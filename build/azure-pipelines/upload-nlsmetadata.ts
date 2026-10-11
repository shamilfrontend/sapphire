/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { ClientAssertionCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

const commit = process.env.BUILD_SOURCEVERSION!;
const credential = new ClientAssertionCredential(
  process.env.AZURE_TENANT_ID!,
  process.env.AZURE_CLIENT_ID!,
  () => Promise.resolve(process.env.AZURE_ID_TOKEN!),
);

interface NlsMetadata {
  keys: { [module: string]: any };
  messages: { [module: string]: any };
  bundles: { [bundle: string]: string[] };
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function convertPackageNls(json: Record<string, string>): NlsMetadata {
  return {
    messages: { package: Object.values(json) as string[] },
    keys: { package: Object.keys(json) as string[] },
    bundles: { main: ['package'] },
  };
}

function convertExtensionNlsMetadata(json: Record<string, any>): NlsMetadata {
  const modules = Object.keys(json);
  const result: NlsMetadata = {
    keys: {},
    messages: {},
    bundles: { main: [] },
  };
  for (const module of modules) {
    result.messages[module] = json[module].messages;
    result.keys[module] = json[module].keys;
    result.bundles.main.push(module);
  }
  return result;
}

function buildCombinedMetadata(): any {
  const combined: Record<string, any> = {};
  combined.vscode = {
    keys: readJson(path.join('out-build', 'nls.keys.json')),
    messages: readJson(path.join('out-build', 'nls.messages.json')),
  };

  const extensionsRoot = path.join('.build', 'extensions');
  if (!fs.existsSync(extensionsRoot)) {
    return combined;
  }

  const extensionDirs = fs.readdirSync(extensionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const dir of extensionDirs) {
    const folderPath = path.join(extensionsRoot, dir.name);
    const manifestPath = path.join(folderPath, 'package.json');
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    const manifest = readJson(manifestPath);
    const extensionKey = `${manifest.publisher}.${manifest.name}`;
    const target = combined[extensionKey] ?? {};

    const metadataPath = path.join(folderPath, 'nls.metadata.json');
    if (fs.existsSync(metadataPath)) {
      Object.assign(target, convertExtensionNlsMetadata(readJson(metadataPath)));
    }

    const headerPath = path.join(folderPath, 'nls.metadata.header.json');
    if (fs.existsSync(headerPath)) {
      target.header = readJson(headerPath);
    }

    const packageNlsPath = path.join(folderPath, 'package.nls.json');
    if (fs.existsSync(packageNlsPath)) {
      Object.assign(target, convertPackageNls(readJson(packageNlsPath)));
    }

    combined[extensionKey] = target;
  }

  return combined;
}

async function uploadGzip(fileName: string, contents: Buffer): Promise<void> {
  const account = process.env.AZURE_STORAGE_ACCOUNT!;
  const blobServiceClient = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    credential,
  );
  const containerClient = blobServiceClient.getContainerClient('$web');
  const blobPath = `nlsmetadata/${commit}/${fileName}`;
  const blobClient = containerClient.getBlockBlobClient(blobPath);

  const gzipContents = zlib.gzipSync(contents);
  await blobClient.uploadData(gzipContents, {
    blobHTTPHeaders: {
      blobContentType: fileName.endsWith('.js') ? 'application/javascript' : 'application/json',
      blobContentEncoding: 'gzip',
      blobCacheControl: 'max-age=31536000, public',
    },
  });
}

async function main(): Promise<void> {
  fs.mkdirSync('./nlsMetadata', { recursive: true });
  const combined = buildCombinedMetadata();
  const combinedContent = Buffer.from(JSON.stringify(combined));
  const nlsMessagesJsContent = fs.readFileSync(path.join('out-build', 'nls.messages.js'));

  const combinedGzipPath = path.join('nlsMetadata', 'combined.nls.metadata.json');
  const messagesGzipPath = path.join('nlsMetadata', 'nls.messages.js');
  fs.writeFileSync(combinedGzipPath, zlib.gzipSync(combinedContent));
  fs.writeFileSync(messagesGzipPath, zlib.gzipSync(nlsMessagesJsContent));

  console.log(`Uploading ${combinedGzipPath}`);
  console.log(
    `##vso[artifact.upload containerfolder=nlsmetadata;artifactname=combined.nls.metadata.json]${combinedGzipPath}`,
  );
  await uploadGzip('combined.nls.metadata.json', combinedContent);

  console.log(`Uploading ${messagesGzipPath}`);
  console.log(
    `##vso[artifact.upload containerfolder=nlsmetadata;artifactname=nls.messages.js]${messagesGzipPath}`,
  );
  await uploadGzip('nls.messages.js', nlsMessagesJsContent);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import es from 'event-stream';
import Vinyl from 'vinyl';
import vfs from 'vinyl-fs';
import zlib from 'zlib';
import mime from 'mime';
import { ClientAssertionCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

const commit = process.env.BUILD_SOURCEVERSION;
const credential = new ClientAssertionCredential(
  process.env.AZURE_TENANT_ID!,
  process.env.AZURE_CLIENT_ID!,
  () => Promise.resolve(process.env.AZURE_ID_TOKEN!),
);

mime.define({
  'application/typescript': ['ts'],
  'application/json': ['code-snippets'],
});

// From default AFD configuration
const MimeTypesToCompress = new Set([
  'application/eot',
  'application/font',
  'application/font-sfnt',
  'application/javascript',
  'application/json',
  'application/opentype',
  'application/otf',
  'application/pkcs7-mime',
  'application/truetype',
  'application/ttf',
  'application/typescript',
  'application/vnd.ms-fontobject',
  'application/xhtml+xml',
  'application/xml',
  'application/xml+rss',
  'application/x-font-opentype',
  'application/x-font-truetype',
  'application/x-font-ttf',
  'application/x-httpd-cgi',
  'application/x-javascript',
  'application/x-mpegurl',
  'application/x-opentype',
  'application/x-otf',
  'application/x-perl',
  'application/x-ttf',
  'font/eot',
  'font/ttf',
  'font/otf',
  'font/opentype',
  'image/svg+xml',
  'text/css',
  'text/csv',
  'text/html',
  'text/javascript',
  'text/js',
  'text/markdown',
  'text/plain',
  'text/richtext',
  'text/tab-separated-values',
  'text/xml',
  'text/x-script',
  'text/x-component',
  'text/x-java-source',
]);

function wait(stream: es.ThroughStream): Promise<void> {
  return new Promise<void>((c, e) => {
    stream.on('end', () => c());
    stream.on('error', (err: any) => e(err));
  });
}

function uploadToAzure({
  prefix,
  compressed,
}: {
  prefix: string;
  compressed: boolean;
}): NodeJS.ReadWriteStream {
  const account = process.env.AZURE_STORAGE_ACCOUNT!;
  const container = '$web';
  const blobServiceClient = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    credential,
  );
  const containerClient = blobServiceClient.getContainerClient(container);

  return es.map(async (file: Vinyl, cb) => {
    try {
      const blobPath = `${prefix}${file.relative.replace(/\\/g, '/')}`;
      const blobClient = containerClient.getBlockBlobClient(blobPath);
      const contentType = mime.lookup(file.path) || undefined;
      const contents = file.contents as Buffer;
      await blobClient.uploadData(contents, {
        blobHTTPHeaders: {
          blobContentType: typeof contentType === 'string' ? contentType : undefined,
          blobContentEncoding: compressed ? 'gzip' : undefined,
          blobCacheControl: 'max-age=31536000, public',
        },
      });
      cb(undefined, file);
    } catch (error) {
      cb(error as Error);
    }
  });
}

function gzipContents(): NodeJS.ReadWriteStream {
  return es.mapSync((file: Vinyl) => {
    const contents = file.contents as Buffer;
    file.contents = zlib.gzipSync(contents);
    return file;
  });
}

function filterStream(predicate: (file: Vinyl) => boolean): NodeJS.ReadWriteStream {
  return es.through(function (file: Vinyl) {
    if (predicate(file)) {
      this.emit('data', file);
    }
  });
}

async function main(): Promise<void> {
  const files: string[] = [];
  const prefix = `${process.env.VSCODE_QUALITY}/${commit}/`;

  const all = vfs
    .src('**', { cwd: '../vscode-web', base: '../vscode-web', dot: true })
    .pipe(filterStream((f) => !f.isDirectory()));

  const compressed = all
    .pipe(filterStream((f) => MimeTypesToCompress.has(mime.lookup(f.path))))
    .pipe(gzipContents())
    .pipe(uploadToAzure({ prefix, compressed: true }));

  const uncompressed = all
    .pipe(filterStream((f) => !MimeTypesToCompress.has(mime.lookup(f.path))))
    .pipe(uploadToAzure({ prefix, compressed: false }));

  const out = es.merge(compressed, uncompressed).pipe(
    es.through(function (f) {
      console.log('Uploaded:', f.relative);
      files.push(f.relative);
      this.emit('data', f);
    }),
  );

  console.log(`Uploading files to CDN...`); // debug
  await wait(out);

  const listing = new Vinyl({
    path: 'files.txt',
    contents: Buffer.from(files.join('\n')),
    stat: { mode: 0o666 } as any,
  });

  const filesOut = es
    .readArray([listing])
    .pipe(gzipContents())
    .pipe(uploadToAzure({ prefix, compressed: true }));

  console.log(`Uploading: files.txt (${files.length} files)`); // debug
  await wait(filesOut);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

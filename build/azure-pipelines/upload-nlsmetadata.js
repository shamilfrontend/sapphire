"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const zlib_1 = __importDefault(require("zlib"));
const identity_1 = require("@azure/identity");
const storage_blob_1 = require("@azure/storage-blob");
const commit = process.env['BUILD_SOURCEVERSION'];
const credential = new identity_1.ClientAssertionCredential(process.env['AZURE_TENANT_ID'], process.env['AZURE_CLIENT_ID'], () => Promise.resolve(process.env['AZURE_ID_TOKEN']));
function readJson(filePath) {
    return JSON.parse(fs_1.default.readFileSync(filePath, 'utf8'));
}
function convertPackageNls(json) {
    return {
        messages: { package: Object.values(json) },
        keys: { package: Object.keys(json) },
        bundles: { main: ['package'] }
    };
}
function convertExtensionNlsMetadata(json) {
    const modules = Object.keys(json);
    const result = {
        keys: {},
        messages: {},
        bundles: { main: [] }
    };
    for (const module of modules) {
        result.messages[module] = json[module].messages;
        result.keys[module] = json[module].keys;
        result.bundles.main.push(module);
    }
    return result;
}
function buildCombinedMetadata() {
    const combined = {};
    combined.vscode = {
        keys: readJson(path_1.default.join('out-build', 'nls.keys.json')),
        messages: readJson(path_1.default.join('out-build', 'nls.messages.json')),
    };
    const extensionsRoot = path_1.default.join('.build', 'extensions');
    if (!fs_1.default.existsSync(extensionsRoot)) {
        return combined;
    }
    const extensionDirs = fs_1.default
        .readdirSync(extensionsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory());
    for (const dir of extensionDirs) {
        const folderPath = path_1.default.join(extensionsRoot, dir.name);
        const manifestPath = path_1.default.join(folderPath, 'package.json');
        if (!fs_1.default.existsSync(manifestPath)) {
            continue;
        }
        const manifest = readJson(manifestPath);
        const extensionKey = `${manifest.publisher}.${manifest.name}`;
        const target = combined[extensionKey] || {};
        const metadataPath = path_1.default.join(folderPath, 'nls.metadata.json');
        if (fs_1.default.existsSync(metadataPath)) {
            Object.assign(target, convertExtensionNlsMetadata(readJson(metadataPath)));
        }
        const headerPath = path_1.default.join(folderPath, 'nls.metadata.header.json');
        if (fs_1.default.existsSync(headerPath)) {
            target.header = readJson(headerPath);
        }
        const packageNlsPath = path_1.default.join(folderPath, 'package.nls.json');
        if (fs_1.default.existsSync(packageNlsPath)) {
            Object.assign(target, convertPackageNls(readJson(packageNlsPath)));
        }
        combined[extensionKey] = target;
    }
    return combined;
}
async function uploadGzip(fileName, contents) {
    const account = process.env.AZURE_STORAGE_ACCOUNT;
    const blobServiceClient = new storage_blob_1.BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
    const containerClient = blobServiceClient.getContainerClient('$web');
    const blobPath = `nlsmetadata/${commit}/${fileName}`;
    const blobClient = containerClient.getBlockBlobClient(blobPath);
    const gzipContents = zlib_1.default.gzipSync(contents);
    await blobClient.uploadData(gzipContents, {
        blobHTTPHeaders: {
            blobContentType: fileName.endsWith('.js') ? 'application/javascript' : 'application/json',
            blobContentEncoding: 'gzip',
            blobCacheControl: 'max-age=31536000, public',
        },
    });
}
async function main() {
    fs_1.default.mkdirSync('./nlsMetadata', { recursive: true });
    const combined = buildCombinedMetadata();
    const combinedContent = Buffer.from(JSON.stringify(combined));
    const nlsMessagesJsContent = fs_1.default.readFileSync(path_1.default.join('out-build', 'nls.messages.js'));
    const combinedGzipPath = path_1.default.join('nlsMetadata', 'combined.nls.metadata.json');
    const messagesGzipPath = path_1.default.join('nlsMetadata', 'nls.messages.js');
    fs_1.default.writeFileSync(combinedGzipPath, zlib_1.default.gzipSync(combinedContent));
    fs_1.default.writeFileSync(messagesGzipPath, zlib_1.default.gzipSync(nlsMessagesJsContent));
    console.log(`Uploading ${combinedGzipPath}`);
    console.log(`##vso[artifact.upload containerfolder=nlsmetadata;artifactname=combined.nls.metadata.json]${combinedGzipPath}`);
    await uploadGzip('combined.nls.metadata.json', combinedContent);
    console.log(`Uploading ${messagesGzipPath}`);
    console.log(`##vso[artifact.upload containerfolder=nlsmetadata;artifactname=nls.messages.js]${messagesGzipPath}`);
    await uploadGzip('nls.messages.js', nlsMessagesJsContent);
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=upload-nlsmetadata.js.map
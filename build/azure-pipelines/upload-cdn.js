"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const event_stream_1 = __importDefault(require("event-stream"));
const vinyl_1 = __importDefault(require("vinyl"));
const vinyl_fs_1 = __importDefault(require("vinyl-fs"));
const zlib_1 = __importDefault(require("zlib"));
const mime_1 = __importDefault(require("mime"));
const identity_1 = require("@azure/identity");
const storage_blob_1 = require("@azure/storage-blob");
const commit = process.env['BUILD_SOURCEVERSION'];
const credential = new identity_1.ClientAssertionCredential(process.env['AZURE_TENANT_ID'], process.env['AZURE_CLIENT_ID'], () => Promise.resolve(process.env['AZURE_ID_TOKEN']));
mime_1.default.define({
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
    'text/x-java-source'
]);
function wait(stream) {
    return new Promise((c, e) => {
        stream.on('end', () => c());
        stream.on('error', (err) => e(err));
    });
}
function uploadToAzure({ prefix, compressed }) {
    const account = process.env.AZURE_STORAGE_ACCOUNT;
    const container = '$web';
    const blobServiceClient = new storage_blob_1.BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
    const containerClient = blobServiceClient.getContainerClient(container);
    return event_stream_1.default.map(async (file, cb) => {
        try {
            const blobPath = `${prefix}${file.relative.replace(/\\/g, '/')}`;
            const blobClient = containerClient.getBlockBlobClient(blobPath);
            const contentType = mime_1.default.lookup(file.path) || undefined;
            const contents = file.contents;
            await blobClient.uploadData(contents, {
                blobHTTPHeaders: {
                    blobContentType: typeof contentType === 'string' ? contentType : undefined,
                    blobContentEncoding: compressed ? 'gzip' : undefined,
                    blobCacheControl: 'max-age=31536000, public'
                }
            });
            cb(undefined, file);
        }
        catch (error) {
            cb(error);
        }
    });
}
function gzipContents() {
    return event_stream_1.default.mapSync((file) => {
        const contents = file.contents;
        file.contents = zlib_1.default.gzipSync(contents);
        return file;
    });
}
function filterStream(predicate) {
    return event_stream_1.default.through(function (file) {
        if (predicate(file)) {
            this.emit('data', file);
        }
    });
}
async function main() {
    const files = [];
    const prefix = `${process.env.VSCODE_QUALITY}/${commit}/`;
    const all = vinyl_fs_1.default.src('**', { cwd: '../vscode-web', base: '../vscode-web', dot: true })
        .pipe(filterStream((f) => !f.isDirectory()));
    const compressed = all
        .pipe(filterStream((f) => MimeTypesToCompress.has(mime_1.default.lookup(f.path))))
        .pipe(gzipContents())
        .pipe(uploadToAzure({ prefix, compressed: true }));
    const uncompressed = all
        .pipe(filterStream((f) => !MimeTypesToCompress.has(mime_1.default.lookup(f.path))))
        .pipe(uploadToAzure({ prefix, compressed: false }));
    const out = event_stream_1.default.merge(compressed, uncompressed)
        .pipe(event_stream_1.default.through(function (f) {
        console.log('Uploaded:', f.relative);
        files.push(f.relative);
        this.emit('data', f);
    }));
    console.log(`Uploading files to CDN...`); // debug
    await wait(out);
    const listing = new vinyl_1.default({
        path: 'files.txt',
        contents: Buffer.from(files.join('\n')),
        stat: { mode: 0o666 }
    });
    const filesOut = event_stream_1.default.readArray([listing])
        .pipe(gzipContents())
        .pipe(uploadToAzure({ prefix, compressed: true }));
    console.log(`Uploading: files.txt (${files.length} files)`); // debug
    await wait(filesOut);
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=upload-cdn.js.map
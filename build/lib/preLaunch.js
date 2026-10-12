"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-check
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rootDir = path_1.default.resolve(__dirname, '..', '..');
function runProcess(command, args = []) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)(command, args, { cwd: rootDir, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
        child.on('exit', err => !err ? resolve() : process.exit(err ?? 1));
        child.on('error', reject);
    });
}
async function exists(subdir) {
    try {
        await fs_1.promises.stat(path_1.default.join(rootDir, subdir));
        return true;
    }
    catch {
        return false;
    }
}
async function ensureNodeModules() {
    if (!(await exists('node_modules'))) {
        await runProcess(npm, ['ci']);
    }
}
async function getElectron() {
    await runProcess(npm, ['run', 'electron']);
}
async function ensureCompiled() {
    if (!(await exists('out'))) {
        await runProcess(npm, ['run', 'compile']);
    }
}
// Vue.volar resolves ./dist/extension.js inside typescript-language-features.
// Production webpack emits that file; dev compiles to out/extension.js instead.
// A missing dist entry aborts Vue activation with MODULE_NOT_FOUND.
const tsExtensionDevShim = [
    '// Dev stand-in for the webpack bundle. The extension host still loads ./out/extension.js.',
    "module.exports = require('../out/extension.js');",
    '',
].join('\n');
async function ensureTypeScriptExtensionDevEntry() {
    const distEntry = path_1.default.join(rootDir, 'extensions', 'typescript-language-features', 'dist', 'extension.js');
    try {
        await fs_1.promises.stat(distEntry);
        return;
    }
    catch {
        // webpack bundle is absent in dev
    }
    await fs_1.promises.mkdir(path_1.default.dirname(distEntry), { recursive: true });
    await fs_1.promises.writeFile(distEntry, tsExtensionDevShim);
}
async function main() {
    await ensureNodeModules();
    await getElectron();
    await ensureCompiled();
    await ensureTypeScriptExtensionDevEntry();
    // Can't require this until after dependencies are installed
    const { getBuiltInExtensions } = require('./builtInExtensions');
    await getBuiltInExtensions();
}
if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=preLaunch.js.map

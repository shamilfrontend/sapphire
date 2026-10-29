/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * A linker-signed Electron dev app has no stable code identity, so macOS Keychain
 * drops "Always Allow" and prompts on every launch. A real ad-hoc signature keeps
 * the same cdhash until the binary changes. Re-signing a stable bundle would mint
 * a new cdhash and bring the prompt back, so this is intentionally one-shot.
 */
export function hasStableDevSignature(codesignOutput: string): boolean {
	if (/linker-signed/.test(codesignOutput) || /Info\.plist=not bound/.test(codesignOutput) || /not signed/.test(codesignOutput)) {
		return false;
	}
	return /Info\.plist entries=/.test(codesignOutput);
}

export function darwinElectronAppPath(repoRoot: string): string {
	const product = JSON.parse(fs.readFileSync(path.join(repoRoot, 'product.json'), 'utf8')) as { nameLong?: string };
	if (!product.nameLong) {
		throw new Error('product.json is missing nameLong');
	}
	return path.join(repoRoot, '.build', 'electron', `${product.nameLong}.app`);
}

function capture(command: string, args: readonly string[]): Promise<{ code: number; output: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		const chunks: Buffer[] = [];
		child.stdout?.on('data', chunk => chunks.push(chunk));
		child.stderr?.on('data', chunk => chunks.push(chunk));
		child.on('error', reject);
		child.on('close', code => resolve({ code: code ?? 1, output: Buffer.concat(chunks).toString('utf8') }));
	});
}

export async function ensureDarwinDevAdhocSignature(repoRoot: string, platform: NodeJS.Platform = process.platform): Promise<void> {
	if (platform !== 'darwin') {
		return;
	}

	const appPath = darwinElectronAppPath(repoRoot);
	try {
		await fs.promises.stat(appPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return;
		}
		throw error;
	}

	const details = await capture('codesign', ['-dv', '--verbose=2', appPath]);
	if (details.code === 0 && hasStableDevSignature(details.output)) {
		return;
	}

	console.log(`Ad-hoc signing ${appPath} so the macOS keychain can remember access...`);
	const signed = await capture('codesign', ['--force', '--deep', '--sign', '-', appPath]);
	if (signed.code !== 0) {
		throw new Error(`codesign failed (${signed.code}): ${signed.output}`);
	}

	const verified = await capture('codesign', ['-dv', '--verbose=2', appPath]);
	if (verified.code !== 0 || !hasStableDevSignature(verified.output)) {
		throw new Error(`Ad-hoc signature did not stick:\n${verified.output}`);
	}
}

if (import.meta.main) {
	const root = path.dirname(path.dirname(import.meta.dirname));
	ensureDarwinDevAdhocSignature(root).catch(err => {
		console.error(err);
		process.exit(1);
	});
}

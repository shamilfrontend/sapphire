/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { spawn } = require('node:child_process') as typeof import('node:child_process');
const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');
type ChildProcess = import('node:child_process').ChildProcess;
type Readable = import('node:stream').Readable;

const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

const mainJs = path.join(root, 'out/main.js');
const vueSourceOut = path.join(root, 'src/vs/workbench/contrib/sapphire/browser/vue/out');
const vueSourceMarker = path.join(vueSourceOut, 'sidebar-tsx/index.js');
const vueRuntimeOut = path.join(root, 'out/vs/workbench/contrib/sapphire/browser/vue/out');
const vueRuntimeMarker = path.join(vueRuntimeOut, 'sidebar-tsx/index.js');
const runAll = path.join(root, 'node_modules/npm-run-all2/bin/npm-run-all/index.js');

const waitLogIntervalMs = 10_000;
const stopGraceMs = 2_000;

let watchers: ChildProcess | null = null;
let app: ChildProcess | null = null;
let shuttingDown = false;
let watcherStatus: { code: number | null; signal: NodeJS.Signals | null } | null = null;
let transpileReady = false;
let vueBuildReady = false;

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function isFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
	if (!pid) {
		return;
	}
	try {
		if (isWin) {
			spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
		} else {
			process.kill(-pid, signal);
		}
	} catch (err) {
		const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
		if (code !== 'ESRCH' && watchers?.pid === pid) {
			try {
				watchers.kill(signal);
			} catch {
				// already gone
			}
		}
	}
}

async function stopWatchers(): Promise<void> {
	const current = watchers;
	const pid = current?.pid;
	if (!current || !pid) {
		return;
	}
	killProcessGroup(pid, 'SIGINT');
	const started = Date.now();
	while (current.exitCode === null && current.signalCode === null && Date.now() - started < stopGraceMs) {
		await delay(100);
	}
	killProcessGroup(pid, 'SIGKILL');
}

async function finish(exitCode: number): Promise<void> {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	if (app && app.exitCode === null && !app.killed) {
		try {
			app.kill('SIGINT');
		} catch {
			// already gone
		}
	}
	await stopWatchers();
	if (app && app.exitCode === null) {
		try {
			app.kill('SIGKILL');
		} catch {
			// already gone
		}
	}
	process.exit(exitCode);
}

function noteWatcherLine(line: string): void {
	// watch-client-transpile deletes out/ before the first build, so a pre-existing
	// out/main.js is not a launch signal. Wait for that first pass to finish.
	if (!transpileReady && line.includes('Finished transpilation with')) {
		transpileReady = true;
	}
	if (!vueBuildReady && line.includes('Initial build complete')) {
		vueBuildReady = true;
	}
}

function attachWatcherOutput(stream: Readable | null): void {
	if (!stream) {
		return;
	}
	let buffer = '';
	stream.on('data', (chunk: Buffer | string) => {
		process.stdout.write(chunk);
		buffer += chunk.toString();
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? '';
		for (const line of lines) {
			noteWatcherLine(line);
		}
	});
}

async function waitForInitialBuild(): Promise<boolean> {
	console.log('[dev] waiting for the initial build...');
	let lastLog = Date.now();
	while (!transpileReady || !vueBuildReady || !isFile(mainJs) || !isFile(vueSourceMarker)) {
		if (shuttingDown) {
			return false;
		}
		if (watcherStatus) {
			const reason = watcherStatus.signal ?? watcherStatus.code ?? 1;
			throw new Error(`[dev] watchers exited (${reason}) before the initial build was ready`);
		}
		if (Date.now() - lastLog >= waitLogIntervalMs) {
			const missing: string[] = [];
			if (!transpileReady || !isFile(mainJs)) {
				missing.push('client transpile');
			}
			if (!vueBuildReady || !isFile(vueSourceMarker)) {
				missing.push('Vue bundle');
			}
			console.log(`[dev] still waiting for ${missing.join(' and ')}...`);
			lastLog = Date.now();
		}
		await delay(500);
	}
	return true;
}

function syncVueRuntime(): void {
	if (isFile(vueRuntimeMarker)) {
		return;
	}
	fs.mkdirSync(path.dirname(vueRuntimeOut), { recursive: true });
	fs.cpSync(vueSourceOut, vueRuntimeOut, { recursive: true });
	console.log(`[dev] synced Vue bundle → ${path.relative(root, vueRuntimeOut)}`);
}

function startWatchers(): void {
	if (!isFile(runAll)) {
		console.error('[dev] npm-run-all2 is missing. Run npm install first.');
		process.exit(1);
	}
	watchers = spawn(process.execPath, [runAll, '-lp', 'watch', 'watchvue'], {
		cwd: root,
		stdio: ['inherit', 'pipe', 'pipe'],
		detached: !isWin,
		env: process.env,
	});
	attachWatcherOutput(watchers.stdout);
	attachWatcherOutput(watchers.stderr);
	watchers.on('error', err => {
		console.error('[dev] failed to start watchers:', err);
		process.exit(1);
	});
	watchers.on('exit', (code, signal) => {
		watcherStatus = { code, signal };
		if (!shuttingDown && app) {
			console.error(`[dev] watchers exited (${signal ?? code ?? 1})`);
		}
	});
}

function startApp(args: string[]): ChildProcess {
	if (isWin) {
		return spawn(path.join(root, 'scripts/code.bat'), args, {
			cwd: root,
			stdio: 'inherit',
			env: process.env,
			shell: true,
		});
	}
	return spawn(path.join(root, 'scripts/code.sh'), args, {
		cwd: root,
		stdio: 'inherit',
		env: process.env,
	});
}

process.on('SIGINT', () => {
	void finish(130);
});
process.on('SIGTERM', () => {
	void finish(143);
});

async function main(): Promise<void> {
	try {
		startWatchers();
		const buildReady = await waitForInitialBuild();
		if (!buildReady || shuttingDown) {
			await finish(130);
		} else {
			syncVueRuntime();
			console.log('[dev] starting');
			app = startApp(process.argv.slice(2));
			app.on('error', err => {
				console.error('[dev] failed to start the app:', err);
				void finish(1);
			});
			app.on('exit', (code, signal) => {
				if (shuttingDown) {
					return;
				}
				const exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
				void finish(exitCode);
			});
		}
	} catch (err) {
		console.error(err instanceof Error ? err.message : err);
		await stopWatchers();
		process.exit(watcherStatus?.code || 1);
	}
}

void main();

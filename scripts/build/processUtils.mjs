import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Command failed: ${command} ${args.join(' ')} (code=${code ?? 'null'}, signal=${signal ?? 'none'})`,
        ),
      );
    });
  });
}

export async function runCommandsSequential(commands) {
  for (const command of commands) {
    await runCommand(command.command, command.args, command.options);
  }
}

export function spawnLongRunning(command, args = [], options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    ...options,
  });

  child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });

  return child;
}

export async function waitForChildren(children) {
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve, reject) => {
          child.on('exit', (code, signal) => {
            if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
              resolve();
              return;
            }
            reject(
              new Error(
                `Child exited with code=${code ?? 'null'} signal=${signal ?? 'none'}`,
              ),
            );
          });
          child.on('error', reject);
        }),
    ),
  );
}

export function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
}

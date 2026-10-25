/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import {
  ITerminalCapabilityImplMap,
  TerminalCapability,
} from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { URI } from '../../../../base/common/uri.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import {
  ITerminalService,
  ITerminalInstance,
  ICreateTerminalOptions,
} from '../../../../workbench/contrib/terminal/browser/terminal.js';
import {
  MAX_TERMINAL_ABSOLUTE_TIME,
  MAX_TERMINAL_BG_COMMAND_TIME,
  MAX_TERMINAL_CHARS,
  MAX_TERMINAL_INACTIVE_TIME,
} from '../common/prompt/prompts.js';
import { TerminalResolveReason } from '../common/toolsServiceTypes.js';
import { timeout } from '../../../../base/common/async.js';

export interface ITerminalToolService {
  readonly _serviceBrand: undefined;

  listPersistentTerminalIds(): string[];
  runCommand(
    command: string,
    opts:
      | { type: 'persistent'; persistentTerminalId: string }
      | { type: 'temporary'; cwd: string | null; terminalId: string },
  ): Promise<{
    interrupt: () => void;
    resPromise: Promise<{ result: string; resolveReason: TerminalResolveReason }>;
  }>;

  focusPersistentTerminal(terminalId: string): Promise<void>;
  persistentTerminalExists(terminalId: string): boolean;

  readTerminal(terminalId: string): Promise<string>;

  createPersistentTerminal(opts: { cwd: string | null }): Promise<string>;
  killPersistentTerminal(terminalId: string): Promise<void>;

  getPersistentTerminal(terminalId: string): ITerminalInstance | undefined;
  getTemporaryTerminal(terminalId: string): ITerminalInstance | undefined;
}
export const ITerminalToolService = createDecorator<ITerminalToolService>('TerminalToolService');

export const persistentTerminalNameOfId = (id: string) => {
  if (id === '1') {return 'Sapphire Agent';}
  return `Sapphire Agent (${id})`;
};
const idOfPersistentTerminalName = (name: string) => {
  if (name === 'Sapphire Agent') {return '1';}

  const match = name.match(/Sapphire Agent \((\d+)\)/);
  if (!match) {return null;}
  if (Number.isInteger(Number(match[1])) && Number(match[1]) >= 1) {return match[1];}
  return null;
};

/** Только OSC/CSI/control — не сбрасывать таймер неактивности. */
const isMostlyControlData = (data: string): boolean => {
  const stripped = data
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  return stripped.trim().length === 0;
};

const truncateTerminalResult = (result: string): string => {
  if (result.length <= MAX_TERMINAL_CHARS) {
    return result;
  }
  const half = MAX_TERMINAL_CHARS / 2;
  return `${result.slice(0, half)}\n...\n${result.slice(result.length - half)}`;
};

function terminalConfigName(config: ICreateTerminalOptions['config']): string | undefined {
  if (!config || typeof config !== 'object') {
    return undefined;
  }
  const name = (config as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

class TerminalToolService extends Disposable implements ITerminalToolService {
  readonly _serviceBrand: undefined;

  private persistentTerminalInstanceOfId: Record<string, ITerminalInstance> = {};

  private temporaryTerminalInstanceOfId: Record<string, ITerminalInstance> = {};

  constructor(
    @ITerminalService private readonly terminalService: ITerminalService,
    @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
    @IFileService private readonly fileService: IFileService,
  ) {
    super();

    const initializeTerminal = (terminal: ITerminalInstance) => {
      const d = terminal.onExit(() => {
        const terminalId = idOfPersistentTerminalName(terminal.title);
        if (terminalId !== null && Object.hasOwn(this.persistentTerminalInstanceOfId, terminalId)) {
          delete this.persistentTerminalInstanceOfId[terminalId];
        }
        d.dispose();
      });
    };

    for (const terminal of terminalService.instances) {
      const proposedTerminalId = idOfPersistentTerminalName(terminal.title);
      if (proposedTerminalId) {
        this.persistentTerminalInstanceOfId[proposedTerminalId] = terminal;
      }
      initializeTerminal(terminal);
    }

    this._register(
      terminalService.onDidCreateInstance((terminal) => {
        initializeTerminal(terminal);
      }),
    );
  }

  listPersistentTerminalIds() {
    return Object.keys(this.persistentTerminalInstanceOfId);
  }

  getValidNewTerminalId(): string {
    const n = Object.keys(this.persistentTerminalInstanceOfId).length;
    if (n === 0) {return '1';}

    for (let i = 1; i <= n + 1; i++) {
      const potentialId = `${i}`;
      if (!Object.hasOwn(this.persistentTerminalInstanceOfId, potentialId)) {return potentialId;}
    }
    throw new Error('This should never be reached by pigeonhole principle');
  }

  private _resolveCwdIgnoreCase(cwdPath: string): string | null {
    const absLower = cwdPath.replace(/\\/g, '/').toLowerCase();
    for (const folder of this.workspaceContextService.getWorkspace().folders) {
      const folderPath = folder.uri.fsPath;
      const folderNorm = folderPath.replace(/\\/g, '/');
      const folderLower = folderNorm.toLowerCase();
      if (absLower === folderLower) {
        return folderPath;
      }
      if (absLower.startsWith(folderLower.endsWith('/') ? folderLower : `${folderLower}/`)) {
        const remainder = cwdPath.replace(/\\/g, '/').slice(folderNorm.length);
        const sep = folderPath.includes('\\') ? '\\' : '/';
        const rem =
          remainder.startsWith('/') || remainder.startsWith('\\') ? remainder.slice(1) : remainder;
        return rem ? `${folderPath}${sep}${rem.replace(/\//g, sep)}` : folderPath;
      }
    }
    return null;
  }

  private async _resolveExistingCwd(
    override_cwd: string | null,
  ): Promise<URI | string | undefined> {
    const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
    if (!override_cwd) {
      return workspaceFolder;
    }

    const tryStat = async (pathOrUri: string | URI): Promise<URI | string | null> => {
      const uri = typeof pathOrUri === 'string' ? URI.file(pathOrUri) : pathOrUri;
      try {
        const stat = await this.fileService.stat(uri);
        if (stat.isDirectory) {
          return typeof pathOrUri === 'string' ? pathOrUri : uri;
        }
      } catch {
        // терминал не найден / недоступен
      }
      return null;
    };

    const direct = await tryStat(override_cwd);
    if (direct !== null) {
      return direct;
    }

    const caseFixed = this._resolveCwdIgnoreCase(override_cwd);
    if (caseFixed) {
      const fixed = await tryStat(caseFixed);
      if (fixed !== null) {
        return fixed;
      }
    }

    return workspaceFolder;
  }

  private async _createTerminal(props: {
    cwd: string | null;
    config: ICreateTerminalOptions['config'];
    hidden?: boolean;
  }) {
    const { cwd: override_cwd, config, hidden } = props;

    const cwd = await this._resolveExistingCwd(override_cwd);

    const options: ICreateTerminalOptions = {
      cwd,
      location: hidden ? undefined : TerminalLocation.Panel,
      config: {
        name: terminalConfigName(config),
        forceShellIntegration: true,
        hideFromUser: hidden ? true : undefined,
        ...config,
      },
      skipContributedProfileCheck: true,
    };

    return this.terminalService.createTerminal(options);
  }

  createPersistentTerminal: ITerminalToolService['createPersistentTerminal'] = async ({ cwd }) => {
    const startedAt = Date.now();
    const budgetMs = () =>
      Math.max(0, MAX_TERMINAL_ABSOLUTE_TIME * 1000 - (Date.now() - startedAt));

    try {
      await Promise.race([
        this.terminalService.whenConnected,
        timeout(budgetMs() || 1).then(() => {
          throw new Error('connect-timeout');
        }),
      ]);
    } catch {
      throw new Error(
        `Timed out after ${MAX_TERMINAL_ABSOLUTE_TIME}s waiting for the terminal service to connect.`,
      );
    }

    if (budgetMs() <= 0) {
      throw new Error(
        `Timed out after ${MAX_TERMINAL_ABSOLUTE_TIME}s before the persistent terminal could be created.`,
      );
    }

    const terminalId = this.getValidNewTerminalId();
    const config = {
      name: persistentTerminalNameOfId(terminalId),
      title: persistentTerminalNameOfId(terminalId),
    };
    try {
      const terminal = await Promise.race([
        this._createTerminal({ cwd, config }),
        timeout(budgetMs()).then(() => {
          throw new Error('create-timeout');
        }),
      ]);
      this.persistentTerminalInstanceOfId[terminalId] = terminal;
      return terminalId;
    } catch (error) {
      if (error instanceof Error && error.message === 'create-timeout') {
        throw new Error(
          `Timed out after ${MAX_TERMINAL_ABSOLUTE_TIME}s creating the persistent terminal.`,
        );
      }
      throw error;
    }
  };

  async killPersistentTerminal(terminalId: string) {
    const terminal = this.persistentTerminalInstanceOfId[terminalId];
    if (!terminal) {throw new Error(`Kill Terminal: Terminal with ID ${terminalId} did not exist.`);}
    terminal.dispose();
    delete this.persistentTerminalInstanceOfId[terminalId];
  }

  persistentTerminalExists(terminalId: string): boolean {
    return Object.hasOwn(this.persistentTerminalInstanceOfId, terminalId);
  }

  getTemporaryTerminal(terminalId: string): ITerminalInstance | undefined {
    if (!terminalId) {return;}
    return this.temporaryTerminalInstanceOfId[terminalId];
  }

  getPersistentTerminal(terminalId: string): ITerminalInstance | undefined {
    if (!terminalId) {return;}
    return this.persistentTerminalInstanceOfId[terminalId];
  }

  focusPersistentTerminal: ITerminalToolService['focusPersistentTerminal'] = async (terminalId) => {
    if (!terminalId) {return;}
    const terminal = this.persistentTerminalInstanceOfId[terminalId];
    if (!terminal) {return;}
    this.terminalService.setActiveInstance(terminal);
    await this.terminalService.focusActiveInstance();
  };

  readTerminal: ITerminalToolService['readTerminal'] = async (terminalId) => {
    const terminal =
      this.getPersistentTerminal(terminalId) ?? this.getTemporaryTerminal(terminalId);
    if (!terminal) {
      throw new Error(`Read Terminal: Terminal with ID ${terminalId} does not exist.`);
    }

    if (!terminal.xterm) {
      throw new Error(
        'Read Terminal: The requested terminal has not yet been rendered and therefore has no scrollback buffer available.',
      );
    }

    const lines: string[] = [];
    for (const line of terminal.xterm.getBufferReverseIterator()) {
      lines.unshift(line);
    }

    return truncateTerminalResult(removeAnsiEscapeCodes(lines.join('\n')));
  };

  private async _waitForCommandDetectionCapability(terminal: ITerminalInstance, maxMs: number) {
    const cmdCap = terminal.capabilities.get(TerminalCapability.CommandDetection);
    if (cmdCap) {return cmdCap;}
    if (maxMs <= 0) {return undefined;}

    const disposables: IDisposable[] = [];
    const waitTimeout = timeout(maxMs);
    const waitForCapability = new Promise<
      ITerminalCapabilityImplMap[TerminalCapability.CommandDetection]
    >((res) => {
      disposables.push(
        terminal.capabilities.onDidAddCapability((e) => {
          if (e.id === TerminalCapability.CommandDetection) {res(e.capability);}
        }),
      );
    });

    const capability = await Promise.any([waitTimeout, waitForCapability]).finally(() => {
      disposables.forEach((d) => d.dispose());
    });

    return capability ?? undefined;
  }

  runCommand: ITerminalToolService['runCommand'] = async (command, params) => {
    const { type } = params;
    const isPersistent = type === 'persistent';
    const startedAt = Date.now();
    const absoluteBudgetMs = () =>
      Math.max(0, MAX_TERMINAL_ABSOLUTE_TIME * 1000 - (Date.now() - startedAt));

    let terminal: ITerminalInstance | undefined;
    const disposables: IDisposable[] = [];
    let resolveUserInterrupt: (() => void) | undefined;
    let interruptForceDispose = false;

    const sendCtrlC = () => {
      if (!terminal) {
        return;
      }
      try {
        terminal.sendText('\x03', false);
      } catch {
        // терминал уже закрыт
      }
    };

    const cleanupTerminal = () => {
      if (!terminal) {return;}
      try {
        terminal.dispose();
      } catch {
        // уже disposed
      }
      if (!isPersistent) {
        delete this.temporaryTerminalInstanceOfId[params.terminalId];
      } else {
        delete this.persistentTerminalInstanceOfId[params.persistentTerminalId];
      }
      terminal = undefined;
    };

    // Persistent: Ctrl+C (сессию оставляем); повторный interrupt — dispose. Temp: сразу dispose.
    const interrupt = () => {
      sendCtrlC();
      resolveUserInterrupt?.();
      if (!isPersistent) {
        cleanupTerminal();
        return;
      }
      if (interruptForceDispose) {
        cleanupTerminal();
      } else {
        interruptForceDispose = true;
      }
    };

    const waitForResult = async (): Promise<{
      result: string;
      resolveReason: TerminalResolveReason;
    }> => {
      const timeoutResult = (
        message: string,
        captured = '',
      ): {
        result: string;
        resolveReason: TerminalResolveReason;
      } => {
        const body = captured.trim() ? captured : message;
        const result = isPersistent ? body : `$ ${command}\n${body}`;
        return {
          result: truncateTerminalResult(removeAnsiEscapeCodes(result)),
          resolveReason: { type: 'timeout' },
        };
      };

      // Жёсткий deadline: connect + create + run.
      if (absoluteBudgetMs() <= 0) {
        return timeoutResult('Timed out before the terminal could start.');
      }

      try {
        await Promise.race([
          this.terminalService.whenConnected,
          timeout(absoluteBudgetMs()).then(() => {
            throw new Error('connect-timeout');
          }),
        ]);
      } catch {
        return timeoutResult(
          `Timed out after ${MAX_TERMINAL_ABSOLUTE_TIME}s waiting for the terminal service to connect.`,
        );
      }

      if (absoluteBudgetMs() <= 0) {
        return timeoutResult('Timed out before the terminal could be created.');
      }

      try {
        if (isPersistent) {
          terminal = this.persistentTerminalInstanceOfId[params.persistentTerminalId];
          if (!terminal) {
            throw new Error(
              `Unexpected internal error: Terminal with ID ${params.persistentTerminalId} did not exist.`,
            );
          }
        } else {
          terminal = await Promise.race([
            this._createTerminal({ cwd: params.cwd, config: undefined, hidden: true }),
            timeout(absoluteBudgetMs()).then(() => {
              throw new Error('create-timeout');
            }),
          ]);
          this.temporaryTerminalInstanceOfId[params.terminalId] = terminal;
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'create-timeout') {
          return timeoutResult(
            `Timed out after ${MAX_TERMINAL_ABSOLUTE_TIME}s creating the terminal.`,
          );
        }
        throw error;
      }

      // сырой PTY, если xterm не подключён
      let capturedData = '';
      disposables.push(
        terminal.onData((data) => {
          capturedData += data;
        }),
      );

      // ждать процесс PTY, не только instance
      await Promise.race([
        terminal.processReady,
        timeout(Math.min(15_000, Math.max(absoluteBudgetMs(), 1))),
      ]);

      if (isPersistent) {
        this.terminalService.setActiveInstance(terminal);
        await this.terminalService.focusActiveInstance();
      }

      let result = '';
      let resolveReason: TerminalResolveReason | undefined;

      const cmdCap = await this._waitForCommandDetectionCapability(
        terminal,
        Math.min(10_000, absoluteBudgetMs()),
      );

      const waitUntilDone = new Promise<void>((resolve) => {
        if (!cmdCap) {return;}
        const l = cmdCap.onCommandFinished((cmd) => {
          if (resolveReason) {return;}
          resolveReason = { type: 'done', exitCode: cmd.exitCode ?? 0 };
          result = cmd.getOutput() ?? '';
          l.dispose();
          resolve();
        });
        disposables.push(l);
      });

      const waitUntilAbsolute = !isPersistent
        ? new Promise<void>((res) => {
            const ms = absoluteBudgetMs();
            if (ms <= 0) {
              if (!resolveReason) {resolveReason = { type: 'timeout' };}
              res();
              return;
            }
            const id = setTimeout(() => {
              if (resolveReason) {return;}
              resolveReason = { type: 'timeout' };
              res();
            }, ms);
            disposables.push(toDisposable(() => clearTimeout(id)));
          })
        : undefined;

      const waitUntilBgTimeout = isPersistent
        ? new Promise<void>((res) => {
            const id = setTimeout(() => {
              if (resolveReason) {return;}
              resolveReason = { type: 'timeout' };
              res();
            }, MAX_TERMINAL_BG_COMMAND_TIME * 1000);
            disposables.push(toDisposable(() => clearTimeout(id)));
          })
        : undefined;

      const waitUntilInactive = !isPersistent
        ? new Promise<void>((res) => {
            let globalTimeoutId: ReturnType<typeof setTimeout>;
            const resetTimer = () => {
              clearTimeout(globalTimeoutId);
              globalTimeoutId = setTimeout(() => {
                if (resolveReason) {return;}
                resolveReason = { type: 'timeout' };
                res();
              }, MAX_TERMINAL_INACTIVE_TIME * 1000);
            };

            const dTimeout = terminal!.onData((data) => {
              if (!isMostlyControlData(data)) {
                resetTimer();
              }
            });
            disposables.push(
              dTimeout,
              toDisposable(() => clearTimeout(globalTimeoutId)),
            );
            resetTimer();
          })
        : undefined;

      const waitUntilUserInterrupt = new Promise<void>((res) => {
        resolveUserInterrupt = () => {
          if (!resolveReason) {
            resolveReason = { type: 'timeout' };
          }
          res();
        };
      });

      // как runCommand: очистить ввод, send
      // runCommand: void — не в Promise.race
      const promptModel = cmdCap?.promptInputModel;
      if (!cmdCap || (promptModel && promptModel.value.length > 0)) {
        await terminal.sendText('\x03', false);
        await timeout(100);
      }

      await Promise.race([
        terminal.sendText(command, true),
        ...(waitUntilAbsolute ? [waitUntilAbsolute] : []),
      ]);

      if (!resolveReason) {
        await Promise.any(
          [
            waitUntilDone,
            waitUntilBgTimeout,
            waitUntilInactive,
            waitUntilUserInterrupt,
            ...(waitUntilAbsolute ? [waitUntilAbsolute] : []),
          ].filter(Boolean) as Promise<void>[],
        );
      }

      disposables.forEach((d) => d.dispose());

      if (resolveReason?.type === 'timeout') {
        // Остановить BG-команду (persistent session сохраняем).
        sendCtrlC();
        await timeout(50);
        const terminalId = isPersistent ? params.persistentTerminalId : params.terminalId;
        try {
          result = await this.readTerminal(terminalId);
        } catch {
          result = removeAnsiEscapeCodes(capturedData);
        }
        if (!result.trim()) {
          result = removeAnsiEscapeCodes(capturedData);
        }
      }

      if (!isPersistent) {
        cleanupTerminal();
      }

      if (!resolveReason) {
        throw new Error(
          'Unexpected internal error: Promise.any should have resolved with a reason.',
        );
      }

      if (!isPersistent) {
        result = `$ ${command}\n${result}`;
      }
      result = truncateTerminalResult(removeAnsiEscapeCodes(result));

      return { result, resolveReason };
    };

    // interrupt сразу после register temp terminal
    // setup внутри resPromise в рамках budget
    return {
      interrupt,
      resPromise: waitForResult(),
    };
  };
}

registerSingleton(ITerminalToolService, TerminalToolService, InstantiationType.Delayed);

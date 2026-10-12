/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh, isNative, OS } from '../../../../base/common/platform.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import {
  IWorkspaceContextService,
  WorkbenchState,
} from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import {
  $,
  addDisposableListener,
  append,
  clearNode,
  EventType,
  getWindow,
  h,
} from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { KeybindingLabel } from '../../../../base/browser/ui/keybindingLabel/keybindingLabel.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { splitRecentLabel } from '../../../../base/common/labels.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { defaultKeybindingLabelStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import {
  editorForeground,
  registerColor,
  transparent,
} from '../../../../platform/theme/common/colorRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import {
  isRecentFolder,
  IRecentFolder,
  IWorkspacesService,
} from '../../../../platform/workspaces/common/workspaces.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ILabelService, Verbosity } from '../../../../platform/label/common/label.js';
import { ColorScheme } from '../../web.api.js';
import { OpenFileFolderAction, OpenFolderAction } from '../../actions/workspaceActions.js';
import { IWindowOpenable } from '../../../../platform/window/common/window.js';

/* eslint-disable */ // Sapphire
import {
  SAPPHIRE_CMD_SHIFT_L_ACTION_ID,
  SAPPHIRE_MAXIMIZE_CHAT_ACTION_ID,
} from '../../../contrib/sapphire/browser/actionIDs.js';
/* eslint-enable */

// interface WatermarkEntry {
// 	readonly id: string;
// 	readonly text: string;
// 	readonly when?: {
// 		native?: ContextKeyExpression;
// 		web?: ContextKeyExpression;
// 	};
// }

// const showCommands: WatermarkEntry = { text: localize('watermark.showCommands', "Show All Commands"), id: 'workbench.action.showCommands' };
// const gotoFile: WatermarkEntry = { text: localize('watermark.quickAccess', "Go to File"), id: 'workbench.action.quickOpen' };
// const openFile: WatermarkEntry = { text: localize('watermark.openFile', "Open File"), id: 'workbench.action.files.openFile' };
// const openFolder: WatermarkEntry = { text: localize('watermark.openFolder', "Open Folder"), id: 'workbench.action.files.openFolder' };
// const openFileOrFolder: WatermarkEntry = { text: localize('watermark.openFileFolder', "Open File or Folder"), id: 'workbench.action.files.openFileFolder' };
// const openRecent: WatermarkEntry = { text: localize('watermark.openRecent', "Open Recent"), id: 'workbench.action.openRecent' };
// const newUntitledFile: WatermarkEntry = { text: localize('watermark.newUntitledFile', "New Untitled Text File"), id: 'workbench.action.files.newUntitledFile' };
// const findInFiles: WatermarkEntry = { text: localize('watermark.findInFiles', "Find in Files"), id: 'workbench.action.findInFiles' };
// const toggleTerminal: WatermarkEntry = { text: localize({ key: 'watermark.toggleTerminal', comment: ['toggle is a verb here'] }, "Toggle Terminal"), id: 'workbench.action.terminal.toggleTerminal', when: { web: ContextKeyExpr.equals('terminalProcessSupported', true) } };
// const startDebugging: WatermarkEntry = { text: localize('watermark.startDebugging', "Start Debugging"), id: 'workbench.action.debug.start', when: { web: ContextKeyExpr.equals('terminalProcessSupported', true) } };
// const openSettings: WatermarkEntry = { text: localize('watermark.openSettings', "Open Settings"), id: 'workbench.action.openSettings' };

// const showCopilot = ContextKeyExpr.or(ContextKeyExpr.equals('chatSetupHidden', false), ContextKeyExpr.equals('chatSetupInstalled', true));
// const openChat: WatermarkEntry = { text: localize('watermark.openChat', "Open Chat"), id: 'workbench.action.chat.open', when: { native: showCopilot, web: showCopilot } };
// const openCopilotEdits: WatermarkEntry = { text: localize('watermark.openCopilotEdits', "Open Copilot Edits"), id: 'workbench.action.chat.openEditSession', when: { native: showCopilot, web: showCopilot } };

// const emptyWindowEntries: WatermarkEntry[] = coalesce([
// 	showCommands,
// 	...(isMacintosh && !isWeb ? [openFileOrFolder] : [openFile, openFolder]),
// 	openRecent,
// 	isMacintosh && !isWeb ? newUntitledFile : undefined, // fill in one more on macOS to get to 5 entries
// 	openChat
// ]);

// const randomEmptyWindowEntries: WatermarkEntry[] = [
// 	/* Nothing yet */
// ];

// const workspaceEntries: WatermarkEntry[] = [
// 	showCommands,
// 	gotoFile,
// 	openChat
// ];

// const randomWorkspaceEntries: WatermarkEntry[] = [
// 	findInFiles,
// 	startDebugging,
// 	toggleTerminal,
// 	openSettings,
// 	openCopilotEdits
// ];

export class EditorGroupWatermark extends Disposable {
  private readonly shortcuts: HTMLElement;

  private readonly transientDisposables = this._register(new DisposableStore());

  // private enabled: boolean = false;
  private workbenchState: WorkbenchState;

  private currentDisposables = new Set<IDisposable>();

  constructor(
    container: HTMLElement,
    @IKeybindingService private readonly keybindingService: IKeybindingService,
    @IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
    // @IContextKeyService private readonly contextKeyService: IContextKeyService,
    @IConfigurationService private readonly configurationService: IConfigurationService,
    @IThemeService private readonly themeService: IThemeService,
    @IWorkspacesService private readonly workspacesService: IWorkspacesService,
    @ICommandService private readonly commandService: ICommandService,
    @IHostService private readonly hostService: IHostService,
    @ILabelService private readonly labelService: ILabelService,
  ) {
    super();

    const elements = h('.editor-group-watermark', [
      h('.letterpress@icon'),
      h('.shortcuts@shortcuts'),
    ]);

    append(container, elements.root);
    this.shortcuts = elements.shortcuts; // shortcuts div is modified on render()

    // Cursor-style letterpress: larger semi-transparent crystal watermark
    const updateTheme = () => {
      const theme = this.themeService.getColorTheme().type;
      const isDark = theme === ColorScheme.DARK || theme === ColorScheme.HIGH_CONTRAST_DARK;
      elements.icon.style.maxWidth = '180px';
      elements.icon.style.opacity = isDark ? '0.7' : '0.65';
      elements.icon.style.filter = isDark ? '' : 'invert(1)';
    };
    updateTheme();
    this._register(this.themeService.onDidColorThemeChange(updateTheme));

    this.registerListeners();

    this.workbenchState = contextService.getWorkbenchState();
    this.render();
  }

  private registerListeners(): void {
    this._register(
      this.configurationService.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('workbench.tips.enabled')) {
          this.render();
        }
      }),
    );

    this._register(
      this.contextService.onDidChangeWorkbenchState((workbenchState) => {
        if (this.workbenchState === workbenchState) {
          return;
        }

        this.workbenchState = workbenchState;
        this.render();
      }),
    );

    // const allEntriesWhenClauses = [...noFolderEntries, ...folderEntries].filter(entry => entry.when !== undefined).map(entry => entry.when!);
    // const allKeys = new Set<string>();
    // allEntriesWhenClauses.forEach(when => when.keys().forEach(key => allKeys.add(key)));
    // this._register(this.contextKeyService.onDidChangeContext(e => {
    // 	if (e.affectsSome(allKeys)) {
    // 		this.render();
    // 	}
    // }));
  }

  private render(): void {
    this.clear();
    const sapphireIconBox = append(this.shortcuts, $('.watermark-box'));
    const emptyActions = append(this.shortcuts, $('.sapphire-empty-actions'));
    const recentsBox = append(this.shortcuts, $('.sapphire-recent-list'));

    const update = async () => {
      // put async at top so don't need to wait (this prevents a jitter on load)
      const recentlyOpened = await this.workspacesService
        .getRecentlyOpened()
        .catch(() => ({ files: [], workspaces: [] }))
        .then((w) => w.workspaces);

      clearNode(sapphireIconBox);
      clearNode(emptyActions);
      clearNode(recentsBox);

      this.currentDisposables.forEach((label) => label.dispose());
      this.currentDisposables.clear();

      if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
        const openFolderButton = append(emptyActions, $('button.sapphire-openfolder-button'));
        openFolderButton.textContent = localize('sapphire.watermark.openFolder', 'Открыть папку');
        openFolderButton.onclick = () => {
          this.commandService.executeCommand(
            isMacintosh && isNative ? OpenFileFolderAction.ID : OpenFolderAction.ID,
          );
        };

        const recentFolders: IRecentFolder[] = [];
        for (const recent of recentlyOpened) {
          if (isRecentFolder(recent)) {
            recentFolders.push(recent);
            if (recentFolders.length === 5) {
              break;
            }
          }
        }
        this.renderRecentFolders(recentsBox, recentFolders);
      } else {
        const workspaceWatermarkEntries: { text: string; id: string }[] = [
          { text: 'New Agent', id: SAPPHIRE_CMD_SHIFT_L_ACTION_ID },
          { text: 'Show Terminal', id: 'workbench.action.terminal.toggleTerminal' },
          { text: 'Show Files', id: 'workbench.view.explorer' },
          { text: 'Search Files', id: 'workbench.action.quickOpen' },
          { text: 'Maximize Chat', id: SAPPHIRE_MAXIMIZE_CHAT_ACTION_ID },
          { text: 'Add Repository', id: 'git.clone' },
        ];

        for (const entry of workspaceWatermarkEntries) {
          this.renderWatermarkEntry(sapphireIconBox, entry.text, entry.id);
        }
      }
    };

    update();
    this.transientDisposables.add(this.keybindingService.onDidUpdateKeybindings(update));
    this.transientDisposables.add(this.workspacesService.onDidChangeRecentlyOpened(() => update()));
  }

  private renderRecentFolders(container: HTMLElement, folders: IRecentFolder[]): void {
    if (folders.length === 0) {
      return;
    }

    const targetWindow = getWindow(container);
    let confirmingItem: HTMLElement | undefined;

    const applyRemoveButtonState = (button: HTMLElement, confirming: boolean) => {
      button.className = 'sapphire-recent-remove';
      if (confirming) {
        button.classList.add('confirming');
        button.textContent = localize('sapphire.watermark.confirmRemoveRecent', 'Подтвердить');
        button.title = localize(
          'sapphire.watermark.confirmRemoveRecentTitle',
          'Подтвердить удаление из списка',
        );
        button.setAttribute(
          'aria-label',
          localize('sapphire.watermark.confirmRemoveRecentTitle', 'Подтвердить удаление из списка'),
        );
      } else {
        button.textContent = '';
        button.classList.add(...ThemeIcon.asClassNameArray(Codicon.close));
        button.title = localize('sapphire.watermark.removeRecent', 'Удалить из списка');
        button.setAttribute(
          'aria-label',
          localize('sapphire.watermark.removeRecent', 'Удалить из списка'),
        );
      }
    };

    const setConfirming = (item: HTMLElement | undefined) => {
      if (confirmingItem && confirmingItem !== item) {
        confirmingItem.classList.remove('confirming');
        const previousButton = confirmingItem.querySelector('.sapphire-recent-remove');
        if (previousButton instanceof HTMLElement) {
          applyRemoveButtonState(previousButton, false);
        }
      }

      confirmingItem = item;
      if (item) {
        item.classList.add('confirming');
        const button = item.querySelector('.sapphire-recent-remove');
        if (button instanceof HTMLElement) {
          applyRemoveButtonState(button, true);
        }
      }
    };

    for (const folder of folders) {
      const windowOpenable: IWindowOpenable = { folderUri: folder.folderUri };
      const fullPath =
        folder.label ||
        this.labelService.getWorkspaceLabel(folder.folderUri, { verbose: Verbosity.LONG });
      const { name, parentPath } = splitRecentLabel(fullPath);

      const item = append(container, $('.sapphire-recent-item'));
      item.title = fullPath;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute(
        'aria-label',
        localize('sapphire.watermark.openRecentFolder', 'Открыть папку {0}', fullPath),
      );

      const nameSpan = append(item, $('span.sapphire-recent-name'));
      nameSpan.textContent = name;

      const pathSpan = append(item, $('span.sapphire-recent-path'));
      pathSpan.textContent = parentPath;

      const removeButton = append(item, $('button.sapphire-recent-remove'));
      applyRemoveButtonState(removeButton, false);

      this.currentDisposables.add(
        addDisposableListener(item, EventType.CLICK, (e) => {
          this.hostService.openWindow([windowOpenable], {
            forceNewWindow: e.ctrlKey || e.metaKey,
            remoteAuthority: folder.remoteAuthority || null,
          });
          e.preventDefault();
          e.stopPropagation();
        }),
      );

      this.currentDisposables.add(
        addDisposableListener(item, EventType.KEY_DOWN, (e) => {
          const keyEvent = new StandardKeyboardEvent(e);
          if (keyEvent.keyCode === KeyCode.Enter || keyEvent.keyCode === KeyCode.Space) {
            this.hostService.openWindow([windowOpenable], {
              remoteAuthority: folder.remoteAuthority || null,
            });
            e.preventDefault();
            e.stopPropagation();
          }
        }),
      );

      this.currentDisposables.add(
        addDisposableListener(removeButton, EventType.CLICK, (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (item.classList.contains('confirming')) {
            this.workspacesService.removeRecentlyOpened([folder.folderUri]);
            return;
          }

          setConfirming(item);
        }),
      );
    }

    this.currentDisposables.add(
      addDisposableListener(targetWindow, EventType.CLICK, () => setConfirming(undefined)),
    );
    this.currentDisposables.add(
      addDisposableListener(targetWindow, EventType.KEY_DOWN, (e) => {
        const keyEvent = new StandardKeyboardEvent(e);
        if (keyEvent.keyCode === KeyCode.Escape) {
          setConfirming(undefined);
        }
      }),
    );
  }

  private renderWatermarkEntry(container: HTMLElement, text: string, commandId: string): void {
    const keys = this.keybindingService.lookupKeybinding(commandId);
    const dl = append(container, $('dl'));
    dl.onclick = () => {
      this.commandService.executeCommand(commandId);
    };
    const dt = append(dl, $('dt'));
    dt.textContent = text;
    const dd = append(dl, $('dd'));
    const label = new KeybindingLabel(dd, OS, {
      renderUnboundKeybindings: true,
      ...defaultKeybindingLabelStyles,
    });
    if (keys) {
      label.set(keys);
    }
    this.currentDisposables.add(label);
  }

  private clear(): void {
    clearNode(this.shortcuts);
    this.transientDisposables.clear();
  }

  override dispose(): void {
    super.dispose();
    this.clear();
    this.currentDisposables.forEach((label) => label.dispose());
  }
}

registerColor(
  'editorWatermark.foreground',
  {
    dark: transparent(editorForeground, 0.6),
    light: transparent(editorForeground, 0.68),
    hcDark: editorForeground,
    hcLight: editorForeground,
  },
  localize('editorLineHighlight', 'Foreground color for the labels in the editor watermark.'),
);

// /*---------------------------------------------------------------------------------------------
//  *  Copyright (c) Microsoft Corporation. All rights reserved.
//  *  Licensed under the MIT License. See License.txt in the project root for license information.
//  *--------------------------------------------------------------------------------------------*/

// import { $, append, clearNode, h } from '../../../../base/browser/dom.js';
// import { KeybindingLabel } from '../../../../base/browser/ui/keybindingLabel/keybindingLabel.js';
// import { coalesce, shuffle } from '../../../../base/common/arrays.js';
// import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
// import { isMacintosh, isWeb, OS } from '../../../../base/common/platform.js';
// import { localize } from '../../../../nls.js';
// import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
// import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
// import { ContextKeyExpr, ContextKeyExpression, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
// import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
// import { IStorageService, StorageScope, StorageTarget, WillSaveStateReason } from '../../../../platform/storage/common/storage.js';
// import { defaultKeybindingLabelStyles } from '../../../../platform/theme/browser/defaultStyles.js';
// import { editorForeground, registerColor, transparent } from '../../../../platform/theme/common/colorRegistry.js';
// import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';

// interface WatermarkEntry {
// 	readonly id: string;
// 	readonly text: string;
// 	readonly when?: {
// 		native?: ContextKeyExpression;
// 		web?: ContextKeyExpression;
// 	};
// }

// const showCommands: WatermarkEntry = { text: localize('watermark.showCommands', "Show All Commands"), id: 'workbench.action.showCommands' };
// const gotoFile: WatermarkEntry = { text: localize('watermark.quickAccess', "Go to File"), id: 'workbench.action.quickOpen' };
// const openFile: WatermarkEntry = { text: localize('watermark.openFile', "Open File"), id: 'workbench.action.files.openFile' };
// const openFolder: WatermarkEntry = { text: localize('watermark.openFolder', "Open Folder"), id: 'workbench.action.files.openFolder' };
// const openFileOrFolder: WatermarkEntry = { text: localize('watermark.openFileFolder', "Open File or Folder"), id: 'workbench.action.files.openFileFolder' };
// const openRecent: WatermarkEntry = { text: localize('watermark.openRecent', "Open Recent"), id: 'workbench.action.openRecent' };
// const newUntitledFile: WatermarkEntry = { text: localize('watermark.newUntitledFile', "New Untitled Text File"), id: 'workbench.action.files.newUntitledFile' };
// const findInFiles: WatermarkEntry = { text: localize('watermark.findInFiles', "Find in Files"), id: 'workbench.action.findInFiles' };
// const toggleTerminal: WatermarkEntry = { text: localize({ key: 'watermark.toggleTerminal', comment: ['toggle is a verb here'] }, "Toggle Terminal"), id: 'workbench.action.terminal.toggleTerminal', when: { web: ContextKeyExpr.equals('terminalProcessSupported', true) } };
// const startDebugging: WatermarkEntry = { text: localize('watermark.startDebugging', "Start Debugging"), id: 'workbench.action.debug.start', when: { web: ContextKeyExpr.equals('terminalProcessSupported', true) } };
// const openSettings: WatermarkEntry = { text: localize('watermark.openSettings', "Open Settings"), id: 'workbench.action.openSettings' };

// const showCopilot = ContextKeyExpr.or(ContextKeyExpr.equals('chatSetupHidden', false), ContextKeyExpr.equals('chatSetupInstalled', true));
// const openChat: WatermarkEntry = { text: localize('watermark.openChat', "Open Chat"), id: 'workbench.action.chat.open', when: { native: showCopilot, web: showCopilot } };

// const emptyWindowEntries: WatermarkEntry[] = coalesce([
// 	showCommands,
// 	...(isMacintosh && !isWeb ? [openFileOrFolder] : [openFile, openFolder]),
// 	openRecent,
// 	isMacintosh && !isWeb ? newUntitledFile : undefined, // fill in one more on macOS to get to 5 entries
// 	openChat
// ]);

// const randomEmptyWindowEntries: WatermarkEntry[] = [
// 	/* Nothing yet */
// ];

// const workspaceEntries: WatermarkEntry[] = [
// 	showCommands,
// 	gotoFile,
// 	openChat
// ];

// const randomWorkspaceEntries: WatermarkEntry[] = [
// 	findInFiles,
// 	startDebugging,
// 	toggleTerminal,
// 	openSettings,
// ];

// export class EditorGroupWatermark extends Disposable {

// 	private static readonly CACHED_WHEN = 'editorGroupWatermark.whenConditions';

// 	private readonly cachedWhen: { [when: string]: boolean };

// 	private readonly shortcuts: HTMLElement;
// 	private readonly transientDisposables = this._register(new DisposableStore());
// 	private readonly keybindingLabels = this._register(new DisposableStore());

// 	private enabled = false;
// 	private workbenchState: WorkbenchState;

// 	constructor(
// 		container: HTMLElement,
// 		@IKeybindingService private readonly keybindingService: IKeybindingService,
// 		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
// 		@IContextKeyService private readonly contextKeyService: IContextKeyService,
// 		@IConfigurationService private readonly configurationService: IConfigurationService,
// 		@IStorageService private readonly storageService: IStorageService
// 	) {
// 		super();

// 		this.cachedWhen = this.storageService.getObject(EditorGroupWatermark.CACHED_WHEN, StorageScope.PROFILE, Object.create(null));
// 		this.workbenchState = this.contextService.getWorkbenchState();

// 		const elements = h('.editor-group-watermark', [
// 			h('.letterpress'),
// 			h('.shortcuts@shortcuts'),
// 		]);

// 		append(container, elements.root);
// 		this.shortcuts = elements.shortcuts;

// 		this.registerListeners();

// 		this.render();
// 	}

// 	private registerListeners(): void {
// 		this._register(this.configurationService.onDidChangeConfiguration(e => {
// 			if (e.affectsConfiguration('workbench.tips.enabled') && this.enabled !== this.configurationService.getValue<boolean>('workbench.tips.enabled')) {
// 				this.render();
// 			}
// 		}));

// 		this._register(this.contextService.onDidChangeWorkbenchState(workbenchState => {
// 			if (this.workbenchState !== workbenchState) {
// 				this.workbenchState = workbenchState;
// 				this.render();
// 			}
// 		}));

// 		this._register(this.storageService.onWillSaveState(e => {
// 			if (e.reason === WillSaveStateReason.SHUTDOWN) {
// 				const entries = [...emptyWindowEntries, ...randomEmptyWindowEntries, ...workspaceEntries, ...randomWorkspaceEntries];
// 				for (const entry of entries) {
// 					const when = isWeb ? entry.when?.web : entry.when?.native;
// 					if (when) {
// 						this.cachedWhen[entry.id] = this.contextKeyService.contextMatchesRules(when);
// 					}
// 				}

// 				this.storageService.store(EditorGroupWatermark.CACHED_WHEN, JSON.stringify(this.cachedWhen), StorageScope.PROFILE, StorageTarget.MACHINE);
// 			}
// 		}));
// 	}

// 	private render(): void {
// 		this.enabled = this.configurationService.getValue<boolean>('workbench.tips.enabled');

// 		clearNode(this.shortcuts);
// 		this.transientDisposables.clear();

// 		if (!this.enabled) {
// 			return;
// 		}

// 		const fixedEntries = this.filterEntries(this.workbenchState !== WorkbenchState.EMPTY ? workspaceEntries : emptyWindowEntries, false /* not shuffled */);
// 		const randomEntries = this.filterEntries(this.workbenchState !== WorkbenchState.EMPTY ? randomWorkspaceEntries : randomEmptyWindowEntries, true /* shuffled */).slice(0, Math.max(0, 5 - fixedEntries.length));
// 		const entries = [...fixedEntries, ...randomEntries];

// 		const box = append(this.shortcuts, $('.watermark-box'));

// 		const update = () => {
// 			clearNode(box);
// 			this.keybindingLabels.clear();

// 			for (const entry of entries) {
// 				const keys = this.keybindingService.lookupKeybinding(entry.id);
// 				if (!keys) {
// 					continue;
// 				}

// 				const dl = append(box, $('dl'));
// 				const dt = append(dl, $('dt'));
// 				dt.textContent = entry.text;

// 				const dd = append(dl, $('dd'));

// 				const label = this.keybindingLabels.add(new KeybindingLabel(dd, OS, { renderUnboundKeybindings: true, ...defaultKeybindingLabelStyles }));
// 				label.set(keys);
// 			}
// 		};

// 		update();
// 		this.transientDisposables.add(this.keybindingService.onDidUpdateKeybindings(update));
// 	}

// 	private filterEntries(entries: WatermarkEntry[], shuffleEntries: boolean): WatermarkEntry[] {
// 		const filteredEntries = entries
// 			.filter(entry => (isWeb && !entry.when?.web) || (!isWeb && !entry.when?.native) || this.cachedWhen[entry.id])
// 			.filter(entry => !!CommandsRegistry.getCommand(entry.id))
// 			.filter(entry => !!this.keybindingService.lookupKeybinding(entry.id));

// 		if (shuffleEntries) {
// 			shuffle(filteredEntries);
// 		}

// 		return filteredEntries;
// 	}
// }

// registerColor('editorWatermark.foreground', { dark: transparent(editorForeground, 0.6), light: transparent(editorForeground, 0.68), hcDark: editorForeground, hcLight: editorForeground }, localize('editorLineHighlight', 'Foreground color for the labels in the editor watermark.'));

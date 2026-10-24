/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh, isNative, OS } from '../../../../base/common/platform.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { $, addDisposableListener, append, clearNode, EventType, getWindow, h } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { KeybindingLabel } from '../../../../base/browser/ui/keybindingLabel/keybindingLabel.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { splitRecentLabel } from '../../../../base/common/labels.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { defaultKeybindingLabelStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { editorForeground } from '../../../../platform/theme/common/colors/editorColors.js';
import { registerColor, transparent } from '../../../../platform/theme/common/colorUtils.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { isRecentFolder, IRecentFolder, IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ILabelService, Verbosity } from '../../../../platform/label/common/label.js';
import { OpenFileFolderAction, OpenFolderAction } from '../../actions/workspaceActions.js';
import { IWindowOpenable } from '../../../../platform/window/common/window.js';

// allow-any-unicode-next-line
// eslint-disable-next-line local/code-import-patterns -- команды пустого экрана живут в contrib/sapphire
import { SAPPHIRE_CMD_SHIFT_L_ACTION_ID, SAPPHIRE_MAXIMIZE_CHAT_ACTION_ID } from '../../../contrib/sapphire/browser/actionIDs.js';

export class EditorGroupWatermark extends Disposable {

	private readonly shortcuts: HTMLElement;
	private readonly transientDisposables = this._register(new DisposableStore());
	private workbenchState: WorkbenchState;
	private currentDisposables = new Set<IDisposable>();

	constructor(
		container: HTMLElement,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@ICommandService private readonly commandService: ICommandService,
		@IHostService private readonly hostService: IHostService,
		@ILabelService private readonly labelService: ILabelService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();

		const elements = h('.editor-group-watermark-wrapper', [
			h('.editor-group-watermark-toolbar-container@toolbarContainer'),
			h('.editor-group-watermark', [
				h('.watermark-container', [
					h('.letterpress'),
					h('.shortcuts@shortcuts'),
				])
			])
		]);

		append(container, elements.root);
		this.shortcuts = elements.shortcuts;

		this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, elements.toolbarContainer, MenuId.EditorGroupWatermarkToolbar, {
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			highlightToggledItems: true,
			menuOptions: { shouldForwardArgs: true }
		}));

		this.workbenchState = this.contextService.getWorkbenchState();
		this.registerListeners();
		this.render();
	}

	private registerListeners(): void {
		this._register(this.contextService.onDidChangeWorkbenchState(workbenchState => {
			if (this.workbenchState === workbenchState) {
				return;
			}

			this.workbenchState = workbenchState;
			this.render();
		}));
	}

	private render(): void {
		this.clear();
		const sapphireIconBox = append(this.shortcuts, $('.watermark-box'));
		const emptyActions = append(this.shortcuts, $('.sapphire-empty-actions'));
		const recentsBox = append(this.shortcuts, $('.sapphire-recent-list'));

		const update = async () => {
			const recentlyOpened = await this.workspacesService.getRecentlyOpened()
				.catch(() => ({ files: [], workspaces: [] }))
				.then(w => w.workspaces);

			clearNode(sapphireIconBox);
			clearNode(emptyActions);
			clearNode(recentsBox);

			this.currentDisposables.forEach(label => label.dispose());
			this.currentDisposables.clear();

			if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
				const openFolderButton = append(emptyActions, $('button.sapphire-openfolder-button'));
				// allow-any-unicode-next-line
				openFolderButton.textContent = localize('sapphire.watermark.openFolder', 'Открыть папку');
				openFolderButton.onclick = () => {
					this.commandService.executeCommand(isMacintosh && isNative ? OpenFileFolderAction.ID : OpenFolderAction.ID);
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
		const removeButtons = new Map<HTMLElement, HTMLElement>();

		const applyRemoveButtonState = (button: HTMLElement, confirming: boolean) => {
			button.className = 'sapphire-recent-remove';
			if (confirming) {
				button.classList.add('confirming');
				// allow-any-unicode-next-line
				button.textContent = localize('sapphire.watermark.confirmRemoveRecent', 'Подтвердить');
				// allow-any-unicode-next-line
				button.title = localize('sapphire.watermark.confirmRemoveRecentTitle', 'Подтвердить удаление из списка');
				// allow-any-unicode-next-line
				button.setAttribute('aria-label', localize('sapphire.watermark.confirmRemoveRecentTitle', 'Подтвердить удаление из списка'));
			} else {
				button.textContent = '';
				button.classList.add(...ThemeIcon.asClassNameArray(Codicon.close));
				// allow-any-unicode-next-line
				button.title = localize('sapphire.watermark.removeRecent', 'Удалить из списка');
				// allow-any-unicode-next-line
				button.setAttribute('aria-label', localize('sapphire.watermark.removeRecent', 'Удалить из списка'));
			}
		};

		const setConfirming = (item: HTMLElement | undefined) => {
			if (confirmingItem && confirmingItem !== item) {
				confirmingItem.classList.remove('confirming');
				const previousButton = removeButtons.get(confirmingItem);
				if (previousButton) {
					applyRemoveButtonState(previousButton, false);
				}
			}

			confirmingItem = item;
			if (item) {
				item.classList.add('confirming');
				const button = removeButtons.get(item);
				if (button) {
					applyRemoveButtonState(button, true);
				}
			}
		};

		for (const folder of folders) {
			const windowOpenable: IWindowOpenable = { folderUri: folder.folderUri };
			const fullPath = folder.label || this.labelService.getWorkspaceLabel(folder.folderUri, { verbose: Verbosity.LONG });
			const { name, parentPath } = splitRecentLabel(fullPath);

			const item = append(container, $('.sapphire-recent-item'));
			item.title = fullPath;
			item.tabIndex = 0;
			item.setAttribute('role', 'button');
			// allow-any-unicode-next-line
			item.setAttribute('aria-label', localize('sapphire.watermark.openRecentFolder', 'Открыть папку {0}', fullPath));

			const nameSpan = append(item, $('span.sapphire-recent-name'));
			nameSpan.textContent = name;

			const pathSpan = append(item, $('span.sapphire-recent-path'));
			pathSpan.textContent = parentPath;

			const removeButton = append(item, $('button.sapphire-recent-remove'));
			removeButtons.set(item, removeButton);
			applyRemoveButtonState(removeButton, false);

			this.currentDisposables.add(addDisposableListener(item, EventType.CLICK, e => {
				this.hostService.openWindow([windowOpenable], {
					forceNewWindow: e.ctrlKey || e.metaKey,
					remoteAuthority: folder.remoteAuthority || null,
				});
				e.preventDefault();
				e.stopPropagation();
			}));

			this.currentDisposables.add(addDisposableListener(item, EventType.KEY_DOWN, e => {
				const keyEvent = new StandardKeyboardEvent(e);
				if (keyEvent.keyCode === KeyCode.Enter || keyEvent.keyCode === KeyCode.Space) {
					this.hostService.openWindow([windowOpenable], {
						remoteAuthority: folder.remoteAuthority || null,
					});
					e.preventDefault();
					e.stopPropagation();
				}
			}));

			this.currentDisposables.add(addDisposableListener(removeButton, EventType.CLICK, e => {
				e.preventDefault();
				e.stopPropagation();

				if (item.classList.contains('confirming')) {
					this.workspacesService.removeRecentlyOpened([folder.folderUri]);
					return;
				}

				setConfirming(item);
			}));
		}

		this.currentDisposables.add(addDisposableListener(targetWindow, EventType.CLICK, () => setConfirming(undefined)));
		this.currentDisposables.add(addDisposableListener(targetWindow, EventType.KEY_DOWN, e => {
			const keyEvent = new StandardKeyboardEvent(e);
			if (keyEvent.keyCode === KeyCode.Escape) {
				setConfirming(undefined);
			}
		}));
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
		const label = new KeybindingLabel(dd, OS, { renderUnboundKeybindings: true, ...defaultKeybindingLabelStyles });
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
		this.currentDisposables.forEach(label => label.dispose());
	}
}

registerColor('editorWatermark.foreground', { dark: transparent(editorForeground, 0.6), light: transparent(editorForeground, 0.68), hcDark: editorForeground, hcLight: editorForeground }, localize('editorLineHighlight', 'Foreground color for the labels in the editor watermark.'));

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { BrowserViewCommandId } from '../../../../platform/browserView/common/browserView.js';
import * as nls from '../../../../nls.js';
import { ActiveEditorContext } from '../../../common/contextkeys.js';
import { BrowserViewEditorId } from '../../browserView/common/browserView.js';

const browserTitlebarIcon = registerIcon(
	'sapphire-browser-titlebar',
	Codicon.globe,
	nls.localize('sapphireBrowserTitlebarIcon', 'Icon for the integrated browser in the title bar.'),
);

const browserTitlebarOnIcon = registerIcon(
	'sapphire-browser-filled',
	Codicon.globe,
	nls.localize('sapphireBrowserFilledIcon', 'Icon for the open integrated browser in the title bar.'),
);

export const SAPPHIRE_OPEN_BROWSER_ACTION_ID = 'sapphire.openBrowser';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SAPPHIRE_OPEN_BROWSER_ACTION_ID,
			title: nls.localize2('sapphireOpenBrowser', 'Sapphire: Open Browser'),
			icon: browserTitlebarIcon,
			f1: true,
			toggled: {
				condition: ActiveEditorContext.isEqualTo(BrowserViewEditorId),
				icon: browserTitlebarOnIcon,
			},
			menu: [
				{
					id: MenuId.LayoutControlMenu,
					when: ContextKeyExpr.or(
						ContextKeyExpr.equals('config.workbench.layoutControl.type', 'toggles'),
						ContextKeyExpr.equals('config.workbench.layoutControl.type', 'both'),
					),
					group: 'navigation',
					order: 1,
				},
			],
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(ICommandService).executeCommand(BrowserViewCommandId.Open);
	}
});

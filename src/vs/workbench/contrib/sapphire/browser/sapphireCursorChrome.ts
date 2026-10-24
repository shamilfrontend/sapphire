/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Color } from '../../../../base/common/color.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ColorScheme } from '../../../../platform/theme/common/theme.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IColorMap, IWorkbenchColorTheme, IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';

const chrome = Color.fromHex('#181818');
const editor = Color.fromHex('#1E1E1E');
const border = Color.fromHex('#2B2B2B');
const accent = Color.fromHex('#007ACC');
const accentHover = Color.fromHex('#1A8AD4');
const white = Color.fromHex('#FFFFFF');
const muted = Color.fromHex('#CCCCCC');
const dim = Color.fromHex('#9D9D9D');
const icon = Color.fromHex('#D7D7D7');
const iconDim = Color.fromHex('#868686');
const pill = Color.fromHex('#2A2A2A');
const pillBorder = Color.fromHex('#3C3C3C');
const pillHover = Color.fromHex('#333333');
const link = Color.fromHex('#4DAAFC');
const linkActive = Color.fromHex('#6CB6FF');
const remote = Color.fromHex('#1688D0');
const clear = Color.white.transparent(0);
const statusHover = Color.white.transparent(0.12);
const statusActive = Color.white.transparent(0.18);

/** Same shell colors as sapphire.css. Parts paint these via getColor(), not CSS variables. */
function cursorChromeColors(theme: IWorkbenchColorTheme): IColorMap {
	if (theme.type !== ColorScheme.DARK) {
		return {};
	}
	return {
		'editor.background': editor,
		'editorGutter.background': editor,
		'editorStickyScroll.background': editor,
		'breadcrumb.background': editor,
		'editorGroup.emptyBackground': editor,
		'editorGroup.border': border,
		'editorGroupHeader.tabsBackground': chrome,
		'editorGroupHeader.tabsBorder': border,
		'editorGroupHeader.noTabsBackground': chrome,
		'titleBar.activeBackground': chrome,
		'titleBar.inactiveBackground': chrome,
		'titleBar.activeForeground': muted,
		'titleBar.inactiveForeground': dim,
		'titleBar.border': border,
		'activityBar.background': chrome,
		'activityBar.foreground': icon,
		'activityBar.inactiveForeground': iconDim,
		'activityBar.border': border,
		'activityBar.activeBorder': accent,
		'activityBar.activeBackground': chrome,
		'activityBarBadge.background': accent,
		'activityBarBadge.foreground': white,
		'sideBar.background': chrome,
		'sideBar.border': border,
		'sideBarSectionHeader.background': chrome,
		'sideBarSectionHeader.border': border,
		'panel.background': chrome,
		'panel.border': border,
		'panelTitle.activeBorder': accent,
		'tab.activeBackground': editor,
		'tab.inactiveBackground': chrome,
		'tab.hoverBackground': editor,
		'tab.unfocusedActiveBackground': editor,
		'tab.unfocusedInactiveBackground': chrome,
		'tab.activeForeground': white,
		'tab.inactiveForeground': dim,
		'tab.border': border,
		'tab.activeBorder': editor,
		'tab.activeBorderTop': accent,
		'statusBar.background': accent,
		'statusBar.foreground': white,
		'statusBar.border': clear,
		'statusBar.noFolderBackground': accent,
		'statusBar.noFolderForeground': white,
		'statusBar.noFolderBorder': clear,
		'statusBar.focusBorder': white,
		'statusBarItem.hoverBackground': statusHover,
		'statusBarItem.hoverForeground': white,
		'statusBarItem.activeBackground': statusActive,
		'statusBarItem.focusBorder': white,
		'statusBarItem.remoteBackground': remote,
		'statusBarItem.remoteForeground': white,
		'commandCenter.background': pill,
		'commandCenter.foreground': muted,
		'commandCenter.border': pillBorder,
		'commandCenter.activeBackground': pillHover,
		'commandCenter.activeForeground': white,
		'commandCenter.activeBorder': pillBorder,
		'commandCenter.inactiveForeground': dim,
		'commandCenter.inactiveBorder': pillBorder,
		'button.background': accent,
		'button.foreground': white,
		'button.hoverBackground': accentHover,
		'button.border': accent,
		'focusBorder': accent,
		'progressBar.background': accent,
		'textLink.foreground': link,
		'textLink.activeForeground': linkActive,
	};
}

class SapphireCursorChromeContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.sapphireCursorChrome';

	constructor(@IWorkbenchThemeService themeService: IWorkbenchThemeService) {
		super();
		this._register(themeService.registerColorThemeOverlay(cursorChromeColors));
	}
}

registerWorkbenchContribution2(
	SapphireCursorChromeContribution.ID,
	SapphireCursorChromeContribution,
	WorkbenchPhase.BlockRestore,
);

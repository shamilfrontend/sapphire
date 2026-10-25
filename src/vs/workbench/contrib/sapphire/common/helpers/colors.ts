/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Color, RGBA } from '../../../../../base/common/color.js';
import { registerColor } from '../../../../../platform/theme/common/colorUtils.js';
import { registerThemingParticipant } from '../../../../../platform/theme/common/themeService.js';

// Синхронно с --void-success / --void-danger в styles.css (палитра Agent)
const sapphireSuccess = '#2f9e6b';
const sapphireDanger = '#d14b5a';

// editCodeService — подсветки inline-diff (достаточно видимые на тёмном фоне)
const sweepBG = new Color(new RGBA(100, 100, 100, 0.2));
const highlightBG = new Color(new RGBA(100, 100, 100, 0.1));
const sweepIdxBG = new Color(new RGBA(100, 100, 100, 0.5));

const acceptBG = new Color(new RGBA(47, 158, 107, 0.22));
const rejectBG = new Color(new RGBA(209, 75, 90, 0.22));

// Цвета кнопок command bar / виджетов
export const acceptAllBg = sapphireSuccess;
export const acceptBg = '#288a5c';
export const acceptBorder = '1px solid #1f6e4a';

export const rejectAllBg = sapphireDanger;
export const rejectBg = '#b83f4d';
export const rejectBorder = '1px solid #8f323d';

export const buttonFontSize = '11px';
export const buttonTextColor = 'white';

const configOfBG = (color: Color) => ({ dark: color, light: color, hcDark: color, hcLight: color });

export const sapphireGreenBG = registerColor('sapphire.greenBG', configOfBG(acceptBG), '', true);
export const sapphireRedBG = registerColor('sapphire.redBG', configOfBG(rejectBG), '', true);
export const sapphireSweepBG = registerColor('sapphire.sweepBG', configOfBG(sweepBG), '', true);
export const sapphireHighlightBG = registerColor('sapphire.highlightBG', configOfBG(highlightBG), '', true);
export const sapphireSweepIdxBG = registerColor('sapphire.sweepIdxBG', configOfBG(sweepIdxBG), '', true);

// Прямые правила темы: не зависят от CSS-переменных / свежести out/.../sapphire.css
registerThemingParticipant((theme, collector) => {
	const rules: Array<[string, string]> = [
		[sapphireGreenBG, '.monaco-editor .sapphire-greenBG'],
		[sapphireRedBG, '.monaco-editor .sapphire-redBG, .sapphire-redBG'],
		[sapphireSweepBG, '.monaco-editor .sapphire-sweepBG'],
		[sapphireHighlightBG, '.monaco-editor .sapphire-highlightBG'],
		[sapphireSweepIdxBG, '.monaco-editor .sapphire-sweepIdxBG'],
	];
	for (const [colorId, selector] of rules) {
		const color = theme.getColor(colorId);
		if (color) {
			collector.addRule(`${selector} { background-color: ${color}; }`);
		}
	}
});

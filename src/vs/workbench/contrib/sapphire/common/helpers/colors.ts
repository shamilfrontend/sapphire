/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Color, RGBA } from '../../../../../base/common/color.js';
import { registerColor } from '../../../../../platform/theme/common/colorUtils.js';

// Синхронно с --void-success / --void-danger в styles.css (палитра Agent)
const sapphireSuccess = '#2f9e6b';
const sapphireDanger = '#d14b5a';

// editCodeService — приглушённые подсветки inline-diff
const sweepBG = new Color(new RGBA(100, 100, 100, 0.2));
const highlightBG = new Color(new RGBA(100, 100, 100, 0.1));
const sweepIdxBG = new Color(new RGBA(100, 100, 100, 0.5));

const acceptBG = new Color(new RGBA(47, 158, 107, 0.12));
const rejectBG = new Color(new RGBA(209, 75, 90, 0.12));

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

// → --vscode-void-greenBG (sapphire.css, asCssVariable)
registerColor('sapphire.greenBG', configOfBG(acceptBG), '', true);
registerColor('sapphire.redBG', configOfBG(rejectBG), '', true);
registerColor('sapphire.sweepBG', configOfBG(sweepBG), '', true);
registerColor('sapphire.highlightBG', configOfBG(highlightBG), '', true);
registerColor('sapphire.sweepIdxBG', configOfBG(sweepIdxBG), '', true);

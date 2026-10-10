/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { shorten } from '../../../../base/common/labels.js';

const CODESPAN_FILE_EXT =
  /\.(?:d\.ts|tsx|ts|jsx|mjs|cjs|js|py|go|rs|java|kt|swift|rb|php|cs|cpp|cc|cxx|c|h|hpp|json|md|yml|yaml|toml|xml|html|css|scss|vue|svelte|sql|sh|bash|zsh|txt)$/i;
const CODESPAN_SYMBOL = /^([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)(\s*\([^)]*\))?$/;

export const classifyCodespan = (
  raw: string,
): { codespanType: 'file-or-folder' | 'function-or-class'; target: string } | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes('/') || trimmed.includes('\\') || CODESPAN_FILE_EXT.test(trimmed)) {
    return { codespanType: 'file-or-folder', target: trimmed };
  }

  const symbolMatch = trimmed.match(CODESPAN_SYMBOL);
  if (symbolMatch?.[1]) {
    const chain = symbolMatch[1].split('.');
    return { codespanType: 'function-or-class', target: chain[chain.length - 1] };
  }

  return null;
};

export const displayPathForCodespan = (uri: URI, candidates: URI[]): string => {
  const idx = candidates.findIndex((u) => u.fsPath === uri.fsPath);
  const shortened = shorten(candidates.map((u) => u.fsPath));
  let displayText = idx >= 0 ? shortened[idx] : uri.fsPath;
  const ellipsisIdx = displayText.lastIndexOf('…/');
  if (ellipsisIdx >= 0) {
    displayText = displayText.slice(ellipsisIdx + 2);
  }
  return displayText;
};

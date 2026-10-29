/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Каталог состояния IDE в корне workspace: индекс и планы. */
export const WORKSPACE_DOT_DIR = '.sapphire';

/** Прежние имена каталога. Переносятся один раз, если нового ещё нет. */
export const LEGACY_WORKSPACE_DOT_DIRS = ['.llm-ide', '.ppr'] as const;

/** @deprecated используйте LEGACY_WORKSPACE_DOT_DIRS */
export const LEGACY_WORKSPACE_DOT_DIR = LEGACY_WORKSPACE_DOT_DIRS[LEGACY_WORKSPACE_DOT_DIRS.length - 1];

export const isUnderWorkspaceStateDir = (relPath: string): boolean => {
	const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
	if (norm === WORKSPACE_DOT_DIR || norm.startsWith(`${WORKSPACE_DOT_DIR}/`)) {
		return true;
	}
	return LEGACY_WORKSPACE_DOT_DIRS.some(
		dir => norm === dir || norm.startsWith(`${dir}/`),
	);
};

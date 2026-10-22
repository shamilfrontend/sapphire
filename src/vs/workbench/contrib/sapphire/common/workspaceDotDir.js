/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/
/** Каталог состояния IDE в корне workspace: индекс, планы, debug-лог. */
export const WORKSPACE_DOT_DIR = '.sapphire';
/** Прежние имена каталога. Переносятся один раз, если нового ещё нет. */
export const LEGACY_WORKSPACE_DOT_DIRS = ['.llm-ide', '.ppr'];
/** @deprecated используйте LEGACY_WORKSPACE_DOT_DIRS */
export const LEGACY_WORKSPACE_DOT_DIR = LEGACY_WORKSPACE_DOT_DIRS[LEGACY_WORKSPACE_DOT_DIRS.length - 1];
export const isUnderWorkspaceStateDir = (relPath) => {
    const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (norm === WORKSPACE_DOT_DIR || norm.startsWith(`${WORKSPACE_DOT_DIR}/`)) {
        return true;
    }
    return LEGACY_WORKSPACE_DOT_DIRS.some(dir => norm === dir || norm.startsWith(`${dir}/`));
};

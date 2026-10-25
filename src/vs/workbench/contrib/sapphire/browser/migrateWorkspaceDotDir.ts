/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { LEGACY_WORKSPACE_DOT_DIRS, WORKSPACE_DOT_DIR } from '../common/workspaceDotDir.js';

/** Если нет `.sapphire`, переименовать первую найденную legacy-папку (`.llm-ide`, затем `.ppr`). */
export async function migrateLegacyWorkspaceDotDir(
	fileService: IFileService,
	root: URI,
): Promise<void> {
	const next = joinPath(root, WORKSPACE_DOT_DIR);
	if (await fileService.exists(next)) {
		return;
	}
	for (const legacyName of LEGACY_WORKSPACE_DOT_DIRS) {
		const legacy = joinPath(root, legacyName);
		if (!(await fileService.exists(legacy))) {
			continue;
		}
		try {
			await fileService.move(legacy, next);
		} catch {
			// Новые записи всё равно пойдут в .sapphire.
		}
		return;
	}
}

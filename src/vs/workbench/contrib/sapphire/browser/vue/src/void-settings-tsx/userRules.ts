/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../../base/common/buffer.js';
import Severity from '../../../../../../../base/common/severity.js';
import { useAccessor } from '../util/services.js';

export type UserRuleDraft = {
  id: string | null; // null — создание нового правила, не редактирование
  name: string;
  content: string;
  enabled: boolean;
};

export const revealSapphireRulesFile = async (accessor: ReturnType<typeof useAccessor>) => {
  const workspaceContextService = accessor.get('IWorkspaceContextService');
  const fileService = accessor.get('IFileService');
  const commandService = accessor.get('ICommandService');
  const notificationService = accessor.get('INotificationService');
  const sapphireModelService = accessor.get('ISapphireModelService');

  const folders = workspaceContextService.getWorkspace().folders;
  if (folders.length === 0) {
    notificationService.notify({
      severity: Severity.Warning,
      message: 'Откройте папку workspace, чтобы создать или редактировать .rules.',
    });
    return;
  }

  const uri = URI.joinPath(folders[0].uri, '.rules');
  const legacyUri = URI.joinPath(folders[0].uri, '.voidrules');
  try {
    const exists = await fileService.exists(uri);
    if (!exists) {
      if (await fileService.exists(legacyUri)) {
        await fileService.move(legacyUri, uri);
      } else {
        await fileService.writeFile(uri, VSBuffer.fromString(''));
      }
    }
  } catch (e) {
    console.error('Error ensuring .rules exists:', e);
  }
  await sapphireModelService.initializeModel(uri);
  await commandService.executeCommand('vscode.open', uri);
};

/** @deprecated use revealSapphireRulesFile */
export const revealVoidRulesFile = revealSapphireRulesFile;

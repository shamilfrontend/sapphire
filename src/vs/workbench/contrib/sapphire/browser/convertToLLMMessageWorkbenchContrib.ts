/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
  IWorkbenchContribution,
  registerWorkbenchContribution2,
  WorkbenchPhase,
} from '../../../common/contributions.js';
import { ISapphireModelService } from '../common/sapphireModelService.js';

class ConvertContribWorkbenchContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.void.convertcontrib';

  _serviceBrand: undefined;

  constructor(
    @ISapphireModelService private readonly sapphireModelService: ISapphireModelService,
    @IWorkspaceContextService private readonly workspaceContext: IWorkspaceContextService,
  ) {
    super();

    const initializeURI = (uri: URI) => {
      this.workspaceContext.getWorkspace();
      const sapphireRulesURI = URI.joinPath(uri, '.rules');
      this.sapphireModelService.initializeModel(sapphireRulesURI);
      const sapphireSkillsURI = URI.joinPath(uri, '.skills');
      this.sapphireModelService.initializeModel(sapphireSkillsURI);
    };

    // Инициализация .rules / .skills при смене workspace
    this._register(
      this.workspaceContext.onDidChangeWorkspaceFolders((e) => {
        [...e.changed, ...e.added].forEach((w) => {
          initializeURI(w.uri);
        });
      }),
    );
    this.workspaceContext.getWorkspace().folders.forEach((w) => {
      initializeURI(w.uri);
    });
  }
}

registerWorkbenchContribution2(
  ConvertContribWorkbenchContribution.ID,
  ConvertContribWorkbenchContribution,
  WorkbenchPhase.BlockRestore,
);

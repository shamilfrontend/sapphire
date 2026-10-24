/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { VIEWLET_ID } from '../../files/common/files.js';
import {
  IWorkbenchContribution,
  registerWorkbenchContribution2,
  WorkbenchPhase,
} from '../../../common/contributions.js';
import { IViewContainerModel, IViewDescriptorService } from '../../../common/views.js';

/** Уже спрятали Outline и Timeline в этом профиле. Повторно не трогаем. */
const MIGRATION_KEY = 'sapphire.explorer.cursorViews.v1';
const HIDDEN_VIEWS = ['outline', 'timeline'];

class SapphireExplorerViewsContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.sapphire.explorerViews';

  constructor(
    @IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
    @IStorageService private readonly storageService: IStorageService,
  ) {
    super();
    this.hideOnce();
  }

  private hideOnce(): void {
    if (this.storageService.getBoolean(MIGRATION_KEY, StorageScope.PROFILE, false)) {
      return;
    }
    const container = this.viewDescriptorService.getViewContainerById(VIEWLET_ID);
    if (!container) {
      return;
    }
    const model = this.viewDescriptorService.getViewContainerModel(container);
    for (const id of HIDDEN_VIEWS) {
      if (!this.hideView(model, id)) {
        return;
      }
    }
    this.storageService.store(MIGRATION_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
  }

  /** false — вид ещё не зарегистрирован, миграцию повторим на следующем старте. */
  private hideView(model: IViewContainerModel, id: string): boolean {
    try {
      if (model.isVisible(id)) {
        model.setVisible(id, false);
      }
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Unknown view')) {
        return false;
      }
      throw error;
    }
  }
}

registerWorkbenchContribution2(
  SapphireExplorerViewsContribution.ID,
  SapphireExplorerViewsContribution,
  WorkbenchPhase.AfterRestored,
);

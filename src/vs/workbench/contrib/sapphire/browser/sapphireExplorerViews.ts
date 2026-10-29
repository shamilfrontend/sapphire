/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { VIEW_ID, VIEWLET_ID } from '../../files/common/files.js';
import {
  IWorkbenchContribution,
  registerWorkbenchContribution2,
  WorkbenchPhase,
} from '../../../common/contributions.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';

/** Уже спрятали Outline и Timeline в этом профиле. Повторно не трогаем. */
const MIGRATION_KEY = 'sapphire.explorer.cursorViews.v1';
/** Вернули Outline и Timeline: в сайдбаре Cursor они свёрнуты внизу. */
const SHOW_KEY = 'sapphire.explorer.cursorViews.v2';
const EXPAND_FILES_KEY = 'sapphire.explorer.cursorViews.v5';
const EXPLORER_VIEWS = ['outline', 'timeline'];

class SapphireExplorerViewsContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.sapphire.explorerViews';

  constructor(
    @IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
    @IStorageService private readonly storageService: IStorageService,
    @IViewsService private readonly viewsService: IViewsService,
  ) {
    super();
    this.hideOnce();
    this.showOnce();
    this.expandFilesOnce();
  }

  private hideOnce(): void {
    if (this.storageService.getBoolean(MIGRATION_KEY, StorageScope.PROFILE, false)) {
      return;
    }
    if (!this.setViewsVisible(false)) {
      return;
    }
    this.storageService.store(MIGRATION_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
  }

  private showOnce(): void {
    if (this.storageService.getBoolean(SHOW_KEY, StorageScope.PROFILE, false)) {
      return;
    }
    if (!this.setViewsVisible(true)) {
      return;
    }
    this.storageService.store(SHOW_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
  }

  private expandFilesOnce(): void {
    if (this.storageService.getBoolean(EXPAND_FILES_KEY, StorageScope.PROFILE, false)) {
      return;
    }
    const container = this.viewDescriptorService.getViewContainerById(VIEWLET_ID);
    if (!container) {
      return;
    }
    const model = this.viewDescriptorService.getViewContainerModel(container);
    try {
      if (!model.isVisible(VIEW_ID)) {
        model.setVisible(VIEW_ID, true);
      }
      model.setCollapsed(VIEW_ID, false);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Unknown view')) {
        return;
      }
      throw error;
    }
    const view = this.viewsService.getViewWithId(VIEW_ID);
    if (!view) {
      const listener = this.viewsService.onDidChangeViewVisibility(event => {
        if (event.id === VIEW_ID && event.visible) {
          listener.dispose();
          this.expandFilesOnce();
        }
      });
      this._register(listener);
      return;
    }
    view.setExpanded(true);
    if (!view.isBodyVisible()) {
      return;
    }
    this.storageService.store(EXPAND_FILES_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
  }

  /** false — вид ещё не зарегистрирован, миграцию повторим на следующем старте. */
  private setViewsVisible(visible: boolean): boolean {
    const container = this.viewDescriptorService.getViewContainerById(VIEWLET_ID);
    if (!container) {
      return false;
    }
    const model = this.viewDescriptorService.getViewContainerModel(container);
    for (const id of EXPLORER_VIEWS) {
      try {
        if (model.isVisible(id) !== visible) {
          model.setVisible(id, visible);
        }
        if (visible) {
          model.setCollapsed(id, true);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Unknown view')) {
          return false;
        }
        throw error;
      }
    }
    return true;
  }
}

registerWorkbenchContribution2(
  SapphireExplorerViewsContribution.ID,
  SapphireExplorerViewsContribution,
  WorkbenchPhase.AfterRestored,
);

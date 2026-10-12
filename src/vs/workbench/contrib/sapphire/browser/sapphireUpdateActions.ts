/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import Severity from '../../../../base/common/severity.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import {
  INotificationActions,
  INotificationHandle,
  INotificationService,
} from '../../../../platform/notification/common/notification.js';
import { ISapphireUpdateService } from '../common/sapphireUpdateService.js';
import {
  IWorkbenchContribution,
  registerWorkbenchContribution2,
  WorkbenchPhase,
} from '../../../common/contributions.js';
import * as dom from '../../../../base/browser/dom.js';
import { IUpdateService } from '../../../../platform/update/common/update.js';
import { SapphireCheckUpdateRespose } from '../common/sapphireUpdateServiceTypes.js';
import { IAction } from '../../../../base/common/actions.js';
import { LLM_IDE_TITLE } from '../common/llmProviderConfig.js';

const notifyUpdate = (
  res: SapphireCheckUpdateRespose & { message: string },
  notifService: INotificationService,
  updateService: IUpdateService,
): INotificationHandle => {
  const message =
    res?.message ||
    `Не удалось проверить обновления ${LLM_IDE_TITLE}.`;

  let actions: INotificationActions | undefined;

  if (res?.action) {
    const primary: IAction[] = [];

    if (res.action === 'download') {
      primary.push({
        label: `Download`,
        id: 'sapphire.updater.download',
        enabled: true,
        tooltip: '',
        class: undefined,
        run: () => {
          updateService.downloadUpdate();
        },
      });
    }

    if (res.action === 'apply') {
      primary.push({
        label: `Apply`,
        id: 'sapphire.updater.apply',
        enabled: true,
        tooltip: '',
        class: undefined,
        run: () => {
          updateService.applyUpdate();
        },
      });
    }

    if (res.action === 'restart') {
      primary.push({
        label: `Restart`,
        id: 'sapphire.updater.restart',
        enabled: true,
        tooltip: '',
        class: undefined,
        run: () => {
          updateService.quitAndInstall();
        },
      });
    }

    actions = {
      primary,
      secondary: [
        {
          id: 'sapphire.updater.close',
          enabled: true,
          label: `Keep current version`,
          tooltip: '',
          class: undefined,
          run: () => {
            notifController.close();
          },
        },
      ],
    };
  } else {
    actions = undefined;
  }

  const notifController = notifService.notify({
    severity: Severity.Info,
    message,
    sticky: true,
    progress: actions ? { worked: 0, total: 100 } : undefined,
    actions,
  });

  return notifController;
};
const notifyErrChecking = (notifService: INotificationService): INotificationHandle => {
  const message = `${LLM_IDE_TITLE}: ошибка проверки обновлений.`;
  const notifController = notifService.notify({
    severity: Severity.Info,
    message,
    sticky: true,
  });
  return notifController;
};

const performVoidCheck = async (
  explicit: boolean,
  notifService: INotificationService,
  sapphireUpdateService: ISapphireUpdateService,
  updateService: IUpdateService,
): Promise<INotificationHandle | null> => {
  const res = await sapphireUpdateService.check(explicit);
  if (!res) {
    const notifController = notifyErrChecking(notifService);
    return notifController;
  }
  if (res.message) {
    const notifController = notifyUpdate(res, notifService, updateService);
    return notifController;
  }
  return null;
};

// Явная проверка обновлений по команде
let lastNotifController: INotificationHandle | null = null;

registerAction2(
  class extends Action2 {
    constructor() {
      super({
        f1: true,
        id: 'sapphire.sapphireCheckUpdate',
        title: localize2('sapphireCheckUpdate', 'Sapphire: Check for Updates'),
      });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
      const sapphireUpdateService = accessor.get(ISapphireUpdateService);
      const notifService = accessor.get(INotificationService);
      const updateService = accessor.get(IUpdateService);

      const currNotifController = lastNotifController;

      const newController = await performVoidCheck(
        true,
        notifService,
        sapphireUpdateService,
        updateService,
      );

      if (newController) {
        currNotifController?.close();
        lastNotifController = newController;
      }
    }
  },
);

// Фоновая проверка после старта workbench
class SapphireUpdateWorkbenchContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.void.sapphireUpdate';

  constructor(
    @ISapphireUpdateService sapphireUpdateService: ISapphireUpdateService,
    @INotificationService notifService: INotificationService,
    @IUpdateService updateService: IUpdateService,
  ) {
    super();

    const autoCheck = () => {
      performVoidCheck(false, notifService, sapphireUpdateService, updateService);
    };

    // Первая проверка через 5 с, далее каждые 3 ч
    const { window } = dom.getActiveWindow();

    const initId = window.setTimeout(() => autoCheck(), 5 * 1000);
    this._register({ dispose: () => window.clearTimeout(initId) });

    const intervalId = window.setInterval(() => autoCheck(), 3 * 60 * 60 * 1000);
    this._register({ dispose: () => window.clearInterval(intervalId) });
  }
}
registerWorkbenchContribution2(
  SapphireUpdateWorkbenchContribution.ID,
  SapphireUpdateWorkbenchContribution,
  WorkbenchPhase.BlockRestore,
);

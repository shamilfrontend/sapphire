/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import {
  IWorkbenchContribution,
  registerWorkbenchContribution2,
  WorkbenchPhase,
} from '../../../common/contributions.js';
import { timeout } from '../../../../base/common/async.js';
import { getActiveWindow } from '../../../../base/browser/dom.js';

// Разовые действия при старте workbench (layout)
class MiscWorkbenchContribs extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.sapphireMiscWorkbenchContribs';

  constructor() {
    super();
    this.initialize();
  }

  private initialize(): void {
    // Через 5 с — resize, обход бага «пустого экрана» после старта
    timeout(5_000).then(() => {
      const targetWindow = getActiveWindow();
      // Пересчёт layout (multi-window)
      targetWindow.dispatchEvent(new Event('resize'));
    });
  }
}

registerWorkbenchContribution2(
  MiscWorkbenchContribs.ID,
  MiscWorkbenchContribs,
  WorkbenchPhase.Eventually,
);

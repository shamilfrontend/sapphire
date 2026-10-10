/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
  IWorkbenchContribution,
  registerWorkbenchContribution2,
  WorkbenchPhase,
} from '../../../common/contributions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { mountSapphireTooltip } from './vue/out/void-tooltip/index.js';
import { h, getActiveWindow } from '../../../../base/browser/dom.js';

// Contribution: монтирует tooltip при старте workbench
export class TooltipContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.sapphireTooltip';

  constructor(@IInstantiationService private readonly instantiationService: IInstantiationService) {
    super();
    this.initializeTooltip();
  }

  private initializeTooltip(): void {
    // Активное окно — поддержка нескольких окон
    const targetWindow = getActiveWindow();

    // .monaco-workbench в контексте этого окна
    const workbench = targetWindow.document.querySelector('.monaco-workbench');

    if (workbench) {
      // Контейнер tooltip через h()
      const tooltipContainer = h('div.sapphire-tooltip-container').root;
      workbench.appendChild(tooltipContainer);

      // Монтируем React
      this.instantiationService.invokeFunction((accessor: ServicesAccessor) => {
        const result = mountSapphireTooltip(tooltipContainer, accessor);
        if (result && typeof result.dispose === 'function') {
          this._register(toDisposable(result.dispose));
        }
      });

      // Очистка DOM при dispose
      this._register(
        toDisposable(() => {
          if (tooltipContainer.parentElement) {
            tooltipContainer.parentElement.removeChild(tooltipContainer);
          }
        }),
      );
    }
  }
}

// Регистрация contribution на фазе AfterRestored
registerWorkbenchContribution2(
  TooltipContribution.ID,
  TooltipContribution,
  WorkbenchPhase.AfterRestored,
);

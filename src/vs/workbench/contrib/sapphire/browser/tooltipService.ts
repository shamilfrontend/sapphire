/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
  IWorkbenchContribution,
  registerWorkbenchContribution2,
  WorkbenchPhase,
} from '../../../common/contributions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { mountSapphireTooltip } from './vue/out/void-tooltip/index.js';
import { h } from '../../../../base/browser/dom.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';

// Contribution: монтирует tooltip при старте workbench
class TooltipContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.sapphireTooltip';

  constructor(
    @IInstantiationService private readonly instantiationService: IInstantiationService,
    @IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
  ) {
    super();
    this.initializeTooltip();
  }

  private initializeTooltip(): void {
    const workbench = this.layoutService.activeContainer;
    // Контейнер tooltip через h()
    const tooltipContainer = h('div.sapphire-tooltip-container').root;
      // Выше titlebar (z-index ~3000): иначе «Новый чат» уходит под pill «Режим Агент».
      tooltipContainer.style.position = 'fixed';
      tooltipContainer.style.inset = '0';
      tooltipContainer.style.zIndex = '100000';
      tooltipContainer.style.pointerEvents = 'none';
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

// Регистрация contribution на фазе AfterRestored
registerWorkbenchContribution2(
  TooltipContribution.ID,
  TooltipContribution,
  WorkbenchPhase.AfterRestored,
);

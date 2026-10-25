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
import { mountSapphireOnboarding } from './vue/out/void-onboarding/index.js';
import { h } from '../../../../base/browser/dom.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';

// Contribution: монтирует onboarding при старте workbench
class OnboardingContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.sapphireOnboarding';

  constructor(
    @IInstantiationService private readonly instantiationService: IInstantiationService,
    @IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
  ) {
    super();
    this.initialize();
  }

  private initialize(): void {
    const workbench = this.layoutService.activeContainer;
    const onboardingContainer = h('div.sapphire-onboarding-container').root;
    workbench.appendChild(onboardingContainer);
      this.instantiationService.invokeFunction((accessor: ServicesAccessor) => {
        const result = mountSapphireOnboarding(onboardingContainer, accessor);
        if (result && typeof result.dispose === 'function') {
          this._register(toDisposable(result.dispose));
        }
      });
      // Очистка DOM при dispose
      this._register(
        toDisposable(() => {
          if (onboardingContainer.parentElement) {
            onboardingContainer.parentElement.removeChild(onboardingContainer);
          }
        }),
      );
  }
}

// Регистрация contribution на фазе AfterRestored
registerWorkbenchContribution2(
  OnboardingContribution.ID,
  OnboardingContribution,
  WorkbenchPhase.AfterRestored,
);

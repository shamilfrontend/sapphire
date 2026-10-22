/*--------------------------------------------------------------------------------------
 *  Sapphire — оверлей «Режим Агент» и переключатель в titlebar.
 *--------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { h, getActiveWindow } from '../../../../base/browser/dom.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import * as nls from '../../../../nls.js';
import {
  IWorkbenchContribution,
  registerWorkbenchContribution2,
  WorkbenchPhase,
} from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ISapphireSettingsService } from '../common/sapphireSettingsService.js';
import { LayoutMode } from '../common/sapphireSettingsTypes.js';
import { mountAgentsWindow } from './vue/out/agents-window-tsx/index.js';

const SAPPHIRE_SET_LAYOUT_MODE_ACTION_ID = 'sapphire.setLayoutMode';

/** Класс `codicon-sapphire-agents-window` в titlebar оформлен как pill в titlebarpart.css. */
const agentsWindowIcon = registerIcon(
  'sapphire-agents-window',
  Codicon.linkExternal,
  nls.localize('pprAgentsWindowIcon', 'Режим Агент'),
);

registerAction2(
  class extends Action2 {
    constructor() {
      super({
        id: SAPPHIRE_SET_LAYOUT_MODE_ACTION_ID,
        title: nls.localize2('sapphireAgentsWindow', 'Режим Агент'),
        icon: agentsWindowIcon,
        f1: true,
        menu: [
          {
            id: MenuId.LayoutControlMenuSubmenu,
            group: 'z_end',
            order: 100,
          },
          {
            id: MenuId.LayoutControlMenu,
            when: ContextKeyExpr.or(
              ContextKeyExpr.equals('config.workbench.layoutControl.type', 'toggles'),
              ContextKeyExpr.equals('config.workbench.layoutControl.type', 'both'),
            ),
            group: 'z_end',
            order: 100,
          },
        ],
      });
    }

    async run(accessor: ServicesAccessor): Promise<void> {
      const settingsService = accessor.get(ISapphireSettingsService);
      settingsService.setGlobalSetting('layoutMode', 'agents');
    }
  },
);

class AgentsWindowContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.sapphireAgentsWindow';

  private _lastMode: LayoutMode | undefined;

  constructor(
    @IInstantiationService private readonly instantiationService: IInstantiationService,
    @ISapphireSettingsService private readonly settingsService: ISapphireSettingsService,
    @IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
  ) {
    super();
    this._mount();
    this._register(this.settingsService.onDidChangeState(() => this._syncLayout()));
    void this.settingsService.waitForInitState.then(() => this._syncLayout());
  }

  private _mount(): void {
    const targetWindow = getActiveWindow();
    const workbench = targetWindow.document.querySelector('.monaco-workbench');
    if (!workbench) return;

    const container = h('div.sapphire-agents-window-container').root;
    container.style.userSelect = 'text';
    container.style.setProperty('-webkit-user-select', 'text');
    workbench.appendChild(container);
    this.instantiationService.invokeFunction((accessor: ServicesAccessor) => {
      const result = mountAgentsWindow(container, accessor);
      if (result && typeof result.dispose === 'function') {
        this._register(toDisposable(result.dispose));
      }
    });
    this._register(
      toDisposable(() => {
        container.parentElement?.removeChild(container);
      }),
    );
  }

  /** При возврате в IDE снова показываем панель ассистента, если её скрыли. */
  private _syncLayout(): void {
    const { layoutMode, isOnboardingComplete } = this.settingsService.state.globalSettings;
    if (
      this._lastMode !== undefined &&
      this._lastMode !== 'ide' &&
      layoutMode === 'ide' &&
      isOnboardingComplete
    ) {
      this.layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
    }
    this._lastMode = layoutMode;
  }
}

registerWorkbenchContribution2(
  AgentsWindowContribution.ID,
  AgentsWindowContribution,
  WorkbenchPhase.AfterRestored,
);

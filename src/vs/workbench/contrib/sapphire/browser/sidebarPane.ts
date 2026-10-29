/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import {
  Extensions as ViewContainerExtensions,
  IViewContainersRegistry,
  ViewContainerLocation,
  IViewsRegistry,
  Extensions as ViewExtensions,
  IViewDescriptorService,
} from '../../../common/views.js';

import * as nls from '../../../../nls.js';

// import { Codicon } from '../../../../base/common/codicons.js';
// import { localize } from '../../../../nls.js';
// import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';

import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
// import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';

import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';

import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
// import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { mountSidebar } from './vue/out/sidebar-tsx/index.js';

import { Codicon } from '../../../../base/common/codicons.js';
import { Orientation } from '../../../../base/browser/ui/sash/sash.js';
// import { IDisposable } from '../../../../base/common/lifecycle.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import {
  IWorkbenchContribution,
  registerWorkbenchContribution2,
  WorkbenchPhase,
} from '../../../common/contributions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

// См. search.contribution.ts, debug.contribution.ts, scm.contribution.ts

// ---------- ViewPane с React-sidebar ----------

class SidebarViewPane extends ViewPane {
  constructor(
    options: IViewPaneOptions,
    @IInstantiationService instantiationService: IInstantiationService,
    @IViewDescriptorService viewDescriptorService: IViewDescriptorService,
    @IConfigurationService configurationService: IConfigurationService,
    @IContextKeyService contextKeyService: IContextKeyService,
    @IThemeService themeService: IThemeService,
    @IContextMenuService contextMenuService: IContextMenuService,
    @IKeybindingService keybindingService: IKeybindingService,
    @IOpenerService openerService: IOpenerService,
    @ITelemetryService telemetryService: ITelemetryService,
    @IHoverService hoverService: IHoverService,
    // @ICodeEditorService private readonly editorService: ICodeEditorService,
    // @IContextKeyService private readonly editorContextKeyService: IContextKeyService,
  ) {
    super(
      options,
      keybindingService,
      contextMenuService,
      configurationService,
      contextKeyService,
      viewDescriptorService,
      instantiationService,
      openerService,
      themeService,
      hoverService,
    );
  }

  protected override renderBody(parent: HTMLElement): void {
    super.renderBody(parent);
    // parent.style.overflow = 'auto'
    parent.style.userSelect = 'text';

    this.instantiationService.invokeFunction((accessor) => {
      // Монтирование React-sidebar
      const disposeFn: (() => void) | undefined = mountSidebar(parent, accessor)?.dispose;
      this._register(toDisposable(() => disposeFn?.()));
    });
  }

  protected override layoutBody(height: number, width: number): void {
    super.layoutBody(height, width);
    this.element.style.height = `${height}px`;
    this.element.style.width = `${width}px`;
  }
}

// ---------- Регистрация view в контейнере void ----------

// const sapphireThemeIcon = Codicon.symbolObject;
// const sapphireViewIcon = registerIcon('sapphire-view-icon', sapphireThemeIcon, localize('sapphireViewIcon', 'View icon of the Sapphire chat view.'));

// В других местах тот же id иногда называют VIEWLET_ID
export const SAPPHIRE_VIEW_CONTAINER_ID = 'workbench.view.void';
export const SAPPHIRE_VIEW_ID = SAPPHIRE_VIEW_CONTAINER_ID;

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(
  ViewContainerExtensions.ViewContainersRegistry,
);
const container = viewContainerRegistry.registerViewContainer(
  {
    id: SAPPHIRE_VIEW_CONTAINER_ID,
    title: nls.localize2('sapphireContainer', 'Sapphire'), // a11y / palette; визуально скрыт в sapphire.css
    ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [
      SAPPHIRE_VIEW_CONTAINER_ID,
      {
        mergeViewWithContainerWhenSingleView: true,
        orientation: Orientation.HORIZONTAL,
      },
    ]),
    hideIfEmpty: false,
    order: 1,

    rejectAddedViews: true,
    icon: Codicon.symbolMethod,
  },
  ViewContainerLocation.AuxiliaryBar,
  { doNotRegisterOpenCommand: true, isDefault: true },
);

const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
viewsRegistry.registerViews(
  [
    {
      id: SAPPHIRE_VIEW_ID,
      hideByDefault: false, // панель открыта при старте
      // containerIcon: sapphireViewIcon,
      name: nls.localize2('sapphireChat', 'Sapphire'), // a11y; визуально скрыт в sapphire.css
      ctorDescriptor: new SyncDescriptor(SidebarViewPane),
      canToggleVisibility: false,
      canMoveView: false, // view нельзя вынести из контейнера
      weight: 80,
      order: 1,
      // singleViewPaneContainerTitle: 'hi',

      // openCommandActionDescriptor: {
      // 	id: SAPPHIRE_VIEW_CONTAINER_ID,
      // 	keybindings: {
      // 		primary: KeyMod.CtrlCmd | KeyCode.KeyL,
      // 	},
      // 	order: 1
      // },
    },
  ],
  container,
);

export const SAPPHIRE_OPEN_SIDEBAR_ACTION_ID = 'sapphire.openSidebar';
registerAction2(
  class extends Action2 {
    constructor() {
      super({
        id: SAPPHIRE_OPEN_SIDEBAR_ACTION_ID,
        title: 'Открыть ассистента Sapphire',
      });
    }

    run(accessor: ServicesAccessor): void {
      const viewsService = accessor.get(IViewsService);
      viewsService.openViewContainer(SAPPHIRE_VIEW_CONTAINER_ID);
    }
  },
);

class SidebarStartContribution implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.startupVoidSidebar';

  constructor(@ICommandService private readonly commandService: ICommandService) {
    this.commandService.executeCommand(SAPPHIRE_OPEN_SIDEBAR_ACTION_ID);
  }
}
registerWorkbenchContribution2(
  SidebarStartContribution.ID,
  SidebarStartContribution,
  WorkbenchPhase.AfterRestored,
);

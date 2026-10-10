/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import {
  Action2,
  MenuId,
  MenuRegistry,
  registerAction2,
} from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { AuxiliaryBarVisibleContext } from '../../../common/contextkeys.js';
import { ViewContainerLocation, ViewContainerLocationToString } from '../../../common/views.js';
import {
  ActivityBarPosition,
  IWorkbenchLayoutService,
  LayoutSettings,
  Parts,
} from '../../../services/layout/browser/layoutService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { SwitchCompositeViewAction } from '../compositeBarActions.js';
import { closeIcon } from '../panel/panelActions.js';
import { IViewSize } from '../../../../base/browser/ui/grid/grid.js';
/* eslint-disable */ // Sapphire
import { SAPPHIRE_MAXIMIZE_CHAT_ACTION_ID } from '../../../contrib/sapphire/browser/actionIDs.js';
/* eslint-enable */

/** Outline chat bubbles when PPR Assistant is hidden. */
const auxiliaryBarOffIcon = registerIcon(
  'auxiliarybar-chat-off-layout-icon',
  Codicon.commentDiscussion,
  localize('toggleAuxiliaryIconOff', 'Icon to show the PPR Assistant side bar.'),
);

/** Filled chat bubble when PPR Assistant is visible (styled via titlebar CSS mask). */
const auxiliaryBarOnIcon = registerIcon(
  'ppr-chat-filled',
  Codicon.commentDiscussion,
  localize('toggleAuxiliaryIconOn', 'Icon to hide the PPR Assistant side bar.'),
);

export class ToggleAuxiliaryBarAction extends Action2 {
  static readonly ID = 'workbench.action.toggleAuxiliaryBar';

  static readonly LABEL = localize2('toggleAuxiliaryBar', 'Toggle Sapphire Side Bar Visibility');

  constructor() {
    super({
      id: ToggleAuxiliaryBarAction.ID,
      title: ToggleAuxiliaryBarAction.LABEL,
      toggled: {
        condition: AuxiliaryBarVisibleContext,
        title: localize('closeSecondarySideBar', 'Hide Sapphire Side Bar'),
        icon: closeIcon,
        mnemonicTitle: localize(
          { key: 'secondary sidebar mnemonic', comment: ['&& denotes a mnemonic'] },
          'Secondary Si&&de Bar',
        ),
      },
      icon: closeIcon, // Ensures no flickering when using toggled.icon
      category: Categories.View,
      metadata: {
        description: localize('openAndCloseAuxiliaryBar', 'Open/Show and Close/Hide Sapphire Side Bar'),
      },
      f1: true,
      keybinding: {
        weight: KeybindingWeight.WorkbenchContrib,
        primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB,
      },
      menu: [
        {
          id: MenuId.LayoutControlMenuSubmenu,
          group: '0_workbench_layout',
          order: 1,
        },
        {
          id: MenuId.MenubarAppearanceMenu,
          group: '2_workbench_layout',
          order: 2,
        },
        {
          id: MenuId.AuxiliaryBarTitle,
          group: 'navigation',
          order: 2,
          when: ContextKeyExpr.equals(
            `config.${LayoutSettings.ACTIVITY_BAR_LOCATION}`,
            ActivityBarPosition.DEFAULT,
          ),
        },
      ],
    });
  }

  override async run(accessor: ServicesAccessor): Promise<void> {
    const layoutService = accessor.get(IWorkbenchLayoutService);
    layoutService.setPartHidden(
      layoutService.isVisible(Parts.AUXILIARYBAR_PART),
      Parts.AUXILIARYBAR_PART,
    );
  }
}

registerAction2(ToggleAuxiliaryBarAction);

registerAction2(
  class extends Action2 {
    constructor() {
      super({
        id: 'workbench.action.closeAuxiliaryBar',
        title: localize2('closeSecondarySideBar', 'Hide Sapphire Side Bar'),
        category: Categories.View,
        precondition: AuxiliaryBarVisibleContext,
        f1: true,
      });
    }

    run(accessor: ServicesAccessor) {
      accessor.get(IWorkbenchLayoutService).setPartHidden(true, Parts.AUXILIARYBAR_PART);
    }
  },
);

registerAction2(
  class FocusAuxiliaryBarAction extends Action2 {
    static readonly ID = 'workbench.action.focusAuxiliaryBar';

    static readonly LABEL = localize2('focusAuxiliaryBar', 'Focus into Sapphire Side Bar');

    constructor() {
      super({
        id: FocusAuxiliaryBarAction.ID,
        title: FocusAuxiliaryBarAction.LABEL,
        category: Categories.View,
        f1: true,
      });
    }

    override async run(accessor: ServicesAccessor): Promise<void> {
      const paneCompositeService = accessor.get(IPaneCompositePartService);
      const layoutService = accessor.get(IWorkbenchLayoutService);

      // Show auxiliary bar
      if (!layoutService.isVisible(Parts.AUXILIARYBAR_PART)) {
        layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
      }

      // Focus into active composite
      const composite = paneCompositeService.getActivePaneComposite(
        ViewContainerLocation.AuxiliaryBar,
      );
      composite?.focus();
    }
  },
);

MenuRegistry.appendMenuItems([
  {
    id: MenuId.LayoutControlMenu,
    item: {
      group: '2_pane_toggles',
      command: {
        id: ToggleAuxiliaryBarAction.ID,
        title: localize('toggleSecondarySideBar', 'PPR Assistant'),
        toggled: { condition: AuxiliaryBarVisibleContext, icon: auxiliaryBarOnIcon },
        icon: auxiliaryBarOffIcon,
      },
      when: ContextKeyExpr.and(
        ContextKeyExpr.or(
          ContextKeyExpr.equals('config.workbench.layoutControl.type', 'toggles'),
          ContextKeyExpr.equals('config.workbench.layoutControl.type', 'both'),
        ),
        ContextKeyExpr.equals('config.workbench.sideBar.location', 'right'),
      ),
      order: 0,
    },
  },
  {
    id: MenuId.LayoutControlMenu,
    item: {
      group: '2_pane_toggles',
      command: {
        id: ToggleAuxiliaryBarAction.ID,
        title: localize('toggleSecondarySideBar', 'PPR Assistant'),
        toggled: { condition: AuxiliaryBarVisibleContext, icon: auxiliaryBarOnIcon },
        icon: auxiliaryBarOffIcon,
      },
      when: ContextKeyExpr.and(
        ContextKeyExpr.or(
          ContextKeyExpr.equals('config.workbench.layoutControl.type', 'toggles'),
          ContextKeyExpr.equals('config.workbench.layoutControl.type', 'both'),
        ),
        ContextKeyExpr.equals('config.workbench.sideBar.location', 'left'),
      ),
      order: 2,
    },
  },
  {
    id: MenuId.ViewContainerTitleContext,
    item: {
      group: '3_workbench_layout_move',
      command: {
        id: ToggleAuxiliaryBarAction.ID,
        title: localize2('hideAuxiliaryBar', 'Hide Sapphire Side Bar'),
      },
      when: ContextKeyExpr.and(
        AuxiliaryBarVisibleContext,
        ContextKeyExpr.equals(
          'viewContainerLocation',
          ViewContainerLocationToString(ViewContainerLocation.AuxiliaryBar),
        ),
      ),
      order: 2,
    },
  },
]);

registerAction2(
  class extends SwitchCompositeViewAction {
    constructor() {
      super(
        {
          id: 'workbench.action.previousAuxiliaryBarView',
          title: localize2('previousAuxiliaryBarView', 'Previous Sapphire Side Bar View'),
          category: Categories.View,
          f1: true,
        },
        ViewContainerLocation.AuxiliaryBar,
        -1,
      );
    }
  },
);

registerAction2(
  class extends SwitchCompositeViewAction {
    constructor() {
      super(
        {
          id: 'workbench.action.nextAuxiliaryBarView',
          title: localize2('nextAuxiliaryBarView', 'Next Sapphire Side Bar View'),
          category: Categories.View,
          f1: true,
        },
        ViewContainerLocation.AuxiliaryBar,
        1,
      );
    }
  },
);

interface MaximizedChatLayout {
  sidebarHidden: boolean;
  panelHidden: boolean;
  auxBarSize: IViewSize;
}

let maximizedChatLayout: MaximizedChatLayout | undefined;

registerAction2(
  class extends Action2 {
    constructor() {
      super({
        id: SAPPHIRE_MAXIMIZE_CHAT_ACTION_ID,
        title: localize2('sapphireMaximizeChat', 'Maximize Chat'),
        category: Categories.View,
        f1: true,
        keybinding: {
          weight: KeybindingWeight.WorkbenchContrib,
          primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyE,
        },
      });
    }

    override async run(accessor: ServicesAccessor): Promise<void> {
      const layoutService = accessor.get(IWorkbenchLayoutService);

      if (maximizedChatLayout) {
        layoutService.setPartHidden(maximizedChatLayout.sidebarHidden, Parts.SIDEBAR_PART);
        layoutService.setPartHidden(maximizedChatLayout.panelHidden, Parts.PANEL_PART);
        layoutService.setSize(Parts.AUXILIARYBAR_PART, maximizedChatLayout.auxBarSize);
        maximizedChatLayout = undefined;
        return;
      }

      if (!layoutService.isVisible(Parts.AUXILIARYBAR_PART)) {
        layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
      }

      maximizedChatLayout = {
        sidebarHidden: !layoutService.isVisible(Parts.SIDEBAR_PART),
        panelHidden: !layoutService.isVisible(Parts.PANEL_PART),
        auxBarSize: layoutService.getSize(Parts.AUXILIARYBAR_PART),
      };

      layoutService.setPartHidden(true, Parts.SIDEBAR_PART);
      layoutService.setPartHidden(true, Parts.PANEL_PART);

      const auxSize = layoutService.getSize(Parts.AUXILIARYBAR_PART);
      const editorSize = layoutService.getSize(Parts.EDITOR_PART);
      layoutService.setSize(Parts.AUXILIARYBAR_PART, {
        width: Math.max(auxSize.width, auxSize.width + editorSize.width - 80),
        height: auxSize.height,
      });
    }
  },
);

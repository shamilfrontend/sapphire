/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { cloneVNode, isVNode, type Component, type VNode } from 'vue';

export type ControlSize = 'xxs' | 'xs' | 'sm' | 'sm+' | 'md';

export type DropdownAccent = { fg: string; bg: string };

export type DropdownIcon = VNode | Component;

/** VNode (h()) и компонент одинаково рендерятся через <component :is>. */
export const dropdownIconView = (icon: DropdownIcon): Component => {
  if (isVNode(icon)) {
    return { render: () => cloneVNode(icon) };
  }
  return icon;
};

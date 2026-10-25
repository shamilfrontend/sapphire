/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createApp, h, reactive, type Component } from 'vue';
import FloatingVue from 'floating-vue';
import { _registerServices } from './services.js';

import { ServicesAccessor } from '../../../../../../../editor/browser/editorExtensions.js';

export const mountFnGenerator =
  (component: Component) =>
  (rootElement: HTMLElement, accessor: ServicesAccessor, props?: Record<string, unknown>) => {
    if (typeof document === 'undefined') {
      console.error('mountFnGenerator error: document was undefined');
      return;
    }

    const disposables = _registerServices(accessor);
    const propsState = reactive({ value: { ...(props ?? {}) } });

    const app = createApp({
      name: 'SapphireVueMount',
      render() {
        return h(component, propsState.value);
      },
    });
    app.use(FloatingVue);

    app.mount(rootElement);

    const rerender = (next?: Record<string, unknown>) => {
      propsState.value = { ...(next ?? {}) };
    };
    const dispose = () => {
      app.unmount();
      disposables.forEach((d) => d.dispose());
    };

    return {
      rerender,
      dispose,
    };
  };

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-globals */

(async function () {
  type IBootstrapWindow =
    import('../../../platform/window/electron-sandbox/window.js').IBootstrapWindow;
  type IProcessExplorerMain = import('./processExplorerMain.js').IProcessExplorerMain;
  type ProcessExplorerWindowConfiguration =
    import('../../../platform/process/common/process.js').ProcessExplorerWindowConfiguration;

  const bootstrapWindow: IBootstrapWindow = (window as any).MonacoBootstrapWindow; // defined by bootstrap-window.ts

  const { result, configuration } = await bootstrapWindow.load<
    IProcessExplorerMain,
    ProcessExplorerWindowConfiguration
  >('vs/code/electron-sandbox/processExplorer/processExplorerMain', {
    configureDeveloperSettings() {
      return {
        forceEnableDeveloperKeybindings: true,
      };
    },
  });

  const resolveEntrypoint = (
    moduleValue: unknown,
  ): ((config: ProcessExplorerWindowConfiguration) => void) | undefined => {
    const queue: unknown[] = [moduleValue];
    const seen = new Set<unknown>();

    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);

      if (typeof candidate === 'function') {
        return candidate as (config: ProcessExplorerWindowConfiguration) => void;
      }

      if (typeof candidate === 'object') {
        const maybeStartup = (candidate as { startup?: unknown }).startup;
        if (typeof maybeStartup === 'function') {
          return maybeStartup as (config: ProcessExplorerWindowConfiguration) => void;
        }

        const maybeDefault = (candidate as { default?: unknown }).default;
        if (maybeDefault) {
          queue.push(maybeDefault);
        }

        for (const value of Object.values(candidate)) {
          if (value && typeof value === 'object') {
            queue.push(value);
          }
        }
      }
    }

    return undefined;
  };

  const startup = resolveEntrypoint(result);
  if (typeof startup !== 'function') {
    throw new TypeError('Process explorer bootstrap failed: expected startup() export.');
  }
  startup(configuration);
})();

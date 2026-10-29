/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { reactive } from 'vue';

type ReturnType<T> = [{ current: T }, (t: T) => void];

// Когда обычный ref не нужен, а значение читают синхронно через .current (стриминг Ctrl+K).
export const useRefState = <T>(initVal: T): ReturnType<T> => {
  const box = reactive({ current: initVal });
  const setState = (newVal: T) => {
    box.current = newVal;
  };
  return [box, setState];
};

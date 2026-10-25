/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../../../platform/instantiation/common/serviceCollection.js';
import {
  emptyProgressRunner,
  IEditorProgressService,
} from '../../../../../../../platform/progress/common/progress.js';

const noopEditorProgressService: IEditorProgressService = {
  _serviceBrand: undefined,
  show(_infiniteOrTotal: true | number, _delay?: number) {
    return emptyProgressRunner;
  },
  async showWhile(promise: Promise<unknown>, _delay?: number): Promise<void> {
    await promise;
  },
};

/**
 * DiffEditorWidget требует IEditorProgressService; в React-монтаже доступен только root workbench,
 * поэтому подмешиваем noop-реализацию через дочерний ServiceCollection.
 */
export const createDiffEditorInstantiationService = (
  instantiationService: IInstantiationService,
): IInstantiationService =>
  instantiationService.createChild(
    new ServiceCollection([IEditorProgressService, noopEditorProgressService]),
  );

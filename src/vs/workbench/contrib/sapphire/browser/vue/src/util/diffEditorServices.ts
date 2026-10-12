/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

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

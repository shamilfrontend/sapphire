/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface ISapphireSCMService {
  readonly _serviceBrand: undefined;
  /**
   * git diff --stat
   *
   * @param path путь к git-репозиторию
   */
  gitStat(path: string): Promise<string>;
  /**
   * git diff --stat для ~10 файлов с наибольшими +/- строками
   *
   * @param path путь к git-репозиторию
   */
  gitSampledDiffs(path: string): Promise<string>;
  /**
   * Текущая git-ветка
   *
   * @param path путь к git-репозиторию
   */
  gitBranch(path: string): Promise<string>;
  /**
   * Последние 5 коммитов без merge
   *
   * @param path путь к git-репозиторию
   */
  gitLog(path: string): Promise<string>;
  /**
   * Пути из git diff --name-only. Если есть staged, берутся только они — как у gitStat.
   */
  gitChangedFiles(path: string): Promise<string[]>;
}

export const ISapphireSCMService = createDecorator<ISapphireSCMService>('sapphireSCMService');

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import {
  InstantiationType,
  registerSingleton,
} from '../../../../platform/instantiation/common/extensions.js';
import {
  createDecorator,
  IInstantiationService,
} from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { ISapphireModelService } from '../common/sapphireModelService.js';
import {
  extractHeuristicQueryTokens,
  HeuristicCandidate,
  HEURISTIC_RETRIEVE_TOP_N,
  mergeHeuristicFileSelections,
  pathSearchQueriesFromTokens,
  pickTopHeuristicUris,
  scorePathHit,
  scoreTextHit,
  shouldSkipHeuristicRetrieve,
  textSearchQueriesFromTokens,
} from '../common/heuristicFileRetrieve.js';
import { StagingSelectionItem } from '../common/chatThreadServiceTypes.js';
import { IProjectIndexService } from './projectIndexService.js';
import {
  SAPPHIRE_CHAT_HEURISTIC_TIMEOUT_MS,
  SAPPHIRE_CHAT_PREP_TIMEOUT_MS,
  racePrepAwait,
} from '../common/chatPrepGuard.js';

export const IHeuristicFileRetrieveService = createDecorator<IHeuristicFileRetrieveService>(
  'sapphireHeuristicFileRetrieveService',
);

export interface IHeuristicFileRetrieveService {
  readonly _serviceBrand: undefined;

  /**
   * Ищет в workspace файлы, релевантные `query`, и мержит их в selections
   * (с `fromHeuristic: true`). Fail-open: при ошибке/пропуске возвращает `selns` без изменений.
   */
  mergeRelevantFilesIntoSelections(
    query: string,
    selns: StagingSelectionItem[],
    opts: {
      enabled: boolean;
      /** Staging пользователя до auto-active/heuristic — для правил skip. */
      userSelns: StagingSelectionItem[];
      omittedFsPaths?: ReadonlySet<string> | null;
      topN?: number;
      /** Stop / смена epoch — отмена fileSearch/textSearch. */
      token?: CancellationToken;
    },
  ): Promise<StagingSelectionItem[]>;
}

const MAX_FILE_SEARCH_PER_QUERY = 8;
const MAX_TEXT_SEARCH_PER_QUERY = 8;
const MAX_PATH_QUERIES = 4;

class HeuristicFileRetrieveService implements IHeuristicFileRetrieveService {
  readonly _serviceBrand: undefined;

  private readonly _queryBuilder: QueryBuilder;

  constructor(
    @ISearchService private readonly _searchService: ISearchService,
    @IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
    @ISapphireModelService private readonly _sapphireModelService: ISapphireModelService,
    @IProjectIndexService private readonly _projectIndexService: IProjectIndexService,
    @IInstantiationService instantiationService: IInstantiationService,
  ) {
    this._queryBuilder = instantiationService.createInstance(QueryBuilder);
  }

  async mergeRelevantFilesIntoSelections(
    query: string,
    selns: StagingSelectionItem[],
    opts: {
      enabled: boolean;
      userSelns: StagingSelectionItem[];
      omittedFsPaths?: ReadonlySet<string> | null;
      topN?: number;
      token?: CancellationToken;
    },
  ): Promise<StagingSelectionItem[]> {
    if (!opts.enabled || shouldSkipHeuristicRetrieve(opts.userSelns)) {
      return selns ? [...selns] : [];
    }

    const tokens = extractHeuristicQueryTokens(query);
    if (!tokens.length) {
      return selns ? [...selns] : [];
    }

    const folders = this._workspaceContextService.getWorkspace().folders.map((f) => f.uri);
    if (!folders.length) {
      return selns ? [...selns] : [];
    }

    const candidates: HeuristicCandidate[] = [];
    const cts = new CancellationTokenSource(opts.token);
    const folder = this._workspaceContextService.getWorkspace().folders[0];
    const fallback = () => (selns ? [...selns] : []);

    const work = async (): Promise<StagingSelectionItem[]> => {
      try {
        const indexHits = this._projectIndexService.search(query, 1);
        indexHits.slice(0, MAX_FILE_SEARCH_PER_QUERY).forEach((h, i) => {
          if (!folder) {
            return;
          }
          candidates.push({
            uri: folder.toResource(h.path),
            score: scorePathHit(i) + Math.min(20, h.score),
            source: 'path',
          });
        });
      } catch {
        // при ошибке — не ломаем весь поиск
      }

      if (cts.token.isCancellationRequested) {
        return fallback();
      }

      const pathQueries = pathSearchQueriesFromTokens(tokens).slice(0, MAX_PATH_QUERIES);
      for (const q of pathQueries) {
        if (cts.token.isCancellationRequested) {
          return fallback();
        }
        try {
          const searchQuery = this._queryBuilder.file(folders, {
            filePattern: q,
            sortByScore: true,
          });
          const data = await this._searchService.fileSearch(searchQuery, cts.token);
          data.results.slice(0, MAX_FILE_SEARCH_PER_QUERY).forEach((r, i) => {
            candidates.push({
              uri: r.resource,
              score: scorePathHit(i),
              source: 'path',
            });
          });
        } catch {
          // ошибка одного file-запроса — остальные продолжаем
        }
      }

      const pathHitsBeforeText = pickTopHeuristicUris(candidates, selns, {
        topN: opts.topN ?? HEURISTIC_RETRIEVE_TOP_N,
        omittedFsPaths: opts.omittedFsPaths,
      });

      // Текстовый поиск — только если path-хиты слабые
      if (pathHitsBeforeText.length < (opts.topN ?? HEURISTIC_RETRIEVE_TOP_N)) {
        for (const q of textSearchQueriesFromTokens(tokens)) {
          if (cts.token.isCancellationRequested) {
            return fallback();
          }
          try {
            const searchQuery = this._queryBuilder.text({ pattern: q, isRegExp: false }, folders);
            const data = await this._searchService.textSearch(searchQuery, cts.token);
            data.results.slice(0, MAX_TEXT_SEARCH_PER_QUERY).forEach((r, i) => {
              candidates.push({
                uri: r.resource,
                score: scoreTextHit(i),
                source: 'text',
              });
            });
          } catch {
            // при ошибке — не ломаем весь поиск
          }
        }
      }

      const topUris = pickTopHeuristicUris(candidates, selns, {
        topN: opts.topN ?? HEURISTIC_RETRIEVE_TOP_N,
        omittedFsPaths: opts.omittedFsPaths,
      });

      const files: { uri: URI; language: string }[] = [];
      for (const uri of topUris) {
        if (cts.token.isCancellationRequested) {
          return fallback();
        }
        let language = 'plaintext';
        try {
          const modelResult = await racePrepAwait(
            this._sapphireModelService.getModelSafe(uri),
            cts.token,
            Math.min(10_000, SAPPHIRE_CHAT_PREP_TIMEOUT_MS),
          );
          language = modelResult.model?.getLanguageId() || 'plaintext';
        } catch {
          language = 'plaintext';
        }
        files.push({ uri, language });
      }

      return mergeHeuristicFileSelections(selns, files, {
        enabled: true,
        omittedFsPaths: opts.omittedFsPaths,
        topN: opts.topN ?? HEURISTIC_RETRIEVE_TOP_N,
      });
    };

    try {
      return await racePrepAwait(work(), cts.token, SAPPHIRE_CHAT_HEURISTIC_TIMEOUT_MS);
    } catch {
      return fallback();
    } finally {
      cts.dispose(true);
    }
  }
}

registerSingleton(
  IHeuristicFileRetrieveService,
  HeuristicFileRetrieveService,
  InstantiationType.Delayed,
);

/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { BuiltinToolCallParams } from '../common/toolsServiceTypes.js';
import { CodespanLocationLink } from '../common/chatThreadServiceTypes.js';
import { classifyCodespan, displayPathForCodespan } from './chatThreadCodespan.js';
import { ChatThreadCollaboratorHost } from './chatThreadTypes.js';

export class ChatThreadCodespanLinks {
  constructor(private readonly _s: ChatThreadCollaboratorHost) {}

  private _getAllSeenFileURIs(threadId: string) {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return [];

    const fsPathsSet = new Set<string>();
    const uris: URI[] = [];
    const addURI = (uri: URI) => {
      if (fsPathsSet.has(uri.fsPath)) return;
      fsPathsSet.add(uri.fsPath);
      uris.push(uri);
    };

    for (const m of thread.messages) {
      // URI из выделений пользователя
      if (m.role === 'user') {
        for (const sel of m.selections ?? []) {
          addURI(sel.uri);
        }
      }
      // URI файлов, уже прочитанных через read_file
      else if (m.role === 'tool' && m.type === 'success' && m.name === 'read_file') {
        const params = m.params as BuiltinToolCallParams['read_file'];
        addURI(params.uri);
      }
    }
    return uris;
  }

  getRelativeStr = (uri: URI) => {
    const isInside = this._s._workspaceContextService.isInsideWorkspace(uri);
    if (isInside) {
      const f = this._s._workspaceContextService
        .getWorkspace()
        .folders.find((f: { uri: URI }) => uri.fsPath.startsWith(f.uri.fsPath));
      if (f) {
        return uri.fsPath.replace(f.uri.fsPath, '');
      }
      return undefined;
    }
    return undefined;
  };

  // Разрешить codespan в URI/диапазон для кликабельной ссылки
  generateCodespanLink = async ({
    codespanStr: _codespanStr,
    threadId,
  }: {
    codespanStr: string;
    threadId: string;
  }) => {
    const classified = classifyCodespan(_codespanStr);
    if (!classified) {
      return null;
    }
    const { codespanType, target } = classified;

    // Файлы из треда в порядке MRU (сначала недавние)
    const prevUris = this._getAllSeenFileURIs(threadId).reverse();

    if (codespanType === 'file-or-folder') {
      const doesUriMatchTarget = (uri: URI) => uri.path.includes(target);

      // Совпадение с уже известными URI
      for (const uri of prevUris) {
        if (doesUriMatchTarget(uri)) {
          return { uri, displayText: displayPathForCodespan(uri, prevUris) };
        }
      }

      // Иначе поиск пути по codebase
      let uris: URI[] = [];
      try {
        const { result } = await this._s._toolsService.callTool.search_pathnames_only({
          query: target,
          includePattern: null,
          pageNumber: 0,
        });
        const { uris: uris_ } = await result;
        uris = uris_;
      } catch (_e) {
        return null;
      }

      for (const uri of uris) {
        if (doesUriMatchTarget(uri)) {
          return { uri, displayText: displayPathForCodespan(uri, uris) };
        }
      }
    }

    if (codespanType === 'function-or-class') {
      // Поиск символа в недавних файлах (только текущий workspace)
      for (const uri of prevUris) {
        if (!this._s._workspaceContextService.isInsideWorkspace(uri)) {
          continue;
        }
        const modelRef = await this._s._sapphireModelService.getModelSafe(uri);
        const { model } = modelRef;
        if (!model) continue;

        const matches = model.findMatches(
          target,
          false,
          false,
          true,
          null,
          true,
        );

        const firstThree = matches.slice(0, 3);

        // До трёх совпадений — go to definition
        for (const match of firstThree) {
          const position = new Position(match.range.startLineNumber, match.range.startColumn);
          const definitionProviders =
            this._s._languageFeaturesService.definitionProvider.ordered(model);

          for (const provider of definitionProviders) {
            const _definitions = await provider.provideDefinition(
              model,
              position,
              CancellationToken.None,
            );

            if (!_definitions) continue;

            const definitions = Array.isArray(_definitions) ? _definitions : [_definitions];

            for (const definition of definitions) {
              return {
                uri: definition.uri,
                selection: {
                  startLineNumber: definition.range.startLineNumber,
                  startColumn: definition.range.startColumn,
                  endLineNumber: definition.range.endLineNumber,
                  endColumn: definition.range.endColumn,
                },
                displayText: _codespanStr,
              };
            }
          }
        }
      }

      // Для символов не ищем по всему репозиторию — только контекст треда
    }

    return null;
  };

  getCodespanLink({
    codespanStr,
    messageIdx,
    threadId,
  }: {
    codespanStr: string;
    messageIdx: number;
    threadId: string;
  }): CodespanLocationLink | undefined {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return undefined;

    const links = thread.state.linksOfMessageIdx?.[messageIdx];
    if (!links) return undefined;

    const link = links[codespanStr];

    return link;
  }

  async addCodespanLink({
    newLinkText,
    newLinkLocation,
    messageIdx,
    threadId,
  }: {
    newLinkText: string;
    newLinkLocation: CodespanLocationLink;
    messageIdx: number;
    threadId: string;
  }) {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;

    this._s._setState({
      allThreads: {
        ...this._s.state.allThreads,
        [threadId]: {
          ...thread,
          state: {
            ...thread.state,
            linksOfMessageIdx: {
              ...thread.state.linksOfMessageIdx,
              [messageIdx]: {
                ...thread.state.linksOfMessageIdx?.[messageIdx],
                [newLinkText]: newLinkLocation,
              },
            },
          },
        },
      },
    });
  }
}

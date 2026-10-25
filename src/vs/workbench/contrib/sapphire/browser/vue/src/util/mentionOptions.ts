/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { File, Folder, type LucideIcon } from 'lucide-vue-next';
import { useAccessor } from './services.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { getBasename, uniquePathLabels } from '../../../../common/pathLabels.js';

export type GenerateNextOptions = (optionText: string) => Promise<Option[]>;

export type Option = {
  fullName: string;
  abbreviatedName: string;
  iconInMenu: LucideIcon; // иконка lucide-vue-next в меню @
} & (
  | { leafNodeType?: undefined; nextOptions: Option[]; generateNextOptions?: undefined }
  | { leafNodeType?: undefined; nextOptions?: undefined; generateNextOptions: GenerateNextOptions }
  | {
      leafNodeType: 'File' | 'Folder';
      uri: URI;
      nextOptions?: undefined;
      generateNextOptions?: undefined;
    }
);

const isSubsequence = (text: string, pattern: string): boolean => {
  text = text.toLowerCase();
  pattern = pattern.toLowerCase();

  if (pattern === '') {return true;}
  if (text === '') {return false;}
  if (pattern.length > text.length) {return false;}

  const seq: boolean[][] = Array(pattern.length + 1)
    .fill(null)
    .map(() => Array(text.length + 1).fill(false));

  for (let j = 0; j <= text.length; j++) {
    seq[0][j] = true;
  }

  for (let i = 1; i <= pattern.length; i++) {
    for (let j = 1; j <= text.length; j++) {
      if (pattern[i - 1] === text[j - 1]) {
        seq[i][j] = seq[i - 1][j - 1];
      } else {
        seq[i][j] = seq[i][j - 1];
      }
    }
  }
  return seq[pattern.length][text.length];
};

const scoreSubsequence = (text: string, pattern: string): number => {
  if (pattern === '') {return 0;}

  text = text.toLowerCase();
  pattern = pattern.toLowerCase();

  // Длина максимального подряд идущего совпадения prefix pattern в text (для сортировки)
  const n = text.length;
  const m = pattern.length;

  let maxConsecutive = 0;

  for (let i = 0; i < n; i++) {
    let consecutiveCount = 0;

    for (let j = 0; j < m; j++) {
      if (i + j < n && text[i + j] === pattern[j]) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    maxConsecutive = Math.max(maxConsecutive, consecutiveCount);
  }

  return maxConsecutive;
};

function getRelativeWorkspacePath(accessor: ReturnType<typeof useAccessor>, uri: URI): string {
  const workspaceService = accessor.get('IWorkspaceContextService');
  const workspaceFolders = workspaceService.getWorkspace().folders;

  if (!workspaceFolders.length) {
    return uri.fsPath; // Нет workspace — абсолютный путь
  }

  // Сначала самая вложенная папка workspace (длиннейший prefix)
  const sortedFolders = [...workspaceFolders].sort(
    (a, b) => b.uri.fsPath.length - a.uri.fsPath.length,
  );

  // Хвостовой / для корректного prefix-match каталогов
  const uriPath = uri.fsPath.endsWith('/') ? uri.fsPath : `${uri.fsPath}/`;

  // URI внутри одной из папок workspace?
  for (const folder of sortedFolders) {
    const folderPath = folder.uri.fsPath.endsWith('/')
      ? folder.uri.fsPath
      : `${folder.uri.fsPath}/`;
    if (uriPath.startsWith(folderPath)) {
      // Относительный путь от корня folder
      let relativePath = uri.fsPath.slice(folder.uri.fsPath.length);
      // Убираем ведущий /
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }
      // console.log({ folderPath, relativePath, uriPath });

      return relativePath;
    }
  }

  // Вне workspace — абсолютный fsPath
  return uri.fsPath;
}

const numOptionsToShow = 100;

const getAbbreviatedName = (relativePath: string) => getBasename(relativePath, 1);

export const getOptionsAtPath = async (
  accessor: ReturnType<typeof useAccessor>,
  path: string[],
  optionText: string,
): Promise<Option[]> => {
  const toolsService = accessor.get('IToolsService');

  const searchForFilesOrFolders = async (t: string, searchFor: 'files' | 'folders') => {
    try {
      const searchResults = (
        await (
          await toolsService.callTool.search_pathnames_only({
            query: t,
            includePattern: null,
            pageNumber: 1,
          })
        ).result
      ).uris;

      if (searchFor === 'files') {
        const res: Option[] = searchResults.map((uri) => {
          const relativePath = getRelativeWorkspacePath(accessor, uri);
          return {
            leafNodeType: 'File',
            uri,
            iconInMenu: File,
            fullName: relativePath,
            abbreviatedName: getAbbreviatedName(relativePath),
          };
        });
        return res;
      }
      if (searchFor === 'folders') {
        // Уникальные каталоги из путей найденных файлов
        const directoryMap = new Map<string, URI>();

        for (const uri of searchResults) {
          if (!uri) {continue;}

          // Разбиваем относительный путь на сегменты каталогов
          const relativePath = getRelativeWorkspacePath(accessor, uri);
          const pathParts = relativePath.split('/');

          // Нужен URI корня workspace для joinPath каталогов
          const workspaceService = accessor.get('IWorkspaceContextService');
          const workspaceFolders = workspaceService.getWorkspace().folders;

          // Какой folder содержит этот файл
          let workspaceFolderUri: URI | undefined;
          if (workspaceFolders.length) {
            // Сначала самая вложенная папка workspace (длиннейший prefix)
            const sortedFolders = [...workspaceFolders].sort(
              (a, b) => b.uri.fsPath.length - a.uri.fsPath.length,
            );

            // Prefix-match fsPath файла с folder
            for (const folder of sortedFolders) {
              const folderPath = folder.uri.fsPath.endsWith('/')
                ? folder.uri.fsPath
                : `${folder.uri.fsPath}/`;
              const uriPath = uri.fsPath.endsWith('/') ? uri.fsPath : `${uri.fsPath}/`;

              if (uriPath.startsWith(folderPath)) {
                workspaceFolderUri = folder.uri;
                break;
              }
            }
          }

          if (workspaceFolderUri) {
            // Все родительские каталоги файла в directoryMap
            let currentPath = '';
            for (let i = 0; i < pathParts.length - 1; i++) {
              currentPath = i === 0 ? `/${pathParts[i]}` : `${currentPath}/${pathParts[i]}`;

              // URI каталога относительно workspaceFolderUri
              const directoryUri = URI.joinPath(
                workspaceFolderUri,
                currentPath.startsWith('/') ? currentPath.substring(1) : currentPath,
              );

              directoryMap.set(currentPath, directoryUri);
            }
          }
        }
        // Map → Option[] для меню folders
        return Array.from(directoryMap.entries()).map(([relativePath, uri]) => ({
          leafNodeType: 'Folder',
          uri,
          iconInMenu: Folder,
          fullName: relativePath,
          abbreviatedName: getAbbreviatedName(relativePath),
        })) satisfies Option[];
      }
    } catch (error) {
      console.error('Error fetching directories:', error);
      return [];
    }
  };

  const allOptions: Option[] = [
    {
      fullName: 'files',
      abbreviatedName: 'files',
      iconInMenu: File,
      generateNextOptions: async (t) => (await searchForFilesOrFolders(t, 'files')) || [],
    },
    {
      fullName: 'folders',
      abbreviatedName: 'folders',
      iconInMenu: Folder,
      generateNextOptions: async (t) => (await searchForFilesOrFolders(t, 'folders')) || [],
    },
  ];

  // Спускаемся по optionsPath (без terminal leaf File/Folder)

  let nextOptionsAtPath = allOptions;
  let generateNextOptionsAtPath: GenerateNextOptions | undefined;

  for (const pn of path) {
    const selectedOption = nextOptionsAtPath.find(
      (o) => o.fullName.toLowerCase() === pn.toLowerCase(),
    );

    if (!selectedOption) {return [];}

    // В path нет terminal leaf — nextOptions всегда есть до generateNextOptions
    nextOptionsAtPath = selectedOption.nextOptions!;
    generateNextOptionsAtPath = selectedOption.generateNextOptions;
  }

  if (generateNextOptionsAtPath) {
    nextOptionsAtPath = await generateNextOptionsAtPath(optionText);
  } else if (path.length === 0 && optionText.trim().length > 0) {
    // Корень меню + текст фильтра — ищем файлы и папки сразу, без ветки files/folders
    const filesResults = (await searchForFilesOrFolders(optionText, 'files')) || [];
    const foldersResults = (await searchForFilesOrFolders(optionText, 'folders')) || [];
    nextOptionsAtPath = [...foldersResults, ...filesResults];
  }

  const optionsAtPath = nextOptionsAtPath
    .filter((o) => isSubsequence(o.fullName, optionText))
    .sort((a, b) => {
      // Сортировка по длине подряд идущего совпадения с фильтром
      const scoreA = scoreSubsequence(a.fullName, optionText);
      const scoreB = scoreSubsequence(b.fullName, optionText);
      return scoreB - scoreA;
    })
    .slice(0, numOptionsToShow); // Лимит после filter+sort по полному списку

  const uniqueNames = uniquePathLabels(optionsAtPath.map((o) => o.fullName));
  return optionsAtPath.map((o, i) => ({
    ...o,
    abbreviatedName: uniqueNames[i] ?? o.abbreviatedName,
  }));
};

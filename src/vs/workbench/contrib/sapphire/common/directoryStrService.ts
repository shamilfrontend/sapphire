/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import {
  ShallowDirectoryItem,
  BuiltinToolCallParams,
  BuiltinToolResultType,
} from './toolsServiceTypes.js';
import {
  MAX_CHILDREN_URIs_PAGE,
  MAX_DIRSTR_CHARS_TOTAL_BEGINNING,
  MAX_DIRSTR_CHARS_TOTAL_TOOL,
} from './prompt/prompts.js';

const MAX_FILES_TOTAL = 1000;

const START_MAX_DEPTH = Infinity;
const START_MAX_ITEMS_PER_DIR = Infinity; // начальное значение — без лимита на каталог

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_ITEMS_PER_DIR = 3;

const throwIfCancelled = (token: CancellationToken | undefined) => {
  if (token?.isCancellationRequested) {
    throw new CancellationError();
  }
};

export interface IDirectoryStrService {
  readonly _serviceBrand: undefined;

  getDirectoryStrTool(uri: URI, token?: CancellationToken): Promise<string>;
  getAllDirectoriesStr(opts: {
    cutOffMessage: string;
    token?: CancellationToken;
  }): Promise<string>;

  getAllURIsInDirectory(
    uri: URI,
    opts: { maxResults: number; token?: CancellationToken },
  ): Promise<URI[]>;
}
export const IDirectoryStrService =
  createDecorator<IDirectoryStrService>('sapphireDirectoryStrService');

// известный фильтр (.git и т.д.)
const shouldExcludeDirectory = (name: string) => {
  if (
    name === '.git' ||
    name === 'node_modules' ||
    name.startsWith('.') ||
    name === 'dist' ||
    name === 'build' ||
    name === 'out' ||
    name === 'bin' ||
    name === 'coverage' ||
    name === '__pycache__' ||
    name === 'env' ||
    name === 'venv' ||
    name === 'tmp' ||
    name === 'temp' ||
    name === 'artifacts' ||
    name === 'target' ||
    name === 'obj' ||
    name === 'vendor' ||
    name === 'logs' ||
    name === 'cache' ||
    name === 'resource' ||
    name === 'resources'
  ) {
    return true;
  }

  if (name.match(/\bout\b/)) {return true;}
  if (name.match(/\bbuild\b/)) {return true;}

  return false;
};

// ---------- один уровень вложенности ----------

export const computeDirectoryTree1Deep = async (
  fileService: IFileService,
  rootURI: URI,
  pageNumber: number = 1,
  token?: CancellationToken,
): Promise<BuiltinToolResultType['ls_dir']> => {
  throwIfCancelled(token);
  const stat = await fileService.resolve(rootURI, { resolveMetadata: false });
  throwIfCancelled(token);
  if (!stat.isDirectory) {
    return { children: null, hasNextPage: false, hasPrevPage: false, itemsRemaining: 0 };
  }

  const nChildren = stat.children?.length ?? 0;

  const fromChildIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1);
  const toChildIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1; // INCLUSIVE
  const listChildren = stat.children?.slice(fromChildIdx, toChildIdx + 1);

  const children: ShallowDirectoryItem[] =
    listChildren?.map((child) => ({
      name: child.name,
      uri: child.resource,
      isDirectory: child.isDirectory,
      isSymbolicLink: child.isSymbolicLink,
    })) ?? [];

  const hasNextPage = nChildren - 1 > toChildIdx;
  const hasPrevPage = pageNumber > 1;
  const itemsRemaining = Math.max(0, nChildren - (toChildIdx + 1));

  return {
    children,
    hasNextPage,
    hasPrevPage,
    itemsRemaining,
  };
};

export const stringifyDirectoryTree1Deep = (
  params: BuiltinToolCallParams['ls_dir'],
  result: BuiltinToolResultType['ls_dir'],
): string => {
  if (!result.children) {
    return `Error: ${params.uri} is not a directory`;
  }

  let output = '';
  const entries = result.children;

  if (!result.hasPrevPage) {
    // первая страница
    output += `${params.uri.fsPath}\n`;
  }

  if (entries.length === 0 && !result.hasPrevPage && !result.hasNextPage) {
    output += `(Directory exists but is empty.)\n`;
    return output;
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1 && !result.hasNextPage;
    const prefix = isLast ? '└── ' : '├── ';

    output += `${prefix}${entry.name}${entry.isDirectory ? '/' : ''}${entry.isSymbolicLink ? ' (symbolic link)' : ''}\n`;
  }

  if (result.hasNextPage) {
    output += `└── (${result.itemsRemaining} results remaining...)\n`;
  }

  return output;
};

// ---------- общий случай ----------

const resolveChildren = async (
  children: undefined | IFileStat[],
  fileService: IFileService,
  token?: CancellationToken,
): Promise<IFileStat[]> => {
  throwIfCancelled(token);
  const res = await fileService.resolveAll(children ?? []);
  throwIfCancelled(token);
  const stats = res.map((s) => (s.success ? s.stat : null)).filter((s) => !!s);
  return stats;
};

// computeDirectoryTree: вычисление + рендер дерева
const computeAndStringifyDirectoryTree = async (
  eItem: IFileStat,
  fileService: IFileService,
  MAX_CHARS: number,
  fileCount: { count: number } = { count: 0 },
  options: { maxDepth?: number; currentDepth?: number; maxItemsPerDir?: number } = {},
  token?: CancellationToken,
): Promise<{ content: string; wasCutOff: boolean }> => {
  throwIfCancelled(token);
  // значения по умолчанию опций
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const currentDepth = options.currentDepth ?? 0;
  const maxItemsPerDir = options.maxItemsPerDir ?? DEFAULT_MAX_ITEMS_PER_DIR;

  // лимит глубины
  if (currentDepth > maxDepth) {
    return { content: '', wasCutOff: true };
  }

  // лимит файлов
  if (fileCount.count >= MAX_FILES_TOTAL) {
    return { content: '', wasCutOff: true };
  }

  // превышен maxChars — выход
  if (MAX_CHARS <= 0) {
    return { content: '', wasCutOff: true };
  }

  // счётчик файлов
  fileCount.count++;

  // корень без символов дерева
  const nodeLine = `${eItem.name}${eItem.isDirectory ? '/' : ''}${eItem.isSymbolicLink ? ' (symbolic link)' : ''}\n`;

  if (nodeLine.length > MAX_CHARS) {
    return { content: '', wasCutOff: true };
  }

  let content = nodeLine;
  let wasCutOff = false;
  const remainingChars = MAX_CHARS - nodeLine.length;

  // пропускаемый каталог
  const isGitIgnoredDirectory = eItem.isDirectory && shouldExcludeDirectory(eItem.name);

  // дочерние элементы
  if (eItem.isDirectory && !isGitIgnoredDirectory) {
    // сортировка Modified
    const eChildren = await resolveChildren(eItem.children, fileService, token);

    // рекурсия с форматированием
    if (eChildren && eChildren.length > 0) {
      const { childrenContent, childrenCutOff } = await renderChildrenCombined(
        eChildren,
        remainingChars,
        '',
        fileService,
        fileCount,
        { maxDepth, currentDepth, maxItemsPerDir }, // maxItemsPerDir в renderChildren
        token,
      );
      content += childrenContent;
      wasCutOff = childrenCutOff;
    }
  }

  return { content, wasCutOff };
};

// рендер детей с │ ├ └
const renderChildrenCombined = async (
  children: IFileStat[],
  maxChars: number,
  parentPrefix: string,
  fileService: IFileService,
  fileCount: { count: number },
  options: { maxDepth: number; currentDepth: number; maxItemsPerDir?: number },
  token?: CancellationToken,
): Promise<{ childrenContent: string; childrenCutOff: boolean }> => {
  throwIfCancelled(token);
  const { maxDepth, currentDepth } = options; // maxItemsPerDir берём отдельно ниже
  // лимит элементов на каталог (maxItemsPerDir)
  // depth=0 — без лимита items на dir
  const maxItemsPerDir =
    currentDepth === 0 ? Infinity : (options.maxItemsPerDir ?? DEFAULT_MAX_ITEMS_PER_DIR);
  const nextDepth = currentDepth + 1;

  let childrenContent = '';
  let childrenCutOff = false;
  let remainingChars = maxChars;

  // лимит глубины
  if (nextDepth > maxDepth) {
    return { childrenContent: '', childrenCutOff: true };
  }

  // обрезка по maxItemsPerDir
  const itemsToProcess = maxItemsPerDir === Infinity ? children : children.slice(0, maxItemsPerDir);
  const hasMoreItems = children.length > itemsToProcess.length;

  for (let i = 0; i < itemsToProcess.length; i++) {
    throwIfCancelled(token);

    // лимит файлов
    if (fileCount.count >= MAX_FILES_TOTAL) {
      childrenCutOff = true;
      break;
    }

    const child = itemsToProcess[i];
    const isLast = i === itemsToProcess.length - 1 && !hasMoreItems;

    // символы ветви
    const branchSymbol = isLast ? '└── ' : '├── ';
    const childLine = `${parentPrefix}${branchSymbol}${child.name}${child.isDirectory ? '/' : ''}${child.isSymbolicLink ? ' (symbolic link)' : ''}\n`;

    // лимит символов
    if (childLine.length > remainingChars) {
      childrenCutOff = true;
      break;
    }

    childrenContent += childLine;
    remainingChars -= childLine.length;
    fileCount.count++;

    const nextLevelPrefix = parentPrefix + (isLast ? '    ' : '│   ');

    // gitignore — без детей
    const isGitIgnoredDirectory = child.isDirectory && shouldExcludeDirectory(child.name);

    // префикс следующего уровня
    if (child.isDirectory && !isGitIgnoredDirectory) {
      // сортировка Modified
      const eChildren = await resolveChildren(child.children, fileService, token);

      if (eChildren && eChildren.length > 0) {
        const { childrenContent: grandChildrenContent, childrenCutOff: grandChildrenCutOff } =
          await renderChildrenCombined(
            eChildren,
            remainingChars,
            nextLevelPrefix,
            fileService,
            fileCount,
            { maxDepth, currentDepth: nextDepth, maxItemsPerDir },
            token,
          );

        if (grandChildrenContent.length > 0) {
          childrenContent += grandChildrenContent;
          remainingChars -= grandChildrenContent.length;
        }

        if (grandChildrenCutOff) {
          childrenCutOff = true;
        }
      }
    }
  }

  // сообщение об обрезке
  if (hasMoreItems) {
    const remainingCount = children.length - itemsToProcess.length;
    const truncatedLine = `${parentPrefix}└── (${remainingCount} more items not shown...)\n`;

    if (truncatedLine.length <= remainingChars) {
      childrenContent += truncatedLine;
      remainingChars -= truncatedLine.length;
    }
    childrenCutOff = true;
  }

  return { childrenContent, childrenCutOff };
};

// ------------------------- каталоги -------------------------

async function getAllUrisInDirectory(
  directoryUri: URI,
  maxResults: number,
  fileService: IFileService,
  token?: CancellationToken,
): Promise<URI[]> {
  const result: URI[] = [];

  // рекурсивный сбор URI
  async function visitAll(folderStat: IFileStat): Promise<boolean> {
    throwIfCancelled(token);

    // лимит URI
    if (result.length >= maxResults) {
      return false;
    }

    try {
      if (!folderStat.isDirectory || !folderStat.children) {
        return true;
      }

      const eChildren = await resolveChildren(folderStat.children, fileService, token);

      // сначала файлы, потом папки
      for (const child of eChildren) {
        throwIfCancelled(token);
        if (!child.isDirectory) {
          result.push(child.resource);

          // лимит
          if (result.length >= maxResults) {
            return false;
          }
        }
      }

      // затем каталоги
      for (const child of eChildren) {
        throwIfCancelled(token);
        const isGitIgnored = shouldExcludeDirectory(child.name);
        if (child.isDirectory && !isGitIgnored) {
          const shouldContinue = await visitAll(child);
          if (!shouldContinue) {
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      if (error instanceof CancellationError) {
        throw error;
      }
      console.error(`Error processing directory ${folderStat.resource.fsPath}: ${error}`);
      return true; // продолжать обход при ошибке в одном каталоге
    }
  }

  throwIfCancelled(token);
  const rootStat = await fileService.resolve(directoryUri);
  throwIfCancelled(token);
  await visitAll(rootStat);
  return result;
}

// --------------------------------------------------

class DirectoryStrService extends Disposable implements IDirectoryStrService {
  _serviceBrand: undefined;

  constructor(
    @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
    @IFileService private readonly fileService: IFileService,
  ) {
    super();
  }

  async getAllURIsInDirectory(
    uri: URI,
    opts: { maxResults: number; token?: CancellationToken },
  ): Promise<URI[]> {
    return getAllUrisInDirectory(uri, opts.maxResults, this.fileService, opts.token);
  }

  async getDirectoryStrTool(uri: URI, token?: CancellationToken) {
    throwIfCancelled(token);
    const eRoot = await this.fileService.resolve(uri);
    throwIfCancelled(token);
    if (!eRoot) {throw new Error(`The folder ${uri.fsPath} does not exist.`);}

    const maxItemsPerDir = START_MAX_ITEMS_PER_DIR;

    // попытка START_MAX_DEPTH
    const { content: initialContent, wasCutOff: initialCutOff } =
      await computeAndStringifyDirectoryTree(
        eRoot,
        this.fileService,
        MAX_DIRSTR_CHARS_TOTAL_TOOL,
        { count: 0 },
        { maxDepth: START_MAX_DEPTH, currentDepth: 0, maxItemsPerDir },
        token,
      );

    // обрезка — DEFAULT_*
    let content;
    let wasCutOff;
    throwIfCancelled(token);
    if (initialCutOff) {
      const result = await computeAndStringifyDirectoryTree(
        eRoot,
        this.fileService,
        MAX_DIRSTR_CHARS_TOTAL_TOOL,
        { count: 0 },
        { maxDepth: DEFAULT_MAX_DEPTH, currentDepth: 0, maxItemsPerDir: DEFAULT_MAX_ITEMS_PER_DIR },
        token,
      );
      content = result.content;
      wasCutOff = result.wasCutOff;
    } else {
      content = initialContent;
      wasCutOff = initialCutOff;
    }

    let c = content.substring(0, MAX_DIRSTR_CHARS_TOTAL_TOOL);
    c = `Directory of ${uri.fsPath}:\n${content}`;
    if (wasCutOff) {c = `${c}\n...Result was truncated...`;}

    return c;
  }

  async getAllDirectoriesStr({
    cutOffMessage,
    token,
  }: {
    cutOffMessage: string;
    token?: CancellationToken;
  }) {
    let str: string = '';
    let cutOff = false;
    const folders = this.workspaceContextService.getWorkspace().folders;
    if (folders.length === 0) {return '(NO WORKSPACE OPEN)';}

    // START_MAX_ITEMS_PER_DIR по умолчанию
    const startMaxItemsPerDir = START_MAX_ITEMS_PER_DIR;

    for (let i = 0; i < folders.length; i += 1) {
      throwIfCancelled(token);
      if (i > 0) {str += '\n';}

      // сначала первый workspace folder
      const f = folders[i];
      str += `Directory of ${f.uri.fsPath}:\n`;
      const rootURI = f.uri;

      const eRoot = await this.fileService.resolve(rootURI);
      throwIfCancelled(token);
      if (!eRoot) {continue;}

      // попытка START_MAX_DEPTH and startMaxItemsPerDir
      const { content: initialContent, wasCutOff: initialCutOff } =
        await computeAndStringifyDirectoryTree(
          eRoot,
          this.fileService,
          MAX_DIRSTR_CHARS_TOTAL_BEGINNING - str.length,
          { count: 0 },
          { maxDepth: START_MAX_DEPTH, currentDepth: 0, maxItemsPerDir: startMaxItemsPerDir },
          token,
        );

      // обрезка — DEFAULT_*
      let content;
      let wasCutOff;
      throwIfCancelled(token);
      if (initialCutOff) {
        const result = await computeAndStringifyDirectoryTree(
          eRoot,
          this.fileService,
          MAX_DIRSTR_CHARS_TOTAL_BEGINNING - str.length,
          { count: 0 },
          {
            maxDepth: DEFAULT_MAX_DEPTH,
            currentDepth: 0,
            maxItemsPerDir: DEFAULT_MAX_ITEMS_PER_DIR,
          },
          token,
        );
        content = result.content;
        wasCutOff = result.wasCutOff;
      } else {
        content = initialContent;
        wasCutOff = initialCutOff;
      }

      str += content;
      if (wasCutOff) {
        cutOff = true;
        break;
      }
    }

    const ans = cutOff ? `${str.trimEnd()}\n${cutOffMessage}` : str;
    return ans;
  }
}

registerSingleton(IDirectoryStrService, DirectoryStrService, InstantiationType.Delayed);

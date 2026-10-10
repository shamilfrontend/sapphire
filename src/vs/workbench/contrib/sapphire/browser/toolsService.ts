import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { isAbsolute } from '../../../../base/common/path.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import {
  createDecorator,
  IInstantiationService,
} from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
  ISearchPatternBuilder,
  QueryBuilder,
} from '../../../services/search/common/queryBuilder.js';
import { ISearchService, resultIsMatch } from '../../../services/search/common/search.js';
import { getWorkspaceSymbols } from '../../search/common/search.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { ITerminalToolService } from './terminalToolService.js';
import {
  LintErrorItem,
  BuiltinToolCallParams,
  BuiltinToolResultType,
  BuiltinToolName,
  PlanTodoItem,
  PlanTodoStatus,
  CodeNavLocation,
  GrepSearchMatch,
  GlobFileHit,
  MemoryType,
  ParallelSubagentTask,
  SymbolSearchHit,
  WorkspaceDiagnosticItem,
  RenameSymbolChange,
  WebSearchHit,
} from '../common/toolsServiceTypes.js';
import { assertPublicHttpUrl } from '../common/webEgressPolicy.js';
import { parseDuckDuckGoHtml, wrapUntrustedContent } from '../common/webSearchParse.js';
import { IMemoriesService } from '../common/memoriesService.js';
import {
  asJson,
  asTextOrError,
  IRequestService,
} from '../../../../platform/request/common/request.js';
import { IWebContentExtractorService } from '../../../../platform/webContentExtractor/common/webContentExtractor.js';
import { ISapphireModelService } from '../common/sapphireModelService.js';
import { EndOfLinePreference, ITextModel } from '../../../../editor/common/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import {
  DocumentSymbol,
  IWorkspaceTextEdit,
  Location,
  LocationLink,
  WorkspaceEdit,
  symbolKindNames,
} from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import {
  IBulkEditService,
  ResourceTextEdit,
} from '../../../../editor/browser/services/bulkEditService.js';
import { rename } from '../../../../editor/contrib/rename/browser/rename.js';
import { ISapphireCommandBarService } from './sapphireCommandBarService.js';
import {
  computeDirectoryTree1Deep,
  IDirectoryStrService,
  stringifyDirectoryTree1Deep,
} from '../common/directoryStrService.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { timeout } from '../../../../base/common/async.js';
import { RawToolParamsObj } from '../common/sendLLMMessageTypes.js';
import {
  LINT_POLL_AFTER_EDIT_MS,
  MAX_CHILDREN_URIs_PAGE,
  MAX_FILE_CHARS_PAGE,
  MAX_TERMINAL_ABSOLUTE_TIME,
  MAX_TERMINAL_BG_COMMAND_TIME,
  MAX_TERMINAL_INACTIVE_TIME,
} from '../common/prompt/prompts.js';
import {
  normalizePlanTodos,
  parsePlanMarkdown,
  PLAN_DIR_SEGMENTS,
  serializePlanMarkdown,
  slugifyPlanName,
} from '../common/prompt/planFileHelpers.js';
import { ISapphireSettingsService } from '../common/sapphireSettingsService.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { WORKSPACE_DOT_DIR } from '../common/workspaceDotDir.js';
import { migrateLegacyWorkspaceDotDir } from './migrateWorkspaceDotDir.js';
import { IChatThreadService } from './chatThreadService.js';
import { IMCPService } from '../common/mcpService.js';
import { IOfficeExtractService } from '../common/officeExtractService.js';
import { formatOfficePage, officePlainText } from '../common/office/officeDocument.js';
import { onlineMcpServerNames } from '../common/prompt/mcpToolDisclosure.js';
import { IProjectIndexService } from './projectIndexService.js';

const MAX_GREP_MATCHES = 300;
const MAX_DIAGNOSTICS = 500;
const MAX_SYMBOL_HITS = 50;

// Встроенные инструменты для вызовов LLM
type ValidateBuiltinParams = {
  [T in BuiltinToolName]: (p: RawToolParamsObj) => BuiltinToolCallParams[T];
};
type CallBuiltinTool = {
  [T in BuiltinToolName]: (p: BuiltinToolCallParams[T]) => Promise<{
    result: BuiltinToolResultType[T] | Promise<BuiltinToolResultType[T]>;
    interruptTool?: () => void;
  }>;
};
type BuiltinToolResultToString = {
  [T in BuiltinToolName]: (
    p: BuiltinToolCallParams[T],
    result: Awaited<BuiltinToolResultType[T]>,
  ) => string;
};

const isFalsy = (u: unknown) => !u || u === 'null' || u === 'undefined';

const validateStr = (argName: string, value: unknown) => {
  if (value === null) throw new Error(`Invalid LLM output: ${argName} was null.`);
  if (typeof value !== 'string')
    throw new Error(
      `Invalid LLM output format: ${argName} must be a string, but its type is "${typeof value}". Full value: ${JSON.stringify(value)}.`,
    );
  return value;
};

/** Убирает одну пару внешних кавычек, если LLM обернул всю команду в них. */
const stripOuterQuotes = (s: string) => {
  const t = s.trim();
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return t.slice(1, -1);
    }
  }
  return s;
};

// Не проверяем, что путь лежит внутри workspace (доверяем LLM)
const validateURI = (uriStr: unknown, workspaceFolderUri?: URI) => {
  if (uriStr === null) throw new Error(`Invalid LLM output: uri was null.`);
  if (typeof uriStr !== 'string')
    throw new Error(
      `Invalid LLM output format: Provided uri must be a string, but it's a(n) ${typeof uriStr}. Full value: ${JSON.stringify(uriStr)}.`,
    );

  // Уже полный URI со схемой (vscode-remote://, file:// и т.д.) — ищем ://
  // Примеры:
  // - vscode-remote://wsl+Ubuntu/home/user/file.txt (WSL)
  // - vscode-remote://ssh-remote+myserver/home/user/file.txt (SSH)
  // - file:///home/user/file.txt
  // - /home/user/file.txt → будет преобразован в file://
  // - C:\Users\file.txt → file:// на Windows
  if (uriStr.includes('://')) {
    try {
      const uri = URI.parse(uriStr);
      return uri;
    } catch (e) {
      throw new Error(`Invalid URI format: ${uriStr}. Error: ${e}`);
    }
  } else {
    const pathStr = uriStr.trim();
    if (!pathStr) {
      if (workspaceFolderUri) {
        return workspaceFolderUri;
      }
      throw new Error(`Invalid LLM output: uri was empty.`);
    }
    // Абсолютный локальный путь
    if (isAbsolute(pathStr) || /^[a-zA-Z]:[\\/]/.test(pathStr)) {
      return URI.file(pathStr);
    }
    // Относительный путь — от корня workspace
    if (workspaceFolderUri) {
      return joinPath(workspaceFolderUri, pathStr);
    }
    return URI.file(pathStr);
  }
};

const validateOptionalURI = (uriStr: unknown, workspaceFolderUri?: URI) => {
  if (isFalsy(uriStr)) return null;
  return validateURI(uriStr, workspaceFolderUri);
};

const validateOptionalStr = (argName: string, str: unknown) => {
  if (isFalsy(str)) return null;
  return validateStr(argName, str);
};

/** true, если в cwd «утекли» команда, аргументы или список файлов вместо каталога. */
const looksLikeCwdWithCommandLeak = (cwd: string): boolean => {
  const trimmed = cwd.trim();
  // Смотрим только на пути, похожие на абсолютные; относительный «src foo» как cwd редок.
  if (!(trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(trimmed))) {
    return false;
  }
  const spaced = trimmed.match(/^(.+?)\s+(\S[\s\S]*)$/);
  if (!spaced) return false;
  const after = spaced[2].trim();
  if (
    /^(npx|npm|yarn|pnpm|bun|node|deno|eslint|vitest|jest|tsc|vue-tsc|git|cd|ls|cat|echo|python|pip|cargo|go|make|bash|sh|zsh)\b/i.test(
      after,
    )
  ) {
    return true;
  }
  if (/\.(ts|tsx|js|jsx|mjs|cjs|vue|py|go|rs|md|json|css|scss)(\s|$)/i.test(after)) {
    return true;
  }
  if (/^(src|tests?|dist|lib|app|packages|components|modules)[/\\]/i.test(after)) {
    return true;
  }
  // Флаги или списки файлов после пути
  if (/^--?\w/.test(after)) return true;
  return false;
};

/**
 * Необязательный cwd для терминальных инструментов: абсолютный путь или null (корень workspace).
 * Битые значения (команда в cwd) мягко отклоняются — команда всё равно выполнится из корня.
 */
const validateOptionalCwd = (
  cwdUnknown: unknown,
  workspaceFolders: readonly { uri: URI }[],
): string | null => {
  if (isFalsy(cwdUnknown)) return null;
  const raw = validateStr('cwd', cwdUnknown).trim();
  if (!raw) return null;

  if (looksLikeCwdWithCommandLeak(raw)) {
    return null;
  }

  const primary = workspaceFolders[0]?.uri;
  let abs: string;
  if (isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) {
    abs = raw;
  } else if (primary) {
    abs = joinPath(primary, raw).fsPath;
  } else {
    abs = raw;
  }

  // При совпадении без учёта регистра — канонический регистр из корня workspace.
  const absLower = abs.replace(/\\/g, '/').toLowerCase();
  for (const folder of workspaceFolders) {
    const folderPath = folder.uri.fsPath;
    const folderNorm = folderPath.replace(/\\/g, '/');
    const folderLower = folderNorm.toLowerCase();
    if (absLower === folderLower) {
      return folderPath;
    }
    if (absLower.startsWith(folderLower.endsWith('/') ? folderLower : `${folderLower}/`)) {
      const remainder = abs.replace(/\\/g, '/').slice(folderNorm.length);
      // Разделители ОС из folderPath; хвост пути нормализуем через /
      const sep = folderPath.includes('\\') ? '\\' : '/';
      const rem =
        remainder.startsWith('/') || remainder.startsWith('\\') ? remainder.slice(1) : remainder;
      return rem ? `${folderPath}${sep}${rem.replace(/\//g, sep)}` : folderPath;
    }
  }

  return abs;
};

const validatePageNum = (pageNumberUnknown: unknown) => {
  if (!pageNumberUnknown) return 1;
  const parsedInt = Number.parseInt(`${pageNumberUnknown}`);
  if (!Number.isInteger(parsedInt))
    throw new Error(`Page number was not an integer: "${pageNumberUnknown}".`);
  if (parsedInt < 1)
    throw new Error(
      `Invalid LLM output format: Specified page number must be 1 or greater: "${pageNumberUnknown}".`,
    );
  return parsedInt;
};

const validateNumber = (numStr: unknown, opts: { default: number | null }) => {
  if (typeof numStr === 'number') return numStr;
  if (isFalsy(numStr)) return opts.default;

  if (typeof numStr === 'string') {
    const parsedInt = Number.parseInt(`${numStr}`);
    if (!Number.isInteger(parsedInt)) return opts.default;
    return parsedInt;
  }

  return opts.default;
};

const validateProposedTerminalId = (terminalIdUnknown: unknown) => {
  if (!terminalIdUnknown)
    throw new Error(
      `A value for terminalID must be specified, but the value was "${terminalIdUnknown}"`,
    );
  const terminalId = `${terminalIdUnknown}`;
  return terminalId;
};

const validateBoolean = (b: unknown, opts: { default: boolean }) => {
  if (typeof b === 'string') {
    if (b === 'true') return true;
    if (b === 'false') return false;
  }
  if (typeof b === 'boolean') {
    return b;
  }
  return opts.default;
};

const validatePlanTodos = (
  todosUnknown: unknown,
  opts?: { allowNull: boolean },
): PlanTodoItem[] | null => {
  if (isFalsy(todosUnknown)) {
    if (opts?.allowNull) return null;
    return [];
  }
  let parsed: unknown = todosUnknown;
  if (typeof todosUnknown === 'string') {
    try {
      parsed = JSON.parse(todosUnknown);
    } catch {
      throw new Error(`Invalid LLM output: todos must be a JSON array. Got: ${todosUnknown}`);
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid LLM output: todos must be an array.`);
  }
  const todos: PlanTodoItem[] = parsed.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid todo at index ${i}`);
    }
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id : `step-${i + 1}`;
    const content = typeof rec.content === 'string' ? rec.content : String(rec.content ?? '');
    const statusRaw = typeof rec.status === 'string' ? rec.status : 'pending';
    const status = (
      ['pending', 'in_progress', 'completed', 'cancelled'].includes(statusRaw)
        ? statusRaw
        : 'pending'
    ) as PlanTodoStatus;
    return { id, content, status };
  });
  return normalizePlanTodos(todos);
};

const checkIfIsFolder = (uriStr: string) => {
  uriStr = uriStr.trim();
  if (uriStr.endsWith('/') || uriStr.endsWith('\\')) return true;
  return false;
};

const MAX_FIND_REFERENCES = 30;

const resolveSymbolPosition = (model: ITextModel, line: number, symbol: string | null): Position => {
  const lineCount = model.getLineCount();
  const safeLine = Math.min(Math.max(1, line), lineCount);
  if (symbol) {
    const lineContent = model.getLineContent(safeLine);
    const idx = lineContent.indexOf(symbol);
    if (idx >= 0) {
      return new Position(safeLine, idx + 1);
    }
  }
  return new Position(safeLine, 1);
};

const normalizeLanguageLocations = (
  value: Location | LocationLink | (Location | LocationLink)[],
): { uri: URI; startLine: number; endLine: number }[] => {
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => {
    const range =
      'targetSelectionRange' in item && item.targetSelectionRange
        ? item.targetSelectionRange
        : item.range;
    return {
      uri: item.uri,
      startLine: range.startLineNumber,
      endLine: range.endLineNumber,
    };
  });
};

const stringifyCodeNavLocations = (
  locations: CodeNavLocation[],
  opts?: { truncated?: boolean; message?: string | null },
): string => {
  if (opts?.message) {
    return opts.message;
  }
  if (locations.length === 0) {
    return 'No locations found.';
  }
  const body = locations
    .map((loc) => `${loc.uri.fsPath}:${loc.startLine}-${loc.endLine}\n${loc.preview}`)
    .join('\n\n');
  return opts?.truncated ? `${body}\n\n(truncated; more references exist)` : body;
};

export interface IToolsService {
  readonly _serviceBrand: undefined;
  validateParams: ValidateBuiltinParams;
  callTool: CallBuiltinTool;
  stringOfResult: BuiltinToolResultToString;
}

export const IToolsService = createDecorator<IToolsService>('ToolsService');

export class ToolsService implements IToolsService {
  readonly _serviceBrand: undefined;

  public validateParams: ValidateBuiltinParams;

  public callTool: CallBuiltinTool;

  public stringOfResult: BuiltinToolResultToString;

  constructor(
    @IFileService fileService: IFileService,
    @IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
    @ISearchService searchService: ISearchService,
    @IInstantiationService instantiationService: IInstantiationService,
    @ISapphireModelService sapphireModelService: ISapphireModelService,
    @IEditCodeService editCodeService: IEditCodeService,
    @ITerminalToolService private readonly terminalToolService: ITerminalToolService,
    @ISapphireCommandBarService private readonly commandBarService: ISapphireCommandBarService,
    @IDirectoryStrService private readonly directoryStrService: IDirectoryStrService,
    @IMarkerService private readonly markerService: IMarkerService,
    @ISapphireSettingsService private readonly sapphireSettingsService: ISapphireSettingsService,
    @IMCPService private readonly mcpService: IMCPService,
    @IOfficeExtractService private readonly officeExtractService: IOfficeExtractService,
    @ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
    @IBulkEditService private readonly bulkEditService: IBulkEditService,
    @IRequestService private readonly requestService: IRequestService,
    @IWebContentExtractorService
    private readonly webContentExtractorService: IWebContentExtractorService,
    @IProjectIndexService private readonly projectIndexService: IProjectIndexService,
    @IMemoriesService private readonly memoriesService: IMemoriesService,
  ) {
    const queryBuilder = instantiationService.createInstance(QueryBuilder);
    const wsUri = () => workspaceContextService.getWorkspace().folders[0]?.uri;
    const vURI = (s: unknown) => validateURI(s, wsUri());
    const vOptURI = (s: unknown) => validateOptionalURI(s, wsUri());

    // Кэш web_search / browse_url (TTL 1 ч, не более 100 ключей)
    type CacheEntry<T> = { at: number; value: T };
    const webSearchCache = new Map<string, CacheEntry<WebSearchHit[]>>();
    const browseCache = new Map<string, CacheEntry<BuiltinToolResultType['browse_url']>>();
    const CACHE_TTL_MS = 60 * 60 * 1000;
    const getCached = <T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined => {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at > CACHE_TTL_MS) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    };
    const setCached = <T>(map: Map<string, CacheEntry<T>>, key: string, value: T) => {
      if (map.size > 100) {
        const first = map.keys().next().value;
        if (first !== undefined) {
          map.delete(first);
        }
      }
      map.set(key, { at: Date.now(), value });
    };

    this.validateParams = {
      read_file: (params: RawToolParamsObj) => {
        const {
          uri: uriStr,
          start_line: startLineUnknown,
          end_line: endLineUnknown,
          page_number: pageNumberUnknown,
        } = params;
        const uri = vURI(uriStr);
        const pageNumber = validatePageNum(pageNumberUnknown);

        let startLine = validateNumber(startLineUnknown, { default: null });
        let endLine = validateNumber(endLineUnknown, { default: null });

        if (startLine !== null && startLine < 1) startLine = null;
        if (endLine !== null && endLine < 1) endLine = null;

        return { uri, startLine, endLine, pageNumber };
      },
      ls_dir: (params: RawToolParamsObj) => {
        const { uri: uriStr, page_number: pageNumberUnknown } = params;

        const uri = vURI(uriStr);
        const pageNumber = validatePageNum(pageNumberUnknown);
        return { uri, pageNumber };
      },
      get_dir_tree: (params: RawToolParamsObj) => {
        const { uri: uriStr } = params;
        const uri = vURI(uriStr);
        return { uri };
      },
      search_pathnames_only: (params: RawToolParamsObj) => {
        const {
          query: queryUnknown,
          search_in_folder: includeUnknown,
          page_number: pageNumberUnknown,
        } = params;

        const queryStr = validateStr('query', queryUnknown);
        const pageNumber = validatePageNum(pageNumberUnknown);
        const includePattern = validateOptionalStr('include_pattern', includeUnknown);

        return { query: queryStr, includePattern, pageNumber };
      },
      search_project_index: (params: RawToolParamsObj) => {
        const { query: queryUnknown, page_number: pageNumberUnknown } = params;
        const query = validateStr('query', queryUnknown);
        const pageNumber = validatePageNum(pageNumberUnknown);
        return { query, pageNumber };
      },
      search_for_files: (params: RawToolParamsObj) => {
        const {
          query: queryUnknown,
          search_in_folder: searchInFolderUnknown,
          is_regex: isRegexUnknown,
          page_number: pageNumberUnknown,
        } = params;
        const queryStr = validateStr('query', queryUnknown);
        const pageNumber = validatePageNum(pageNumberUnknown);
        const searchInFolder = vOptURI(searchInFolderUnknown);
        const isRegex = validateBoolean(isRegexUnknown, { default: false });
        return {
          query: queryStr,
          isRegex,
          searchInFolder,
          pageNumber,
        };
      },
      search_in_file: (params: RawToolParamsObj) => {
        const { uri: uriStr, query: queryUnknown, is_regex: isRegexUnknown } = params;
        const uri = vURI(uriStr);
        const query = validateStr('query', queryUnknown);
        const isRegex = validateBoolean(isRegexUnknown, { default: false });
        return { uri, query, isRegex };
      },

      grep_search: (params: RawToolParamsObj) => {
        const query = validateStr('query', params.query);
        if (!query.trim()) {
          throw new Error('grep_search: query cannot be empty');
        }
        const includePattern = validateOptionalStr('include_pattern', params.include_pattern);
        const excludePattern = validateOptionalStr('exclude_pattern', params.exclude_pattern);
        const isRegex = validateBoolean(params.is_regex, { default: false });
        const caseSensitive = validateBoolean(params.case_sensitive, { default: false });
        if (isRegex) {
          try {
            new RegExp(query);
          } catch (e) {
            throw new Error(
              `grep_search: invalid regex: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        return { query, includePattern, excludePattern, isRegex, caseSensitive };
      },

      read_lint_errors: (params: RawToolParamsObj) => {
        const { uri: uriUnknown } = params;
        const uri = vURI(uriUnknown);
        return { uri };
      },

      get_diagnostics: (params: RawToolParamsObj) => {
        const uri = vOptURI(params.uri);
        return { uri };
      },

      go_to_definition: (params: RawToolParamsObj) => {
        const uri = vURI(params.uri);
        const line = validateNumber(params.line, { default: null });
        if (line === null || line < 1) {
          throw new Error(`Invalid LLM output: line must be a positive integer.`);
        }
        const symbol = validateOptionalStr('symbol', params.symbol);
        return { uri, line, symbol };
      },

      find_references: (params: RawToolParamsObj) => {
        const uri = vURI(params.uri);
        const line = validateNumber(params.line, { default: null });
        if (line === null || line < 1) {
          throw new Error(`Invalid LLM output: line must be a positive integer.`);
        }
        const symbol = validateOptionalStr('symbol', params.symbol);
        return { uri, line, symbol };
      },

      search_symbols: (params: RawToolParamsObj) => {
        const query = validateStr('query', params.query);
        if (!query.trim()) {
          throw new Error('search_symbols: query cannot be empty');
        }
        const uri = vOptURI(params.uri);
        return { query, uri };
      },

      rename_symbol: (params: RawToolParamsObj) => {
        const uri = vURI(params.uri);
        const line = validateNumber(params.line, { default: null });
        if (line === null || line < 1) {
          throw new Error(`Invalid LLM output: line must be a positive integer.`);
        }
        const symbol = validateOptionalStr('symbol', params.symbol);
        const newName = validateStr('new_name', params.new_name).trim();
        if (!newName) {
          throw new Error('rename_symbol: new_name cannot be empty');
        }
        if (/\s/.test(newName)) {
          throw new Error('rename_symbol: new_name must be a single identifier without spaces');
        }
        return { uri, line, symbol, newName };
      },

      glob_files: (params: RawToolParamsObj) => {
        const pattern = validateStr('pattern', params.pattern).trim();
        if (!pattern) {
          throw new Error('glob_files: pattern cannot be empty');
        }
        let limit = validateNumber(params.limit, { default: 100 }) ?? 100;
        if (limit < 1) limit = 1;
        if (limit > 1000) limit = 1000;
        return { pattern, limit };
      },

      web_search: (params: RawToolParamsObj) => {
        const query = validateStr('query', params.query).trim();
        if (!query) {
          throw new Error('web_search: query cannot be empty');
        }
        let k = validateNumber(params.k, { default: 5 }) ?? 5;
        if (k < 1) k = 1;
        if (k > 10) k = 10;
        return { query, k };
      },

      browse_url: (params: RawToolParamsObj) => {
        const url = validateStr('url', params.url).trim();
        assertPublicHttpUrl(url);
        return { url };
      },

      save_memory: (params: RawToolParamsObj) => {
        const typeRaw = validateStr('type', params.type).trim().toLowerCase();
        if (typeRaw !== 'decision' && typeRaw !== 'preference' && typeRaw !== 'context') {
          throw new Error('save_memory: type must be decision, preference, or context');
        }
        const key = validateStr('key', params.key).trim();
        const value = validateStr('value', params.value).trim();
        if (!key || !value) {
          throw new Error('save_memory: key and value cannot be empty');
        }
        let tags: string[] | null = null;
        if (!isFalsy(params.tags)) {
          const tagsStr = validateStr('tags', params.tags);
          tags = tagsStr
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
        }
        return { type: typeRaw as MemoryType, key, value, tags };
      },

      run_subagent: (params: RawToolParamsObj) => {
        const description = validateStr('description', params.description);
        const prompt = validateStr('prompt', params.prompt);
        return { description, prompt };
      },

      run_parallel_subagents: (params: RawToolParamsObj) => {
        let parsed: unknown = params.tasks;
        if (typeof params.tasks === 'string') {
          try {
            parsed = JSON.parse(params.tasks);
          } catch {
            throw new Error('run_parallel_subagents: tasks must be a JSON array');
          }
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error('run_parallel_subagents: tasks must be a non-empty array');
        }
        if (parsed.length > 4) {
          throw new Error('run_parallel_subagents: at most 4 tasks allowed');
        }
        const tasks: ParallelSubagentTask[] = parsed.map((item, i) => {
          if (!item || typeof item !== 'object') {
            throw new Error(`run_parallel_subagents: tasks[${i}] must be an object`);
          }
          const rec = item as { description?: unknown; prompt?: unknown };
          const description = validateStr(`tasks[${i}].description`, rec.description);
          const prompt = validateStr(`tasks[${i}].prompt`, rec.prompt);
          if (!prompt.trim()) {
            throw new Error(`run_parallel_subagents: tasks[${i}].prompt cannot be empty`);
          }
          return { description, prompt };
        });
        return { tasks };
      },

      get_chat_history: (params: RawToolParamsObj) => {
        const threadId = validateOptionalStr('thread_id', params.thread_id);
        return { threadId };
      },

      enable_mcp_server: (params: RawToolParamsObj) => {
        const serverName = validateStr('server_name', params.server_name);
        return { serverName };
      },

      create_plan: (params: RawToolParamsObj) => {
        const name = validateStr('name', params.name);
        const overview = validateStr('overview', params.overview);
        const plan = validateStr('plan', params.plan);
        const todos = validatePlanTodos(params.todos) ?? [];
        return { name, overview, plan, todos };
      },

      update_plan: (params: RawToolParamsObj) => {
        const planUri = vURI(params.plan_uri ?? params.uri);
        const name = isFalsy(params.name) ? null : validateStr('name', params.name);
        const overview = isFalsy(params.overview) ? null : validateStr('overview', params.overview);
        const plan = isFalsy(params.plan) ? null : validateStr('plan', params.plan);
        const todos = validatePlanTodos(params.todos, { allowNull: true });
        return { planUri, name, overview, plan, todos };
      },

      // ---

      create_file_or_folder: (params: RawToolParamsObj) => {
        const { uri: uriUnknown } = params;
        const uri = vURI(uriUnknown);
        const uriStr = validateStr('uri', uriUnknown);
        const isFolder = checkIfIsFolder(uriStr);
        return { uri, isFolder };
      },

      delete_file_or_folder: (params: RawToolParamsObj) => {
        const { uri: uriUnknown, is_recursive: isRecursiveUnknown } = params;
        const uri = vURI(uriUnknown);
        const isRecursive = validateBoolean(isRecursiveUnknown, { default: false });
        const uriStr = validateStr('uri', uriUnknown);
        const isFolder = checkIfIsFolder(uriStr);
        return { uri, isRecursive, isFolder };
      },

      rewrite_file: (params: RawToolParamsObj) => {
        const { uri: uriStr, new_content: newContentUnknown } = params;
        const uri = vURI(uriStr);
        const newContent = validateStr('newContent', newContentUnknown);
        return { uri, newContent };
      },

      edit_file: (params: RawToolParamsObj) => {
        const { uri: uriStr, search_replace_blocks: searchReplaceBlocksUnknown } = params;
        const uri = vURI(uriStr);
        const searchReplaceBlocks = validateStr('searchReplaceBlocks', searchReplaceBlocksUnknown);
        return { uri, searchReplaceBlocks };
      },

      // ---

      run_command: (params: RawToolParamsObj) => {
        const { command: commandUnknown, cwd: cwdUnknown } = params;
        const command = stripOuterQuotes(validateStr('command', commandUnknown));
        const cwd = validateOptionalCwd(cwdUnknown, workspaceContextService.getWorkspace().folders);
        const terminalId = generateUuid();
        return { command, cwd, terminalId };
      },
      run_persistent_command: (params: RawToolParamsObj) => {
        const { command: commandUnknown, persistent_terminal_id: persistentTerminalIdUnknown } =
          params;
        const command = stripOuterQuotes(validateStr('command', commandUnknown));
        const persistentTerminalId = validateProposedTerminalId(persistentTerminalIdUnknown);
        return { command, persistentTerminalId };
      },
      open_persistent_terminal: (params: RawToolParamsObj) => {
        const { cwd: cwdUnknown } = params;
        const cwd = validateOptionalCwd(cwdUnknown, workspaceContextService.getWorkspace().folders);
        // Доп. параметров нет — откроется новый фоновый терминал
        return { cwd };
      },
      kill_persistent_terminal: (params: RawToolParamsObj) => {
        const { persistent_terminal_id: terminalIdUnknown } = params;
        const persistentTerminalId = validateProposedTerminalId(terminalIdUnknown);
        return { persistentTerminalId };
      },
    };

    this.callTool = {
      read_file: async ({ uri, startLine, endLine, pageNumber }) => {
        const office = await this.officeExtractService.extractIfOffice(uri);
        if (office) {
          return {
            result: formatOfficePage(office, pageNumber, MAX_FILE_CHARS_PAGE, startLine, endLine),
          };
        }
        await sapphireModelService.initializeModel(uri);
        const { model } = await sapphireModelService.getModelSafe(uri);
        if (model === null) {
          throw new Error(`No contents; File does not exist.`);
        }

        let contents: string;
        if (startLine === null && endLine === null) {
          contents = model.getValue(EndOfLinePreference.LF);
        } else {
          const startLineNumber = startLine === null ? 1 : startLine;
          const endLineNumber = endLine === null ? model.getLineCount() : endLine;
          contents = model.getValueInRange(
            { startLineNumber, startColumn: 1, endLineNumber, endColumn: Number.MAX_SAFE_INTEGER },
            EndOfLinePreference.LF,
          );
        }

        const totalNumLines = model.getLineCount();

        const fromIdx = MAX_FILE_CHARS_PAGE * (pageNumber - 1);
        const toIdx = MAX_FILE_CHARS_PAGE * pageNumber - 1;
        const fileContents = contents.slice(fromIdx, toIdx + 1); // постранично
        const hasNextPage = contents.length - 1 - toIdx >= 1;
        const totalFileLen = contents.length;
        return { result: { fileContents, totalFileLen, hasNextPage, totalNumLines } };
      },

      ls_dir: async ({ uri, pageNumber }) => {
        const cts = new CancellationTokenSource();
        const resultPromise = computeDirectoryTree1Deep(fileService, uri, pageNumber, cts.token);
        return { result: resultPromise, interruptTool: () => cts.cancel() };
      },

      get_dir_tree: async ({ uri }) => {
        const cts = new CancellationTokenSource();
        const resultPromise = (async () => {
          const str = await this.directoryStrService.getDirectoryStrTool(uri, cts.token);
          return { str };
        })();
        return { result: resultPromise, interruptTool: () => cts.cancel() };
      },

      search_pathnames_only: async ({ query: queryStr, includePattern, pageNumber }) => {
        const cts = new CancellationTokenSource();
        const query = queryBuilder.file(
          workspaceContextService.getWorkspace().folders.map((f) => f.uri),
          {
            filePattern: queryStr,
            includePattern: includePattern ?? undefined,
            sortByScore: true, // заметно улучшает релевантность
          },
        );
        const resultPromise = (async () => {
          const data = await searchService.fileSearch(query, cts.token);
          const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1);
          const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1;
          const uris = data.results
            .slice(fromIdx, toIdx + 1) // постранично
            .map(({ resource }) => resource);

          const hasNextPage = data.results.length - 1 - toIdx >= 1;
          return { uris, hasNextPage };
        })();
        return { result: resultPromise, interruptTool: () => cts.cancel() };
      },

      search_project_index: async ({ query, pageNumber }) => {
        const folder = workspaceContextService.getWorkspace().folders[0];
        const { hits, hasNextPage } = this.projectIndexService.searchPaged(query, pageNumber);
        return {
          result: {
            hits: hits.map((h) => ({
              uri: folder ? folder.toResource(h.path) : URI.file(h.path),
              score: h.score,
              purpose: h.purpose,
              localRole: h.localRole,
              tags: h.tags,
              anchor: h.anchor,
              kind: h.kind,
            })),
            hasNextPage,
          },
        };
      },

      search_for_files: async ({ query: queryStr, isRegex, searchInFolder, pageNumber }) => {
        const cts = new CancellationTokenSource();
        const searchFolders =
          searchInFolder === null
            ? workspaceContextService.getWorkspace().folders.map((f) => f.uri)
            : [searchInFolder];

        const query = queryBuilder.text(
          {
            pattern: queryStr,
            isRegExp: isRegex,
          },
          searchFolders,
        );

        const resultPromise = (async () => {
          const data = await searchService.textSearch(query, cts.token);
          const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1);
          const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1;
          const uris = data.results
            .slice(fromIdx, toIdx + 1) // постранично
            .map(({ resource }) => resource);

          const hasNextPage = data.results.length - 1 - toIdx >= 1;
          return { queryStr, uris, hasNextPage };
        })();
        return { result: resultPromise, interruptTool: () => cts.cancel() };
      },
      search_in_file: async ({ uri, query, isRegex }) => {
        const office = await this.officeExtractService.extractIfOffice(uri);
        let contents: string;
        if (office) {
          contents = officePlainText(office);
        } else {
          await sapphireModelService.initializeModel(uri);
          const { model } = await sapphireModelService.getModelSafe(uri);
          if (model === null) {
            throw new Error(`No contents; File does not exist.`);
          }
          contents = model.getValue(EndOfLinePreference.LF);
        }
        const contentOfLine = contents.split('\n');
        const totalLines = contentOfLine.length;
        const regex = isRegex ? new RegExp(query) : null;
        const lines: number[] = [];
        for (let i = 0; i < totalLines; i++) {
          const line = contentOfLine[i];
          if ((isRegex && regex!.test(line)) || (!isRegex && line.includes(query))) {
            const matchLine = i + 1;
            lines.push(matchLine);
          }
        }
        return { result: { lines } };
      },

      grep_search: async ({
        query,
        includePattern,
        excludePattern,
        isRegex,
        caseSensitive,
      }) => {
        const cts = new CancellationTokenSource();
        const folders = workspaceContextService.getWorkspace().folders.map((f) => f.uri);
        const excludePatterns: ISearchPatternBuilder<URI>[] | undefined = excludePattern
          ? [{ pattern: excludePattern }]
          : undefined;
        const textQuery = queryBuilder.text(
          { pattern: query, isRegExp: isRegex, isCaseSensitive: caseSensitive },
          folders,
          {
            includePattern: includePattern ?? undefined,
            excludePattern: excludePatterns,
            maxResults: MAX_GREP_MATCHES,
            previewOptions: { matchLines: 1, charsPerLine: 300 },
          },
        );
        const resultPromise = (async () => {
          const data = await searchService.textSearch(textQuery, cts.token);
          const matches: GrepSearchMatch[] = [];
          let totalMatches = 0;
          for (const fileMatch of data.results) {
            for (const textMatch of fileMatch.results ?? []) {
              if (!resultIsMatch(textMatch)) {
                continue;
              }
              totalMatches += 1;
              if (matches.length >= MAX_GREP_MATCHES) {
                continue;
              }
              const firstLoc = textMatch.rangeLocations[0];
              if (!firstLoc) {
                continue;
              }
              // Диапазоны поиска 0-based; модели отдаём строки с 1.
              matches.push({
                uri: fileMatch.resource,
                lineNumber: firstLoc.source.startLineNumber + 1,
                lineContent: textMatch.previewText.trimEnd(),
              });
            }
          }
          return { matches, totalMatches };
        })();
        return { result: resultPromise, interruptTool: () => cts.cancel() };
      },

      read_lint_errors: async ({ uri }) => {
        await timeout(1000);
        const { lintErrors } = this._getLintErrors(uri);
        return { result: { lintErrors } };
      },

      get_diagnostics: async ({ uri }) => {
        const markers = uri
          ? this.markerService.read({ resource: uri })
          : this.markerService.read();
        const diagnostics: WorkspaceDiagnosticItem[] = markers
          .filter(
            (m) => m.severity === MarkerSeverity.Error || m.severity === MarkerSeverity.Warning,
          )
          .slice(0, MAX_DIAGNOSTICS)
          .map((m) => ({
            uri: m.resource,
            message: m.message,
            severity: (m.severity === MarkerSeverity.Error ? 'error' : 'warning') as
              | 'error'
              | 'warning',
            startLine: m.startLineNumber,
            endLine: m.endLineNumber,
            source: m.source ?? null,
            code: (typeof m.code === 'string' ? m.code : m.code?.value) ?? null,
          }));
        return { result: { diagnostics } };
      },

      go_to_definition: async ({ uri, line, symbol }) => {
        const { locations, message } = await this._runCodeNav({
          kind: 'definition',
          uri,
          line,
          symbol,
          workspaceContextService,
          sapphireModelService,
        });
        return { result: { locations, message } };
      },

      find_references: async ({ uri, line, symbol }) => {
        const result = await this._runCodeNav({
          kind: 'references',
          uri,
          line,
          symbol,
          workspaceContextService,
          sapphireModelService,
        });
        return { result };
      },

      search_symbols: async ({ query, uri }) => {
        const queryLower = query.toLowerCase();
        const symbols: SymbolSearchHit[] = [];

        if (uri) {
          await sapphireModelService.initializeModel(uri);
          const { model } = await sapphireModelService.getModelSafe(uri);
          if (model === null) {
            throw new Error(`File does not exist: ${uri.fsPath}`);
          }
          const providers = this.languageFeaturesService.documentSymbolProvider.ordered(model);
          const collect = (sym: DocumentSymbol, parentName = '') => {
            const fullName = parentName ? `${parentName}.${sym.name}` : sym.name;
            if (fullName.toLowerCase().includes(queryLower)) {
              symbols.push({
                name: fullName,
                kind: symbolKindNames[sym.kind] ?? String(sym.kind),
                uri,
                startLine: sym.range.startLineNumber,
                endLine: sym.range.endLineNumber,
              });
            }
            for (const child of sym.children ?? []) {
              collect(child, fullName);
            }
          };
          for (const provider of providers) {
            const docSymbols = await provider.provideDocumentSymbols(model, CancellationToken.None);
            if (!docSymbols) {
              continue;
            }
            for (const sym of docSymbols) {
              collect(sym);
            }
          }
        } else {
          const items = await getWorkspaceSymbols(query, CancellationToken.None);
          for (const item of items) {
            const range = item.symbol.location.range;
            symbols.push({
              name: item.symbol.name,
              kind: symbolKindNames[item.symbol.kind] ?? String(item.symbol.kind),
              uri: item.symbol.location.uri,
              startLine: range.startLineNumber,
              endLine: range.endLineNumber,
            });
          }
        }

        const truncated = symbols.length > MAX_SYMBOL_HITS;
        return {
          result: {
            symbols: symbols.slice(0, MAX_SYMBOL_HITS),
            truncated,
          },
        };
      },

      rename_symbol: async ({ uri, line, symbol, newName }) => {
        const result = await this._executeRenameSymbol({
          uri,
          line,
          symbol,
          newName,
          sapphireModelService,
          workspaceContextService,
        });
        return { result };
      },

      glob_files: async ({ pattern, limit }) => {
        const cts = new CancellationTokenSource();
        const resultPromise = (async () => {
          const folders = workspaceContextService.getWorkspace().folders.map((f) => f.uri);
          if (!folders.length) {
            return { files: [] as GlobFileHit[], truncated: false };
          }
          const query = queryBuilder.file(folders, {
            filePattern: pattern,
            sortByScore: false,
          });
          const data = await searchService.fileSearch(query, cts.token);
          const preCap = Math.max(limit * 5, 500);
          const resources = data.results.slice(0, preCap).map((r) => r.resource);
          const files: GlobFileHit[] = [];
          for (const uri of resources) {
            try {
              const stat = await fileService.stat(uri);
              files.push({
                uri,
                mtime: stat.mtime,
                size: typeof stat.size === 'number' ? stat.size : 0,
              });
            } catch {
              files.push({ uri, mtime: 0, size: 0 });
            }
          }
          files.sort((a, b) => b.mtime - a.mtime);
          const truncated = files.length > limit || data.results.length > preCap;
          return { files: files.slice(0, limit), truncated };
        })();
        return { result: resultPromise, interruptTool: () => cts.cancel() };
      },

      web_search: async ({ query, k }) => {
        const cts = new CancellationTokenSource();
        const cacheKey = `search:${query}:${k}`;
        const cached = getCached(webSearchCache, cacheKey);
        if (cached) {
          return { result: { results: cached } };
        }
        const resultPromise = (async () => {
          const results: WebSearchHit[] = [];
          try {
            const ctx = await this.requestService.request(
              {
                type: 'GET',
                url: `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
              },
              cts.token,
            );
            const json = await asJson<{
              AbstractText?: string;
              AbstractURL?: string;
              Heading?: string;
              RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Name?: string }>;
            }>(ctx);
            if (json?.AbstractText && json.AbstractURL) {
              results.push({
                title: json.Heading || query,
                snippet: json.AbstractText,
                url: json.AbstractURL,
              });
            }
            for (const topic of json?.RelatedTopics ?? []) {
              if (results.length >= k) break;
              if (topic.Text && topic.FirstURL) {
                results.push({
                  title: topic.Name || topic.Text.slice(0, 80),
                  snippet: topic.Text,
                  url: topic.FirstURL,
                });
              }
            }
          } catch {
            // JSON API не дал достаточно — пробуем HTML SERP
          }
          if (results.length < k) {
            try {
              const htmlCtx = await this.requestService.request(
                {
                  type: 'GET',
                  url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
                  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PPRCodeBot/1.0)' },
                },
                cts.token,
              );
              const html = (await asTextOrError(htmlCtx)) ?? '';
              const parsed = parseDuckDuckGoHtml(html, k);
              for (const hit of parsed) {
                if (results.length >= k) break;
                if (!results.some((r) => r.url === hit.url)) {
                  results.push(hit);
                }
              }
            } catch (e) {
              if (results.length === 0) {
                throw new Error(
                  `web_search failed: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }
          }
          const sliced = results.slice(0, k);
          setCached(webSearchCache, cacheKey, sliced);
          return { results: sliced };
        })();
        return { result: resultPromise, interruptTool: () => cts.cancel() };
      },

      browse_url: async ({ url }) => {
        assertPublicHttpUrl(url);
        const cached = getCached(browseCache, `browse:${url}`);
        if (cached) {
          return { result: cached };
        }
        const cts = new CancellationTokenSource();
        const resultPromise = (async () => {
          let content = '';
          let title: string | null = null;
          try {
            const extracted = await this.webContentExtractorService.extract([URI.parse(url)]);
            content = (extracted?.[0] ?? '').trim();
          } catch {
            // экстрактор недоступен — сырой HTTP
          }
          if (!content) {
            const ctx = await this.requestService.request(
              {
                type: 'GET',
                url,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PPRCodeBot/1.0)' },
              },
              cts.token,
            );
            const raw = (await asTextOrError(ctx)) ?? '';
            const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;
            content = raw
              .replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
          }
          if (content.length > 50_000) {
            content = `${content.slice(0, 50_000)}\n…[truncated]`;
          }
          const result = { content, title, url };
          setCached(browseCache, `browse:${url}`, result);
          return result;
        })();
        return { result: resultPromise, interruptTool: () => cts.cancel() };
      },

      save_memory: async ({ type, key, value, tags }) => {
        await this.memoriesService.addMemory(type, key, value, tags ?? undefined);
        return { result: { acknowledged: true as const, key } };
      },

      run_subagent: async () => {
        throw new Error('run_subagent must be handled by the chat thread agent loop.');
      },

      run_parallel_subagents: async () => {
        throw new Error('run_parallel_subagents must be handled by the chat thread agent loop.');
      },

      get_chat_history: async ({ threadId }) => {
        const chatThreadService = instantiationService.invokeFunction((accessor) =>
          accessor.get(IChatThreadService),
        );
        const summary = chatThreadService.getChatHistorySummary({ threadId });
        return { result: { summary } };
      },

      enable_mcp_server: async ({ serverName }) => {
        const tools = this.mcpService.getMCPTools() ?? [];
        const matched = tools.filter((tool) => tool.mcpServerName === serverName);
        if (matched.length === 0) {
          const known = onlineMcpServerNames(tools);
          throw new Error(
            `MCP server "${serverName}" is not available. Online servers: ${known.join(', ') || 'none'}.`,
          );
        }
        return { result: { serverName, toolNames: matched.map((tool) => tool.name) } };
      },

      create_plan: async ({ name, overview, plan, todos }) => {
        const folders = workspaceContextService.getWorkspace().folders;
        if (!folders.length) {
          throw new Error('No workspace folder open. Open a folder to create a plan.');
        }
        const root = folders[0].uri;
        await migrateLegacyWorkspaceDotDir(fileService, root);
        const plansDir = joinPath(root, ...PLAN_DIR_SEGMENTS);
        try {
          await fileService.createFolder(joinPath(root, WORKSPACE_DOT_DIR));
        } catch {
          /* каталог уже есть */
        }
        try {
          await fileService.createFolder(plansDir);
        } catch {
          /* каталог уже есть */
        }
        const planUri = joinPath(plansDir, `${slugifyPlanName(name)}.plan.md`);
        const content = serializePlanMarkdown({ name, overview, plan, todos });
        await fileService.writeFile(planUri, VSBuffer.fromString(content));
        return { result: { planUri, name, overview, todos: normalizePlanTodos(todos) } };
      },

      update_plan: async ({ planUri, name, overview, plan, todos }) => {
        await sapphireModelService.initializeModel(planUri);
        const { model } = await sapphireModelService.getModelSafe(planUri);
        if (model === null) {
          throw new Error(`Plan file does not exist: ${planUri.fsPath}`);
        }
        const existing = parsePlanMarkdown(model.getValue(EndOfLinePreference.LF));
        const next = {
          name: name ?? existing.name,
          overview: overview ?? existing.overview,
          plan: plan ?? existing.plan,
          todos: todos ?? existing.todos,
        };
        const content = serializePlanMarkdown(next);
        await fileService.writeFile(planUri, VSBuffer.fromString(content));
        return {
          result: {
            planUri,
            name: next.name,
            overview: next.overview,
            todos: normalizePlanTodos(next.todos),
          },
        };
      },

      // ---

      create_file_or_folder: async ({ uri, isFolder }) => {
        if (isFolder) await fileService.createFolder(uri);
        else {
          await fileService.createFile(uri);
        }
        return { result: {} };
      },

      delete_file_or_folder: async ({ uri, isRecursive }) => {
        await fileService.del(uri, { recursive: isRecursive });
        return { result: {} };
      },

      rewrite_file: async ({ uri, newContent }) => {
        if (!(await fileService.exists(uri))) {
          await fileService.createFile(uri);
        }
        await sapphireModelService.initializeModel(uri);
        const { model } = sapphireModelService.getModel(uri);
        if (!model) {
          throw new Error(`File does not exist or could not be loaded: ${uri.fsPath}`);
        }
        if (this.commandBarService.getStreamState(uri) === 'streaming') {
          throw new Error(
            `Another LLM is currently making changes to this file. Please stop streaming for now and ask the user to resume later.`,
          );
        }
        await editCodeService.callBeforeApplyOrEdit(uri);
        await editCodeService.instantlyRewriteFile({ uri, newContent });
        // После записи — опрос линтера (с задержкой, чтобы успели маркеры)
        const lintErrorsPromise = Promise.resolve().then(async () => {
          await timeout(LINT_POLL_AFTER_EDIT_MS);
          const { lintErrors } = this._getLintErrors(uri);
          return { lintErrors };
        });
        return { result: lintErrorsPromise };
      },

      edit_file: async ({ uri, searchReplaceBlocks }) => {
        await sapphireModelService.initializeModel(uri);
        const { model } = sapphireModelService.getModel(uri);
        if (!model) {
          throw new Error(`File does not exist or could not be loaded: ${uri.fsPath}`);
        }
        if (this.commandBarService.getStreamState(uri) === 'streaming') {
          throw new Error(
            `Another LLM is currently making changes to this file. Please stop streaming for now and ask the user to resume later.`,
          );
        }
        await editCodeService.callBeforeApplyOrEdit(uri);
        editCodeService.instantlyApplySearchReplaceBlocks({ uri, searchReplaceBlocks });

        // После правки — опрос линтера
        const lintErrorsPromise = Promise.resolve().then(async () => {
          await timeout(LINT_POLL_AFTER_EDIT_MS);
          const { lintErrors } = this._getLintErrors(uri);
          return { lintErrors };
        });

        return { result: lintErrorsPromise };
      },
      // ---
      run_command: async ({ command, cwd, terminalId }) => {
        const { resPromise, interrupt } = await this.terminalToolService.runCommand(command, {
          type: 'temporary',
          cwd,
          terminalId,
        });
        return { result: resPromise, interruptTool: interrupt };
      },
      run_persistent_command: async ({ command, persistentTerminalId }) => {
        const { resPromise, interrupt } = await this.terminalToolService.runCommand(command, {
          type: 'persistent',
          persistentTerminalId,
        });
        return { result: resPromise, interruptTool: interrupt };
      },
      open_persistent_terminal: async ({ cwd }) => {
        // Ответ сразу, чтобы Stop мог прервать, пока терминал ещё создаётся.
        const result = this.terminalToolService
          .createPersistentTerminal({ cwd })
          .then((persistentTerminalId) => ({ persistentTerminalId }));
        return { result };
      },
      kill_persistent_terminal: async ({ persistentTerminalId }) => {
        // Закрываем фоновый терминал (exit)
        await this.terminalToolService.killPersistentTerminal(persistentTerminalId);
        return { result: {} };
      },
    };

    const nextPageStr = (hasNextPage: boolean) => (hasNextPage ? '\n\n(more on next page...)' : '');

    const stringifyLintErrors = (lintErrors: LintErrorItem[]) =>
      lintErrors
        .map(
          (e, i) =>
            `Error ${i + 1}:\nLines Affected: ${e.startLineNumber}-${e.endLineNumber}\nError message:${e.message}`,
        )
        .join('\n\n')
        .substring(0, MAX_FILE_CHARS_PAGE);

    // Текст, который уходит в контекст LLM после успешного вызова инструмента
    this.stringOfResult = {
      read_file: (params, result) =>
        `${params.uri.fsPath}\n\`\`\`\n${result.fileContents}\n\`\`\`${nextPageStr(result.hasNextPage)}${result.hasNextPage ? `\nMore info because truncated: this file has ${result.totalNumLines} lines, or ${result.totalFileLen} characters.` : ''}`,
      ls_dir: (params, result) => {
        const dirTreeStr = stringifyDirectoryTree1Deep(params, result);
        return dirTreeStr; // пагинация уже в stringifyDirectoryTree1Deep
      },
      get_dir_tree: (params, result) => result.str,
      search_pathnames_only: (params, result) =>
        result.uris.map((uri) => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage),
      search_project_index: (_params, result) => {
        if (result.hits.length === 0) {
          return 'No index hits. The project index may be empty — ask the user to index, or fall back to search_pathnames_only / grep_search.';
        }
        const body = result.hits
          .map((h) => {
            const desc = h.purpose || h.localRole;
            const tags = h.tags.length ? ` tags=[${h.tags.join(', ')}]` : '';
            const anchor = h.anchor ? ` @${h.anchor}` : '';
            return `${h.uri.fsPath}${anchor} (score=${h.score}, ${h.kind})${tags}\n  ${desc}`;
          })
          .join('\n');
        return body + nextPageStr(result.hasNextPage);
      },
      search_for_files: (params, result) =>
        result.uris.map((uri) => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage),
      search_in_file: (params, result) => {
        const { model } = sapphireModelService.getModel(params.uri);
        if (!model) return '<Error getting string of result>';
        const lines = result.lines
          .map((n) => {
            const lineContent = model.getValueInRange(
              {
                startLineNumber: n,
                startColumn: 1,
                endLineNumber: n,
                endColumn: Number.MAX_SAFE_INTEGER,
              },
              EndOfLinePreference.LF,
            );
            return `Line ${n}:\n\`\`\`\n${lineContent}\n\`\`\``;
          })
          .join('\n\n');
        return lines;
      },
      grep_search: (_params, result) => {
        if (result.matches.length === 0) {
          return 'No matches found.';
        }
        const lines = result.matches.map(
          (m) => `${m.uri.fsPath}:${m.lineNumber}: ${m.lineContent}`,
        );
        const truncated =
          result.totalMatches > result.matches.length
            ? `\n\n(showing ${result.matches.length} of ${result.totalMatches} matches)`
            : '';
        return lines.join('\n') + truncated;
      },
      read_lint_errors: (params, result) =>
        result.lintErrors ? stringifyLintErrors(result.lintErrors) : 'No lint errors found.',
      get_diagnostics: (_params, result) => {
        if (result.diagnostics.length === 0) {
          return 'No diagnostics found.';
        }
        return result.diagnostics
          .map(
            (d, i) =>
              `${i + 1}. [${d.severity}] ${d.uri.fsPath}:${d.startLine}-${d.endLine}${d.source ? ` (${d.source})` : ''}${d.code ? ` [${d.code}]` : ''}\n${d.message}`,
          )
          .join('\n\n')
          .substring(0, MAX_FILE_CHARS_PAGE);
      },
      go_to_definition: (_params, result) =>
        stringifyCodeNavLocations(result.locations, { message: result.message }),
      find_references: (_params, result) =>
        stringifyCodeNavLocations(result.locations, {
          message: result.message,
          truncated: result.truncated,
        }),
      search_symbols: (_params, result) => {
        if (result.symbols.length === 0) {
          return 'No symbols found.';
        }
        const lines = result.symbols.map(
          (s) => `${s.kind} ${s.name} — ${s.uri.fsPath}:${s.startLine}-${s.endLine}`,
        );
        return lines.join('\n') + (result.truncated ? '\n\n(results truncated)' : '');
      },
      rename_symbol: (_params, result) => {
        if (result.changes.length === 0) {
          return `No rename edits applied for "${result.oldName}" → "${result.newName}".`;
        }
        const lines = result.changes.map(
          (c) =>
            `${c.uri.fsPath}:${c.startLine}-${c.endLine}: "${c.oldText}" → "${c.newText}"`,
        );
        return (
          `Renamed "${result.oldName}" → "${result.newName}" in ${result.changes.length} location${result.changes.length === 1 ? '' : 's'} (applied=${result.applied}).\n` +
          lines.join('\n')
        );
      },
      glob_files: (_params, result) => {
        if (result.files.length === 0) {
          return 'No files matched.';
        }
        const lines = result.files.map(
          (f) => `${f.uri.fsPath}\tmtime=${f.mtime}\tsize=${f.size}`,
        );
        return lines.join('\n') + (result.truncated ? `\n\n(truncated)` : '');
      },
      web_search: (_params, result) => {
        if (result.results.length === 0) {
          return wrapUntrustedContent('WEB_SEARCH', 'No results.');
        }
        const body = result.results
          .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`)
          .join('\n\n');
        return wrapUntrustedContent('WEB_SEARCH', body);
      },
      browse_url: (_params, result) => {
        const head = result.title ? `Title: ${result.title}\nURL: ${result.url}\n\n` : `URL: ${result.url}\n\n`;
        const body = result.content.length > 10_000 ? `${result.content.slice(0, 10_000)}\n…[truncated]` : result.content;
        return wrapUntrustedContent('WEB_PAGE', head + body);
      },
      save_memory: (_params, result) => `Memory saved: key="${result.key}".`,
      run_subagent: (_params, result) => {
        const head = result.completed
          ? 'Sub-agent finished.'
          : 'Sub-agent finished WITHOUT a clear summary.';
        return `${head}\n\n${result.summary}`;
      },
      run_parallel_subagents: (_params, result) => {
        return result.results
          .map((r, i) => {
            const head = r.completed
              ? `### Sub-agent ${i + 1}: ${r.description}`
              : `### Sub-agent ${i + 1}: ${r.description} (incomplete)`;
            return `${head}\n\n${r.summary}`;
          })
          .join('\n\n---\n\n');
      },
      get_chat_history: (_params, result) => result.summary,
      enable_mcp_server: (_params, result) =>
        `Enabled MCP server "${result.serverName}" for the rest of this thread. On your next response you can call: ${result.toolNames.join(', ')}.`,
      create_plan: (params, result) =>
        `Plan created at ${result.planUri.fsPath}\nTitle: ${result.name}\nOverview: ${result.overview}\nTodos: ${result.todos.length}`,
      update_plan: (params, result) =>
        `Plan updated at ${result.planUri.fsPath}\nTitle: ${result.name}\nOverview: ${result.overview}\nTodos: ${result.todos.map((t) => `${t.id}:${t.status}`).join(', ')}`,
      // ---
      create_file_or_folder: (params, _result) => `URI ${params.uri.fsPath} successfully created.`,
      delete_file_or_folder: (params, _result) => `URI ${params.uri.fsPath} successfully deleted.`,
      edit_file: (params, result) => {
        const lintErrsString = this.sapphireSettingsService.state.globalSettings.includeToolLintErrors
          ? result.lintErrors
            ? ` Lint errors found after change:\n${stringifyLintErrors(result.lintErrors)}.\nIf this is related to a change made while calling this tool, you might want to fix the error.`
            : ` No lint errors found.`
          : '';

        return `Change successfully made to ${params.uri.fsPath}.${lintErrsString}`;
      },
      rewrite_file: (params, result) => {
        const lintErrsString = this.sapphireSettingsService.state.globalSettings.includeToolLintErrors
          ? result.lintErrors
            ? ` Lint errors found after change:\n${stringifyLintErrors(result.lintErrors)}.\nIf this is related to a change made while calling this tool, you might want to fix the error.`
            : ` No lint errors found.`
          : '';

        return `Change successfully made to ${params.uri.fsPath}.${lintErrsString}`;
      },
      run_command: (params, result) => {
        const { resolveReason, result: result_ } = result;
        if (resolveReason.type === 'done') {
          return `${result_}\n(exit code ${resolveReason.exitCode})`;
        }
        // Временная команда: таймаут по неактивности или абсолютный
        if (resolveReason.type === 'timeout') {
          return `${result_}\nTerminal command was automatically stopped after ${MAX_TERMINAL_INACTIVE_TIME}s of inactivity or ${MAX_TERMINAL_ABSOLUTE_TIME}s absolute (whichever came first) and did not finish successfully. Common causes: unclosed quotes / node -e one-liners waiting for more input. Do not retry the same command — use read_file to inspect files, or write a script file with rewrite_file and run it (e.g. node check.js). For long-running jobs, open a persistent terminal.`;
        }
        throw new Error(
          `Unexpected internal error: Terminal command did not resolve with a valid reason.`,
        );
      },

      run_persistent_command: (params, result) => {
        const { resolveReason, result: result_ } = result;
        const { persistentTerminalId } = params;
        if (resolveReason.type === 'done') {
          return `${result_}\n(exit code ${resolveReason.exitCode})`;
        }
        // Фоновая команда в persistent-терминале
        if (resolveReason.type === 'timeout') {
          return `${result_}\nTerminal command is running in terminal ${persistentTerminalId}. The given outputs are the results after ${MAX_TERMINAL_BG_COMMAND_TIME} seconds.`;
        }
        throw new Error(
          `Unexpected internal error: Terminal command did not resolve with a valid reason.`,
        );
      },

      open_persistent_terminal: (_params, result) => {
        const { persistentTerminalId } = result;
        return `Successfully created persistent terminal. persistentTerminalId="${persistentTerminalId}"`;
      },
      kill_persistent_terminal: (params, _result) =>
        `Successfully closed terminal "${params.persistentTerminalId}".`,
    };
  }

  private async _runCodeNav(args: {
    kind: 'definition' | 'references';
    uri: URI;
    line: number;
    symbol: string | null;
    workspaceContextService: IWorkspaceContextService;
    sapphireModelService: ISapphireModelService;
  }): Promise<{
    locations: CodeNavLocation[];
    truncated: boolean;
    message: string | null;
  }> {
    const { kind, uri, line, symbol, workspaceContextService, sapphireModelService } = args;

    await sapphireModelService.initializeModel(uri);
    const { model } = await sapphireModelService.getModelSafe(uri);
    if (model === null) {
      return {
        locations: [],
        truncated: false,
        message: `File does not exist: ${uri.fsPath}`,
      };
    }

    const position = resolveSymbolPosition(model, line, symbol);

    let raw: Location | LocationLink | (Location | LocationLink)[] | null | undefined;
    if (kind === 'definition') {
      const providers = this.languageFeaturesService.definitionProvider.ordered(model);
      if (providers.length === 0) {
        return {
          locations: [],
          truncated: false,
          message: 'No definition provider for this file.',
        };
      }
      for (const provider of providers) {
        const result = await provider.provideDefinition(model, position, CancellationToken.None);
        if (result) {
          raw = result;
          break;
        }
      }
      if (!raw) {
        return {
          locations: [],
          truncated: false,
          message: 'No definition found for this symbol.',
        };
      }
    } else {
      const providers = this.languageFeaturesService.referenceProvider.ordered(model);
      if (providers.length === 0) {
        return {
          locations: [],
          truncated: false,
          message: 'No reference provider for this file.',
        };
      }
      for (const provider of providers) {
        const result = await provider.provideReferences(
          model,
          position,
          { includeDeclaration: true },
          CancellationToken.None,
        );
        if (result && result.length > 0) {
          raw = result;
          break;
        }
      }
      if (!raw) {
        return {
          locations: [],
          truncated: false,
          message: 'No references found for this symbol.',
        };
      }
    }

    const normalized = normalizeLanguageLocations(raw).filter((loc) =>
      workspaceContextService.isInsideWorkspace(loc.uri),
    );

    if (normalized.length === 0) {
      return {
        locations: [],
        truncated: false,
        message:
          kind === 'definition'
            ? 'No definition found inside the open workspace.'
            : 'No references found inside the open workspace.',
      };
    }

    const truncated = kind === 'references' && normalized.length > MAX_FIND_REFERENCES;
    const sliced = truncated ? normalized.slice(0, MAX_FIND_REFERENCES) : normalized;

    const locations: CodeNavLocation[] = [];
    for (const loc of sliced) {
      await sapphireModelService.initializeModel(loc.uri);
      const { model: locModel } = await sapphireModelService.getModelSafe(loc.uri);
      let preview = '';
      if (locModel) {
        const previewLine = Math.min(
          Math.max(1, loc.startLine),
          locModel.getLineCount(),
        );
        preview = locModel.getLineContent(previewLine).trim();
      }
      locations.push({
        uri: loc.uri,
        startLine: loc.startLine,
        endLine: loc.endLine,
        preview,
      });
    }

    return { locations, truncated, message: null };
  }

  private async _executeRenameSymbol(args: {
    uri: URI;
    line: number;
    symbol: string | null;
    newName: string;
    sapphireModelService: ISapphireModelService;
    workspaceContextService: IWorkspaceContextService;
  }): Promise<BuiltinToolResultType['rename_symbol']> {
    const { uri, line, symbol, newName, sapphireModelService, workspaceContextService } = args;

    await sapphireModelService.initializeModel(uri);
    const { model } = await sapphireModelService.getModelSafe(uri);
    if (model === null) {
      throw new Error(`File does not exist: ${uri.fsPath}`);
    }

    const position = resolveSymbolPosition(model, line, symbol);
    let workspaceEdit: WorkspaceEdit | null = null;
    let oldName = symbol?.trim() || '';

    const renameProviders = this.languageFeaturesService.renameProvider.ordered(model);
    if (renameProviders.length > 0) {
      const renameResult = await rename(
        this.languageFeaturesService.renameProvider,
        model,
        position,
        newName,
      );
      if (renameResult.rejectReason) {
        throw new Error(`Rename rejected: ${renameResult.rejectReason}`);
      }
      if (!renameResult.edits?.length) {
        throw new Error(`No rename edits produced for the symbol at ${uri.fsPath}:${line}.`);
      }
      workspaceEdit = { edits: renameResult.edits };
      if (!oldName) {
        for (const edit of renameResult.edits) {
          if (!ResourceTextEdit.is(edit)) {
            continue;
          }
          await sapphireModelService.initializeModel(edit.resource);
          const { model: editModel } = await sapphireModelService.getModelSafe(edit.resource);
          if (!editModel) {
            continue;
          }
          const range = Range.lift(edit.textEdit.range);
          if (!range) {
            continue;
          }
          const text = editModel.getValueInRange(range, EndOfLinePreference.LF).trim();
          if (text) {
            oldName = text;
            break;
          }
        }
      }
    } else {
      // Запасной путь: find references + точная замена идентификатора по диапазону
      const referenceProviders = this.languageFeaturesService.referenceProvider.ordered(model);
      if (referenceProviders.length === 0) {
        throw new Error('No rename provider or reference provider for this file.');
      }

      let references: Location[] | null = null;
      for (const provider of referenceProviders) {
        const refs = await provider.provideReferences(
          model,
          position,
          { includeDeclaration: true },
          CancellationToken.None,
        );
        if (refs && refs.length > 0) {
          references = refs;
          break;
        }
      }
      if (!references?.length) {
        throw new Error(`No references found for the symbol at ${uri.fsPath}:${line}.`);
      }

      const textEdits: IWorkspaceTextEdit[] = [];
      for (const ref of references) {
        if (!workspaceContextService.isInsideWorkspace(ref.uri)) {
          continue;
        }
        await sapphireModelService.initializeModel(ref.uri);
        const { model: refModel } = await sapphireModelService.getModelSafe(ref.uri);
        if (!refModel) {
          continue;
        }
        const range = Range.lift(ref.range);
        if (!range) {
          continue;
        }
        const rangeText = refModel.getValueInRange(range, EndOfLinePreference.LF);
        const trimmed = rangeText.trim();
        if (!oldName) {
          oldName = trimmed;
        }
        if (!trimmed || trimmed !== oldName) {
          continue;
        }
        textEdits.push({
          resource: ref.uri,
          textEdit: { range, text: newName },
          versionId: undefined,
        });
      }
      if (!oldName) {
        throw new Error(
          `Could not determine symbol name at ${uri.fsPath}:${line}. Pass symbol= explicitly.`,
        );
      }
      if (textEdits.length === 0) {
        throw new Error(`No renameable references found for "${oldName}".`);
      }
      workspaceEdit = { edits: textEdits };
    }

    if (!oldName) {
      oldName = '(unknown)';
    }
    if (oldName === newName) {
      throw new Error(`new_name is the same as the current name "${oldName}".`);
    }

    const changes: RenameSymbolChange[] = [];
    for (const edit of workspaceEdit.edits) {
      if (!ResourceTextEdit.is(edit)) {
        continue;
      }
      await sapphireModelService.initializeModel(edit.resource);
      const { model: editModel } = await sapphireModelService.getModelSafe(edit.resource);
      const range = Range.lift(edit.textEdit.range);
      if (!range) {
        continue;
      }
      const oldText = editModel
        ? editModel.getValueInRange(range, EndOfLinePreference.LF)
        : oldName;
      changes.push({
        uri: edit.resource,
        startLine: range.startLineNumber,
        endLine: range.endLineNumber,
        oldText,
        newText: edit.textEdit.text,
      });
    }

    if (changes.length === 0) {
      throw new Error(`Rename produced no text edits for "${oldName}" → "${newName}".`);
    }

    const applyResult = await this.bulkEditService.apply(workspaceEdit, {
      showPreview: false,
      label: `Rename ${oldName} → ${newName}`,
      quotableLabel: `Rename ${oldName} to ${newName}`,
      code: 'undoredo.void.renameSymbol',
    });

    return {
      oldName,
      newName,
      changes,
      applied: applyResult.isApplied,
    };
  }

  private _getLintErrors(uri: URI): { lintErrors: LintErrorItem[] | null } {
    const lintErrors = this.markerService
      .read({ resource: uri })
      .filter((l) => l.severity === MarkerSeverity.Error || l.severity === MarkerSeverity.Warning)
      .slice(0, 100)
      .map(
        (l) =>
          ({
            code: typeof l.code === 'string' ? l.code : l.code?.value || '',
            message: (l.severity === MarkerSeverity.Error ? '(error) ' : '(warning) ') + l.message,
            startLineNumber: l.startLineNumber,
            endLineNumber: l.endLineNumber,
          }) satisfies LintErrorItem,
      );

    if (!lintErrors.length) return { lintErrors: null };
    return { lintErrors };
  }
}

registerSingleton(IToolsService, ToolsService, InstantiationType.Eager);

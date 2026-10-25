/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { uriAlreadyInSelections } from './activeFileAttach.js';
import { StagingSelectionItem } from './chatThreadServiceTypes.js';

/** Макс. файлов при авто-подборе эвристикой. */
export const HEURISTIC_RETRIEVE_TOP_N = 3;

/** Мин. длина запроса (trim) перед эвристическим поиском. */
const HEURISTIC_MIN_QUERY_LENGTH = 8;

type HeuristicQueryToken = {
  text: string;
  kind: 'path' | 'identifier';
};

export type HeuristicCandidate = {
  uri: URI;
  /** Больше score — лучше; path важнее text при равном score. */
  score: number;
  source: 'path' | 'text';
};

const STOP_WORDS = new Set(
  [
    // EN stop-words
    'a',
    'an',
    'the',
    'and',
    'or',
    'but',
    'if',
    'then',
    'else',
    'for',
    'to',
    'of',
    'in',
    'on',
    'at',
    'by',
    'with',
    'from',
    'as',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'can',
    'may',
    'might',
    'must',
    'this',
    'that',
    'these',
    'those',
    'it',
    'its',
    'my',
    'your',
    'our',
    'their',
    'me',
    'you',
    'we',
    'they',
    'i',
    'please',
    'fix',
    'make',
    'add',
    'update',
    'change',
    'create',
    'delete',
    'remove',
    'implement',
    'refactor',
    'help',
    'how',
    'what',
    'why',
    'when',
    'where',
    'which',
    'code',
    'file',
    'files',
    'folder',
    'project',
    'need',
    'want',
    'just',
    'also',
    'like',
    'use',
    'using',
    'into',
    'about',
    // RU
    'и',
    'а',
    'но',
    'или',
    'если',
    'то',
    'для',
    'на',
    'в',
    'во',
    'из',
    'к',
    'ко',
    'по',
    'с',
    'со',
    'от',
    'до',
    'об',
    'про',
    'при',
    'это',
    'этот',
    'эта',
    'эти',
    'тот',
    'та',
    'те',
    'как',
    'что',
    'чем',
    'где',
    'когда',
    'какой',
    'какая',
    'какие',
    'пожалуйста',
    'нужно',
    'надо',
    'хочу',
    'сделай',
    'сделать',
    'добавь',
    'добавить',
    'исправь',
    'исправить',
    'обнови',
    'обновить',
    'измени',
    'изменить',
    'создай',
    'создать',
    'удали',
    'удалить',
    'убери',
    'файл',
    'файлы',
    'папка',
    'папки',
    'проект',
    'код',
    'функция',
    'метод',
    'класс',
    'помоги',
    'помощь',
    'давай',
    'можно',
    'нужен',
    'нужна',
    'нужны',
  ].map((w) => w.toLowerCase()),
);

const EXCLUDED_PATH_PARTS = ['node_modules', '.git', 'dist', 'build', 'out', '.venv', 'vendor'];

/** Имена/фрагменты путей с секретами — не подтягивать в SELECTIONS. */
const EXCLUDED_SECRET_BASENAME_RE =
  /(^|\/)(\.env($|\.)|.*credentials.*|.*secrets?.*|.*\.pem$|.*\.key$)/i;

/** Похоже на путь: `/`, `\`, расширение файла или glob `*`. */
const PATH_LIKE_RE =
  /(?:[A-Za-z0-9_.@-]+[\\/])+[A-Za-z0-9_.@*-]+|[A-Za-z0-9_.@-]+\.[A-Za-z0-9]{1,8}\b|\*[A-Za-z0-9_.@/-]*/g;

/** Идентификаторы camelCase, PascalCase, snake_case, kebab (длина — ниже). */
const IDENTIFIER_RE =
  /\b[A-Za-z_][A-Za-z0-9_]*(?:[A-Z][A-Za-z0-9_]+)+\b|\b[A-Za-z_][A-Za-z0-9_]{2,}\b|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g;

/**
 * Токены пути и идентификаторов из текста пользователя.
 * Stop-words (RU/EN) и идентификаторы короче 3 символов отбрасываются.
 */
export const extractHeuristicQueryTokens = (query: string): HeuristicQueryToken[] => {
  const trimmed = query.trim();
  if (trimmed.length < HEURISTIC_MIN_QUERY_LENGTH) {
    return [];
  }

  const seen = new Set<string>();
  const out: HeuristicQueryToken[] = [];

  const push = (text: string, kind: HeuristicQueryToken['kind']) => {
    const t = text.trim();
    if (!t) {
      return;
    }
    const key = t.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    if (kind === 'identifier') {
      if (t.length < 3) {
        return;
      }
      if (STOP_WORDS.has(key)) {
        return;
      }
    }
    seen.add(key);
    out.push({ text: t, kind });
  };

  for (const m of trimmed.matchAll(PATH_LIKE_RE)) {
    push(m[0], 'path');
  }
  for (const m of trimmed.matchAll(IDENTIFIER_RE)) {
    // уже учтён как path
    if (seen.has(m[0].toLowerCase())) {
      continue;
    }
    push(m[0], 'identifier');
  }

  // Сначала длинные и path-токены — порядок для search
  out.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'path' ? -1 : 1;
    }
    return b.text.length - a.text.length;
  });

  return out;
};

/** Запросы fileSearch: path-токены и basename идентификаторов. */
export const pathSearchQueriesFromTokens = (tokens: HeuristicQueryToken[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const q = t.kind === 'path' ? t.text : t.text;
    const key = q.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(q);
  }
  return out;
};

/** До 2 самых длинных идентификаторов для fallback textSearch. */
export const textSearchQueriesFromTokens = (tokens: HeuristicQueryToken[]): string[] => {
  return tokens
    .filter((t) => t.kind === 'identifier')
    .slice()
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 2)
    .map((t) => t.text);
};

export const isExcludedHeuristicPath = (fsPath: string): boolean => {
  const norm = fsPath.replace(/\\/g, '/');
  if (EXCLUDED_SECRET_BASENAME_RE.test(norm)) {
    return true;
  }
  const parts = norm.split('/').map((p) => p.toLowerCase());
  return EXCLUDED_PATH_PARTS.some((ex) => parts.includes(ex));
};

/**
 * true, если контекста достаточно — авто-подбор не нужен.
 * Учитываются Folder и ручные File / CodeSelection; `fromHeuristic` игнорируются.
 */
export const shouldSkipHeuristicRetrieve = (
  userSelns: StagingSelectionItem[] | null | undefined,
): boolean => {
  if (!userSelns?.length) {
    return false;
  }
  if (userSelns.some((s) => s.type === 'Folder')) {
    return true;
  }
  const fileLike = userSelns.filter(
    (s) => s.type === 'CodeSelection' || (s.type === 'File' && !s.fromHeuristic),
  );
  return fileLike.length >= 2;
};

/**
 * Сортировка и dedupe кандидатов; top N URI, не в selections и не в omitted.
 */
export const pickTopHeuristicUris = (
  candidates: HeuristicCandidate[],
  selns: StagingSelectionItem[] | null | undefined,
  opts: {
    topN?: number;
    omittedFsPaths?: ReadonlySet<string> | string[] | null;
  } = {},
): URI[] => {
  const topN = opts.topN ?? HEURISTIC_RETRIEVE_TOP_N;
  const omitted = opts.omittedFsPaths
    ? opts.omittedFsPaths instanceof Set
      ? opts.omittedFsPaths
      : new Set(opts.omittedFsPaths)
    : new Set<string>();

  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // при равном score — path выше text
    if (a.source !== b.source) {
      return a.source === 'path' ? -1 : 1;
    }
    return a.uri.fsPath.localeCompare(b.uri.fsPath);
  });

  const out: URI[] = [];
  const seen = new Set<string>();
  for (const c of sorted) {
    if (out.length >= topN) {
      break;
    }
    const fsPath = c.uri.fsPath;
    if (seen.has(fsPath) || omitted.has(fsPath)) {
      continue;
    }
    if (isExcludedHeuristicPath(fsPath)) {
      continue;
    }
    if (uriAlreadyInSelections(selns, fsPath)) {
      continue;
    }
    seen.add(fsPath);
    out.push(c.uri);
  }
  return out;
};

/**
 * Добавить File с fromHeuristic. `selns` не мутируется (возвращается новый массив).
 */
export const mergeHeuristicFileSelections = (
  selns: StagingSelectionItem[] | null | undefined,
  files: { uri: URI; language: string }[],
  opts: {
    enabled: boolean;
    omittedFsPaths?: ReadonlySet<string> | string[] | null;
    topN?: number;
  },
): StagingSelectionItem[] => {
  const base = selns ? [...selns] : [];
  if (!opts.enabled || !files.length) {
    return base;
  }
  const omitted = opts.omittedFsPaths
    ? opts.omittedFsPaths instanceof Set
      ? opts.omittedFsPaths
      : new Set(opts.omittedFsPaths)
    : new Set<string>();
  const topN = opts.topN ?? HEURISTIC_RETRIEVE_TOP_N;
  let added = 0;
  for (const f of files) {
    if (added >= topN) {
      break;
    }
    const fsPath = f.uri.fsPath;
    if (omitted.has(fsPath) || uriAlreadyInSelections(base, fsPath)) {
      continue;
    }
    if (isExcludedHeuristicPath(fsPath)) {
      continue;
    }
    base.push({
      type: 'File',
      uri: f.uri,
      language: f.language || 'plaintext',
      fromHeuristic: true,
    });
    added++;
  }
  return base;
};

/** Начисление score для browser-слоя. */
export const scorePathHit = (rankIndex: number): number => 1000 - rankIndex;
export const scoreTextHit = (rankIndex: number): number => 500 - rankIndex;

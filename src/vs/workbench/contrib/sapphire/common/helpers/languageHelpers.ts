/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { separateOutFirstLine } from './util.js';

// надёжнее, чем model.getLanguageId()
export function detectLanguage(
  languageService: ILanguageService,
  opts: { uri: URI | null; fileContents: string | undefined },
) {
  const firstLine = opts.fileContents ? separateOutFirstLine(opts.fileContents)?.[0] : undefined;
  const fullLang = languageService.createByFilepathOrFirstLine(opts.uri, firstLine);
  return fullLang.languageId || 'plaintext';
}

// --- маппинг markdown lang → VS Code languageId
export const convertToVscodeLang = (languageService: ILanguageService, markdownLang: string) => {
  if (Object.hasOwn(markdownLangToVscodeLang, markdownLang)) {return markdownLangToVscodeLang[markdownLang];}

  const { languageId } = languageService.createById(markdownLang);
  return languageId;
};

// // напр. "bash" → "shellscript"
const markdownLangToVscodeLang: { [key: string]: string } = {
  // Веб
  html: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  javascript: 'typescript',
  js: 'typescript', // более общий renderer
  jsx: 'typescriptreact',
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'typescriptreact',
  json: 'json',
  jsonc: 'json',

  // Языки программирования
  python: 'python',
  py: 'python',
  java: 'java',
  cpp: 'cpp',
  'c++': 'cpp',
  c: 'c',
  csharp: 'csharp',
  cs: 'csharp',
  'c#': 'csharp',
  go: 'go',
  golang: 'go',
  rust: 'rust',
  rs: 'rust',
  ruby: 'ruby',
  rb: 'ruby',
  php: 'php',
  shell: 'shellscript', // важно для bash/sh
  bash: 'shellscript',
  sh: 'shellscript',
  zsh: 'shellscript',

  // Разметка и конфиги
  markdown: 'markdown',
  md: 'markdown',
  xml: 'xml',
  svg: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  ini: 'ini',
  toml: 'ini',

  // БД и query-языки
  sql: 'sql',
  mysql: 'sql',
  postgresql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',

  // Прочее
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  makefile: 'makefile',
  plaintext: 'plaintext',
  text: 'plaintext',
};

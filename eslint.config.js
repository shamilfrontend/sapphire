/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
import fs from 'fs';
import path from 'path';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';

import stylisticTs from '@stylistic/eslint-plugin-ts';
import pluginLocal from 'eslint-plugin-local';
import pluginJsdoc from 'eslint-plugin-jsdoc';

import pluginHeader from 'eslint-plugin-header';

pluginHeader.rules.header.meta.schema = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ignores = fs
  .readFileSync(path.join(__dirname, '.eslint-ignore'), 'utf8')
  .toString()
  .split(/\r\n|\n/)
  .filter((line) => line && !line.startsWith('#'));

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default tseslint.config(
  // Global ignores
  {
    ignores: [...ignores, '!**/.eslint-plugin-local/**/*'],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  // Airbnb style guide (via FlatCompat for ESLint 9)
  ...compat.extends('airbnb', 'airbnb/hooks'),
  // ESLint flat config defaults to JS-only; include TypeScript / TSX
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
  },
  // Architectural overrides - VS Code fork patterns incompatible with strict Airbnb
  {
    files: ['**/*.{js,cjs,mjs,jsx,ts,tsx,mts,cts}'],
    rules: {
      'no-underscore-dangle': 'off',
      'import/prefer-default-export': 'off',
      'class-methods-use-this': 'off',
      'no-param-reassign': 'off',
      'max-classes-per-file': 'off',
      // VS Code / Sapphire already manage these
      'import/extensions': 'off',
      'import/no-unresolved': 'off',
      'import/no-extraneous-dependencies': 'off',
      'import/no-cycle': 'off',
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
      'react/jsx-filename-extension': ['warn', { extensions: ['.jsx', '.tsx'] }],
      'react/function-component-definition': 'off',
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/require-default-props': 'off',
      'no-continue': 'off',
      'no-plusplus': 'off',
      'no-bitwise': 'off',
      'no-restricted-syntax': 'off',
      'consistent-return': 'off',
      'default-case': 'off',
      'no-await-in-loop': 'off',
      'prefer-destructuring': 'off',
      'no-nested-ternary': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      // Conflicts with Prettier singleQuote (Airbnb); VS Code nls convention
      'local/code-no-unexternalized-strings': 'off',
      // High-volume VS Code patterns - not safely auto-fixable across the fork
      'no-undef': 'off',
      'no-use-before-define': 'off',
      'no-unused-vars': 'off',
      'no-shadow': 'off',
      'no-empty-function': 'off',
      'no-useless-constructor': 'off',
      'no-console': 'off',
      'no-useless-escape': 'off',
      'no-template-curly-in-string': 'off',
      'func-names': 'off',
      camelcase: 'off',
      'no-dupe-class-members': 'off',
      'no-return-assign': 'off',
      'no-return-await': 'off',
      'no-multi-assign': 'off',
      'no-promise-executor-return': 'off',
      'react/jsx-props-no-spreading': 'off',
      'default-param-last': 'off',
      'guard-for-in': 'off',
      radix: 'off',
      'no-empty': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/anchor-is-valid': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'no-constant-condition': 'off',
      'import/export': 'off',
      'no-unreachable-loop': 'off',
      'no-unsafe-optional-chaining': 'off',
      'react/no-unused-prop-types': 'off',
      'no-useless-catch': 'off',
      'import/no-import-module-exports': 'off',
      'react/no-unused-state': 'off',
      'jsx-a11y/no-autofocus': 'off',
      'no-misleading-character-class': 'off',
      'no-constructor-return': 'off',
      'react/jsx-pascal-case': 'off',
      'default-case-last': 'off',
      'getter-return': 'off',
      'valid-typeof': 'off',
      'no-sequences': 'off',
      'no-new-object': 'off',
      'no-dupe-keys': 'off',
      'no-unreachable': 'off',
      'no-self-compare': 'off',
      'import/no-named-default': 'off',
      eqeqeq: 'warn',
      'no-eval': 'warn',
      'no-implied-eval': 'warn',
      'no-new-wrappers': 'warn',
      'no-throw-literal': 'warn',
    },
  },
  // All files (JS and TS)
  {
    files: ['**/*.{js,cjs,mjs,jsx,ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      local: pluginLocal,
      header: pluginHeader,
    },
    rules: {
      'constructor-super': 'warn',
      curly: 'off', // <-- Sapphire
      eqeqeq: 'warn',
      'prefer-const': [
        'off', // <-- Sapphire
        {
          destructuring: 'all',
        },
      ],
      'no-buffer-constructor': 'warn',
      'no-caller': 'warn',
      'no-case-declarations': 'warn',
      'no-debugger': 'warn',
      'no-duplicate-case': 'warn',
      'no-duplicate-imports': 'warn',
      'no-eval': 'warn',
      'no-async-promise-executor': 'warn',
      'no-extra-semi': 'warn',
      'no-new-wrappers': 'warn',
      'no-redeclare': 'off',
      'no-sparse-arrays': 'warn',
      'no-throw-literal': 'warn',
      'no-unsafe-finally': 'warn',
      'no-unused-labels': 'warn',
      'no-misleading-character-class': 'warn',
      'no-restricted-globals': [
        'warn',
        'name',
        'length',
        'event',
        'closed',
        'external',
        'status',
        'origin',
        'orientation',
        'context',
      ], // non-complete list of globals that are easy to access unintentionally
      'no-var': 'warn',
      semi: 'off',
      'local/code-translation-remind': 'warn',
      'local/code-no-native-private': 'warn',
      'local/code-parameter-properties-must-have-explicit-accessibility': 'warn',
      'local/code-no-nls-in-standalone-editor': 'warn',
      'local/code-no-potentially-unsafe-disposables': 'warn',
      'local/code-no-dangerous-type-assertions': 'off', // Sapphire warn -> off
      'local/code-no-standalone-editor': 'warn',
      'local/code-no-unexternalized-strings': 'off', // conflicts with Prettier singleQuote
      'local/code-must-use-super-dispose': 'warn',
      'local/code-declare-service-brand': 'warn',
      'local/code-layering': [
        'warn',
        {
          common: [],
          node: ['common'],
          browser: ['common'],
          'electron-sandbox': ['common', 'browser'],
          'electron-utility': ['common', 'node'],
          'electron-main': ['common', 'node', 'electron-utility'],
        },
      ],
      // Sapphire - this should only apply to workbench/void/
      // 'header/header': [
      // 	2,
      // 	'block',
      // 	[
      // 		'/*--------------------------------------------------------------------------------------',
      // 		'*  Copyright 2025 Glass Devtools, Inc. All rights reserved.',
      // 		'*  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.',
      // 		'*--------------------------------------------------------------------------------------*/',
      // 	]
      // ]
    },
  },
  // TS
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@stylistic/ts': stylisticTs,
      '@typescript-eslint': tseslint.plugin,
      local: pluginLocal,
      jsdoc: pluginJsdoc,
    },
    rules: {
      '@stylistic/ts/semi': 'off', // <-- Sapphire
      '@stylistic/ts/member-delimiter-style': 'off', // <-- Sapphire
      'local/code-no-unused-expressions': [
        'warn',
        {
          allowTernary: true,
        },
      ],
      'jsdoc/no-types': 'warn',
      'local/code-no-static-self-ref': 'off', // <-- Sapphire
    },
  },
  // vscode TS
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'class',
          format: ['PascalCase'],
        },
      ],
    },
  },
  // Tests
  {
    files: ['**/*.test.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      local: pluginLocal,
    },
    rules: {
      'local/code-must-use-super-dispose': 'off',
      'local/code-no-test-only': 'error',
      'local/code-no-test-async-suite': 'warn',
      'local/code-no-unexternalized-strings': 'off',
      'local/code-must-use-result': [
        'warn',
        [
          {
            message: 'Expression must be awaited',
            functions: ['assertSnapshot', 'assertHeap'],
          },
        ],
      ],
    },
  },
  // vscode tests specific rules
  {
    files: ['src/vs/**/*.test.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      local: pluginLocal,
    },
    rules: {
      'local/code-ensure-no-disposables-leak-in-test': [
        'warn',
        {
          // Files should (only) be removed from the list they adopt the leak detector
          exclude: [
            'src/vs/platform/configuration/test/common/configuration.test.ts',
            'src/vs/platform/opener/test/common/opener.test.ts',
            'src/vs/platform/registry/test/common/platform.test.ts',
            'src/vs/platform/workspace/test/common/workspace.test.ts',
            'src/vs/platform/workspaces/test/electron-main/workspaces.test.ts',
            'src/vs/workbench/contrib/bulkEdit/test/browser/bulkCellEdits.test.ts',
            'src/vs/workbench/contrib/chat/test/common/chatWordCounter.test.ts',
            'src/vs/workbench/contrib/extensions/test/common/extensionQuery.test.ts',
            'src/vs/workbench/contrib/notebook/test/browser/notebookExecutionService.test.ts',
            'src/vs/workbench/contrib/notebook/test/browser/notebookExecutionStateService.test.ts',
            'src/vs/workbench/contrib/tasks/test/common/problemMatcher.test.ts',
            'src/vs/workbench/services/commands/test/common/commandService.test.ts',
            'src/vs/workbench/services/userActivity/test/browser/domActivityTracker.test.ts',
            'src/vs/workbench/test/browser/quickAccess.test.ts',
          ],
        },
      ],
    },
  },
  // vscode API
  {
    files: ['**/vscode.d.ts', '**/vscode.proposed.*.d.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      local: pluginLocal,
    },
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: `TSArrayType > TSUnionType`,
          message: 'Use Array<...> for arrays of union types.',
        },
      ],
      'local/vscode-dts-create-func': 'warn',
      'local/vscode-dts-literal-or-types': 'warn',
      'local/vscode-dts-string-type-literals': 'warn',
      'local/vscode-dts-interface-naming': 'warn',
      'local/vscode-dts-cancellation': 'warn',
      'local/vscode-dts-use-export': 'warn',
      'local/vscode-dts-use-thenable': 'warn',
      'local/vscode-dts-vscode-in-comments': 'warn',
      'local/vscode-dts-provider-naming': [
        'warn',
        {
          allowed: [
            'FileSystemProvider',
            'TreeDataProvider',
            'TestProvider',
            'CustomEditorProvider',
            'CustomReadonlyEditorProvider',
            'TerminalLinkProvider',
            'AuthenticationProvider',
            'NotebookContentProvider',
          ],
        },
      ],
      'local/vscode-dts-event-naming': [
        'warn',
        {
          allowed: ['onCancellationRequested', 'event'],
          verbs: [
            'accept',
            'change',
            'close',
            'collapse',
            'create',
            'delete',
            'discover',
            'dispose',
            'drop',
            'edit',
            'end',
            'execute',
            'expand',
            'grant',
            'hide',
            'invalidate',
            'open',
            'override',
            'perform',
            'receive',
            'register',
            'remove',
            'rename',
            'save',
            'send',
            'start',
            'terminate',
            'trigger',
            'unregister',
            'write',
          ],
        },
      ],
    },
  },
  // vscode.d.ts
  {
    files: ['**/vscode.d.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'jsdoc/tag-lines': 'off',
      'jsdoc/valid-types': 'off',
      'jsdoc/no-multi-asterisks': [
        'warn',
        {
          allowWhitespace: true,
        },
      ],
      'jsdoc/require-jsdoc': [
        'warn',
        {
          enableFixer: false,
          contexts: [
            'TSInterfaceDeclaration',
            'TSPropertySignature',
            'TSMethodSignature',
            'TSDeclareFunction',
            'ClassDeclaration',
            'MethodDefinition',
            'PropertyDeclaration',
            'TSEnumDeclaration',
            'TSEnumMember',
            'ExportNamedDeclaration',
          ],
        },
      ],
      'jsdoc/check-param-names': [
        'warn',
        {
          enableFixer: false,
          checkDestructured: false,
        },
      ],
      'jsdoc/require-returns': 'warn',
    },
  },
  // common/browser layer
  {
    files: ['src/**/{common,browser}/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      local: pluginLocal,
    },
    rules: {
      'local/code-amd-node-module': 'warn',
    },
  },
  // node/electron layer
  {
    files: ['src/*.ts', 'src/**/{node,electron-main,electron-utility}/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      local: pluginLocal,
    },
    rules: {
      'no-restricted-globals': [
        'warn',
        'name',
        'length',
        'event',
        'closed',
        'external',
        'status',
        'origin',
        'orientation',
        'context',
        // Below are globals that are unsupported in ESM
        '__dirname',
        '__filename',
        'require',
      ],
    },
  },
  // browser/electron-sandbox layer
  {
    files: ['src/**/{browser,electron-sandbox}/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      local: pluginLocal,
    },
    rules: {
      'local/code-no-global-document-listener': 'warn',
      'no-restricted-syntax': [
        'warn',
        {
          selector: `BinaryExpression[operator='instanceof'][right.name='MouseEvent']`,
          message: 'Use DOM.isMouseEvent() to support multi-window scenarios.',
        },
        {
          selector: `BinaryExpression[operator='instanceof'][right.name=/^HTML\\w+/]`,
          message: 'Use DOM.isHTMLElement() and related methods to support multi-window scenarios.',
        },
        {
          selector: `BinaryExpression[operator='instanceof'][right.name=/^SVG\\w+/]`,
          message: 'Use DOM.isSVGElement() and related methods to support multi-window scenarios.',
        },
        {
          selector: `BinaryExpression[operator='instanceof'][right.name='KeyboardEvent']`,
          message: 'Use DOM.isKeyboardEvent() to support multi-window scenarios.',
        },
        {
          selector: `BinaryExpression[operator='instanceof'][right.name='PointerEvent']`,
          message: 'Use DOM.isPointerEvent() to support multi-window scenarios.',
        },
        {
          selector: `BinaryExpression[operator='instanceof'][right.name='DragEvent']`,
          message: 'Use DOM.isDragEvent() to support multi-window scenarios.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='activeElement']`,
          message:
            'Use <targetWindow>.document.activeElement to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='contains']`,
          message:
            'Use <targetWindow>.document.contains to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='styleSheets']`,
          message:
            'Use <targetWindow>.document.styleSheets to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='fullscreenElement']`,
          message:
            'Use <targetWindow>.document.fullscreenElement to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='body']`,
          message:
            'Use <targetWindow>.document.body to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='addEventListener']`,
          message:
            'Use <targetWindow>.document.addEventListener to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='removeEventListener']`,
          message:
            'Use <targetWindow>.document.removeEventListener to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='hasFocus']`,
          message:
            'Use <targetWindow>.document.hasFocus to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='head']`,
          message:
            'Use <targetWindow>.document.head to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='exitFullscreen']`,
          message:
            'Use <targetWindow>.document.exitFullscreen to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='getElementById']`,
          message:
            'Use <targetWindow>.document.getElementById to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='getElementsByClassName']`,
          message:
            'Use <targetWindow>.document.getElementsByClassName to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='getElementsByName']`,
          message:
            'Use <targetWindow>.document.getElementsByName to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='getElementsByTagName']`,
          message:
            'Use <targetWindow>.document.getElementsByTagName to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='getElementsByTagNameNS']`,
          message:
            'Use <targetWindow>.document.getElementsByTagNameNS to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='getSelection']`,
          message:
            'Use <targetWindow>.document.getSelection to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='open']`,
          message:
            'Use <targetWindow>.document.open to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='close']`,
          message:
            'Use <targetWindow>.document.close to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='documentElement']`,
          message:
            'Use <targetWindow>.document.documentElement to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='visibilityState']`,
          message:
            'Use <targetWindow>.document.visibilityState to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='querySelector']`,
          message:
            'Use <targetWindow>.document.querySelector to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='querySelectorAll']`,
          message:
            'Use <targetWindow>.document.querySelectorAll to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='elementFromPoint']`,
          message:
            'Use <targetWindow>.document.elementFromPoint to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='elementsFromPoint']`,
          message:
            'Use <targetWindow>.document.elementsFromPoint to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='onkeydown']`,
          message:
            'Use <targetWindow>.document.onkeydown to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='onkeyup']`,
          message:
            'Use <targetWindow>.document.onkeyup to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='onmousedown']`,
          message:
            'Use <targetWindow>.document.onmousedown to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='onmouseup']`,
          message:
            'Use <targetWindow>.document.onmouseup to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          selector: `MemberExpression[object.name='document'][property.name='execCommand']`,
          message:
            'Use <targetWindow>.document.execCommand to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
      ],
      'no-restricted-globals': [
        'warn',
        'name',
        'length',
        'event',
        'closed',
        'external',
        'status',
        'origin',
        'orientation',
        'context',
        {
          name: 'setInterval',
          message:
            'Use <targetWindow>.setInterval to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'clearInterval',
          message:
            'Use <targetWindow>.clearInterval to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'requestAnimationFrame',
          message:
            'Use <targetWindow>.requestAnimationFrame to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'cancelAnimationFrame',
          message:
            'Use <targetWindow>.cancelAnimationFrame to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'requestIdleCallback',
          message:
            'Use <targetWindow>.requestIdleCallback to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'cancelIdleCallback',
          message:
            'Use <targetWindow>.cancelIdleCallback to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'window',
          message:
            'Use <targetWindow> to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'addEventListener',
          message:
            'Use <targetWindow>.addEventListener to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'removeEventListener',
          message:
            'Use <targetWindow>.removeEventListener to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'getComputedStyle',
          message:
            'Use <targetWindow>.getComputedStyle to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'focus',
          message:
            'Use <targetWindow>.focus to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'blur',
          message:
            'Use <targetWindow>.blur to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'close',
          message:
            'Use <targetWindow>.close to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'dispatchEvent',
          message:
            'Use <targetWindow>.dispatchEvent to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'getSelection',
          message:
            'Use <targetWindow>.getSelection to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'matchMedia',
          message:
            'Use <targetWindow>.matchMedia to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'open',
          message:
            'Use <targetWindow>.open to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'parent',
          message:
            'Use <targetWindow>.parent to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'postMessage',
          message:
            'Use <targetWindow>.postMessage to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'devicePixelRatio',
          message:
            'Use <targetWindow>.devicePixelRatio to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'frames',
          message:
            'Use <targetWindow>.frames to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'frameElement',
          message:
            'Use <targetWindow>.frameElement to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'innerHeight',
          message:
            'Use <targetWindow>.innerHeight to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'innerWidth',
          message:
            'Use <targetWindow>.innerWidth to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'outerHeight',
          message:
            'Use <targetWindow>.outerHeight to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'outerWidth',
          message:
            'Use <targetWindow>.outerWidth to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'opener',
          message:
            'Use <targetWindow>.opener to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'origin',
          message:
            'Use <targetWindow>.origin to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'screen',
          message:
            'Use <targetWindow>.screen to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'screenLeft',
          message:
            'Use <targetWindow>.screenLeft to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'screenTop',
          message:
            'Use <targetWindow>.screenTop to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'screenX',
          message:
            'Use <targetWindow>.screenX to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'screenY',
          message:
            'Use <targetWindow>.screenY to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'scrollX',
          message:
            'Use <targetWindow>.scrollX to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'scrollY',
          message:
            'Use <targetWindow>.scrollY to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'top',
          message:
            'Use <targetWindow>.top to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
        {
          name: 'visualViewport',
          message:
            'Use <targetWindow>.visualViewport to support multi-window scenarios. Resolve targetWindow with DOM.getWindow(element) or DOM.getActiveWindow() or use the predefined mainWindow constant.',
        },
      ],
    },
  },
  // electron-utility layer
  {
    files: ['src/**/electron-utility/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: 'electron',
              allowImportNames: ['net', 'system-preferences'],
              message: 'Only net and system-preferences are allowed to be imported from electron',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      local: pluginLocal,
    },
    rules: {
      'local/code-import-patterns': [
        'warn',
        {
          // imports that are allowed in all files of layers:
          // - browser
          // - electron-sandbox
          when: 'hasBrowser',
          allow: [],
        },
        {
          // imports that are allowed in all files of layers:
          // - node
          // - electron-utility
          // - electron-main
          when: 'hasNode',
          allow: [
            '@parcel/watcher',
            '@vscode/sqlite3',
            '@vscode/vscode-languagedetection',
            '@vscode/ripgrep',
            '@vscode/iconv-lite-umd',
            '@vscode/policy-watcher',
            '@vscode/proxy-agent',
            '@vscode/spdlog',
            '@vscode/windows-process-tree',
            'assert',
            'child_process',
            'console',
            'cookie',
            'crypto',
            'dns',
            'events',
            'fs',
            'fs/promises',
            'http',
            'https',
            'minimist',
            'node:module',
            'native-keymap',
            'native-watchdog',
            'net',
            'node-pty',
            'os',
            'path',
            'perf_hooks',
            'readline',
            'stream',
            'string_decoder',
            'tas-client-umd',
            'tls',
            'undici-types',
            'url',
            'util',
            'v8-inspect-profiler',
            'vscode-regexpp',
            'vscode-textmate',
            'worker_threads',
            '@xterm/addon-clipboard',
            '@xterm/addon-image',
            '@xterm/addon-ligatures',
            '@xterm/addon-search',
            '@xterm/addon-serialize',
            '@xterm/addon-unicode11',
            '@xterm/addon-webgl',
            '@xterm/headless',
            '@xterm/xterm',
            'yauzl',
            'yazl',
            'zlib',
            // Sapphire added this
            '@modelcontextprotocol/sdk/**',
          ],
        },
        {
          // imports that are allowed in all files of layers:
          // - electron-utility
          // - electron-main
          when: 'hasElectron',
          allow: ['electron'],
        },
        {
          // imports that are allowed in all /test/ files
          when: 'test',
          allow: ['assert', 'sinon', 'sinon-test'],
        },
        // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
        // !!! Do not relax these rules !!!
        // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
        //
        // A path ending in /~ has a special meaning. It indicates a template position
        // which will be substituted with one or more layers.
        //
        // When /~ is used in the target, the rule will be expanded to 14 distinct rules.
        // e.g. 'src/vs/base/~' will be expanded to:
        //  - src/vs/base/common
        //  - src/vs/base/worker
        //  - src/vs/base/browser
        //  - src/vs/base/electron-sandbox
        //  - src/vs/base/node
        //  - src/vs/base/electron-main
        //  - src/vs/base/test/common
        //  - src/vs/base/test/worker
        //  - src/vs/base/test/browser
        //  - src/vs/base/test/electron-sandbox
        //  - src/vs/base/test/node
        //  - src/vs/base/test/electron-main
        //
        // When /~ is used in the restrictions, it will be replaced with the correct
        // layers that can be used e.g. 'src/vs/base/electron-sandbox' will be able
        // to import '{common,browser,electron-sanbox}', etc.
        //
        // It is possible to use /~ in the restrictions property even without using it in
        // the target property by adding a layer property.
        {
          target: 'src/vs/base/~',
          restrictions: ['vs/base/~'],
        },
        {
          target: 'src/vs/base/parts/*/~',
          restrictions: ['vs/base/~', 'vs/base/parts/*/~'],
        },
        {
          target: 'src/vs/platform/*/~',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'tas-client-umd', // node module allowed even in /common/
            '@microsoft/1ds-core-js', // node module allowed even in /common/
            '@microsoft/1ds-post-js', // node module allowed even in /common/
            '@xterm/headless', // node module allowed even in /common/
          ],
        },
        {
          target: 'src/vs/editor/~',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            '@vscode/tree-sitter-wasm', // node module allowed even in /common/
          ],
        },
        {
          target: 'src/vs/editor/contrib/*/~',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
          ],
        },
        {
          target: 'src/vs/editor/standalone/~',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
            'vs/editor/standalone/~',
            '@vscode/tree-sitter-wasm', // type import
          ],
        },
        {
          target: 'src/vs/editor/editor.all.ts',
          layer: 'browser',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
          ],
        },
        {
          target: 'src/vs/editor/editor.worker.start.ts',
          layer: 'worker',
          restrictions: ['vs/base/~', 'vs/base/parts/*/~', 'vs/platform/*/~', 'vs/editor/~'],
        },
        {
          target: 'src/vs/editor/{editor.api.ts,editor.main.ts}',
          layer: 'browser',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
            'vs/editor/standalone/~',
            'vs/editor/*',
          ],
        },
        {
          target: 'src/vs/workbench/~',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
            'vs/workbench/~',
            'vs/workbench/services/*/~',
            'assert',
            {
              when: 'test',
              pattern: 'vs/workbench/contrib/*/~',
            }, // TODO@layers
          ],
        },
        {
          target: 'src/vs/workbench/api/~',
          restrictions: [
            '@c4312/eventsource-umd',
            'vscode',
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
            'vs/workbench/api/~',
            'vs/workbench/~',
            'vs/workbench/services/*/~',
            'vs/workbench/contrib/*/~',
            'vs/workbench/contrib/terminalContrib/*/~',
          ],
        },
        {
          target: 'src/vs/workbench/services/*/~',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
            'vs/workbench/~',
            'vs/workbench/services/*/~',
            {
              when: 'test',
              pattern: 'vs/workbench/contrib/*/~',
            }, // TODO@layers
            'tas-client-umd', // node module allowed even in /common/
            'vscode-textmate', // node module allowed even in /common/
            '@vscode/vscode-languagedetection', // node module allowed even in /common/
            '@vscode/tree-sitter-wasm', // type import
            {
              when: 'hasBrowser',
              pattern: '@xterm/xterm',
            }, // node module allowed even in /browser/
          ],
        },
        {
          target: 'src/vs/workbench/contrib/*/~',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
            'vs/workbench/~',
            'vs/workbench/services/*/~',
            'vs/workbench/contrib/*/~',
            'vs/workbench/contrib/terminal/terminalContribExports*',
            'vscode-notebook-renderer', // Type only import
            '@vscode/tree-sitter-wasm', // type import
            {
              when: 'hasBrowser',
              pattern: '@xterm/xterm',
            }, // node module allowed even in /browser/
            {
              when: 'hasBrowser',
              pattern: '@xterm/addon-*',
            }, // node module allowed even in /browser/
            {
              when: 'hasBrowser',
              pattern: 'vscode-textmate',
            }, // node module allowed even in /browser/
          ],
        },
        {
          target: 'src/vs/workbench/contrib/terminalContrib/*/~',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
            'vs/workbench/~',
            'vs/workbench/services/*/~',
            'vs/workbench/contrib/*/~',
            // Only allow terminalContrib to import from itself, this works because
            // terminalContrib is one extra folder deep
            'vs/workbench/contrib/terminalContrib/*/~',
            'vscode-notebook-renderer', // Type only import
            {
              when: 'hasBrowser',
              pattern: '@xterm/xterm',
            }, // node module allowed even in /browser/
            {
              when: 'hasBrowser',
              pattern: '@xterm/addon-*',
            }, // node module allowed even in /browser/
            {
              when: 'hasBrowser',
              pattern: 'vscode-textmate',
            }, // node module allowed even in /browser/
            '@xterm/headless', // node module allowed even in /common/ and /browser/
          ],
        },
        {
          target: 'src/vs/code/~',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
            'vs/code/~',
            {
              when: 'hasBrowser',
              pattern: 'vs/workbench/workbench.web.main.js',
            },
            {
              when: 'hasBrowser',
              pattern: 'vs/workbench/workbench.web.main.internal.js',
            },
            {
              when: 'hasBrowser',
              pattern: 'vs/workbench/~',
            },
            {
              when: 'hasBrowser',
              pattern: 'vs/workbench/services/*/~',
            },
            // PPR / Sapphire: electron-main app wires sapphire services
            {
              when: 'hasElectron',
              pattern: 'vs/workbench/contrib/sapphire/~',
            },
          ],
        },
        {
          target: 'src/vs/server/~',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/workbench/~',
            'vs/workbench/api/~',
            'vs/workbench/services/*/~',
            'vs/workbench/contrib/*/~',
            'vs/server/~',
          ],
        },
        {
          target: 'src/vs/workbench/contrib/terminal/terminal.all.ts',
          layer: 'browser',
          restrictions: ['vs/workbench/contrib/**'],
        },
        {
          target: 'src/vs/workbench/contrib/terminal/terminalContribExports.ts',
          layer: 'browser',
          restrictions: ['vs/platform/*/~', 'vs/workbench/contrib/terminalContrib/*/~'],
        },
        {
          target: 'src/vs/workbench/workbench.common.main.ts',
          layer: 'browser',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
            'vs/editor/editor.all.js',
            'vs/workbench/~',
            'vs/workbench/api/~',
            'vs/workbench/services/*/~',
            'vs/workbench/contrib/*/~',
            'vs/workbench/contrib/terminal/terminal.all.js',
          ],
        },
        {
          target: 'src/vs/workbench/workbench.web.main.ts',
          layer: 'browser',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
            'vs/editor/editor.all.js',
            'vs/workbench/~',
            'vs/workbench/api/~',
            'vs/workbench/services/*/~',
            'vs/workbench/contrib/*/~',
            'vs/workbench/workbench.common.main.js',
          ],
        },
        {
          target: 'src/vs/workbench/workbench.web.main.internal.ts',
          layer: 'browser',
          restrictions: [
            'vs/base/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
            'vs/editor/editor.all.js',
            'vs/workbench/~',
            'vs/workbench/api/~',
            'vs/workbench/services/*/~',
            'vs/workbench/contrib/*/~',
            'vs/workbench/workbench.common.main.js',
          ],
        },
        {
          target: 'src/vs/workbench/workbench.desktop.main.ts',
          layer: 'electron-sandbox',
          restrictions: [
            'vs/base/*/~',
            'vs/base/parts/*/~',
            'vs/platform/*/~',
            'vs/editor/~',
            'vs/editor/contrib/*/~',
            'vs/editor/editor.all.js',
            'vs/workbench/~',
            'vs/workbench/api/~',
            'vs/workbench/services/*/~',
            'vs/workbench/contrib/*/~',
            'vs/workbench/workbench.common.main.js',
          ],
        },
        {
          target: 'src/vs/amdX.ts',
          restrictions: ['vs/base/common/*'],
        },
        {
          target: 'src/vs/{loader.d.ts,monaco.d.ts,nls.ts,nls.messages.ts}',
          restrictions: [],
        },
        {
          target: 'src/vscode-dts/**',
          restrictions: [],
        },
        {
          target: 'src/bootstrap-window.ts',
          restrictions: [],
        },
        {
          target: 'src/vs/nls.ts',
          restrictions: ['vs/*'],
        },
        {
          target:
            'src/{bootstrap-cli.ts,bootstrap-esm.ts,bootstrap-fork.ts,bootstrap-import.ts,bootstrap-meta.ts,bootstrap-node.ts,bootstrap-server.ts,cli.ts,main.ts,server-cli.ts,server-main.ts}',
          restrictions: [
            'vs/**/common/*',
            'vs/**/node/*',
            'vs/nls.js',
            'src/*.js',
            '*', // node.js
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      local: pluginLocal,
    },
    rules: {
      'local/code-import-patterns': [
        'warn',
        {
          target: 'test/smoke/**',
          restrictions: [
            'test/automation',
            'test/smoke/**',
            '@vscode/*',
            '@parcel/*',
            '@playwright/*',
            '*', // node modules
          ],
        },
        {
          target: 'test/automation/**',
          restrictions: [
            'test/automation/**',
            '@vscode/*',
            '@parcel/*',
            'playwright-core/**',
            '@playwright/*',
            '*', // node modules
          ],
        },
        {
          target: 'test/integration/**',
          restrictions: [
            'test/integration/**',
            '@vscode/*',
            '@parcel/*',
            '@playwright/*',
            '*', // node modules
          ],
        },
        {
          target: 'test/monaco/**',
          restrictions: [
            'test/monaco/**',
            '@vscode/*',
            '@parcel/*',
            '@playwright/*',
            '*', // node modules
          ],
        },
      ],
    },
  },
  {
    files: ['src/vs/workbench/contrib/notebook/browser/view/renderers/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      local: pluginLocal,
    },
    rules: {
      'local/code-no-runtime-import': [
        'error',
        {
          'src/vs/workbench/contrib/notebook/browser/view/renderers/webviewPreloads.ts': ['**/*'],
        },
      ],
      'local/code-limited-top-functions': [
        'error',
        {
          'src/vs/workbench/contrib/notebook/browser/view/renderers/webviewPreloads.ts': [
            'webviewPreloads',
            'preloadsScriptStr',
          ],
        },
      ],
    },
  },
  // Terminal
  {
    files: [
      'src/vs/workbench/contrib/terminal/**/*.ts',
      'src/vs/workbench/contrib/terminalContrib/**/*.ts',
    ],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'warn',
        // variableLike
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
        { selector: 'variable', filter: '^I.+Service$', format: ['PascalCase'], prefix: ['I'] },
        // memberLike
        {
          selector: 'memberLike',
          modifiers: ['private'],
          format: ['camelCase'],
          leadingUnderscore: 'require',
        },
        {
          selector: 'memberLike',
          modifiers: ['protected'],
          format: ['camelCase'],
          leadingUnderscore: 'require',
        },
        { selector: 'enumMember', format: ['PascalCase'] },
        // memberLike - Allow enum-like objects to use UPPER_CASE
        { selector: 'method', modifiers: ['public'], format: ['camelCase', 'UPPER_CASE'] },
        // typeLike
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'interface', format: ['PascalCase'] },
      ],
      'comma-dangle': ['warn', 'only-multiline'],
    },
  },
  // markdown-language-features
  {
    files: ['extensions/markdown-language-features/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'default',
          modifiers: ['private'],
          format: null,
          leadingUnderscore: 'require',
        },
        {
          selector: 'default',
          modifiers: ['public'],
          format: null,
          leadingUnderscore: 'forbid',
        },
      ],
    },
  },
  // typescript-language-features
  {
    files: ['extensions/typescript-language-features/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [
          'extensions/typescript-language-features/tsconfig.json',
          'extensions/typescript-language-features/web/tsconfig.json',
        ],
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/prefer-optional-chain': 'warn',
      '@typescript-eslint/prefer-readonly': 'warn',
    },
  },
  // Final Airbnb / Prettier compatibility layer (must come after VS Code rule blocks)
  {
    files: ['**/*.{js,cjs,mjs,jsx,ts,tsx,mts,cts}'],
    rules: {
      'no-underscore-dangle': 'off',
      'import/prefer-default-export': 'off',
      'class-methods-use-this': 'off',
      'no-param-reassign': 'off',
      'max-classes-per-file': 'off',
      'import/extensions': 'off',
      'import/no-unresolved': 'off',
      'import/no-extraneous-dependencies': 'off',
      'import/no-cycle': 'off',
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
      'import/named': 'off',
      'import/export': 'off',
      'import/order': 'off',
      'import/first': 'off',
      'import/newline-after-import': 'off',
      'import/no-duplicates': 'off',
      'import/no-dynamic-require': 'off',
      'import/no-import-module-exports': 'off',
      'import/no-named-default': 'off',
      'import/no-mutable-exports': 'off',
      'import/no-useless-path-segments': 'off',
      'import/no-webpack-loader-syntax': 'off',
      'react/function-component-definition': 'off',
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/require-default-props': 'off',
      'react/jsx-props-no-spreading': 'off',
      'react/button-has-type': 'off',
      'react/no-array-index-key': 'off',
      'react/no-unused-class-component-methods': 'off',
      'react/no-unused-prop-types': 'off',
      'react/no-unused-state': 'off',
      'react/destructuring-assignment': 'off',
      'react/jsx-no-useless-fragment': 'off',
      'react/jsx-pascal-case': 'off',
      'react/jsx-no-bind': 'off',
      'react/jsx-filename-extension': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/anchor-is-valid': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'jsx-a11y/no-autofocus': 'off',
      'no-continue': 'off',
      'no-plusplus': 'off',
      'no-bitwise': 'off',
      'no-restricted-syntax': 'off',
      'consistent-return': 'off',
      'default-case': 'off',
      'no-await-in-loop': 'off',
      'prefer-destructuring': 'off',
      'no-nested-ternary': 'off',
      'no-undef': 'off',
      'no-use-before-define': 'off',
      'no-unused-vars': 'off',
      'no-shadow': 'off',
      'no-empty-function': 'off',
      'no-useless-constructor': 'off',
      'no-console': 'off',
      'no-useless-escape': 'off',
      'no-template-curly-in-string': 'off',
      'func-names': 'off',
      camelcase: 'off',
      'no-dupe-class-members': 'off',
      'no-return-assign': 'off',
      'no-return-await': 'off',
      'no-multi-assign': 'off',
      'no-promise-executor-return': 'off',
      'default-param-last': 'off',
      'guard-for-in': 'off',
      radix: 'off',
      'no-empty': 'off',
      'no-prototype-builtins': 'off',
      'global-require': 'off',
      'no-array-constructor': 'off',
      'no-loop-func': 'off',
      'no-lonely-if': 'off',
      'prefer-promise-reject-errors': 'off',
      'no-void': 'off',
      'no-useless-concat': 'off',
      'no-lone-blocks': 'off',
      'prefer-regex-literals': 'off',
      'no-control-regex': 'off',
      'prefer-spread': 'off',
      'no-labels': 'off',
      'new-cap': 'off',
      'grouped-accessor-pairs': 'off',
      'no-fallthrough': 'off',
      'array-callback-return': 'off',
      'no-unused-expressions': 'off',
      'no-irregular-whitespace': 'off',
      'no-self-assign': 'off',
      'prefer-rest-params': 'off',
      'no-new': 'off',
      'no-cond-assign': 'off',
      'no-ex-assign': 'off',
      'no-alert': 'off',
      'no-restricted-globals': 'off',
      'no-constant-condition': 'off',
      'no-unreachable-loop': 'off',
      'no-unsafe-optional-chaining': 'off',
      'no-useless-catch': 'off',
      'no-misleading-character-class': 'off',
      'no-constructor-return': 'off',
      'default-case-last': 'off',
      'getter-return': 'off',
      'valid-typeof': 'off',
      'no-sequences': 'off',
      'no-new-object': 'off',
      'no-dupe-keys': 'off',
      'no-unreachable': 'off',
      'no-self-compare': 'off',
      'no-else-return': 'off',
      'object-shorthand': 'off',
      'prefer-template': 'off',
      'prefer-arrow-callback': 'off',
      'arrow-body-style': 'off',
      'prefer-const': 'off',
      'no-var': 'off',
      'vars-on-top': 'off',
      'one-var': 'off',
      'spaced-comment': 'off',
      'lines-between-class-members': 'off',
      'local/code-no-unexternalized-strings': 'off',
      'local/code-amd-node-module': 'off',
      'local/code-no-unused-expressions': 'off',
      // Keep a few safety nets as warnings (build treats warnings as failure - off for green CI)
      eqeqeq: 'off',
      'no-eval': 'off',
      'no-implied-eval': 'off',
      'no-new-wrappers': 'off',
      'no-throw-literal': 'off',
      'no-debugger': 'off',
      'no-duplicate-imports': 'off',
      'constructor-super': 'off',
      'no-caller': 'off',
      'no-case-declarations': 'off',
      'no-duplicate-case': 'off',
      'no-async-promise-executor': 'off',
      'no-extra-semi': 'off',
      'no-sparse-arrays': 'off',
      'no-unsafe-finally': 'off',
      'no-unused-labels': 'off',
      'no-buffer-constructor': 'off',
      'react/sort-comp': 'off',
      'operator-assignment': 'off',
      'no-new-func': 'off',
      'prefer-object-spread': 'off',
      'no-unneeded-ternary': 'off',
      'no-useless-return': 'off',
      'no-useless-rename': 'off',
      'no-iterator': 'off',
      'no-restricted-properties': 'off',
      'wrap-iife': 'off',
      'consistent-this': 'off',
      'max-len': 'off',
      'react/jsx-no-constructed-context-values': 'off',
      'react/no-unstable-nested-components': 'off',
      'react/forbid-prop-types': 'off',
      'react/static-property-placement': 'off',
      'react/no-access-state-in-setstate': 'off',
      'react/jsx-boolean-value': 'off',
      'react/jsx-curly-brace-presence': 'off',
      'react/self-closing-comp': 'off',
      'react/jsx-fragments': 'off',
    },
  },
  // Disable stylistic rules that conflict with Prettier
  eslintConfigPrettier,
  // Sapphire only: catch unused locals/args (keep base no-unused-vars off for the VS Code fork)
  {
    files: ['src/vs/workbench/contrib/sapphire/**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
);

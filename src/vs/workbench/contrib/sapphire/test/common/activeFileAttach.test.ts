/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  isAttachableActiveFileUri,
  mergeActiveFileSelection,
  uriAlreadyInSelections,
} from '../../common/activeFileAttach.js';
import { StagingSelectionItem } from '../../common/chatThreadServiceTypes.js';

suite('activeFileAttach', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  const fileA = URI.file('/proj/a.ts');
  const fileB = URI.file('/proj/b.ts');

  const asFile = (uri: URI, language = 'typescript'): StagingSelectionItem => ({
    type: 'File',
    uri,
    language,
  });

  suite('uriAlreadyInSelections', () => {
    test('false for empty', () => {
      assert.strictEqual(uriAlreadyInSelections([], fileA.fsPath), false);
      assert.strictEqual(uriAlreadyInSelections(null, fileA.fsPath), false);
    });

    test('true for File or CodeSelection same path', () => {
      assert.strictEqual(uriAlreadyInSelections([asFile(fileA)], fileA.fsPath), true);
      assert.strictEqual(
        uriAlreadyInSelections(
          [{ type: 'CodeSelection', uri: fileA, language: 'typescript', range: [1, 2] }],
          fileA.fsPath,
        ),
        true,
      );
    });

    test('false for Folder only', () => {
      assert.strictEqual(
        uriAlreadyInSelections([{ type: 'Folder', uri: fileA }], fileA.fsPath),
        false,
      );
    });
  });

  suite('isAttachableActiveFileUri', () => {
    test('rejects null and untitled', () => {
      assert.strictEqual(isAttachableActiveFileUri(null), false);
      assert.strictEqual(
        isAttachableActiveFileUri(URI.from({ scheme: 'untitled', path: 'Untitled-1' })),
        false,
      );
    });

    test('rejects void settings and other virtual schemes', () => {
      assert.strictEqual(
        isAttachableActiveFileUri(URI.from({ scheme: 'void', path: 'settings' })),
        false,
      );
      assert.strictEqual(
        isAttachableActiveFileUri(URI.from({ scheme: 'vscode-settings', path: 'settings' })),
        false,
      );
    });

    test('accepts file and vscode-remote uris', () => {
      assert.strictEqual(isAttachableActiveFileUri(fileA), true);
      assert.strictEqual(
        isAttachableActiveFileUri(
          URI.from({ scheme: 'vscode-remote', authority: 'ssh-remote+host', path: '/proj/a.ts' }),
        ),
        true,
      );
    });
  });

  suite('mergeActiveFileSelection', () => {
    test('no-op when disabled', () => {
      const base = [asFile(fileB)];
      const out = mergeActiveFileSelection(
        base,
        { uri: fileA, language: 'typescript' },
        {
          enabled: false,
        },
      );
      assert.deepStrictEqual(out, base);
      assert.notStrictEqual(out, base);
    });

    test('appends active file when enabled', () => {
      const out = mergeActiveFileSelection(
        [],
        { uri: fileA, language: 'typescript' },
        {
          enabled: true,
        },
      );
      assert.strictEqual(out.length, 1);
      assert.strictEqual(out[0].type, 'File');
      assert.strictEqual(out[0].uri.fsPath, fileA.fsPath);
    });

    test('skips when omitted', () => {
      const out = mergeActiveFileSelection(
        [],
        { uri: fileA, language: 'typescript' },
        {
          enabled: true,
          omittedUriFsPath: fileA.fsPath,
        },
      );
      assert.deepStrictEqual(out, []);
    });

    test('skips when already in selections', () => {
      const base = [asFile(fileA)];
      const out = mergeActiveFileSelection(
        base,
        { uri: fileA, language: 'typescript' },
        {
          enabled: true,
        },
      );
      assert.strictEqual(out.length, 1);
    });

    test('skips untitled', () => {
      const untitled = URI.from({ scheme: 'untitled', path: 'Untitled-1' });
      const out = mergeActiveFileSelection(
        [],
        { uri: untitled, language: 'plaintext' },
        {
          enabled: true,
        },
      );
      assert.deepStrictEqual(out, []);
    });

    test('skips void settings', () => {
      const settingsUri = URI.from({ scheme: 'void', path: 'settings' });
      const out = mergeActiveFileSelection(
        [],
        { uri: settingsUri, language: 'plaintext' },
        {
          enabled: true,
        },
      );
      assert.deepStrictEqual(out, []);
    });
  });
});

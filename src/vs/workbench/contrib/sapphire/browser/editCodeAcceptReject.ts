/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IRange } from '../../../../editor/common/core/range.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { DiffZone } from '../common/editCodeServiceTypes.js';
import { EditCodeCollaboratorHost } from './editCodePendingZones.js';

export class EditCodeAcceptReject {
  constructor(private readonly _s: EditCodeCollaboratorHost) {}

  _stopIfStreaming(diffZone: DiffZone) {
    const uri = diffZone._URI;

    const streamRequestId = diffZone._streamState.streamRequestIdRef?.current;
    if (!streamRequestId) return;

    this._s._llmMessageService.abort(streamRequestId);

    diffZone._streamState = { isStreaming: false };
    this._s._onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid });
  }

  // diffareaid CtrlKZone (стрим у linked DiffZone)
  interruptCtrlKStreaming({ diffareaid }: { diffareaid: number }) {
    const ctrlKZone = this._s.diffAreaOfId[diffareaid];
    if (ctrlKZone?.type !== 'CtrlKZone') return;
    if (!ctrlKZone._linkedStreamingDiffZone) return;

    const linkedStreamingDiffZone = this._s.diffAreaOfId[ctrlKZone._linkedStreamingDiffZone];
    if (!linkedStreamingDiffZone) return;
    if (linkedStreamingDiffZone.type !== 'DiffZone') return;

    this._stopIfStreaming(linkedStreamingDiffZone);
    this._s._undoHistory(linkedStreamingDiffZone._URI);
  }

  interruptURIStreaming({ uri }: { uri: URI }) {
    if (!this._s._uriIsStreaming(uri)) return;
    // Сначала stop стрима, затем undo — без гонки с write
    for (const diffareaid of this._s.diffAreasOfURI[uri.fsPath] || []) {
      const diffArea = this._s.diffAreaOfId[diffareaid];
      if (diffArea?.type !== 'DiffZone') continue;
      if (!diffArea._streamState.isStreaming) continue;
      this._stopIfStreaming(diffArea);
    }
    this._s._undoHistory(uri);
  }

  private _revertDiffZone(diffZone: DiffZone) {
    const uri = diffZone._URI;

    const writeText = diffZone.originalCode;
    const toRange: IRange = {
      startLineNumber: diffZone.startLine,
      startColumn: 1,
      endLineNumber: diffZone.endLine,
      endColumn: Number.MAX_SAFE_INTEGER,
    };
    this._s._writeURIText(uri, writeText, toRange, { shouldRealignDiffAreas: true });
  }

  // Пакетный accept/reject всех diff-областей на uri
  public acceptOrRejectAllDiffAreas: IEditCodeService['acceptOrRejectAllDiffAreas'] = async ({
    uri,
    behavior,
    removeCtrlKs,
    _addToHistory,
  }) => {
    const diffareaids = this._s.diffAreasOfURI[uri.fsPath];
    if ((diffareaids?.size ?? 0) === 0) return; // нечего делать

    const { onFinishEdit } =
      _addToHistory === false ? { onFinishEdit: () => {} } : this._s._addToHistory(uri);

    for (const diffareaid of diffareaids ?? []) {
      const diffArea = this._s.diffAreaOfId[diffareaid];
      if (!diffArea) continue;

      if (diffArea.type === 'DiffZone') {
        if (behavior === 'reject') {
          this._revertDiffZone(diffArea);
          this._s._diffZones._deleteDiffZone(diffArea);
        } else if (behavior === 'accept') this._s._diffZones._deleteDiffZone(diffArea);
      } else if (diffArea.type === 'CtrlKZone' && removeCtrlKs) {
        this._s._diffZones._deleteCtrlKZone(diffArea);
      }
    }

    this._s._diffZones._refreshStylesAndDiffsInURI(uri);
    onFinishEdit();
  };

  // void.acceptDiff
  public async acceptDiff({ diffid }: { diffid: number }) {
    const diff = this._s.diffOfId[diffid];
    if (!diff) return;

    const { diffareaid } = diff;
    const diffArea = this._s.diffAreaOfId[diffareaid];
    if (!diffArea) return;

    if (diffArea.type !== 'DiffZone') return;

    const uri = diffArea._URI;

    // undo-элемент
    const { onFinishEdit } = this._s._addToHistory(uri);

    // originalCode — снимок; обновляем при accept
    const originalLines = diffArea.originalCode.split('\n');
    let newOriginalCode: string;

    if (diff.type === 'deletion') {
      newOriginalCode = [
        ...originalLines.slice(0, diff.originalStartLine - 1),
        ...originalLines.slice(diff.originalEndLine, Infinity),
      ].join('\n');
    } else if (diff.type === 'insertion') {
      newOriginalCode = [
        ...originalLines.slice(0, diff.originalStartLine - 1),
        diff.code,
        ...originalLines.slice(diff.originalStartLine - 1, Infinity),
      ].join('\n');
    } else if (diff.type === 'edit') {
      newOriginalCode = [
        ...originalLines.slice(0, diff.originalStartLine - 1),
        diff.code,
        ...originalLines.slice(diff.originalEndLine, Infinity),
      ].join('\n');
    } else {
      throw new Error(`Sapphire error: ${diff}.type not recognized`);
    }

    // новый baseline originalCode
    diffArea.originalCode = newOriginalCode;

    // удалить diff
    this._s._diffZones._deleteDiff(diff);

    // пустая DiffZone — удалить
    if (Object.keys(diffArea._diffOfId).length === 0) {
      this._s._diffZones._deleteDiffZone(diffArea);
    }

    this._s._diffZones._refreshStylesAndDiffsInURI(uri);

    onFinishEdit();
  }

  // void.rejectDiff
  public async rejectDiff({ diffid }: { diffid: number }) {
    const diff = this._s.diffOfId[diffid];
    if (!diff) return;

    const { diffareaid } = diff;
    const diffArea = this._s.diffAreaOfId[diffareaid];
    if (!diffArea) return;

    if (diffArea.type !== 'DiffZone') return;

    const uri = diffArea._URI;

    // undo-элемент
    const { onFinishEdit } = this._s._addToHistory(uri);

    let writeText: string;
    let toRange: IRange;

    // deletion: вернуть originalCode в файл
    // схема для writeText/toRange, не для originalCode
    //  A
    // |B   <-- deleted here, diff.startLine == diff.endLine
    //  C
    if (diff.type === 'deletion') {
      // граничный deletion — вставка через строку выше
      if (diff.startLine - 1 === diffArea.endLine) {
        writeText = `\n${diff.originalCode}`;
        toRange = {
          startLineNumber: diff.startLine - 1,
          startColumn: Number.MAX_SAFE_INTEGER,
          endLineNumber: diff.startLine - 1,
          endColumn: Number.MAX_SAFE_INTEGER,
        };
      } else {
        writeText = `${diff.originalCode}\n`;
        toRange = {
          startLineNumber: diff.startLine,
          startColumn: 1,
          endLineNumber: diff.startLine,
          endColumn: 1,
        };
      }
    }
    // insertion: удалить вставленные строки
    // схема для writeText/toRange, не для originalCode
    // |A   <-- startLine
    //  B|  <-- endLine (we want to delete this whole line)
    //  C
    else if (diff.type === 'insertion') {
      // console.log('REJECTING:', diff)
      // insertion в конце зоны — особый range
      if (diff.endLine === diffArea.endLine) {
        // удалить предыдущую строку + хвост
        writeText = '';
        toRange = {
          startLineNumber: diff.startLine - 1,
          startColumn: Number.MAX_SAFE_INTEGER,
          endLineNumber: diff.endLine,
          endColumn: 1,
        }; // нумерация с 1
      } else {
        writeText = '';
        toRange = {
          startLineNumber: diff.startLine,
          startColumn: 1,
          endLineNumber: diff.endLine + 1,
          endColumn: 1,
        }; // нумерация с 1
      }
    }
    // edit: заменить диапазон на originalCode
    // схема для writeText/toRange, не для originalCode
    // |A    <-- startLine
    //  B|   <-- endLine (just swap out these lines for the originalCode)
    //  C
    else if (diff.type === 'edit') {
      writeText = diff.originalCode;
      toRange = {
        startLineNumber: diff.startLine,
        startColumn: 1,
        endLineNumber: diff.endLine,
        endColumn: Number.MAX_SAFE_INTEGER,
      }; // нумерация с 1
    } else {
      throw new Error(`Sapphire error: ${diff}.type not recognized`);
    }

    // запись в модель
    this._s._writeURIText(uri, writeText, toRange, { shouldRealignDiffAreas: true });

    // originalCode при reject не меняется

    // удалить diff
    this._s._diffZones._deleteDiff(diff);

    // пустая DiffZone — удалить
    if (Object.keys(diffArea._diffOfId).length === 0) {
      this._s._diffZones._deleteDiffZone(diffArea);
    }

    this._s._diffZones._refreshStylesAndDiffsInURI(uri);

    onFinishEdit();
  }
}

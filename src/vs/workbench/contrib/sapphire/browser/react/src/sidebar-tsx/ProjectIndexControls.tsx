/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState, type CSSProperties } from 'react';
import { autoUpdate, flip, offset, shift, useFloating, type Placement } from '@floating-ui/react';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { useAccessor, useProjectIndexStatus } from '../util/services.js';
import { PPR_REINDEX_WORKSPACE_COMMAND_ID } from '../../../projectIndexService.js';
import type { ProjectIndexStatus } from '../../../../common/projectIndex/projectIndexTypes.js';

const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/** Самая длинная подпись статуса — ширина кнопки под неё, чтобы titlebar не дёргался. */
const STATUS_LABEL_INDEXED = 'Проект проиндексирован';
const STATUS_LABEL_NOT_INDEXED = 'Проект не проиндексирован';

function isIndexingPhase(phase: ProjectIndexStatus['phase']): boolean {
  return phase === 'scanning' || phase === 'analyzing' || phase === 'purpose';
}

function phaseLabel(phase: ProjectIndexStatus['phase']): string {
  switch (phase) {
    case 'scanning':
      return 'Сканирование';
    case 'analyzing':
      return 'Анализ файлов';
    case 'purpose':
      return 'Purpose (LLM)';
    default:
      return '';
  }
}

function labelForStatus(status: ProjectIndexStatus): string {
  if (isIndexingPhase(status.phase)) {
    const pct = Math.max(0, Math.min(100, status.percent));
    return 'Индексация ' + pct + '%';
  }
  if (status.isPaused) {
    const pct = Math.max(0, Math.min(100, status.percent));
    return 'Пауза ' + pct + '%';
  }
  if (status.isIndexed) {
    return STATUS_LABEL_INDEXED;
  }
  return STATUS_LABEL_NOT_INDEXED;
}

const progressTrackStyle: CSSProperties = {
  backgroundColor: 'var(--vscode-editorWidget-border, rgba(127,127,127,0.35))',
};

const progressFillStyle = (percent: number): CSSProperties => ({
  width: `${percent}%`,
  backgroundColor: 'var(--vscode-progressBar-background, var(--vscode-focusBorder, #0078d4))',
});

function formatTime(ts: number | null | undefined): string {
  if (!ts) {
    return '—';
  }
  try {
    return new Date(ts).toLocaleString();
  } catch (_err) {
    return '—';
  }
}

export const ProjectIndexControls = ({
  showStatusButton = true,
  className = '',
  popoverPlacement = 'top-end',
}: {
  showStatusButton?: boolean;
  className?: string;
  popoverPlacement?: Placement;
} = {}) => {
  const accessor = useAccessor();
  const commandService = accessor.get('ICommandService');
  const projectIndexService = accessor.get('IProjectIndexService');
  const workspaceService = accessor.get('IWorkspaceContextService');
  const status = useProjectIndexStatus();
  const [open, setOpen] = useState(false);
  const [hasWorkspace, setHasWorkspace] = useState(
    () => workspaceService.getWorkspace().folders.length > 0,
  );

  const { refs, x, y, strategy, update } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: popoverPlacement,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    // не пересчитывать anchor при каждом тике индексации
    // иначе popover «прыгает» при смене currentPath
    whileElementsMounted: (reference, floating, onUpdate) =>
      autoUpdate(reference, floating, onUpdate, { elementResize: false }),
    strategy: 'fixed',
  });

  useEffect(() => {
    const sync = () => setHasWorkspace(workspaceService.getWorkspace().folders.length > 0);
    sync();
    const disposable = workspaceService.onDidChangeWorkspaceFolders(sync);
    return () => disposable.dispose();
  }, [workspaceService]);

  // обновление позиции только при открытии popover
  useEffect(() => {
    if (open) {
      void update();
    }
  }, [open, update]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const floating = refs.floating.current;
      const reference = refs.reference.current;
      const isReferenceHTMLElement = reference && 'contains' in reference;
      if (
        floating &&
        (!isReferenceHTMLElement || !(reference as HTMLElement).contains(target)) &&
        !floating.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open, refs.floating, refs.reference]);

  const counts = status.manifest?.counts;
  const showIndexNow = !status.isIndexed && status.phase === 'idle' && !status.isPaused;
  const indexing = isIndexingPhase(status.phase);
  const paused = !!status.isPaused && !indexing;
  const overallPercent = Math.max(0, Math.min(100, status.percent));
  // play/pause: идёт индекс, пауза или остался purpose
  const showPlayPause =
    indexing || paused || (!!counts?.purposePending && counts.purposePending > 0);
  const showReindex = status.isIndexed && !indexing;
  const iconBtnClass =
    'inline-flex items-center justify-center rounded border border-void-border-1 bg-void-bg-1 text-void-fg-1 hover:brightness-110 shrink-0';
  const iconBtnStyle = { width: 22, height: 22, ...noDrag } as CSSProperties;

  if (!hasWorkspace || !showStatusButton) {
    return null;
  }

  const statusTitle = indexing
    ? `Общий прогресс индексации: ${overallPercent}% · ${phaseLabel(status.phase)}`
    : labelForStatus(status);

  return (
    <div className={`relative flex items-center gap-1 shrink-0 ${className}`} style={noDrag}>
      <button
        type="button"
        ref={refs.setReference}
        style={noDrag}
        // фиксированная ширина — titlebar не дёргается от %
        className="text-[11px] px-1.5 py-0.5 rounded hover:bg-void-bg-2 cursor-pointer w-[188px] shrink-0 text-left"
        title={statusTitle}
        aria-expanded={open}
        aria-label={statusTitle}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {indexing || paused ? (
          <div className="flex flex-col gap-0.5 w-full min-w-0">
            <div className="flex items-center justify-between gap-1 w-full min-w-0">
              <span className="truncate text-void-fg-1">{paused ? 'Пауза' : 'Индексация'}</span>
              <span className="shrink-0 tabular-nums font-semibold text-void-fg-1">
                {overallPercent}%
              </span>
            </div>
            <div className="h-1 w-full rounded-full overflow-hidden" style={progressTrackStyle}>
              <div
                className="h-full rounded-full transition-[width] duration-150 ease-out"
                style={progressFillStyle(overallPercent)}
              />
            </div>
          </div>
        ) : (
          <span className="block truncate text-void-fg-3 hover:text-void-fg-1">
            {labelForStatus(status)}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={refs.setFloating}
          style={{ position: strategy, top: y ?? 0, left: x ?? 0 }}
          className="z-[10000] w-[340px] max-h-[420px] overflow-auto rounded-lg border border-void-border-2 bg-void-bg-1 shadow-lg p-3 text-left"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-sm font-medium text-void-fg-1 mb-2">Индекс проекта</div>
          <div className="mb-3 rounded-md border border-void-border-2 bg-void-bg-2 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-medium text-void-fg-1">Общий прогресс</span>
              <span className="text-sm tabular-nums font-semibold text-void-fg-1">
                {indexing || status.isIndexed || paused ? `${overallPercent}%` : '—'}
              </span>
            </div>
            <div className="h-2 w-full rounded-full overflow-hidden mb-1.5" style={progressTrackStyle}>
              <div
                className="h-full rounded-full transition-[width] duration-150 ease-out"
                style={progressFillStyle(
                  indexing || status.isIndexed || paused ? overallPercent : 0,
                )}
              />
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="text-[11px] text-void-fg-2 truncate min-w-0 flex-1">
                {indexing
                  ? `${phaseLabel(status.phase)}${
                      status.total > 0 ? ` · ${status.processed}/${status.total}` : ''
                    }`
                  : paused
                    ? 'На паузе'
                    : status.isIndexed
                      ? 'Готов'
                      : 'Не проиндексирован'}
              </div>
              {showPlayPause ? (
                <button
                  type="button"
                  className={iconBtnClass}
                  style={iconBtnStyle}
                  title={indexing ? 'Пауза' : 'Продолжить'}
                  aria-label={indexing ? 'Пауза' : 'Продолжить'}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (indexing) {
                      projectIndexService.pause();
                    } else {
                      void projectIndexService.resume();
                    }
                  }}
                >
                  {indexing ? (
                    <Pause size={12} strokeWidth={2.5} style={{ width: 12, height: 12 }} />
                  ) : (
                    <Play size={12} strokeWidth={2.5} style={{ width: 12, height: 12 }} />
                  )}
                </button>
              ) : null}
              {showReindex ? (
                <button
                  type="button"
                  className={iconBtnClass}
                  style={iconBtnStyle}
                  title="Переиндексировать заново"
                  aria-label="Переиндексировать заново"
                  onClick={(e) => {
                    e.stopPropagation();
                    void commandService.executeCommand(PPR_REINDEX_WORKSPACE_COMMAND_ID);
                  }}
                >
                  <RefreshCw size={12} strokeWidth={2.5} style={{ width: 12, height: 12 }} />
                </button>
              ) : null}
            </div>
            {(indexing || paused) && status.currentPath ? (
              <div className="truncate text-[11px] text-void-fg-3 mt-0.5" title={status.currentPath}>
                {status.currentPath}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-void-fg-3 mb-3">
            <span>Файлов: {counts?.files ?? 0}</span>
            <span>Символов: {counts?.symbols ?? 0}</span>
            <span>Чанков: {counts?.chunks ?? 0}</span>
            <span>Рёбер: {counts?.edges ?? 0}</span>
            <span>Purpose: {counts?.purposeDone ?? 0}</span>
            <span>Pending: {counts?.purposePending ?? 0}</span>
            <span className="col-span-2">
              Полная: {formatTime(status.manifest?.lastFullAt)}
            </span>
            <span className="col-span-2">
              Инкремент: {formatTime(status.manifest?.lastIncrementalAt)}
            </span>
          </div>

          {counts?.byKind && Object.keys(counts.byKind).length > 0 && (
            <div className="mb-3 text-[11px] text-void-fg-3">
              {Object.entries(counts.byKind).map(([k, v]) => (
                <span key={k} className="mr-2">
                  {k}: {v}
                </span>
              ))}
            </div>
          )}

          {status.errors.length > 0 && (
            <div className="mb-3 text-[11px] text-red-400">
              Ошибки: {status.errors.slice(0, 5).map((e) => e.path).join(', ')}
            </div>
          )}

          {(showIndexNow || paused) && (
            <div className="flex flex-col gap-1.5">
              {showIndexNow && (
                <button
                  type="button"
                  className="text-xs bg-void-bg-2 text-void-fg-1 rounded px-2 py-1.5 text-left font-medium"
                  onClick={() => {
                    void projectIndexService.reindexFull();
                  }}
                >
                  Проиндексировать сейчас
                </button>
              )}

              {paused && (
                <button
                  type="button"
                  className="text-xs bg-void-bg-2 text-void-fg-1 rounded px-2 py-1.5 text-left font-medium"
                  onClick={() => {
                    void projectIndexService.resume();
                  }}
                >
                  Продолжить индексацию
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

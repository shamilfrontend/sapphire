/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Circle,
  File,
  Folder,
  Minus,
  Pencil,
  Plus,
  Text,
  Trash2,
  X,
} from 'lucide-react';
import { isMacintosh } from '../../../../../../../base/common/platform.js';
import {
  useAccessor,
  useActiveURI,
  useChatThreadMessageQueue,
  useChatThreadsState,
  useSettingsState,
} from '../util/services.js';
import {
  ChatImageAttachment,
  StagingSelectionItem,
} from '../../../../common/chatThreadServiceTypes.js';
import {
  isAttachableActiveFileUri,
  uriAlreadyInSelections,
} from '../../../../common/activeFileAttach.js';
import { chatImageToDataUrl } from '../../../../common/chatImageUtils.js';
import { getBasename, uniquePathLabels } from '../../../../common/pathLabels.js';
import { getRelative, sapphireOpenFileFn } from './chatFileUtils.js';
import { IconX } from './chatIcons.js';

const AUTO_ACTIVE_FILE_TOOLTIP =
  'Содержимое активного файла уйдёт в контекст сообщения. Нажмите ×, чтобы не прикреплять в этот раз.';

const HEURISTIC_FILE_TOOLTIP =
  'Файл найден автоматически по тексту запроса и добавлен в контекст. Нажмите ×, чтобы не прикреплять его в следующий раз.';

export const ImageLightbox = ({
  image,
  onClose,
}: {
  image: ChatImageAttachment;
  onClose: () => void;
}) => {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const mouseDownInsideModal = useRef(false);

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [image.id]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(5, z + 0.25));
      if (e.key === '-') setZoom((z) => Math.max(1, z - 0.25));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const clampZoom = (z: number) => Math.min(5, Math.max(1, z));

  // Закрытие по клику на затемнение: mousedown/up снаружи модалки, не внутри.
  return (
    <div
      className="fixed inset-0 bg-black/70 flex flex-col items-center justify-center z-[9999999]"
      onMouseDown={() => {
        mouseDownInsideModal.current = false;
      }}
      onMouseUp={() => {
        if (!mouseDownInsideModal.current) onClose();
        mouseDownInsideModal.current = false;
      }}
    >
      <div
        className="relative flex flex-col items-center gap-3 max-w-[95vw] max-h-[95vh]"
        onMouseDown={(e) => {
          e.stopPropagation();
          mouseDownInsideModal.current = true;
        }}
        onMouseUp={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 self-end">
          <button
            type="button"
            className="rounded-full size-8 flex items-center justify-center bg-black/50 text-white hover:bg-black/70 cursor-pointer"
            title="Уменьшить"
            onClick={() => setZoom((z) => clampZoom(z - 0.25))}
          >
            <Minus size={16} />
          </button>
          <span className="text-white text-xs tabular-nums w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="rounded-full size-8 flex items-center justify-center bg-black/50 text-white hover:bg-black/70 cursor-pointer"
            title="Увеличить"
            onClick={() => setZoom((z) => clampZoom(z + 0.25))}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="rounded-full size-8 flex items-center justify-center bg-black/50 text-white hover:bg-black/70 cursor-pointer"
            title="Закрыть"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div
          className="overflow-hidden max-w-[90vw] max-h-[80vh] flex items-center justify-center"
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.15 : 0.15;
            setZoom((z) => {
              const next = clampZoom(z + delta);
              if (next <= 1) setOffset({ x: 0, y: 0 });
              return next;
            });
          }}
        >
          <img
            src={chatImageToDataUrl(image)}
            alt=""
            draggable={false}
            className="max-w-[90vw] max-h-[80vh] object-contain select-none"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              cursor: zoom > 1 ? 'grab' : 'default',
              transition: draggingRef.current ? 'none' : 'transform 0.05s ease-out',
            }}
            onMouseDown={(e) => {
              if (zoom <= 1) return;
              e.preventDefault();
              draggingRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                origX: offset.x,
                origY: offset.y,
              };
              const onMove = (ev: MouseEvent) => {
                if (!draggingRef.current) return;
                setOffset({
                  x: draggingRef.current.origX + (ev.clientX - draggingRef.current.startX),
                  y: draggingRef.current.origY + (ev.clientY - draggingRef.current.startY),
                });
              };
              const onUp = () => {
                draggingRef.current = null;
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          />
        </div>
      </div>
    </div>
  );
};

export const SelectedImages = ({
  type,
  images,
  setImages,
}:
  | {
      type: 'past';
      images: ChatImageAttachment[];
      setImages?: undefined;
    }
  | {
      type: 'staging';
      images: ChatImageAttachment[];
      setImages: (imgs: ChatImageAttachment[]) => void;
    }) => {
  const [lightboxImage, setLightboxImage] = useState<ChatImageAttachment | null>(null);

  if (!images.length) return null;

  return (
    <>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {images.map((img) => (
          <div
            key={img.id}
            className="relative group rounded-md overflow-hidden border border-void-border-3 bg-void-bg-2 cursor-pointer"
            onClick={() => setLightboxImage(img)}
          >
            <img
              src={chatImageToDataUrl(img)}
              alt=""
              className="block h-14 w-auto max-w-[120px] object-cover"
            />
            {type === 'staging' && setImages && (
              <button
                type="button"
                className="absolute top-0.5 right-0.5 rounded-full bg-black/60 text-white p-0.5 opacity-80 hover:opacity-100 cursor-pointer"
                title="Убрать"
                onClick={(e) => {
                  e.stopPropagation();
                  setImages(images.filter((x) => x.id !== img.id));
                }}
              >
                <IconX className="stroke-[2]" size={10} />
              </button>
            )}
          </div>
        ))}
      </div>
      {lightboxImage && (
        <ImageLightbox image={lightboxImage} onClose={() => setLightboxImage(null)} />
      )}
    </>
  );
};

export const QueuedMessagesPanel = ({
  threadId,
  onEditQueued,
}: {
  threadId: string;
  onEditQueued: (item: {
    text: string;
    images?: ChatImageAttachment[];
    selections?: StagingSelectionItem[];
  }) => void;
}) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');
  const queue = useChatThreadMessageQueue(threadId);
  const [expanded, setExpanded] = useState(true);
  const [lightboxImage, setLightboxImage] = useState<ChatImageAttachment | null>(null);
  const steerShortcut = isMacintosh ? '⌘↵' : 'Ctrl+↵';

  if (!queue.length) return null;

  const title = queue.length === 1 ? '1 в очереди' : `${queue.length} в очереди`;

  return (
    <div className="mb-2 rounded-xl border border-void-border-3 bg-void-bg-1 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-void-fg-3 hover:text-void-fg-1 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{title}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {queue.map((item) => (
            <div
              key={item.id}
              className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-void-bg-2"
            >
              <Circle size={12} className="mt-1 shrink-0 text-void-fg-3" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-void-fg-1 truncate">
                  {item.text.trim() || (item.images?.length ? 'Изображение' : '(пусто)')}
                </div>
                {item.images && item.images.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {item.images.map((img) => (
                      <button
                        key={img.id}
                        type="button"
                        className="rounded overflow-hidden border border-void-border-3 cursor-pointer"
                        onClick={() => setLightboxImage(img)}
                      >
                        <img
                          src={chatImageToDataUrl(img)}
                          alt=""
                          className="h-8 w-auto max-w-[64px] object-cover block"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  className="text-[11px] px-1.5 py-0.5 rounded text-void-fg-2 hover:text-void-fg-1 hover:bg-void-bg-2-alt cursor-pointer"
                  title={`Отправить сейчас (${steerShortcut})`}
                  onClick={() => void chatThreadsService.steerQueuedMessage(threadId, item.id)}
                >
                  Отправить сейчас <span className="opacity-60">{steerShortcut}</span>
                </button>
                <button
                  type="button"
                  className="p-1 rounded text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2-alt cursor-pointer"
                  title="Редактировать"
                  onClick={() => {
                    const removed = chatThreadsService.removeQueuedMessage(threadId, item.id);
                    if (!removed) return;
                    onEditQueued({
                      text: removed.text,
                      images: removed.images,
                      selections: removed.selections,
                    });
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className="p-1 rounded text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2-alt cursor-pointer"
                  title="Удалить"
                  onClick={() => chatThreadsService.removeQueuedMessage(threadId, item.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {lightboxImage && (
        <ImageLightbox image={lightboxImage} onClose={() => setLightboxImage(null)} />
      )}
    </div>
  );
};

export const SelectedFiles = ({
  type,
  selections,
  messageIdx,
}:
  | {
      type: 'past';
      selections: StagingSelectionItem[];
      messageIdx: number;
    }
  | {
      type: 'staging';
      selections: StagingSelectionItem[];
      messageIdx?: number;
    }) => {
  const accessor = useAccessor();
  const modelReferenceService = accessor.get('ISapphireModelService');
  const chatThreadService = accessor.get('IChatThreadService');
  const settingsState = useSettingsState();
  // перерисовка при omit и смене состояния треда
  useChatThreadsState();
  const omitAutoActiveFsPath = chatThreadService.getOmitAutoActiveFileFsPath();

  const { uri: currentURI } = useActiveURI();

  // сбрасываем omit при смене активного файла
  useEffect(() => {
    if (type !== 'staging') return;
    if (omitAutoActiveFsPath && currentURI && omitAutoActiveFsPath !== currentURI.fsPath) {
      chatThreadService.clearOmitAutoActiveFile();
    }
    if (omitAutoActiveFsPath && !currentURI) {
      chatThreadService.clearOmitAutoActiveFile();
    }
  }, [currentURI, type, chatThreadService, omitAutoActiveFsPath]);

  const [autoActiveSelection, setAutoActiveSelection] = useState<StagingSelectionItem | null>(null);

  const autoAttachEnabled = settingsState.globalSettings.autoAttachActiveFile !== false;

  // Виртуальная «Активный» метка: файл редактора, если autoAttach и не в omit/heuristics.
  useEffect(() => {
    let cancelled = false;
    const computeAuto = async () => {
      if (type !== 'staging' || !autoAttachEnabled || !isAttachableActiveFileUri(currentURI)) {
        if (!cancelled) setAutoActiveSelection(null);
        return;
      }
      if (uriAlreadyInSelections(selections, currentURI.fsPath)) {
        if (!cancelled) setAutoActiveSelection(null);
        return;
      }
      if (omitAutoActiveFsPath === currentURI.fsPath) {
        if (!cancelled) setAutoActiveSelection(null);
        return;
      }
      const language =
        (await modelReferenceService.getModelSafe(currentURI)).model?.getLanguageId() ||
        'plaintext';
      if (!cancelled) {
        setAutoActiveSelection({ type: 'File', uri: currentURI, language });
      }
    };
    void computeAuto();
    return () => {
      cancelled = true;
    };
  }, [
    type,
    autoAttachEnabled,
    currentURI,
    selections,
    modelReferenceService,
    omitAutoActiveFsPath,
  ]);

  const autoList = autoActiveSelection ? [autoActiveSelection] : [];
  const allSelections = [...selections, ...autoList];
  const selectionPathLabels = uniquePathLabels(
    allSelections.map((s) => getRelative(s.uri, accessor) ?? s.uri.fsPath),
  );

  if (allSelections.length === 0) {
    return null;
  }

  const autoStart = selections.length;
  const autoEnd = autoStart + autoList.length;

  return (
    <div className="flex items-center flex-wrap text-left relative gap-x-0.5 gap-y-1 pb-0.5">
      {allSelections.map((selection, i) => {
        const isThisSelectionAutoActive = i >= autoStart && i < autoEnd;
        const isThisSelectionHeuristic =
          !isThisSelectionAutoActive && selection.type === 'File' && !!selection.fromHeuristic;

        const thisKey =
          selection.type === 'CodeSelection'
            ? selection.type + selection.language + selection.range + selection.uri.fsPath
            : selection.type === 'File'
              ? (isThisSelectionAutoActive ? 'auto-' : isThisSelectionHeuristic ? 'heur-' : '') +
                selection.type +
                selection.language +
                selection.uri.fsPath
              : selection.type === 'Folder'
                ? selection.type + selection.uri.fsPath
                : i;

        const SelectionIcon =
          selection.type === 'File'
            ? File
            : selection.type === 'Folder'
              ? Folder
              : selection.type === 'CodeSelection'
                ? Text
                : (undefined as never);

        const tooltipContent = isThisSelectionAutoActive
          ? AUTO_ACTIVE_FILE_TOOLTIP
          : isThisSelectionHeuristic
            ? HEURISTIC_FILE_TOOLTIP
            : getRelative(selection.uri, accessor);

        return (
          <div key={thisKey} className="flex flex-col space-y-[1px]">
            <span
              className="truncate overflow-hidden text-ellipsis"
              data-tooltip-id="sapphire-tooltip"
              data-tooltip-content={tooltipContent}
              data-tooltip-place="top"
              data-tooltip-delay-show={
                isThisSelectionAutoActive || isThisSelectionHeuristic ? 0 : 3000
              }
              {...(isThisSelectionAutoActive || isThisSelectionHeuristic
                ? { 'data-tooltip-class-name': 'sapphire-max-w-[300px]' }
                : {})}
            >
              <div
                className={`
								flex items-center gap-1 relative
								px-1
								w-fit h-fit
								select-none
								text-xs text-nowrap
								border rounded-sm
								${
                  isThisSelectionAutoActive || isThisSelectionHeuristic
                    ? 'bg-void-bg-1 text-void-fg-2 border-void-border-2'
                    : 'bg-void-bg-1 hover:brightness-95 text-void-fg-1 border-void-border-1'
                }
								hover:border-void-border-1
								transition-all duration-150
							`}
                onClick={() => {
                  if (type !== 'staging') return;
                  if (selection.type === 'File') {
                    sapphireOpenFileFn(selection.uri, accessor);
                  } else if (selection.type === 'CodeSelection') {
                    sapphireOpenFileFn(selection.uri, accessor, selection.range);
                  } else if (selection.type === 'Folder') {
                    accessor
                      .get('ICommandService')
                      .executeCommand('revealInExplorer', selection.uri);
                  }
                }}
              >
                <SelectionIcon size={10} />

                {(selectionPathLabels[i] || getBasename(selection.uri.fsPath)) +
                  (selection.type === 'CodeSelection'
                    ? ` (${selection.range[0]}-${selection.range[1]})`
                    : '')}

                {isThisSelectionAutoActive ? (
                  <span className="text-[10px] text-void-fg-3 opacity-90">Активный</span>
                ) : isThisSelectionHeuristic ? (
                  <span className="text-[10px] text-void-fg-3 opacity-90">Найдено</span>
                ) : null}

                {type === 'staging' || (type === 'past' && isThisSelectionHeuristic) ? (
                  <div
                    className="cursor-pointer z-1 self-stretch flex items-center justify-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isThisSelectionAutoActive) {
                        setAutoActiveSelection(null);
                        chatThreadService.omitAutoActiveFileForNextSend(selection.uri.fsPath);
                        return;
                      }
                      if (isThisSelectionHeuristic) {
                        chatThreadService.omitHeuristicFileForNextSend(selection.uri.fsPath);
                        if (type === 'staging') {
                          // убираем из staging (индекс в selections)
                          chatThreadService.removeStagingSelectionAt(i, messageIdx);
                        }
                        return;
                      }
                      if (type === 'staging') {
                        chatThreadService.removeStagingSelectionAt(i, messageIdx);
                      }
                    }}
                  >
                    <IconX className="stroke-[2]" size={10} />
                  </div>
                ) : null}
              </div>
            </span>
          </div>
        );
      })}
    </div>
  );
};

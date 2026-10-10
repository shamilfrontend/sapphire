/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { Check, Copy, LoaderCircle, MessageCircleQuestion, Trash2, X } from 'lucide-react';
import { IconShell1 } from '../markdown/ApplyBlockHoverButtons.js';
import {
  useAccessor,
  useChatThreadsState,
  useFullChatThreadsStreamState,
} from '../util/services.js';
import { IsRunningType, ThreadType } from '../../../chatThreadService.js';

const numInitialThreads = 3;

export const PastThreadsList = ({
  className = '',
  onThreadClick,
  filterText = '',
  showAllByDefault = false,
  highlightCurrent = false,
}: {
  className?: string;
  onThreadClick?: () => void;
  /** Фильтр: без учёта регистра по первому user-сообщению. */
  filterText?: string;
  showAllByDefault?: boolean;
  highlightCurrent?: boolean;
}) => {
  const [showAll, setShowAll] = useState(showAllByDefault);

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const threadsState = useChatThreadsState();
  const { allThreads } = threadsState;

  const streamState = useFullChatThreadsStreamState();

  const runningThreadIds: { [threadId: string]: IsRunningType | undefined } = {};
  for (const threadId in streamState) {
    const isRunning = streamState[threadId]?.isRunning;
    if (isRunning) {
      runningThreadIds[threadId] = isRunning;
    }
  }

  if (!allThreads) {
    return (
      <div key="error" className="p-1">
        Ошибка доступа к истории чатов.
      </div>
    );
  }

  const query = filterText.trim().toLowerCase();

  // сначала недавно изменённые треды
  const sortedThreadIds = Object.keys(allThreads ?? {})
    .sort((threadId1, threadId2) =>
      (allThreads[threadId1]?.lastModified ?? 0) > (allThreads[threadId2]?.lastModified ?? 0)
        ? -1
        : 1,
    )
    .filter((threadId) => (allThreads![threadId]?.messages.length ?? 0) !== 0)
    .filter((threadId) => {
      if (!query) return true;
      const thread = allThreads![threadId];
      const firstUser = thread?.messages.find((msg) => msg.role === 'user');
      const text = firstUser && firstUser.role === 'user' ? (firstUser.displayContent ?? '') : '';
      return text.toLowerCase().includes(query);
    });

  // по умолчанию показываем только первые N тредов
  const hasMoreThreads = sortedThreadIds.length > numInitialThreads;
  const displayThreads = showAll ? sortedThreadIds : sortedThreadIds.slice(0, numInitialThreads);

  return (
    <div
      className={`flex flex-col mb-2 gap-2 w-full text-nowrap text-void-fg-3 select-none relative ${className}`}
    >
      {displayThreads.length === 0 ? (
        <div className="p-1 text-xs opacity-70">
          {query ? 'Ничего не найдено' : 'Нет сохранённых чатов'}
        </div>
      ) : (
        displayThreads.map((threadId, i) => {
          const pastThread = allThreads[threadId];
          if (!pastThread) {
            return (
              <div key={i} className="p-1">
                Ошибка доступа к истории чатов.
              </div>
            );
          }

          return (
            <PastThreadElement
              key={pastThread.id}
              pastThread={pastThread}
              idx={i}
              hoveredIdx={hoveredIdx}
              setHoveredIdx={setHoveredIdx}
              isRunning={runningThreadIds[pastThread.id]}
              isCurrent={highlightCurrent && pastThread.id === threadsState.currentThreadId}
              onThreadClick={onThreadClick}
            />
          );
        })
      )}

      {hasMoreThreads && !showAll && (
        <div
          className="text-void-fg-3 opacity-80 hover:opacity-100 hover:brightness-115 cursor-pointer p-1 text-xs"
          onClick={() => setShowAll(true)}
        >
          Показать ещё {sortedThreadIds.length - numInitialThreads}...
        </div>
      )}
      {hasMoreThreads && showAll && (
        <div
          className="text-void-fg-3 opacity-80 hover:opacity-100 hover:brightness-115 cursor-pointer p-1 text-xs"
          onClick={() => setShowAll(false)}
        >
          Свернуть
        </div>
      )}
    </div>
  );
};

// «Сегодня» / «Вчера» или дата
const formatDate = (date: Date) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date >= today) {
    return 'Сегодня';
  }
  if (date >= yesterday) {
    return 'Вчера';
  }
  return `${date.toLocaleString('ru-RU', { month: 'short' })} ${date.getDate()}`;
};

const DuplicateButton = ({ threadId }: { threadId: string }) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');
  return (
    <IconShell1
      Icon={Copy}
      className="size-[11px]"
      onClick={() => {
        chatThreadsService.duplicateThread(threadId);
      }}
      data-tooltip-id="sapphire-tooltip"
      data-tooltip-place="top"
      data-tooltip-content="Дублировать чат"
    />
  );
};

const TrashButton = ({ threadId }: { threadId: string }) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');

  const [isTrashPressed, setIsTrashPressed] = useState(false);

  return isTrashPressed ? (
    <div className="flex flex-nowrap text-nowrap gap-1">
      <IconShell1
        Icon={X}
        className="size-[11px]"
        onClick={() => {
          setIsTrashPressed(false);
        }}
        data-tooltip-id="sapphire-tooltip"
        data-tooltip-place="top"
        data-tooltip-content="Отмена"
      />
      <IconShell1
        Icon={Check}
        className="size-[11px]"
        onClick={() => {
          chatThreadsService.deleteThread(threadId);
          setIsTrashPressed(false);
        }}
        data-tooltip-id="sapphire-tooltip"
        data-tooltip-place="top"
        data-tooltip-content="Подтвердить"
      />
    </div>
  ) : (
    <IconShell1
      Icon={Trash2}
      className="size-[11px]"
      onClick={() => {
        setIsTrashPressed(true);
      }}
      data-tooltip-id="sapphire-tooltip"
      data-tooltip-place="top"
      data-tooltip-content="Удалить чат"
    />
  );
};

const PastThreadElement = ({
  pastThread,
  idx,
  hoveredIdx,
  setHoveredIdx,
  isRunning,
  isCurrent = false,
  onThreadClick,
}: {
  pastThread: ThreadType;
  idx: number;
  hoveredIdx: number | null;
  setHoveredIdx: (idx: number | null) => void;
  isRunning: IsRunningType | undefined;
  isCurrent?: boolean;
  onThreadClick?: () => void;
}) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');

  let firstMsg = null;
  const firstUserMsgIdx = pastThread.messages.findIndex((msg) => msg.role === 'user');

  if (firstUserMsgIdx !== -1) {
    const firsUsertMsgObj = pastThread.messages[firstUserMsgIdx];
    firstMsg = (firsUsertMsgObj.role === 'user' && firsUsertMsgObj.displayContent) || '';
  } else {
    firstMsg = '""';
  }

  const numMessages = pastThread.messages.filter(
    (msg) => msg.role === 'assistant' || msg.role === 'user',
  ).length;

  const detailsHTML = (
    <span
    // data-tooltip-id='sapphire-tooltip'
    // data-tooltip-content={`Изменён ${formatTime(new Date(pastThread.lastModified))}`}
    // data-tooltip-place='top'
    >
      <span className="opacity-60">{numMessages}</span>
      {` `}
      {formatDate(new Date(pastThread.lastModified))}
      {/* число сообщений */}
    </span>
  );

  return (
    <div
      key={pastThread.id}
      className={`
			py-1 px-2 rounded text-sm cursor-pointer
			${
        isCurrent
          ? 'bg-void-bg-2-alt opacity-100'
          : 'bg-void-bg-2-hover hover:bg-void-bg-2-alt opacity-80 hover:opacity-100'
      }
		`}
      onClick={() => {
        chatThreadsService.openTab(pastThread.id);
        onThreadClick?.();
      }}
      onMouseEnter={() => setHoveredIdx(idx)}
      onMouseLeave={() => setHoveredIdx(null)}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-2 min-w-0 overflow-hidden">
          {/* Спиннер: preparing / LLM / tool / idle с interrupt */}
          {isRunning === 'LLM' ||
          isRunning === 'tool' ||
          isRunning === 'preparing' ||
          (isRunning === 'idle' &&
            chatThreadsService.streamState[pastThread.id]?.interrupt !== 'not_needed') ? (
            <LoaderCircle
              className="animate-spin bg-void-stroke-1 flex-shrink-0 flex-grow-0"
              size={14}
            />
          ) : isRunning === 'awaiting_user' ? (
            <MessageCircleQuestion
              className="bg-void-stroke-1 flex-shrink-0 flex-grow-0"
              size={14}
            />
          ) : null}
          {/* Превью первого сообщения */}
          <span
            className="truncate overflow-hidden text-ellipsis"
            data-tooltip-id="sapphire-tooltip"
            data-tooltip-content={`${numMessages} сообщ.`}
            data-tooltip-place="top"
          >
            {firstMsg}
          </span>

          {/* <span className='opacity-60'>{`(${numMessages})`}</span> */}
        </span>

        <div className="flex items-center gap-x-1 opacity-60">
          {idx === hoveredIdx ? (
            <>
              {/* Дублировать */}
              <DuplicateButton threadId={pastThread.id} />

              {/* Действия при hover */}
              <TrashButton threadId={pastThread.id} />
            </>
          ) : (
            <>{detailsHTML}</>
          )}
        </div>
      </div>
    </div>
  );
};

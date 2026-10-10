/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import {
  History,
  LoaderCircle,
  MessageCircle,
  MessageCircleQuestion,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import {
  useAccessor,
  useChatThreadsState,
  useFullChatThreadsStreamState,
} from '../util/services.js';
import { threadActivity, threadTitle } from '../util/threadDisplay.js';
import { PastThreadsList } from './SidebarThreadSelector.js';
import { AgentsThreadTree } from '../agents-window-tsx/AgentsThreadTree.js';

const AgentsHistoryTree = ({ onThreadOpen }: { onThreadOpen: () => void }) => {
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  return (
    <AgentsThreadTree
      filterText=""
      editingFolderId={editingFolderId}
      onEditingFolderIdChange={setEditingFolderId}
      onThreadOpen={onThreadOpen}
    />
  );
};

export const SidebarChatTabs = ({
  variant = 'sidebar',
  showHistoryButton,
  settingsTab,
  onActivateSettings,
  onCloseSettings,
  onSelectThread,
}: {
  variant?: 'sidebar' | 'agents';
  /** Если не задано: история в сайдбаре IDE, в режиме Агент скрыта. */
  showHistoryButton?: boolean;
  settingsTab?: { open: boolean; active: boolean };
  onActivateSettings?: () => void;
  onCloseSettings?: () => void;
  onSelectThread?: () => void;
}) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');
  const threadsState = useChatThreadsState();
  const streamState = useFullChatThreadsStreamState();

  const { openThreadIds = [], currentThreadId, allThreads } = threadsState;
  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const historyVisible = showHistoryButton ?? variant !== 'agents';
  const settingsActive = !!settingsTab?.active;

  useEffect(() => {
    const id = settingsActive ? '__settings' : currentThreadId;
    tabRefs.current[id]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [currentThreadId, settingsActive, openThreadIds, settingsTab?.open]);

  useEffect(() => {
    if (!historyVisible) setShowHistory(false);
  }, [historyVisible]);

  useEffect(() => {
    const disposable = chatThreadsService.onDidRequestShowHistory(() => {
      setShowHistory(true);
    });
    return () => disposable.dispose();
  }, [chatThreadsService]);

  useEffect(() => {
    if (!showHistory) return;
    const onMouseDown = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowHistory(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showHistory]);

  return (
    <div
      className={`relative flex items-stretch gap-1 w-full h-8 px-1.5 select-none ${
        variant === 'agents' ? 'bg-[var(--void-header-bg)]' : 'bg-void-bg-2'
      }`}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-px bg-void-border-4" />
      <div className="relative z-10 flex items-stretch gap-0.5 min-w-0 flex-1 overflow-x-auto">
        {openThreadIds.map((threadId) => {
          const thread = allThreads[threadId];
          const isActive = threadId === currentThreadId && !settingsActive;
          const activity = threadActivity(streamState[threadId]);
          const title = threadTitle(thread);

          return (
            <div
              key={threadId}
              ref={(node) => {
                tabRefs.current[threadId] = node;
              }}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
              className={`
								group flex items-center gap-1.5 max-w-[160px] h-full pl-2 pr-1 border-b-2 text-xs shrink-0 cursor-pointer
								transition-colors
								${isActive ? 'border-void-ring-color text-void-fg-0 font-medium' : 'border-transparent text-void-fg-3 hover:bg-void-bg-2-hover hover:text-void-fg-2'}
								${isActive && variant === 'agents' ? 'bg-[var(--void-content-bg)]' : ''}
								${isActive && variant !== 'agents' ? 'bg-void-bg-1' : ''}
							`}
              onMouseDown={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                chatThreadsService.closeTab(threadId);
              }}
              onClick={() => {
                onSelectThread?.();
                chatThreadsService.switchToThread(threadId);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectThread?.();
                  chatThreadsService.switchToThread(threadId);
                }
              }}
              title={title}
            >
              {activity === 'running' ? (
                <LoaderCircle className="animate-spin size-3.5 shrink-0" />
              ) : activity === 'awaiting' ? (
                <MessageCircleQuestion className="size-3.5 shrink-0" />
              ) : (
                <MessageCircle className="size-3.5 shrink-0 opacity-70" />
              )}
              <span className="truncate">{title}</span>
              <button
                type="button"
                className={`
									flex items-center justify-center size-4 rounded shrink-0
									hover:bg-void-bg-2-alt
									${isActive ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'}
								`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  chatThreadsService.closeTab(threadId);
                }}
                title="Закрыть вкладку"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
        {settingsTab?.open && (
          <div
            ref={(node) => {
              tabRefs.current.__settings = node;
            }}
            role="tab"
            tabIndex={0}
            aria-selected={settingsActive}
            className={`
							group flex items-center gap-1.5 max-w-[160px] h-full pl-2 pr-1 border-b-2 text-xs shrink-0 cursor-pointer
							transition-colors
							${settingsActive ? 'border-void-ring-color text-void-fg-0 font-medium' : 'border-transparent text-void-fg-3 hover:bg-void-bg-2-hover hover:text-void-fg-2'}
							${settingsActive && variant === 'agents' ? 'bg-[var(--void-content-bg)]' : ''}
							${settingsActive && variant !== 'agents' ? 'bg-void-bg-1' : ''}
						`}
            onMouseDown={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              onCloseSettings?.();
            }}
            onClick={() => onActivateSettings?.()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivateSettings?.();
              }
            }}
            title="Настройки"
          >
            <Settings
              className={`size-3.5 shrink-0 ${settingsActive ? 'opacity-100' : 'opacity-70'}`}
            />
            <span className="truncate">Настройки</span>
            <button
              type="button"
              className={`
								flex items-center justify-center size-4 rounded shrink-0
								hover:bg-void-bg-2-alt
								${settingsActive ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'}
							`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onCloseSettings?.();
              }}
              title="Закрыть вкладку"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>

      <div className="relative z-10 flex items-center gap-0.5 shrink-0 pr-0.5">
        <button
          type="button"
          className="flex items-center justify-center size-7 rounded text-void-fg-4 hover:bg-void-bg-2-hover hover:text-void-fg-2"
          onClick={() => {
            onSelectThread?.();
            chatThreadsService.openNewThread();
          }}
          title="Новый чат"
          data-tooltip-id="sapphire-tooltip"
          data-tooltip-content="Новый чат"
        >
          <Plus className="size-4 stroke-[1.5]" />
        </button>
        {historyVisible && (
          <button
            type="button"
            className={`
							flex items-center justify-center size-7 rounded text-void-fg-4
							hover:bg-void-bg-2-hover hover:text-void-fg-2
							${showHistory ? 'bg-void-bg-1/60 text-void-fg-1' : ''}
						`}
            onClick={() => setShowHistory((v) => !v)}
            title="История чатов"
            data-tooltip-id="sapphire-tooltip"
            data-tooltip-content="История чатов"
          >
            <History className="size-4 stroke-[1.5]" />
          </button>
        )}
      </div>

      {showHistory && historyVisible && (
        <div
          ref={historyRef}
          className="absolute right-1 top-full z-50 mt-1 w-[min(100%-8px,320px)] max-h-[50vh] overflow-y-auto rounded-lg border border-void-border-2 bg-void-bg-1 shadow-lg p-2"
        >
          {variant === 'agents' ? (
            <AgentsHistoryTree
              onThreadOpen={() => {
                setShowHistory(false);
                onSelectThread?.();
              }}
            />
          ) : (
            <>
              <div className="text-xs text-void-fg-3 px-1 pb-2">История чатов</div>
              <PastThreadsList
                onThreadClick={() => {
                  setShowHistory(false);
                  onSelectThread?.();
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};

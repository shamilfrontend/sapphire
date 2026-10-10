/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import '../styles.css';
import type { ReactNode } from 'react';
import { Hammer } from 'lucide-react';
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js';
import { ProseWrapper } from '../sidebar-tsx/ChatProse.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';
import {
  useAccessor,
  useChatThreadsState,
  useChatThreadsStreamState,
  useIsDark,
} from '../util/services.js';
import { PlanTodoItem } from '../../../../common/toolsServiceTypes.js';
import type { ChatThreads } from '../../../../browser/chatThreadTypes.js';

export type PlanEditorMode = 'preview' | 'markdown';

const TodoMark = ({ status }: { status: PlanTodoItem['status'] }) => {
  const checked = status === 'completed' || status === 'cancelled';
  return (
    <span
      className={`mt-[3px] shrink-0 w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center text-[9px] leading-none ${
        checked
          ? 'border-void-fg-3 bg-void-bg-3 text-void-fg-1'
          : status === 'in_progress'
            ? 'border-void-fg-2 bg-void-bg-2 text-void-fg-2'
            : 'border-void-fg-3 bg-transparent'
      }`}
      aria-hidden
    >
      {status === 'completed'
        ? '✓'
        : status === 'cancelled'
          ? '×'
          : status === 'in_progress'
            ? '●'
            : ''}
    </span>
  );
};

const PlanTodoList = ({ todos }: { todos: PlanTodoItem[] }) => {
  if (!todos.length) {
    return null;
  }
  return (
    <div className="my-4">
      <div className="text-[13px] font-bold text-void-fg-1 mb-2">Todos</div>
      <ul className="flex flex-col gap-1.5 m-0 p-0 list-none">
        {todos.map((t) => (
          <li key={t.id} className="flex items-start gap-2 text-[13px] leading-snug">
            <TodoMark status={t.status} />
            <span
              className={
                t.status === 'cancelled'
                  ? 'line-through text-void-fg-3'
                  : t.status === 'completed'
                    ? 'text-void-fg-2'
                    : 'text-void-fg-1'
              }
            >
              {t.content}
              {t.status === 'in_progress' ? (
                <span className="text-void-fg-3"> · в работе</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Тред, к которому привязан planUri (текущий или любой с тем же activePlan). */
const findPlanThreadId = (
  allThreads: ChatThreads,
  currentThreadId: string,
  planUriFsPath: string,
): string | undefined => {
  if (!planUriFsPath) return undefined;
  const current = allThreads[currentThreadId];
  if (current?.state.activePlan?.planUriFsPath === planUriFsPath) return currentThreadId;
  for (const id of Object.keys(allThreads)) {
    if (allThreads[id]?.state.activePlan?.planUriFsPath === planUriFsPath) return id;
  }
  return undefined;
};

export const PlanEditorChrome = ({
  mode,
  name,
  overview,
  plan,
  todos,
  planUriFsPath,
  onModeChange,
  markdownBody,
}: {
  mode: PlanEditorMode;
  name: string;
  overview: string;
  plan: string;
  todos: PlanTodoItem[];
  planUriFsPath: string;
  onModeChange: (mode: PlanEditorMode) => void;
  /** Режим Markdown, когда под chrome нет редактора Monaco. */
  markdownBody?: ReactNode;
}) => {
  const isDark = useIsDark();
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');
  const chatThreadsState = useChatThreadsState();
  const planThreadId = findPlanThreadId(
    chatThreadsState.allThreads,
    chatThreadsState.currentThreadId,
    planUriFsPath,
  );
  const streamState = useChatThreadsStreamState(planThreadId ?? '');
  const planStatus = planThreadId
    ? chatThreadsState.allThreads[planThreadId]?.state.activePlan?.status
    : undefined;
  const progressLabel = planThreadId
    ? chatThreadsState.allThreads[planThreadId]?.state.activePlan?.progressLabel
    : undefined;
  const isRunning = !!streamState?.isRunning;
  const canBuild =
    !!planThreadId &&
    (planStatus === 'ready' ||
      planStatus === 'built' ||
      (planStatus === 'building' && !isRunning)) &&
    !isRunning;
  const buildLabel =
    planStatus === 'building' && isRunning
      ? 'Выполняется…'
      : planStatus === 'building' && !isRunning
        ? 'Продолжить'
        : planStatus === 'built'
          ? 'Выполнить снова'
          : 'Сделать по плану';

  const onBuild = () => {
    if (!planThreadId || !canBuild) return;
    if (planThreadId !== chatThreadsState.currentThreadId) {
      chatThreadsService.switchToThread(planThreadId);
    }
    void chatThreadsService.buildActivePlan(planThreadId);
  };

  return (
    <div
      className={`@@void-scope ${isDark ? 'dark' : ''}`}
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <div
        className="flex items-center gap-1 shrink-0 px-3 border-b border-void-border-1 bg-void-bg-2"
        style={{ height: 36, pointerEvents: 'auto' }}
      >
        <span className="text-[11px] text-void-fg-3 mr-1">Вид</span>
        <div className="inline-flex rounded-sm border border-void-border-2 overflow-hidden">
          <button
            type="button"
            onClick={() => onModeChange('preview')}
            className={`px-2 py-0.5 text-[12px] ${
              mode === 'preview'
                ? 'bg-void-bg-1 text-void-fg-1'
                : 'bg-void-bg-3 text-void-fg-3 hover:text-void-fg-1'
            }`}
          >
            Просмотр
          </button>
          <button
            type="button"
            onClick={() => onModeChange('markdown')}
            className={`px-2 py-0.5 text-[12px] border-l border-void-border-2 ${
              mode === 'markdown'
                ? 'bg-void-bg-1 text-void-fg-1'
                : 'bg-void-bg-3 text-void-fg-3 hover:text-void-fg-1'
            }`}
          >
            Markdown
          </button>
        </div>
        <button
          type="button"
          disabled={!canBuild}
          onClick={onBuild}
          className={`ml-auto inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-sm text-[12px] font-medium ${
            canBuild
              ? 'bg-void-success text-white hover:opacity-90'
              : 'opacity-50 cursor-not-allowed bg-void-bg-3 text-void-fg-3'
          }`}
        >
          <Hammer className="w-3.5 h-3.5" />
          {buildLabel}
        </button>
        {progressLabel && planStatus === 'building' ? (
          <span className="ml-2 text-[11px] text-void-fg-3 truncate max-w-[220px]" title={progressLabel}>
            {progressLabel}
          </span>
        ) : null}
      </div>
      {mode === 'preview' ? (
        <div
          className="flex-1 min-h-0 overflow-auto bg-void-bg-1 cursor-text"
          style={{ pointerEvents: 'auto', userSelect: 'text', WebkitUserSelect: 'text' }}
        >
          <div className="px-8 py-6 max-w-[800px]">
            <ErrorBoundary>
              <ProseWrapper>
                {name.trim() ? <h1>{name.trim()}</h1> : null}
                {overview.trim() ? (
                  <ChatMarkdownRender
                    string={overview.trim()}
                    chatMessageLocation={undefined}
                    isApplyEnabled={false}
                    isLinkDetectionEnabled
                  />
                ) : null}
              </ProseWrapper>
              <PlanTodoList todos={todos} />
              {plan.trim() ? (
                <ProseWrapper>
                  <ChatMarkdownRender
                    string={plan.trim()}
                    chatMessageLocation={undefined}
                    isApplyEnabled={false}
                    isLinkDetectionEnabled
                  />
                </ProseWrapper>
              ) : null}
            </ErrorBoundary>
          </div>
        </div>
      ) : markdownBody ? (
        <div className="flex-1 min-h-0 overflow-hidden" style={{ pointerEvents: 'auto' }}>
          {markdownBody}
        </div>
      ) : null}
    </div>
  );
};

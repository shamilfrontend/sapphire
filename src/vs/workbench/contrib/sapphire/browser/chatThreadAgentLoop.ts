/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ChatThreadCollaboratorHost, defaultMessageState } from './chatThreadTypes.js';
import {
  shouldClearStuckStream,
  shouldClearStuckStreamOnStaleEpoch,
} from '../common/chatStreamGuards.js';
import { chatTrace } from '../common/chatSendTrace.js';
import { newThreadObject } from './chatThreadLibrary.js';
import { URI } from '../../../../base/common/uri.js';
import {
  chat_userMessageContent,
  InternalToolInfo,
  isABuiltinToolName,
  MAX_SUBAGENT_ABSOLUTE_TIME,
  MAX_TOOL_ABSOLUTE_TIME,
  READ_ONLY_SUBAGENT_TOOLS,
} from '../common/prompt/prompts.js';
import {
  mergeEnabledMcpServers,
  onlineMcpServerNames,
} from '../common/prompt/mcpToolDisclosure.js';
import {
  getErrorMessage,
  LLMUsage,
  OnError,
  OnFinalMessage,
  OnRetry,
  OnText,
  RawToolCallObj,
  RawToolParamsObj,
} from '../common/sendLLMMessageTypes.js';
import { FeatureName, ModelSelection, ModelSelectionOptions, ChatMode } from '../common/sapphireSettingsTypes.js';
import {
  approvalTypeOfBuiltinToolName,
  BuiltinToolCallParams,
  BuiltinToolResultType,
  ToolCallParams,
  ToolName,
  ToolResult,
} from '../common/toolsServiceTypes.js';
import {
  ChatMessage,
  promoteEmptyDisplayFromReasoning,
  ToolMessage,
} from '../common/chatThreadServiceTypes.js';
import { chatTokenCalibrator, estimateMessageTokens, outputTokensPerSecond } from '../common/estimateTokens.js';
import {
  applyCompactionReplace,
  buildCompactionTranscript,
  buildCompactionUserPrompt,
  buildContextSummaryMessage,
  CONTEXT_COMPACTION_SYSTEM_PROMPT,
  shouldCompactContext,
  splitMessagesForCompaction,
} from '../common/contextCompaction.js';
import { parsePlanMarkdown, planProgressLabel, planTodosHaveOpen } from '../common/prompt/planFileHelpers.js';
import { segmentToolCalls } from '../common/toolCallSchedule.js';
import { timeout } from '../../../../base/common/async.js';
import { RawMCPToolCall } from '../common/mcpServiceTypes.js';
import {
  AcknowledgeDocCommentsToken,
  Sound,
} from '../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import {
  AGENT_CONTINUE_NUDGE,
  AGENT_DRAFT_PLAN_NUDGE,
  AGENT_LENGTH_CONTINUE_NUDGE,
  AGENT_WRAP_UP_NUDGE,
  agentEmptyTurnPauseMessage,
  agentLengthPauseMessage,
  agentLoopStopMessage,
  agentToolErrorsPauseMessage,
  cyrillicShare,
  decideLoopContinuation,
  decideToolBatch,
  LoopContinuation,
  LoopContinuationPauseReason,
  MAX_CONSECUTIVE_TOOL_ERRORS,
  shouldAutoContinueOnLength,
  shouldTranslateReasoningToRussian,
  streamingReasoningDisplay,
  toolBatchSignature,
  updateConsecutiveToolErrors,
} from '../common/agentLoopPolicy.js';
import {
  formatAgentRetryStatusHint,
  formatGatewayRetryStatusHint,
} from '../common/llmRetryStatus.js';

/** Повторы LLM при transient-ошибках (не gatewayRetryExhausted). */
const CHAT_RETRIES = 3;
const RETRY_DELAY = 2500;
/** Максимум LLM-ходов за один непрерывный прогон агента. */
const MAX_AGENT_LLM_TURNS = 25;
/** Одинаковых батчей tool_calls подряд до остановки без выполнения последнего. */
const REPEAT_TOOL_BATCHES = 3;

const SUBAGENT_EXCLUDED_TOOLS = ['run_subagent', 'run_parallel_subagents'] as const;

type AgentRunContext = {
  isSubagent?: boolean;
  chatModeOverride?: ChatMode;
  parentThreadId?: string;
  allowedToolNames?: readonly string[];
};

export class ChatThreadAgentLoop {
  /** threadId скрытых дочерних run_subagent. */
  private readonly _subagentThreadIds = new Set<string>();
  /** parentThreadId → дочерние threadId (каскадный abort). */
  private readonly _childThreadsByParent = new Map<string, Set<string>>();
  /** Опциональный allowlist инструментов на тред (read-only parallel subagents). */
  private readonly _allowedToolsByThread = new Map<string, ReadonlySet<string>>();

  constructor(private readonly _s: ChatThreadCollaboratorHost) {}

  // ---------- стриминг LLM / tool ----------

  _currentModelSelectionProps = () => {
    // Модель и опции фиксируем на весь прогон (reasoning не меняется «на лету»)
    const featureName: FeatureName = 'Chat';
    const modelSelection = this._s._settingsService.state.modelSelectionOfFeature[featureName];
    const modelSelectionOptions = modelSelection
      ? this._s._settingsService.state.optionsOfModelSelection[featureName][
          modelSelection.providerName
        ]?.[modelSelection.modelName]
      : undefined;
    return { modelSelection, modelSelectionOptions };
  };

  _findToolMessageIndex(threadId: string, toolId: string): number {
    const messages = this._s.state.allThreads[threadId]?.messages;
    if (!messages) return -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === 'tool' && message.id === toolId && message.type !== 'invalid_params') {
        return i;
      }
    }
    return -1;
  }

  /** Заменить tool-сообщение по id или добавить, если его ещё нет в треде. */
  _updateToolById = (threadId: string, tool: ChatMessage & { role: 'tool' }) => {
    const idx = this._findToolMessageIndex(threadId, tool.id);
    if (idx >= 0) {
      this._s._editMessageInThread(threadId, idx, tool);
      return;
    }
    this._s._addMessageToThread(threadId, tool);
  };

  _updateLatestTool = (threadId: string, tool: ChatMessage & { role: 'tool' }) => {
    this._updateToolById(threadId, tool);
  };

  /**
   * При заполнении контекста: LLM-сжатие старого префикса → context_summary, хвост сохраняем.
   * Ошибки не фатальны — остаётся эфемерный trim в prepareMessages.
   */
  private async _maybeCompactContext({
    threadId,
    modelSelection,
    modelSelectionOptions,
    chatMode,
    isActive,
  }: {
    threadId: string;
    modelSelection: ModelSelection | null;
    modelSelectionOptions: ModelSelectionOptions | undefined;
    chatMode: ChatMode;
    isActive: () => boolean;
  }): Promise<void> {
    if (!modelSelection || !isActive()) {
      return;
    }

    const thread = this._s.state.allThreads[threadId];
    if (!thread) {
      return;
    }

    const chatMessages = thread.messages;
    const allowUpdatePlan = thread.state.activePlan?.status === 'building';
    let usage: { percentFull: number; usedTokens: number } | null = null;
    try {
      usage = await this._s._convertToLLMMessagesService.estimateChatContextUsage({
        chatMessages,
        chatMode,
        modelSelection,
        allowUpdatePlan,
        enabledMcpServerNames: thread.state.enabledMcpServers,
      });
    } catch (err) {
      console.error('[context compaction] estimate failed', err);
      return;
    }
    if (!usage || !isActive()) {
      return;
    }

    if (
      !shouldCompactContext({
        percentFull: usage.percentFull,
        messages: chatMessages,
        lastCompactedAtMessageCount: thread.state.lastCompactedAtMessageCount,
      })
    ) {
      return;
    }

    const split = splitMessagesForCompaction(chatMessages);
    if (!split) {
      return;
    }

    const transcript = buildCompactionTranscript(split.prefix);
    if (!transcript.trim()) {
      return;
    }

    this._s._setStreamState(threadId, {
      isRunning: 'idle',
      interrupt: Promise.resolve(() => {
        /* abort подключим ниже, когда будет requestId */
      }),
    });

    const summaryText = await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      const requestId = this._s._llmMessageService.sendLLMMessage({
        messagesType: 'chatMessages',
        chatMode: null,
        messages: [
          { role: 'system', content: CONTEXT_COMPACTION_SYSTEM_PROMPT },
          { role: 'user', content: buildCompactionUserPrompt(transcript) },
        ],
        separateSystemMessage: undefined,
        modelSelection,
        modelSelectionOptions,
        overridesOfModel: this._s._settingsService.state.overridesOfModel,
        featureName: 'Chat',
        logging: {
          loggingName: 'Chat - Context Compaction',
          loggingExtras: { threadId, prefixMessages: split.prefix.length },
        },
        onText: () => {},
        onFinalMessage: ({ fullText }: Parameters<OnFinalMessage>[0]) => {
          finish((fullText || '').trim() || null);
        },
        onError: (err: Parameters<OnError>[0]) => {
          console.error('[context compaction] LLM error', err);
          finish(null);
        },
        onAbort: () => {
          finish(null);
        },
      });

      if (!requestId) {
        finish(null);
        return;
      }

      this._s._setStreamState(threadId, {
        isRunning: 'idle',
        interrupt: Promise.resolve(() => {
          this._s._llmMessageService.abort(requestId);
        }),
      });

      // Прогон уже superseded (abort/Steer) — сразу отменяем compaction LLM.
      if (!isActive()) {
        this._s._llmMessageService.abort(requestId);
        finish(null);
      }
    });

    if (!isActive() || !summaryText) {
      return;
    }

    const compactedToTokens = estimateMessageTokens({ content: summaryText });
    const summary = buildContextSummaryMessage({
      summaryText,
      compactedFromTokens: usage.usedTokens,
      compactedToTokens,
    });
    const nextMessages = applyCompactionReplace(summary, split.tail);
    this._s._replaceThreadMessages(threadId, nextMessages, { markCompacted: true });
  }

  /** При abort: все running_now → rejected с единым сообщением interrupted. */
  _rejectRunningTools(threadId: string) {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return 0;
    const runningIds = thread.messages
      .filter((message) => message.role === 'tool' && message.type === 'running_now')
      .map((message) => message.id);
    const content = this.toolErrMsgs.interrupted;
    for (const id of runningIds) {
      const current = this._s.state.allThreads[threadId]?.messages;
      let running: (ChatMessage & { role: 'tool' }) | undefined;
      for (let i = (current?.length ?? 0) - 1; i >= 0; i--) {
        const message = current![i];
        if (message.role === 'tool' && message.id === id && message.type === 'running_now') {
          running = message;
          break;
        }
      }
      if (!running || running.type !== 'running_now') continue;
      this._updateToolById(threadId, {
        role: 'tool',
        type: 'rejected',
        name: running.name,
        params: running.params,
        id: running.id,
        content,
        rawParams: running.rawParams,
        result: null,
        mcpServerName: running.mcpServerName,
      });
    }
    return runningIds.length;
  }

  approveLatestToolRequest(threadId: string) {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return; // invariant

    // Двойной Approve не должен запускать два agent loop параллельно.
    const running = this._s.streamState[threadId]?.isRunning;
    if (running === 'tool' || running === 'LLM') {
      return;
    }

    const lastMsg = thread.messages[thread.messages.length - 1];
    if (!(lastMsg.role === 'tool' && lastMsg.type === 'tool_request')) return; // invariant

    const callThisToolFirst: ToolMessage<ToolName> = lastMsg;

    // Атомарно «съедаем» tool_request → running_now, чтобы второй Approve не прошёл.
    this._updateLatestTool(threadId, {
      role: 'tool',
      type: 'running_now',
      name: callThisToolFirst.name,
      params: callThisToolFirst.params,
      content: '(value not received yet...)',
      result: null,
      id: callThisToolFirst.id,
      rawParams: callThisToolFirst.rawParams,
      mcpServerName: callThisToolFirst.mcpServerName,
      startedAt: Date.now(),
    });

    this._s._wrapRunAgentToNotify(
      this._runChatAgent({
        callThisToolFirst: { ...callThisToolFirst, type: 'tool_request' },
        threadId,
        ...this._currentModelSelectionProps(),
      }),
      threadId,
    );
  }

  rejectLatestToolRequest(threadId: string) {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return; // invariant

    const lastMsg = thread.messages[thread.messages.length - 1];

    let params: ToolCallParams<ToolName>;
    if (lastMsg.role === 'tool' && lastMsg.type !== 'invalid_params') {
      params = lastMsg.params;
    } else return;

    const { name, id, rawParams, mcpServerName } = lastMsg;

    const errorMessage = this.toolErrMsgs.rejected;
    this._updateLatestTool(threadId, {
      role: 'tool',
      type: 'rejected',
      params,
      name,
      content: errorMessage,
      result: null,
      id,
      rawParams,
      mcpServerName,
    });
    this._s._setThreadState(threadId, { pendingToolCalls: undefined });
    this._s._setStreamState(threadId, undefined);
  }

  async buildActivePlan(threadId: string) {
    const thread = this._s.state.allThreads[threadId];
    if (!thread) return;
    const activePlan = thread.state.activePlan;
    if (!activePlan) return;
    // «Сделать по плану» из ready/built или продолжение building после паузы.
    if (
      activePlan.status !== 'ready' &&
      activePlan.status !== 'built' &&
      activePlan.status !== 'building'
    ) {
      return;
    }
    if (this._s.streamState[threadId]?.isRunning) return;

    this._s._setThreadState(threadId, { activePlan: { ...activePlan, status: 'building' } });
    await this._s._settingsService.setGlobalSetting('chatMode', 'agent');

    let planBody = '';
    try {
      const planUri = URI.file(activePlan.planUriFsPath);
      await this._s._sapphireModelService.initializeModel(planUri);
      const { model } = await this._s._sapphireModelService.getModelSafe(planUri);
      planBody = model?.getValue() ?? '';
    } catch {
      planBody = `(Could not read plan file at ${activePlan.planUriFsPath})`;
    }

    const instructions = `Реализуй утверждённый план «${activePlan.name}».

Файл плана: ${activePlan.planUriFsPath}

Отмечай шаги через update_plan (in_progress / completed). Не пересоздавай план через create_plan.

---
${planBody}`;

    if (this._s.streamState[threadId]?.isRunning) {
      await this.abortRunning(threadId);
    }
    if (thread.messages.length === 0) {
      this._s._addUserCheckpoint({ threadId });
    }

    const userMessageContent = await chat_userMessageContent(instructions, [], {
      directoryStrService: this._s._directoryStringService,
      fileService: this._s._fileService,
    });
    this._s._addMessageToThread(threadId, {
      role: 'user',
      content: userMessageContent,
      displayContent: `Сделать по плану: ${activePlan.name}`,
      selections: [],
      state: defaultMessageState,
    });
    this._s._setThreadState(threadId, { currCheckpointIdx: null });

    this._s._wrapRunAgentToNotify(
      this._runChatAgent({ threadId, ...this._currentModelSelectionProps() }),
      threadId,
    );
    this._s.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then((m) => {
      m.scrollToBottom();
    });
  }

  _computeMCPServerOfToolName = (toolName: string) =>
    this._s._mcpService.getMCPTools()?.find((t: InternalToolInfo) => t.name === toolName)
      ?.mcpServerName;

  private async _interruptChildThreads(parentThreadId: string) {
    const children = this._childThreadsByParent.get(parentThreadId);
    if (!children?.size) {
      return;
    }
    await Promise.all(
      [...children].map((childId) => this.abortRunning(childId, { skipFlush: true })),
    );
  }

  async abortRunning(threadId: string, opts?: { skipFlush?: boolean }) {
    await this._interruptChildThreads(threadId);

    const thread = this._s.state.allThreads[threadId];
    if (!thread) return; // invariant

    chatTrace(
      threadId,
      'abort',
      `running=${this._s.streamState[threadId]?.isRunning ?? 'none'} skipFlush=${!!opts?.skipFlush}`,
    );

    // Сначала инвалидируем runEpoch — иначе старый loop после abort затрёт Steer/follow-up.
    this._s._bumpAgentRunEpoch(threadId);

    // Частичный ответ LLM при abort во время стрима
    if (this._s.streamState[threadId]?.isRunning === 'LLM') {
      const { displayContentSoFar, reasoningSoFar, toolCallsSoFar } =
        this._s.streamState[threadId].llmInfo;
      const visibleTurn = promoteEmptyDisplayFromReasoning(displayContentSoFar, reasoningSoFar);
      this._s._addMessageToThread(threadId, {
        role: 'assistant',
        displayContent: visibleTurn.displayContent,
        reasoning: visibleTurn.reasoning,
      });
      for (const tc of toolCallsSoFar ?? []) {
        this._s._addMessageToThread(threadId, {
          role: 'interrupted_streaming_tool',
          name: tc.name,
          mcpServerName: this._computeMCPServerOfToolName(tc.name),
        });
      }
    }
    // Прерывание tool: все running_now в истории, не только toolInfo в streamState
    else if (this._s.streamState[threadId]?.isRunning === 'tool') {
      const rejected = this._rejectRunningTools(threadId);
      if (rejected === 0) {
        const {
          toolName,
          toolParams,
          id,
          content: content_,
          rawParams,
          mcpServerName,
        } = this._s.streamState[threadId].toolInfo;
        const idx = this._findToolMessageIndex(threadId, id);
        const existing = idx >= 0 ? thread.messages[idx] : undefined;
        // Не перезаписываем уже завершённый tool — только running_now или ещё не в истории.
        if (!existing || (existing.role === 'tool' && existing.type === 'running_now')) {
          const content = content_ || this.toolErrMsgs.interrupted;
          this._updateToolById(threadId, {
            role: 'tool',
            name: toolName,
            params: toolParams,
            id,
            content,
            rawParams,
            type: 'rejected',
            result: null,
            mcpServerName,
          });
        }
      }
    }
    // Ожидание Approve — отклоняем pending tool_request
    else if (this._s.streamState[threadId]?.isRunning === 'awaiting_user') {
      this.rejectLatestToolRequest(threadId);
    } else if (
      this._s.streamState[threadId]?.isRunning === 'idle' ||
      this._s.streamState[threadId]?.isRunning === 'preparing'
    ) {
      // idle / preparing — interrupt ниже отменит prep или compaction
    }

    // Сбрасываем хвост multi-tool turn (pendingToolCalls).
    this._s._setThreadState(threadId, { pendingToolCalls: undefined });

    // Берём interrupt, сразу чистим streamState (спиннеры табов), затем await и вызов cancel.
    const interruptPromise = this._s.streamState[threadId]?.interrupt;
    this._s._setStreamState(threadId, undefined);

    this._s._addUserCheckpoint({ threadId });

    const interrupt = await interruptPromise;
    if (typeof interrupt === 'function') interrupt();

    if (!opts?.skipFlush) {
      void this._s._flushMessageQueue(threadId);
    }
  }

  readonly toolErrMsgs = {
    rejected: 'Tool call was rejected by the user.',
    interrupted: 'Tool call was interrupted by the user.',
    errWhenStringifying: (error: any) =>
      `Tool call succeeded, but there was an error stringifying the output.\n${getErrorMessage(error)}`,
  };

  _appendAgentStopMessage(threadId: string, reason: 'stop_repeat' | 'stop_limit') {
    this._s._addMessageToThread(threadId, {
      role: 'assistant',
      displayContent: agentLoopStopMessage(reason, {
        maxSteps: MAX_AGENT_LLM_TURNS,
        repeatLimit: REPEAT_TOOL_BATCHES,
      }),
      reasoning: '',
      pauseReason: reason,
    });
  }

  _appendAgentPauseMessage(
    threadId: string,
    reason: LoopContinuationPauseReason,
    progressLabel?: string,
  ) {
    if (reason === 'stop_repeat' || reason === 'stop_limit') {
      this._appendAgentStopMessage(threadId, reason);
      return;
    }
    if (reason === 'length_pause') {
      this._appendAgentLengthPauseMessage(threadId, progressLabel);
      return;
    }
    if (reason === 'empty_turn_pause') {
      this._s._addMessageToThread(threadId, {
        role: 'assistant',
        displayContent: agentEmptyTurnPauseMessage({ progressLabel }),
        reasoning: '',
        pauseReason: 'empty_turn_pause',
      });
      return;
    }
    this._s._addMessageToThread(threadId, {
      role: 'assistant',
      displayContent: agentToolErrorsPauseMessage({ maxErrors: MAX_CONSECUTIVE_TOOL_ERRORS }),
      reasoning: '',
      pauseReason: 'tool_errors',
    });
  }

  private _toolOutcomesForCalls(
    threadId: string,
    toolCalls: RawToolCallObj[],
  ): ('success' | 'tool_error' | 'invalid_params' | 'rejected' | 'other')[] {
    return toolCalls.map((tc) => {
      const idx = this._findToolMessageIndex(threadId, tc.id);
      const message =
        idx >= 0 ? this._s.state.allThreads[threadId]?.messages[idx] : undefined;
      if (!message || message.role !== 'tool') {
        return 'other';
      }
      if (message.type === 'success') return 'success';
      if (message.type === 'tool_error') return 'tool_error';
      if (message.type === 'invalid_params') return 'invalid_params';
      if (message.type === 'rejected') return 'rejected';
      return 'other';
    });
  }

  private _applyLoopContinuationNudges(
    threadId: string,
    decision: Extract<LoopContinuation, { action: 'continue' }>,
  ): void {
    for (const nudge of decision.nudges) {
      if (nudge === 'wrap_up') {
        this._appendAgentWrapUpNudge(threadId);
      } else if (nudge === 'continue_plan') {
        this._appendAgentContinueNudge(threadId);
      } else if (nudge === 'draft_plan') {
        this._appendAgentDraftPlanNudge(threadId);
      } else if (nudge === 'length_continue') {
        this._appendAgentLengthContinueNudge(threadId);
      }
    }
  }

  _appendAgentWrapUpNudge(threadId: string) {
    this._s._addMessageToThread(threadId, {
      role: 'user',
      content: AGENT_WRAP_UP_NUDGE,
      displayContent: '',
      selections: null,
      state: defaultMessageState,
    });
  }

  _appendAgentContinueNudge(threadId: string) {
    this._s._addMessageToThread(threadId, {
      role: 'user',
      content: AGENT_CONTINUE_NUDGE,
      displayContent: '',
      selections: null,
      state: defaultMessageState,
    });
  }

  _appendAgentDraftPlanNudge(threadId: string) {
    this._s._addMessageToThread(threadId, {
      role: 'user',
      content: AGENT_DRAFT_PLAN_NUDGE,
      displayContent: '',
      selections: null,
      state: defaultMessageState,
    });
  }

  _appendAgentLengthContinueNudge(threadId: string) {
    this._s._addMessageToThread(threadId, {
      role: 'user',
      content: AGENT_LENGTH_CONTINUE_NUDGE,
      displayContent: '',
      selections: null,
      state: defaultMessageState,
    });
  }

  _appendAgentLengthPauseMessage(threadId: string, progressLabel?: string) {
    this._s._addMessageToThread(threadId, {
      role: 'assistant',
      displayContent: agentLengthPauseMessage({ progressLabel }),
      reasoning: '',
      pauseReason: 'length_pause',
    });
  }

  /** Последний видимый пользователю текст (без скрытых nudge с пустым displayContent). */
  _latestUserFacingText(threadId: string): string {
    const messages = this._s.state.allThreads[threadId]?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role !== 'user') continue;
      const visible = message.displayContent?.trim();
      if (visible) return visible;
    }
    return '';
  }

  /**
   * MCP-схемы в запрос только когда тред их «включил».
   * Упоминание сервера в последнем user-тексте включает его перед вызовом модели.
   */
  _syncEnabledMcpServers(threadId: string): string[] {
    const online = onlineMcpServerNames(this._s._mcpService.getMCPTools());
    const persisted = this._s.state.allThreads[threadId]?.state.enabledMcpServers;
    const next = mergeEnabledMcpServers(persisted, this._latestUserFacingText(threadId), online);
    const prev = persisted ?? [];
    const same = next.length === prev.length && next.every((name, i) => name === prev[i]);
    if (!same) {
      this._s._setThreadState(threadId, { enabledMcpServers: next });
    }
    return next;
  }

  /**
   * GLM отдаёт reasoning_content по-английски — отдельный короткий LLM-вызов для панели.
   * Reasoning на переводе выключен, чтобы не плодить ещё один английский trace.
   */
  _translateReasoningToRussian(
    reasoning: string,
    isActive: () => boolean,
  ): Promise<string | undefined> {
    const { modelSelection, modelSelectionOptions } = this._currentModelSelectionProps();
    if (!modelSelection) return Promise.resolve(undefined);
    const { overridesOfModel } = this._s._settingsService.state;
    return new Promise((resolve) => {
      const requestId = this._s._llmMessageService.sendLLMMessage({
        messagesType: 'chatMessages',
        chatMode: null,
        messages: [
          {
            role: 'user',
            content: `Переведи на русский целиком. Не сокращай и не комментируй.\n\n${reasoning}`,
          },
        ],
        separateSystemMessage:
          'Ты переводчик. Переведи текст на русский язык. Это внутреннее рассуждение ассистента для блока «Рассуждение». Имена файлов, пути, код, API и идентификаторы оставь как есть. Ответь только переводом на русском, без английского и без вступления.',
        modelSelection,
        modelSelectionOptions: { ...modelSelectionOptions, reasoningEnabled: false },
        overridesOfModel,
        featureName: 'Chat',
        logging: { loggingName: 'Chat - translate reasoning' },
        onText: () => {},
        onFinalMessage: ({ fullText, fullReasoning }: Parameters<OnFinalMessage>[0]) => {
          const text = fullText.trim();
          if (text && cyrillicShare(text) >= 0.35) {
            resolve(text);
            return;
          }
          const fallback = fullReasoning.trim();
          resolve(fallback && cyrillicShare(fallback) >= 0.35 ? fallback : undefined);
        },
        onError: () => resolve(undefined),
        onAbort: () => resolve(undefined),
      });
      if (!requestId || !isActive()) resolve(undefined);
    });
  }

  /** Есть ли открытые todo у плана в статусе building; ошибка чтения файла ≠ open. */
  async _planHasOpenTodos(threadId: string): Promise<boolean> {
    const todos = await this._readActivePlanTodos(threadId);
    return todos !== null && planTodosHaveOpen(todos);
  }

  /** Подпись текущего открытого шага плана или undefined. */
  async _planProgressLabel(threadId: string): Promise<string | undefined> {
    const fromState = this._s.state.allThreads[threadId]?.state.activePlan?.progressLabel;
    if (fromState) return fromState;
    const todos = await this._readActivePlanTodos(threadId);
    return todos ? planProgressLabel(todos) : undefined;
  }

  /**
   * Todo из файла активного плана при status === building.
   * null — нет building-плана или файл не прочитался.
   */
  async _readActivePlanTodos(threadId: string) {
    const activePlan = this._s.state.allThreads[threadId]?.state.activePlan;
    if (!activePlan || activePlan.status !== 'building') return null;
    try {
      const planUri = URI.file(activePlan.planUriFsPath);
      await this._s._sapphireModelService.initializeModel(planUri);
      const { model } = await this._s._sapphireModelService.getModelSafe(planUri);
      return parsePlanMarkdown(model?.getValue() ?? '').todos;
    } catch {
      return null;
    }
  }

  // private readonly _currentlyRunningToolInterruptor: { [threadId: string]: (() => void) | undefined } = {}

  /** Выполнение одного tool_call; awaitingUserApproval — пауза на Approve. */
  _runToolCall = async (
    threadId: string,
    toolName: ToolName,
    toolId: string,
    mcpServerName: string | undefined,
    opts:
      | {
          preapproved: true;
          unvalidatedToolParams: RawToolParamsObj;
          validatedParams: ToolCallParams<ToolName>;
        }
      | { preapproved: false; unvalidatedToolParams: RawToolParamsObj },
    group?: {
      /** Общий флаг Stop для параллельной read-only группы; streamState у группы. */
      isInterrupted: () => boolean;
      addCancel: (cancel: () => void) => void;
    },
  ): Promise<{ awaitingUserApproval?: boolean; interrupted?: boolean }> => {
    let toolParams: ToolCallParams<ToolName>;
    let toolResult: ToolResult<ToolName>;
    let toolResultStr: string;

    const isBuiltInTool = isABuiltinToolName(toolName);

    if (!opts.preapproved) {
      // 1. Валидация параметров (preapproved пропускает)
      try {
        if (isBuiltInTool) {
          const params = this._s._toolsService.validateParams[toolName](opts.unvalidatedToolParams);
          toolParams = params;
        } else {
          toolParams = opts.unvalidatedToolParams;
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this._s._addMessageToThread(threadId, {
          role: 'tool',
          type: 'invalid_params',
          rawParams: opts.unvalidatedToolParams,
          result: null,
          name: toolName,
          content: errorMessage,
          id: toolId,
          mcpServerName,
        });
        return {};
      }
      // Checkpoint перед правкой файла
      if (toolName === 'edit_file') {
        this._s._addToolEditCheckpoint({
          threadId,
          uri: (toolParams as BuiltinToolCallParams['edit_file']).uri,
        });
      }
      if (toolName === 'rewrite_file') {
        this._s._addToolEditCheckpoint({
          threadId,
          uri: (toolParams as BuiltinToolCallParams['rewrite_file']).uri,
        });
      }

      // 2. Approval: tool_request и выход; у subagent UI нет — auto-approve
      const skipApprovalUi = this._subagentThreadIds.has(threadId);

      const approvalType = isBuiltInTool ? approvalTypeOfBuiltinToolName[toolName] : 'MCP tools';
      if (approvalType && !skipApprovalUi) {
        const autoApprove = this._s._settingsService.state.globalSettings.autoApprove[approvalType];
        // tool_request только при ручном approve; auto-approve сразу → running_now
        if (!autoApprove) {
          this._s._addMessageToThread(threadId, {
            role: 'tool',
            type: 'tool_request',
            content: '(Awaiting user permission...)',
            result: null,
            name: toolName,
            params: toolParams,
            id: toolId,
            rawParams: opts.unvalidatedToolParams,
            mcpServerName,
          });
          return { awaitingUserApproval: true };
        }
      }
    } else {
      toolParams = opts.validatedParams;
    }

    // 3. Вызов tool (race: interrupt, absolute timeout, stale result)
    const startedAt = Date.now();
    const runningTool = {
      role: 'tool',
      type: 'running_now',
      name: toolName,
      params: toolParams,
      content: '(value not received yet...)',
      result: null,
      id: toolId,
      rawParams: opts.unvalidatedToolParams,
      mcpServerName,
      startedAt,
    } as const;
    // В параллельной группе карточки running_now добавляет группа до Promise.all.
    if (!group) {
      this._updateToolById(threadId, runningTool);
    }

    let interrupted = false;
    let interruptToolFn: (() => void) | undefined;
    let cancelWait: (() => void) | undefined;
    let absoluteTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const interruptorPromise = new Promise<() => void>((res) => {
      // Resolve сразу — Stop не ждёт инициализации callTool.
      res(() => {
        interrupted = true;
        interruptToolFn?.();
        cancelWait?.();
      });
    });
    const waitCancelled = new Promise<never>((_, reject) => {
      cancelWait = () => {
        reject(Object.assign(new Error('interrupted'), { isToolInterrupt: true }));
      };
    });
    const isSubagentTool =
      toolName === 'run_subagent' || toolName === 'run_parallel_subagents';
    const toolTimeoutSec = isSubagentTool ? MAX_SUBAGENT_ABSOLUTE_TIME : MAX_TOOL_ABSOLUTE_TIME;
    const absoluteTimeout = new Promise<never>((_, reject) => {
      absoluteTimeoutId = setTimeout(() => {
        reject(
          Object.assign(
            new Error(
              isSubagentTool
                ? `Sub-agent timed out after ${MAX_SUBAGENT_ABSOLUTE_TIME}s and did not finish.`
                : `Tool timed out after ${MAX_TOOL_ABSOLUTE_TIME}s and did not finish. Try a narrower search, a smaller edit, or a persistent terminal for long jobs.`,
            ),
            { isToolTimeout: true },
          ),
        );
      }, toolTimeoutSec * 1000);
    });

    // Результат tool не пишем, если abort/Stop или карточка уже rejected/tool_error.
    const isStaleToolResult = () => {
      if (interrupted || group?.isInterrupted()) return true;
      const stream = this._s.streamState[threadId];
      if (!stream || stream.isRunning !== 'tool') return true;
      const idx = this._findToolMessageIndex(threadId, toolId);
      const message = idx >= 0 ? this._s.state.allThreads[threadId]?.messages[idx] : undefined;
      if (
        message?.role === 'tool' &&
        (message.type === 'rejected' || message.type === 'tool_error')
      ) {
        return true;
      }
      return false;
    };

    const cancelThisTool = () => {
      interrupted = true;
      interruptToolFn?.();
      cancelWait?.();
    };

    try {
      if (group) {
        group.addCancel(cancelThisTool);
      } else {
        // streamState tool + interrupt (Promise уже resolved)
        this._s._setStreamState(threadId, {
          isRunning: 'tool',
          interrupt: interruptorPromise,
          toolInfo: {
            toolName,
            toolParams,
            id: toolId,
            content: 'interrupted...',
            rawParams: opts.unvalidatedToolParams,
            mcpServerName,
          },
        });
      }

      const execute = async () => {
        if (isBuiltInTool && toolName === 'run_subagent') {
          if (this._subagentThreadIds.has(threadId)) {
            throw new Error('A sub-agent cannot spawn another sub-agent. Finish this task yourself.');
          }
          const ctrl: { interrupt?: () => void } = {};
          interruptToolFn = () => ctrl.interrupt?.();
          if (interrupted) {
            throw Object.assign(new Error('interrupted'), { isToolInterrupt: true });
          }
          const result = await this._runSubagent(
            threadId,
            toolParams as BuiltinToolCallParams['run_subagent'],
            ctrl,
          );
          if (interrupted) {
            throw Object.assign(new Error('interrupted'), { isToolInterrupt: true });
          }
          return result;
        }

        if (isBuiltInTool && toolName === 'run_parallel_subagents') {
          if (this._subagentThreadIds.has(threadId)) {
            throw new Error('A sub-agent cannot spawn another sub-agent. Finish this task yourself.');
          }
          const ctrl: { interrupt?: () => void } = {};
          interruptToolFn = () => ctrl.interrupt?.();
          if (interrupted) {
            throw Object.assign(new Error('interrupted'), { isToolInterrupt: true });
          }
          const result = await this._runParallelSubagents(
            threadId,
            toolParams as BuiltinToolCallParams['run_parallel_subagents'],
            ctrl,
          );
          if (interrupted) {
            throw Object.assign(new Error('interrupted'), { isToolInterrupt: true });
          }
          return result;
        }

        const allowlist = this._allowedToolsByThread.get(threadId);
        if (allowlist && !allowlist.has(toolName)) {
          throw new Error(
            `Tool "${toolName}" is not allowed in this read-only sub-agent. Allowed: ${[...allowlist].join(', ')}`,
          );
        }

        if (isBuiltInTool) {
          const { result, interruptTool } = await this._s._toolsService.callTool[toolName](
            toolParams as any,
          );
          interruptToolFn = interruptTool;
          if (interrupted) {
            interruptTool?.();
            throw Object.assign(new Error('interrupted'), { isToolInterrupt: true });
          }
          return await Promise.resolve(result);
        }

        const mcpTools = this._s._mcpService.getMCPTools();
        const mcpTool = mcpTools?.find((t: InternalToolInfo) => t.name === toolName);
        if (!mcpTool) {
          throw new Error(`MCP tool ${toolName} not found`);
        }

        const { result, interruptTool } = this._s._mcpService.callMCPTool({
          serverName: mcpTool.mcpServerName ?? 'unknown_mcp_server',
          toolName,
          params: toolParams,
        });
        interruptToolFn = interruptTool;
        if (interrupted) {
          interruptTool();
          throw Object.assign(new Error('interrupted'), { isToolInterrupt: true });
        }
        return (await result).result;
      };

      toolResult = (await Promise.race([
        execute(),
        waitCancelled,
        absoluteTimeout,
      ])) as ToolResult<ToolName>;

      if (isStaleToolResult()) {
        return { interrupted: true };
      }
    } catch (error) {
      interruptToolFn?.();
      if (interrupted || (error as { isToolInterrupt?: boolean })?.isToolInterrupt) {
        return { interrupted: true };
      }

      const errorMessage = getErrorMessage(error);
      // tool_error только если результат ещё актуален (не rejected после abort).
      if (!isStaleToolResult()) {
        this._updateLatestTool(threadId, {
          role: 'tool',
          type: 'tool_error',
          params: toolParams,
          result: errorMessage,
          name: toolName,
          content: errorMessage,
          id: toolId,
          rawParams: opts.unvalidatedToolParams,
          mcpServerName,
          startedAt,
          durationMs: Date.now() - startedAt,
        });
      }
      return {};
    } finally {
      if (absoluteTimeoutId !== undefined) {
        clearTimeout(absoluteTimeoutId);
      }
    }

    // 4. Строка результата для LLM
    try {
      if (isStaleToolResult()) {
        return { interrupted: true };
      }
      if (isBuiltInTool) {
        toolResultStr = this._s._toolsService.stringOfResult[toolName](
          toolParams as any,
          toolResult as any,
        );
      }
      // MCP: stringify через mcpService
      else {
        toolResultStr = this._s._mcpService.stringifyResult(toolResult as RawMCPToolCall);
      }
    } catch (error) {
      const errorMessage = this.toolErrMsgs.errWhenStringifying(error);
      if (!isStaleToolResult()) {
        this._updateLatestTool(threadId, {
          role: 'tool',
          type: 'tool_error',
          params: toolParams,
          result: errorMessage,
          name: toolName,
          content: errorMessage,
          id: toolId,
          rawParams: opts.unvalidatedToolParams,
          mcpServerName,
          startedAt,
          durationMs: Date.now() - startedAt,
        });
      }
      return {};
    }

    // 5. success в историю; side effects (plan, enable_mcp_server)
    if (isStaleToolResult()) {
      return { interrupted: true };
    }
    this._updateLatestTool(threadId, {
      role: 'tool',
      type: 'success',
      params: toolParams,
      result: toolResult,
      name: toolName,
      content: toolResultStr,
      id: toolId,
      rawParams: opts.unvalidatedToolParams,
      mcpServerName,
      startedAt,
      durationMs: Date.now() - startedAt,
    });

    if (toolName === 'create_plan' || toolName === 'update_plan') {
      const planResult = toolResult as
        BuiltinToolResultType['create_plan'] | BuiltinToolResultType['update_plan'];
      const prev = this._s.state.allThreads[threadId]?.state.activePlan;
      const status = prev?.status === 'building' ? 'building' : 'ready';
      this._s._setThreadState(threadId, {
        activePlan: {
          planUriFsPath: planResult.planUri.fsPath,
          name: planResult.name,
          status,
          progressLabel: planProgressLabel(planResult.todos),
        },
      });
    }

    if (toolName === 'enable_mcp_server') {
      const { serverName } = toolParams as BuiltinToolCallParams['enable_mcp_server'];
      const prev = this._s.state.allThreads[threadId]?.state.enabledMcpServers ?? [];
      if (!prev.includes(serverName)) {
        this._s._setThreadState(threadId, { enabledMcpServers: [...prev, serverName] });
      }
    }

    return {};
  };

  _clearStuckAgentStreamState(
    threadId: string,
    error?: { message: string; fullError: Error | null },
  ) {
    // Не трогаем awaiting_user; снимаем залипшие preparing/LLM/tool/idle после необработанной ошибки.
    const running = this._s.streamState[threadId]?.isRunning;
    if (!shouldClearStuckStream(running)) {
      return;
    }
    this._s._setStreamState(threadId, error ? { isRunning: undefined, error } : undefined);
  }

  /**
   * Параллельный батч read-only tool из одного LLM-хода.
   * Ошибка одного не отменяет остальные; Stop — всю группу.
   */
  async _runReadOnlyToolGroup(
    threadId: string,
    toolCalls: RawToolCallObj[],
    isActive: () => boolean,
  ): Promise<{ interrupted?: boolean; ranAny?: boolean }> {
    const prepared: {
      tc: RawToolCallObj;
      toolParams: ToolCallParams<ToolName>;
      mcpServerName: string | undefined;
    }[] = [];
    let ranAny = false;
    const mcpTools = this._s._mcpService.getMCPTools();

    for (const tc of toolCalls) {
      if (!isActive()) return { interrupted: true, ranAny };
      const mcpServerName = mcpTools?.find(
        (t: { name: string; mcpServerName?: string }) => t.name === tc.name,
      )?.mcpServerName;
      let toolParams: ToolCallParams<ToolName>;
      try {
        if (!isABuiltinToolName(tc.name)) {
          throw new Error(`Tool ${tc.name} cannot run in a read-only group`);
        }
        toolParams = this._s._toolsService.validateParams[tc.name](tc.rawParams);
      } catch (error) {
        ranAny = true;
        this._s._addMessageToThread(threadId, {
          role: 'tool',
          type: 'invalid_params',
          rawParams: tc.rawParams,
          result: null,
          name: tc.name,
          content: getErrorMessage(error),
          id: tc.id,
          mcpServerName,
        });
        continue;
      }
      this._updateToolById(threadId, {
        role: 'tool',
        type: 'running_now',
        name: tc.name,
        params: toolParams,
        content: '(value not received yet...)',
        result: null,
        id: tc.id,
        rawParams: tc.rawParams,
        mcpServerName,
        startedAt: Date.now(),
      });
      prepared.push({ tc, toolParams, mcpServerName });
    }

    if (!prepared.length) return { ranAny };
    if (!isActive()) return { interrupted: true, ranAny: true };

    const cancelers: (() => void)[] = [];
    let groupInterrupted = false;
    const interruptAll = () => {
      groupInterrupted = true;
      for (const cancel of cancelers) cancel();
    };
    const first = prepared[0];
    this._s._setStreamState(threadId, {
      isRunning: 'tool',
      interrupt: Promise.resolve(interruptAll),
      toolInfo: {
        toolName: first.tc.name,
        toolParams: first.toolParams,
        id: first.tc.id,
        content: 'interrupted...',
        rawParams: first.tc.rawParams,
        mcpServerName: first.mcpServerName,
      },
    });

    const group = {
      isInterrupted: () => groupInterrupted,
      addCancel: (cancel: () => void) => {
        cancelers.push(cancel);
        if (groupInterrupted) cancel();
      },
    };

    const outcomes = await Promise.all(
      prepared.map((job) =>
        this._runToolCall(
          threadId,
          job.tc.name,
          job.tc.id,
          job.mcpServerName,
          {
            preapproved: true,
            unvalidatedToolParams: job.tc.rawParams,
            validatedParams: job.toolParams,
          },
          group,
        ),
      ),
    );

    const interrupted =
      groupInterrupted || !isActive() || outcomes.some((outcome) => outcome.interrupted);
    return { interrupted, ranAny: true };
  }

  /**
   * Последовательный прогон tool_calls одного хода; read-only сегменты — параллельно.
   * При паузе на approve хвост кладём в pendingToolCalls (без ожидающего tool).
   */
  async _runToolCallsSequential(
    threadId: string,
    toolCalls: RawToolCallObj[],
    isActive: () => boolean,
  ): Promise<{ awaitingUserApproval?: boolean; interrupted?: boolean; ranAny?: boolean }> {
    let ranAny = false;
    let offset = 0;
    for (const segment of segmentToolCalls(toolCalls)) {
      if (!isActive()) return { interrupted: true, ranAny };
      if (segment.kind === 'parallel') {
        const { interrupted, ranAny: groupRan } = await this._runReadOnlyToolGroup(
          threadId,
          segment.calls,
          isActive,
        );
        if (groupRan) ranAny = true;
        if (!isActive() || interrupted) {
          this._s._setThreadState(threadId, { pendingToolCalls: undefined });
          return { interrupted: true, ranAny };
        }
        offset += segment.calls.length;
        continue;
      }

      const tc = segment.call;
      const mcpTools = this._s._mcpService.getMCPTools();
      const mcpTool = mcpTools?.find(
        (t: { name: string; mcpServerName?: string }) => t.name === tc.name,
      );

      const { awaitingUserApproval, interrupted } = await this._runToolCall(
        threadId,
        tc.name,
        tc.id,
        mcpTool?.mcpServerName,
        { preapproved: false, unvalidatedToolParams: tc.rawParams },
      );
      if (!isActive()) return { interrupted: true, ranAny };
      if (interrupted) {
        this._s._setThreadState(threadId, { pendingToolCalls: undefined });
        return { interrupted: true, ranAny };
      }
      ranAny = true;
      if (awaitingUserApproval) {
        const remaining = toolCalls.slice(offset + 1);
        this._s._setThreadState(threadId, {
          pendingToolCalls: remaining.length ? remaining : undefined,
        });
        return { awaitingUserApproval: true, ranAny };
      }
      offset += 1;
    }
    this._s._setThreadState(threadId, { pendingToolCalls: undefined });
    return { ranAny };
  }

  async _drainPendingToolCalls(
    threadId: string,
    isActive: () => boolean,
  ): Promise<{ awaitingUserApproval?: boolean; interrupted?: boolean; ranAny?: boolean }> {
    const pending = this._s.state.allThreads[threadId]?.state.pendingToolCalls;
    if (!pending?.length) return {};
    // Очищаем pending до run — вложенная пауза перезапишет очередь предсказуемо.
    this._s._setThreadState(threadId, { pendingToolCalls: undefined });
    return this._runToolCallsSequential(threadId, pending, isActive);
  }

  private async _runSubagent(
    parentThreadId: string,
    params: BuiltinToolCallParams['run_subagent'],
    ctrl: { interrupt?: () => void },
    opts?: { readOnly?: boolean },
  ): Promise<BuiltinToolResultType['run_subagent']> {
    const child = newThreadObject();
    const childId = child.id;
    const ephemeralIds: Set<string> = this._s._ephemeralThreadIds;
    ephemeralIds.add(childId);
    this._subagentThreadIds.add(childId);
    const allowedToolNames = opts?.readOnly ? READ_ONLY_SUBAGENT_TOOLS : undefined;
    if (allowedToolNames) {
      this._allowedToolsByThread.set(childId, new Set(allowedToolNames));
    }

    let children = this._childThreadsByParent.get(parentThreadId);
    if (!children) {
      children = new Set();
      this._childThreadsByParent.set(parentThreadId, children);
    }
    children.add(childId);

    let interrupted = false;
    ctrl.interrupt = () => {
      interrupted = true;
      void this.abortRunning(childId, { skipFlush: true });
    };

    try {
      this._s._setState({
        allThreads: {
          ...this._s.state.allThreads,
          [childId]: child,
        },
      });

      this._s._addMessageToThread(childId, {
        role: 'user',
        content: params.prompt,
        displayContent: params.prompt,
        selections: null,
        state: defaultMessageState,
      });

      const parentEnabled =
        this._s.state.allThreads[parentThreadId]?.state.enabledMcpServers;
      if (parentEnabled?.length && !opts?.readOnly) {
        this._s._setThreadState(childId, { enabledMcpServers: [...parentEnabled] });
      }

      const { modelSelection, modelSelectionOptions } = this._currentModelSelectionProps();
      await this._runChatAgent({
        threadId: childId,
        modelSelection,
        modelSelectionOptions,
        runCtx: {
          isSubagent: true,
          chatModeOverride: 'agent',
          parentThreadId,
          allowedToolNames,
        },
      });

      if (interrupted) {
        throw Object.assign(new Error('interrupted'), { isToolInterrupt: true });
      }

      const messages = this._s.state.allThreads[childId]?.messages ?? [];
      let summary = '';
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'assistant') {
          const text = (msg.displayContent || '').trim();
          if (text) {
            summary = text;
            break;
          }
        }
      }
      const completed = !!summary;
      if (!summary) {
        summary = '(The sub-agent finished without producing a summary.)';
      }
      return { summary, completed };
    } finally {
      // Дочерний subagent-тред не персистится — убираем из state и очереди
      children.delete(childId);
      if (children.size === 0) {
        this._childThreadsByParent.delete(parentThreadId);
      }
      this._subagentThreadIds.delete(childId);
      this._allowedToolsByThread.delete(childId);
      ephemeralIds.delete(childId);
      this._s._setStreamState(childId, undefined);
      const { [childId]: _drop, ...rest } = this._s.state.allThreads;
      this._s._setState({ allThreads: rest });
      this._s.clearMessageQueue(childId);
    }
  }

  private async _runParallelSubagents(
    parentThreadId: string,
    params: BuiltinToolCallParams['run_parallel_subagents'],
    ctrl: { interrupt?: () => void },
  ): Promise<BuiltinToolResultType['run_parallel_subagents']> {
    const childCtrls: Array<{ interrupt?: () => void }> = [];
    ctrl.interrupt = () => {
      for (const c of childCtrls) {
        c.interrupt?.();
      }
    };

    const settled = await Promise.all(
      params.tasks.map(async (task) => {
        const childCtrl: { interrupt?: () => void } = {};
        childCtrls.push(childCtrl);
        try {
          const r = await this._runSubagent(
            parentThreadId,
            { description: task.description, prompt: task.prompt },
            childCtrl,
            { readOnly: true },
          );
          return {
            description: task.description,
            summary: r.summary,
            completed: r.completed,
          };
        } catch (e) {
          if ((e as { isToolInterrupt?: boolean })?.isToolInterrupt) {
            throw e;
          }
          return {
            description: task.description,
            summary: `(The sub-agent errored: ${e instanceof Error ? e.message : String(e)})`,
            completed: false,
          };
        }
      }),
    );
    return { results: settled };
  }

  /**
   * Главный цикл агента: LLM → tool_calls → decideLoopContinuation, с runEpoch против гонок abort/Steer.
   */
  async _runChatAgent({
    threadId,
    modelSelection,
    modelSelectionOptions,
    callThisToolFirst,
    runCtx,
    runEpoch: existingRunEpoch,
  }: {
    threadId: string;
    modelSelection: ModelSelection | null;
    modelSelectionOptions: ModelSelectionOptions | undefined;

    callThisToolFirst?: ToolMessage<ToolName> & { type: 'tool_request' };
    runCtx?: AgentRunContext;
    /** Поколение прогона из подготовки сообщения (Jira) — общий abort с prep. */
    runEpoch?: number;
  }) {
    const runEpoch =
      existingRunEpoch !== undefined
        ? existingRunEpoch
        : this._s._bumpAgentRunEpoch(threadId);
    const isActive = () => this._s._isActiveAgentRun(threadId, runEpoch);
    if (!isActive()) {
      chatTrace(threadId, 'agent.skip', `stale epoch=${runEpoch}`);
      return;
    }
    chatTrace(threadId, 'agent.enter', `epoch=${runEpoch}`);

    let interruptedWhenIdle = false;
    const idleInterruptor = Promise.resolve(() => {
      interruptedWhenIdle = true;
    });
    // idleInterruptor: отмена LLM между ходами (compaction подменяет interrupt — восстанавливаем ниже)

    const chatMode =
      runCtx?.chatModeOverride ?? this._s._settingsService.state.globalSettings.chatMode; // фиксируем на прогон, даже если пользователь сменил режим в UI
    const isSubagent = !!runCtx?.isSubagent;
    const excludedToolNames = isSubagent && !runCtx?.allowedToolNames
      ? SUBAGENT_EXCLUDED_TOOLS
      : undefined;
    const allowedToolNames = runCtx?.allowedToolNames;
    const { overridesOfModel } = this._s._settingsService.state;

    let nMessagesSent = 0;
    let shouldSendAnotherMessage = true;
    let isRunningWhenEnd: undefined | 'awaiting_user';
    let toolsRanInRun = false;
    let summaryNudged = false;
    let consecutiveEmptyTurns = 0;
    let consecutiveLengthContinues = 0;
    let consecutiveToolErrors = 0;
    let lengthPauseAnnounced = false;
    let disableToolsNextTurn = false;
    /** Уже есть план (activePlan) или был success create_plan/update_plan в этом прогоне. */
    let planDraftedInRun = !!this._s.state.allThreads[threadId]?.state.activePlan;
    const recentToolSignatures: string[] = [];

    try {
      // Вход после Approve: сначала одобренный tool, затем pendingToolCalls того же хода
      if (callThisToolFirst) {
        const { interrupted } = await this._runToolCall(
          threadId,
          callThisToolFirst.name,
          callThisToolFirst.id,
          callThisToolFirst.mcpServerName,
          {
            preapproved: true,
            unvalidatedToolParams: callThisToolFirst.rawParams,
            validatedParams: callThisToolFirst.params,
          },
        );
        if (!isActive()) return;
        if (interrupted) {
          this._s._setStreamState(threadId, undefined);
          this._s._setThreadState(threadId, { pendingToolCalls: undefined });
          this._s._addUserCheckpoint({ threadId });
          return;
        }
        toolsRanInRun = true;
        const drain = await this._drainPendingToolCalls(threadId, isActive);
        if (!isActive()) return;
        if (drain.interrupted) {
          this._s._setStreamState(threadId, undefined);
          this._s._addUserCheckpoint({ threadId });
          return;
        }
        if (drain.awaitingUserApproval) {
          this._s._setStreamState(threadId, { isRunning: 'awaiting_user' });
          this._playChatSound('confirm');
          return;
        }
        if (drain.ranAny) {
          toolsRanInRun = true;
        }
      }
      if (!isActive()) return;
      this._s._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });

      // Цикл LLM ↔ инструменты до natural_end / pause / await_user
      while (shouldSendAnotherMessage) {
        if (!isActive()) return;
        // shouldSendAnotherMessage выставляет decideLoopContinuation
        shouldSendAnotherMessage = false;
        isRunningWhenEnd = undefined;
        nMessagesSent += 1;

        this._s._setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor });

        await this._maybeCompactContext({
          threadId,
          modelSelection,
          modelSelectionOptions,
          chatMode,
          isActive,
        });
        if (!isActive()) return;
        // Compaction мог подменить idle interrupt — возвращаем хук отмены цикла.
        this._s._setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor });

        const chatMessages = this._s.state.allThreads[threadId]?.messages ?? [];
        const allowUpdatePlan =
          this._s.state.allThreads[threadId]?.state.activePlan?.status === 'building';
        const enabledMcpServerNames =
          chatMode === 'agent' || chatMode === 'debug'
            ? this._syncEnabledMcpServers(threadId)
            : undefined;
        const { messages, separateSystemMessage } =
          await this._s._convertToLLMMessagesService.prepareLLMChatMessages({
            chatMessages,
            modelSelection,
            chatMode,
          });

        if (!isActive()) return;
        if (interruptedWhenIdle) {
          this._s._setStreamState(threadId, undefined);
          return;
        }

        let shouldRetryLLM = true;
        let nAttempts = 0;
        while (shouldRetryLLM) {
          if (!isActive()) return;
          shouldRetryLLM = false;
          nAttempts += 1;

          type ResTypes =
            | {
                type: 'llmDone';
                toolCalls?: RawToolCallObj[];
                info: {
                  fullText: string;
                  fullReasoning: string;
                  usage?: LLMUsage;
                  finishReason?: string;
                  truncatedToolNames?: string[];
                };
              }
            | {
                type: 'llmError';
                error?: {
                  message: string;
                  fullError: Error | null;
                  gatewayRetryExhausted?: boolean;
                };
              }
            | { type: 'llmAborted' };

          let resMessageIsDonePromise: (res: ResTypes) => void; // resolve по onFinalMessage / onError / onAbort
          const messageIsDonePromise = new Promise<ResTypes>((res, _rej) => {
            resMessageIsDonePromise = res;
          });

          const disableAllTools = disableToolsNextTurn;
          disableToolsNextTurn = false;

          const llmCancelToken = this._s._llmMessageService.sendLLMMessage({
            messagesType: 'chatMessages',
            chatMode,
            allowUpdatePlan,
            enabledMcpServerNames,
            excludedToolNames,
            allowedToolNames,
            disableAllTools: disableAllTools || undefined,
            messages,
            modelSelection,
            modelSelectionOptions,
            overridesOfModel,
            featureName: 'Chat',
            logging: {
              loggingName: isSubagent ? `Chat - subagent` : `Chat - ${chatMode}`,
              loggingExtras: {
                threadId,
                nMessagesSent,
                chatMode,
                isSubagent,
                disableAllTools,
              },
            },
            separateSystemMessage,
            onText: ({ fullText, fullReasoning, toolCalls }: Parameters<OnText>[0]) => {
              // Поздние IPC-чанки после abort/Steer игнорируем — иначе «оживёт» спиннер LLM.
              if (!isActive()) return;
              const running = this._s.streamState[threadId]?.isRunning;
              if (running !== 'LLM' && running !== 'idle') return;
              const stream = this._s.streamState[threadId];
              const prevFirst =
                stream?.isRunning === 'LLM' ? stream.llmInfo.firstTokenAt : undefined;
              const hasOutput = !!(fullText || fullReasoning || toolCalls?.length);
              const firstTokenAt = prevFirst ?? (hasOutput ? Date.now() : undefined);
              // GLM стримит reasoning по-английски — скрываем до post-turn перевода.
              const reasoningForUi = streamingReasoningDisplay(
                this._latestUserFacingText(threadId),
                fullReasoning,
              );
              this._s._setStreamState(threadId, {
                isRunning: 'LLM',
                llmInfo: {
                  displayContentSoFar: fullText,
                  reasoningSoFar: reasoningForUi,
                  toolCallsSoFar: toolCalls ?? null,
                  ...(firstTokenAt !== undefined ? { firstTokenAt } : {}),
                },
                interrupt: Promise.resolve(() => {
                  if (llmCancelToken) this._s._llmMessageService.abort(llmCancelToken);
                }),
                // statusHint gateway-retry сбрасывается при появлении токенов (ниже merge в setStreamState).
              });
            },
            onRetry: ({ attempt, maxAttempts, status, retryAfterSec }: Parameters<OnRetry>[0]) => {
              if (!isActive()) return;
              const stream = this._s.streamState[threadId];
              if (stream?.isRunning !== 'LLM' && stream?.isRunning !== 'idle') return;
              const statusHint = formatGatewayRetryStatusHint({
                attempt,
                maxAttempts,
                status,
                retryAfterSec,
              });
              if (stream.isRunning === 'LLM') {
                this._s._setStreamState(threadId, {
                  ...stream,
                  statusHint,
                });
              } else {
                this._s._setStreamState(threadId, {
                  isRunning: 'idle',
                  interrupt: idleInterruptor,
                  statusHint,
                });
              }
            },
            onFinalMessage: async ({
              fullText,
              fullReasoning,
              toolCalls,
              usage,
              finishReason,
              truncatedToolNames,
            }: Parameters<OnFinalMessage>[0]) => {
              resMessageIsDonePromise({
                type: 'llmDone',
                toolCalls,
                info: { fullText, fullReasoning, usage, finishReason, truncatedToolNames },
              });
            },
            onError: async (error: Parameters<OnError>[0]) => {
              resMessageIsDonePromise({ type: 'llmError', error });
            },
            onAbort: () => {
              // Только разблокировать promise; state уже сбросил abortRunning
              resMessageIsDonePromise({ type: 'llmAborted' });
            },
          });

          // Переход в isRunning LLM
          if (!llmCancelToken) {
            if (!isActive()) return;
            this._s._setStreamState(threadId, {
              isRunning: undefined,
              error: {
                message: 'Произошла непредвиденная ошибка при отправке сообщения.',
                fullError: null,
              },
            });
            break;
          }

          if (!isActive()) return;
          this._s._setStreamState(threadId, {
            isRunning: 'LLM',
            llmInfo: { displayContentSoFar: '', reasoningSoFar: '', toolCallsSoFar: null },
            interrupt: Promise.resolve(() => this._s._llmMessageService.abort(llmCancelToken)),
          });
          const llmRes = await messageIsDonePromise;

          if (!isActive()) return; // superseded — не трогаем streamState

          if (llmRes.type === 'llmAborted') {
            return;
          }
          if (llmRes.type === 'llmError') {
            const { error } = llmRes;
            // Gateway исчерпал 408/429 — сразу в UI, без RETRY_DELAY
            if (error?.gatewayRetryExhausted) {
              if (this._s.streamState[threadId]?.isRunning === 'LLM') {
                const { displayContentSoFar, reasoningSoFar, toolCallsSoFar } =
                  this._s.streamState[threadId].llmInfo;
                const visibleTurn = promoteEmptyDisplayFromReasoning(
                  displayContentSoFar,
                  reasoningSoFar,
                );
                this._s._addMessageToThread(threadId, {
                  role: 'assistant',
                  displayContent: visibleTurn.displayContent,
                  reasoning: visibleTurn.reasoning,
                });
                for (const tc of toolCallsSoFar ?? []) {
                  this._s._addMessageToThread(threadId, {
                    role: 'interrupted_streaming_tool',
                    name: tc.name,
                    mcpServerName: this._computeMCPServerOfToolName(tc.name),
                  });
                }
              }
              this._s._setStreamState(threadId, { isRunning: undefined, error });
              this._s._addUserCheckpoint({ threadId });
              return;
            }
            if (nAttempts < CHAT_RETRIES) {
              shouldRetryLLM = true;
              const statusHint = formatAgentRetryStatusHint({
                attempt: nAttempts + 1,
                maxAttempts: CHAT_RETRIES,
                message: error?.message,
              });
              this._s._setStreamState(threadId, {
                isRunning: 'idle',
                interrupt: idleInterruptor,
                statusHint,
              });
              await timeout(RETRY_DELAY);
              if (!isActive()) return;
              if (interruptedWhenIdle) {
                this._s._setStreamState(threadId, undefined);
                return;
              }
              continue;
            } else {
              if (this._s.streamState[threadId]?.isRunning === 'LLM') {
                const { displayContentSoFar, reasoningSoFar, toolCallsSoFar } =
                  this._s.streamState[threadId].llmInfo;
                const visibleTurn = promoteEmptyDisplayFromReasoning(
                  displayContentSoFar,
                  reasoningSoFar,
                );
                this._s._addMessageToThread(threadId, {
                  role: 'assistant',
                  displayContent: visibleTurn.displayContent,
                  reasoning: visibleTurn.reasoning,
                });
                for (const tc of toolCallsSoFar ?? []) {
                  this._s._addMessageToThread(threadId, {
                    role: 'interrupted_streaming_tool',
                    name: tc.name,
                    mcpServerName: this._computeMCPServerOfToolName(tc.name),
                  });
                }
              }

              this._s._setStreamState(threadId, { isRunning: undefined, error });
              this._s._addUserCheckpoint({ threadId });
              return;
            }
          }

          const { toolCalls, info } = llmRes;
          const doneStream = this._s.streamState[threadId];
          const firstTokenAt =
            doneStream?.isRunning === 'LLM' ? doneStream.llmInfo.firstTokenAt : undefined;
          const tokensPerSecond =
            info.usage && firstTokenAt !== undefined
              ? outputTokensPerSecond(info.usage.completion_tokens, firstTokenAt, Date.now())
              : undefined;

          // Калибровка локальных оценок токенов по usage.prompt_tokens шлюза
          if (info.usage?.prompt_tokens) {
            try {
              const chatMode = this._s._settingsService.state.globalSettings.chatMode;
              const { modelSelection } = this._currentModelSelectionProps();
              const est = await this._s._convertToLLMMessagesService.estimateChatContextUsage({
                chatMessages: this._s.state.allThreads[threadId]?.messages ?? [],
                chatMode,
                modelSelection,
                allowUpdatePlan,
                enabledMcpServerNames,
                excludedToolNames,
              });
              if (est?.usedTokens) {
                const rawEstimate = Math.round(
                  est.usedTokens / Math.max(0.01, chatTokenCalibrator.getFactor()),
                );
                chatTokenCalibrator.observe(rawEstimate, info.usage.prompt_tokens);
              }
            } catch {
              // best-effort
            }
          }

          let reasoning = info.fullReasoning;
          if (shouldTranslateReasoningToRussian(this._latestUserFacingText(threadId), reasoning)) {
            const running = this._s.streamState[threadId];
            if (running?.isRunning === 'LLM' || running?.isRunning === 'idle') {
              this._s._setStreamState(threadId, {
                isRunning: 'LLM',
                llmInfo: {
                  displayContentSoFar: info.fullText,
                  reasoningSoFar: 'Перевожу рассуждение…',
                  toolCallsSoFar: toolCalls ?? null,
                  ...(firstTokenAt !== undefined ? { firstTokenAt } : {}),
                },
                interrupt: Promise.resolve(() => {}),
              });
            }
            const translated = await this._translateReasoningToRussian(reasoning, isActive);
            if (!isActive()) return;
            if (translated) reasoning = translated;
          }
          const visibleTurn = promoteEmptyDisplayFromReasoning(info.fullText, reasoning);
          const assistantDisplayContent = visibleTurn.displayContent;
          reasoning = visibleTurn.reasoning;
          this._s._addMessageToThread(threadId, {
            role: 'assistant',
            displayContent: assistantDisplayContent,
            reasoning,
            ...(info.usage ? { usage: info.usage } : {}),
            ...(tokensPerSecond !== undefined ? { outputTokensPerSecond: tokensPerSecond } : {}),
          });

          this._s._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });

          const hadTruncatedToolCall = !!(info.truncatedToolNames?.length);
          const planHasOpenTodos = await this._planHasOpenTodos(threadId);
          if (!isActive()) return;

          const wantsLengthContinue = shouldAutoContinueOnLength({
            finishReason: info.finishReason,
            planHasOpenTodos,
            hadTruncatedToolCall,
            consecutiveLengthContinues,
          });

          const hasToolCalls = !!(toolCalls?.length);
          if (hasToolCalls) {
            consecutiveLengthContinues = 0;
          }

          const batchDecision = hasToolCalls
            ? decideToolBatch({
                step: nMessagesSent,
                maxSteps: MAX_AGENT_LLM_TURNS,
                batch: toolCalls!,
                recentSignatures: recentToolSignatures,
                repeatLimit: REPEAT_TOOL_BATCHES,
              })
            : null;

          // activePlan выставляется при success create_plan/update_plan
          if (!planDraftedInRun && this._s.state.allThreads[threadId]?.state.activePlan) {
            planDraftedInRun = true;
          }

          const sharedDecisionInput = {
            hasToolCalls,
            batchDecision,
            wantsLengthContinue,
            finishReason: info.finishReason,
            planHasOpenTodos,
            hadTruncatedToolCall,
            toolsRanInRun,
            assistantText: assistantDisplayContent,
            reasoningText: reasoning,
            consecutiveEmptyTurns,
            consecutiveLengthContinues,
            summaryNudged,
            consecutiveToolErrors,
            step: nMessagesSent,
            maxSteps: MAX_AGENT_LLM_TURNS,
            chatMode,
            lengthPauseAnnounced,
            planDraftedInRun,
          };

          let decision = decideLoopContinuation({
            ...sharedDecisionInput,
            toolsExecuted: false,
            ranAny: false,
            awaitingUserApproval: false,
          });

          if (decision.action === 'run_tools' && toolCalls?.length) {
            recentToolSignatures.push(toolBatchSignature(toolCalls));
            const { awaitingUserApproval, interrupted, ranAny } =
              await this._runToolCallsSequential(threadId, toolCalls, isActive);
            if (!isActive()) return;
            if (interrupted) {
              this._s._setStreamState(threadId, undefined);
              return;
            }

            consecutiveToolErrors = updateConsecutiveToolErrors(
              consecutiveToolErrors,
              this._toolOutcomesForCalls(threadId, toolCalls),
            );

            if (ranAny) {
              toolsRanInRun = true;
              consecutiveEmptyTurns = 0;
            }

            if (!planDraftedInRun && this._s.state.allThreads[threadId]?.state.activePlan) {
              planDraftedInRun = true;
            }

            decision = decideLoopContinuation({
              ...sharedDecisionInput,
              toolsExecuted: true,
              ranAny: !!ranAny,
              awaitingUserApproval: !!awaitingUserApproval,
              toolsRanInRun,
              consecutiveToolErrors,
              consecutiveEmptyTurns,
              planDraftedInRun,
            });
          }

          if (decision.action === 'await_user') {
            isRunningWhenEnd = 'awaiting_user';
            this._s._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });
          } else if (decision.action === 'continue') {
            this._applyLoopContinuationNudges(threadId, decision);
            if (decision.markSummaryNudged) {
              summaryNudged = true;
            }
            if (decision.bumpEmptyTurns) {
              consecutiveEmptyTurns++;
            }
            if (decision.bumpLengthContinues) {
              consecutiveLengthContinues++;
              consecutiveEmptyTurns = 0;
            }
            if (decision.disableTools) {
              disableToolsNextTurn = true;
            }
            shouldSendAnotherMessage = true;
            this._s._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });
          } else if (decision.action === 'pause') {
            if (
              decision.reason === 'length_pause' ||
              decision.reason === 'empty_turn_pause'
            ) {
              lengthPauseAnnounced = true;
            }
            const needsProgress =
              decision.reason === 'length_pause' || decision.reason === 'empty_turn_pause';
            const progressLabel = needsProgress
              ? await this._planProgressLabel(threadId)
              : undefined;
            if (!isActive()) return;
            this._appendAgentPauseMessage(threadId, decision.reason, progressLabel);
            this._s._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });
          } else {
            // natural_end (run_tools пересчитывает decision выше)
            this._s._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });
          }
        } // while retry LLM
      } // while shouldSendAnotherMessage

      if (!isActive()) return;

      // awaiting_user оставляем; иначе снимаем isRunning
      this._s._setStreamState(
        threadId,
        isRunningWhenEnd === 'awaiting_user'
          ? { isRunning: 'awaiting_user' }
          : { isRunning: undefined },
      );

      if (!isSubagent) {
        this._playChatSound(isRunningWhenEnd === 'awaiting_user' ? 'confirm' : 'done');

        if (!isRunningWhenEnd) this._s._addUserCheckpoint({ threadId });

        // activePlan: built только когда todo закрыты; иначе остаёмся building
        if (!isRunningWhenEnd) {
          const activePlan = this._s.state.allThreads[threadId]?.state.activePlan;
          if (activePlan?.status === 'building') {
            const stillOpen = await this._planHasOpenTodos(threadId);
            if (!isActive()) return;
            const progressLabel = stillOpen
              ? ((await this._planProgressLabel(threadId)) ?? activePlan.progressLabel)
              : undefined;
            if (!isActive()) return;
            this._s._setThreadState(threadId, {
              activePlan: {
                ...activePlan,
                status: stillOpen ? 'building' : 'built',
                ...(progressLabel !== undefined ? { progressLabel } : { progressLabel: undefined }),
              },
            });
          }
        }

        // Очередь follow-up после завершённого прогона (не на approve)
        if (!isRunningWhenEnd) {
          void this._s._flushMessageQueue(threadId);
        }
      }
    } catch (error) {
      if (!isActive()) return;
      this._clearStuckAgentStreamState(threadId, {
        message: getErrorMessage(error),
        fullError: error instanceof Error ? error : null,
      });
      if (!isSubagent) {
        this._s._addUserCheckpoint({ threadId });
      }
      throw error;
    } finally {
      if (isSubagent) {
        return;
      }
      const running = this._s.streamState[threadId]?.isRunning;
      if (isActive()) {
        // Живой прогон: снять залипший preparing|idle|LLM|tool и flush очереди.
        if (shouldClearStuckStream(running)) {
          chatTrace(threadId, 'agent.finally-clear', String(running));
          this._clearStuckAgentStreamState(threadId);
          void this._s._flushMessageQueue(threadId);
        }
        return;
      }
      // Stale epoch: только idle, оставленный умирающим loop после abort (не трогаем preparing/LLM/tool нового прогона).
      if (shouldClearStuckStreamOnStaleEpoch(running)) {
        chatTrace(threadId, 'agent.finally-clear-stale', String(running));
        this._clearStuckAgentStreamState(threadId);
        // Очередь, поставленная в залипший idle, иначе не всплывёт: цикл уже мёртв.
        void this._s._flushMessageQueue(threadId);
      }
    }
  }

  _playChatSound(kind: 'done' | 'confirm') {
    if (!this._s._settingsService.state.globalSettings.playChatNotificationSound) return;
    const volume = this._s._configurationService.getValue(
      'accessibility.signalOptions.volume',
    );
    if (typeof volume === 'number' && volume <= 0) {
      console.warn(
        '[sapphire] Chat notification sound skipped: accessibility.signalOptions.volume is 0',
      );
      return;
    }
    const sound = kind === 'confirm' ? Sound.warning : Sound.taskCompleted;
    void this._s._accessibilitySignalService
      .playSound(sound, true, AcknowledgeDocCommentsToken)
      .catch((err: unknown) => {
        console.warn('[sapphire] Failed to play chat notification sound', err);
      });
  }
}

/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, {
  Fragment,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronRight, Pencil, X } from 'lucide-react';
import {
  useAccessor,
  useChatThreadsState,
  useChatThreadsStreamState,
  useCommandBarState,
  useFullChatThreadsStreamState,
  useSettingsState,
} from '../util/services.js';
import { getIconClasses } from '../../../../../../../editor/common/services/getIconClasses.js';
import { FileKind } from '../../../../../../../platform/files/common/files.js';
import type { Diff } from '../../../../common/editCodeServiceTypes.js';
import { formatChatThreadLog } from '../../../../common/formatChatThreadLog.js';
import { ChatMarkdownRender, ChatMessageLocation } from '../markdown/ChatMarkdownRender.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { TextAreaFns, SapphireInputBox2 } from '../util/inputs.js';
import { PastThreadsList } from './SidebarThreadSelector.js';
import { SAPPHIRE_OPEN_SETTINGS_ACTION_ID } from '../../../sapphireSettingsPane.js';
import { isFeatureNameDisabled } from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsTypes.js';
import { WarningBox } from '../void-settings-tsx/WarningBox.js';
import { getModelCapabilities } from '../../../../common/modelCapabilities.js';
import {
  ChatImageAttachment,
  ChatMessage,
  CheckpointEntry,
  promoteEmptyDisplayFromReasoning,
  StagingSelectionItem,
  ToolMessage,
} from '../../../../common/chatThreadServiceTypes.js';
import { filesToChatImageAttachments, imageFilesFromDataTransfer } from '../util/chatImages.js';
import {
  chatAttachFileAccept,
  ChatDropOverlay,
  partitionPickedChatFiles,
  useChatDropZone,
} from '../util/chatDrop.js';
import { isABuiltinToolName } from '../../../../common/prompt/prompts.js';
import ErrorBoundary from './ErrorBoundary.js';
import { canEnqueueFollowUp, IsRunningType } from '../../../chatThreadService.js';
import { chatTrace, formatChatSendTrace } from '../../../../common/chatSendTrace.js';
import { ToolName } from '../../../../common/toolsServiceTypes.js';
import { getBasename } from '../../../../common/pathLabels.js';
import { useAgentsReview } from '../agents-window-tsx/AgentsReviewContext.js';
import { useAgentsPlan } from '../agents-window-tsx/AgentsPlanContext.js';
import { sapphireOpenFileFn } from './chatFileUtils.js';
import { IconLoading } from './chatIcons.js';
import { ProseWrapper, SmallProseWrapper } from './ChatProse.js';
import { ToolChildrenWrapper } from './ChatToolPrimitives.js';
import { QueuedMessagesPanel, SelectedFiles, SelectedImages } from './ChatAttachments.js';
import { formatTokenCount, useChatContextUsage, SapphireChatArea } from './ChatComposer.js';
import { estimateTextTokens, outputTokensPerSecond } from '../../../../common/estimateTokens.js';
import {
  findPinnedPlanToolMessage,
  planUriFsPathToCollapseInThread,
  shouldCollapsePlanToolInThread,
} from '../../../../common/planToolPin.js';
import {
  builtinToolNameToComponent,
  CanceledTool,
  EditToolSoFar,
  InvalidTool,
  MCPToolWrapper,
  PlanToolCard,
  PlanToolInlinePlaceholder,
  ResultWrapper,
  ToolHeaderWrapper,
  ToolRequestAcceptRejectButtons,
} from './ChatToolCards.js';

const EMPTY_CHAT_MESSAGES: ChatMessage[] = [];

/** Оценка скорости вывода по растущему тексту; обновляется по таймеру, даже между чанками. */
const useLiveOutputTokensPerSecond = (
  display: string | undefined,
  reasoning: string | undefined,
  firstTokenAt: number | undefined,
  active: boolean,
): number | undefined => {
  const [rate, setRate] = useState<number | undefined>(undefined);
  const textRef = useRef({ display: display ?? '', reasoning: reasoning ?? '' });
  textRef.current = { display: display ?? '', reasoning: reasoning ?? '' };

  useEffect(() => {
    if (!active || firstTokenAt == null) {
      setRate(undefined);
      return;
    }
    const tick = () => {
      const { display: text, reasoning: thought } = textRef.current;
      const tokens = estimateTextTokens(`${text}${thought}`);
      setRate(outputTokensPerSecond(tokens, firstTokenAt, Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [active, firstTokenAt]);

  return rate;
};

const scrollToBottom = (divRef: { current: HTMLElement | null }) => {
  if (divRef.current) {
    divRef.current.scrollTop = divRef.current.scrollHeight;
  }
};

const ScrollToBottomContainer = ({
  children,
  className,
  style,
  scrollContainerRef,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  scrollContainerRef: React.MutableRefObject<HTMLDivElement | null>;
}) => {
  const [isAtBottom, setIsAtBottom] = useState(true); // изначально прокрутка вниз

  const divRef = scrollContainerRef;

  const onScroll = () => {
    const div = divRef.current;
    if (!div) return;

    const isBottom = Math.abs(div.scrollHeight - div.clientHeight - div.scrollTop) < 4;

    setIsAtBottom(isBottom);
  };

  // при новых сообщениях — автоскролл, если пользователь внизу
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom(divRef);
    }
  }, [children, isAtBottom]); // children меняются при новых сообщениях

  // первый рендер — в конец ленты
  useEffect(() => {
    scrollToBottom(divRef);
  }, []);

  return (
    <div ref={divRef} onScroll={onScroll} className={className} style={style}>
      {children}
    </div>
  );
};
const useChatSupportsVision = (): boolean => {
  const settingsState = useSettingsState();
  const modelSelection = settingsState.modelSelectionOfFeature.Chat;
  if (!modelSelection) return false;
  return !!getModelCapabilities(
    modelSelection.providerName,
    modelSelection.modelName,
    settingsState.overridesOfModel,
  ).supportsVision;
};

const UserMessageComponent = ({
  chatMessage,
  messageIdx,
  isCheckpointGhost,
  currCheckpointIdx,
  _scrollToBottom,
}: {
  chatMessage: ChatMessage & { role: 'user' };
  messageIdx: number;
  currCheckpointIdx: number | undefined;
  isCheckpointGhost: boolean;
  _scrollToBottom: (() => void) | null;
}) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');
  const fileService = accessor.get('IFileService');
  const languageService = accessor.get('ILanguageService');

  // состояние редактирования из сервиса треда
  let isBeingEdited = false;
  let stagingSelections: StagingSelectionItem[] = [];
  let setIsBeingEdited = (_: boolean) => {};
  let setStagingSelections = (_: StagingSelectionItem[]) => {};

  if (messageIdx !== undefined) {
    const _state = chatThreadsService.getCurrentMessageState(messageIdx);
    isBeingEdited = _state.isBeingEdited;
    stagingSelections = _state.stagingSelections;
    setIsBeingEdited = (v) =>
      chatThreadsService.setCurrentMessageState(messageIdx, { isBeingEdited: v });
    setStagingSelections = (s) =>
      chatThreadsService.setCurrentMessageState(messageIdx, { stagingSelections: s });
  }

  // локальный UI (hover, focus, disabled)
  const mode: ChatBubbleMode = isBeingEdited ? 'edit' : 'display';
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);
  const [textAreaRefState, setTextAreaRef] = useState<HTMLTextAreaElement | null>(null);
  const textAreaFnsRef = useRef<TextAreaFns | null>(null);
  const [editImages, setEditImages] = useState<ChatImageAttachment[]>(chatMessage.images ?? []);
  const editFileInputRef = useRef<HTMLInputElement | null>(null);
  const supportsVision = useChatSupportsVision();
  // синхронизация поля при входе в режим edit
  const _mustInitialize = useRef(true);
  const _justEnabledEdit = useRef(false);
  useEffect(() => {
    const canInitialize = mode === 'edit' && textAreaRefState;
    const shouldInitialize = _justEnabledEdit.current || _mustInitialize.current;
    if (canInitialize && shouldInitialize) {
      setStagingSelections(chatMessage.selections || []);
      setEditImages(chatMessage.images ?? []);

      if (textAreaFnsRef.current) textAreaFnsRef.current.setValue(chatMessage.displayContent || '');

      textAreaRefState.focus();

      _justEnabledEdit.current = false;
      _mustInitialize.current = false;
    }
  }, [
    chatMessage,
    mode,
    _justEnabledEdit,
    textAreaRefState,
    textAreaFnsRef.current,
    _justEnabledEdit.current,
    _mustInitialize.current,
  ]);

  useEffect(() => {
    if (!supportsVision) {
      setEditImages([]);
    }
  }, [supportsVision]);

  const onOpenEdit = () => {
    setIsBeingEdited(true);
    chatThreadsService.setCurrentlyFocusedMessageIdx(messageIdx);
    _justEnabledEdit.current = true;
  };
  const onCloseEdit = () => {
    setIsFocused(false);
    setIsHovered(false);
    setIsBeingEdited(false);
    chatThreadsService.setCurrentlyFocusedMessageIdx(undefined);
  };

  const EditSymbol = mode === 'display' ? Pencil : X;

  const appendEditImages = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const next = await filesToChatImageAttachments(files, editImages);
      setEditImages(next);
      setIsDisabled(!textAreaRefState?.value && next.length === 0);
    },
    [editImages, textAreaRefState],
  );

  const onPickEditFiles = useCallback(async () => {
    editFileInputRef.current?.click();
  }, []);

  const onEditFilesPicked = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const { imageFiles, selections: picked } = await partitionPickedChatFiles(files, {
        fileService,
        languageService,
        includeImages: supportsVision,
      });
      if (imageFiles.length) {
        await appendEditImages(imageFiles);
      }
      for (const item of picked) {
        chatThreadsService.addNewStagingSelection(item);
      }
      if (picked.length) {
        setIsDisabled(false);
      }
    },
    [
      appendEditImages,
      chatThreadsService,
      fileService,
      languageService,
      supportsVision,
    ],
  );

  const editDropZone = useChatDropZone({
    includeImages: supportsVision,
    onImages: appendEditImages,
    onSelections: (items) => {
      for (const item of items) {
        chatThreadsService.addNewStagingSelection(item);
      }
    },
  });

  let chatbubbleContents: React.ReactNode;
  if (mode === 'display') {
    chatbubbleContents = (
      <>
        <SelectedFiles
          type="past"
          messageIdx={messageIdx}
          selections={chatMessage.selections || []}
        />
        {(chatMessage.images?.length ?? 0) > 0 && (
          <SelectedImages type="past" images={chatMessage.images!} />
        )}
        <span className="px-0.5 select-text cursor-text">{chatMessage.displayContent}</span>
      </>
    );
  } else if (mode === 'edit') {
    const onSubmit = async () => {
      if (isDisabled) return;
      if (!textAreaRefState) return;
      if (messageIdx === undefined) return;

      // прерываем стрим перед редактированием
      const threadId = chatThreadsService.state.currentThreadId;

      await chatThreadsService.abortRunning(threadId);

      // выходим из режима редактирования
      setIsBeingEdited(false);
      chatThreadsService.setCurrentlyFocusedMessageIdx(undefined);

      // отправляем отредактированное сообщение
      const userMessage = textAreaRefState.value;
      try {
        await chatThreadsService.editUserMessageAndStreamResponse({
          userMessage,
          messageIdx,
          threadId,
          images: editImages,
        });
      } catch (e) {
        console.error('Error while editing message:', e);
      }
      await chatThreadsService.focusCurrentChat();
      requestAnimationFrame(() => _scrollToBottom?.());
    };

    const onAbort = async () => {
      const threadId = chatThreadsService.state.currentThreadId;
      await chatThreadsService.abortRunning(threadId);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        onCloseEdit();
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        onSubmit();
      }
    };

    if (!chatMessage.content && !chatMessage.images?.length) {
      // пустое сообщение без картинок не рендерим
      return null;
    }

    chatbubbleContents = (
      <div
        className="relative w-full"
        onDragEnter={editDropZone.onDragEnter}
        onDragOver={editDropZone.onDragOver}
        onDragLeave={editDropZone.onDragLeave}
        onDrop={editDropZone.onDrop}
      >
        <ChatDropOverlay visible={editDropZone.isDragOver} />
        <SapphireChatArea
          featureName="Chat"
          onSubmit={onSubmit}
          onAbort={onAbort}
          isStreaming={false}
          isDisabled={isDisabled}
          showSelections
          selections={stagingSelections}
          setSelections={setStagingSelections}
          images={editImages}
          setImages={(imgs) => {
            setEditImages(imgs);
            setIsDisabled(!textAreaRefState?.value && imgs.length === 0);
          }}
          onPickFiles={onPickEditFiles}
          showProjectIndexStatus={false}
        >
          <input
            ref={editFileInputRef}
            type="file"
            accept={chatAttachFileAccept(supportsVision)}
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              await onEditFilesPicked(files);
            }}
          />
          <SapphireInputBox2
            enableAtToMention
            ref={setTextAreaRef}
            className="min-h-[81px] max-h-[500px] px-0.5"
            placeholder="Редактировать сообщение..."
            onChangeText={(text) => setIsDisabled(!text && editImages.length === 0)}
            onFocus={() => {
              setIsFocused(true);
              chatThreadsService.setCurrentlyFocusedMessageIdx(messageIdx);
            }}
            onBlur={() => {
              setIsFocused(false);
            }}
            onKeyDown={onKeyDown}
            onPaste={async (e) => {
              if (!supportsVision) return;
              const files = imageFilesFromDataTransfer(e.clipboardData);
              if (!files.length) return;
              e.preventDefault();
              await appendEditImages(files);
            }}
            fnsRef={textAreaFnsRef}
            multiline
          />
        </SapphireChatArea>
      </div>
    );
  }

  const isMsgAfterCheckpoint =
    currCheckpointIdx !== undefined && currCheckpointIdx === messageIdx - 1;

  return (
    <div
      // выравнивание пузыря по роли
      className={`
        relative ml-auto
        ${
          mode === 'edit'
            ? 'w-full max-w-full'
            : mode === 'display'
              ? `self-end w-fit max-w-full whitespace-pre-wrap`
              : '' // user: pre-wrap для переносов
        }

        ${isCheckpointGhost && !isMsgAfterCheckpoint ? 'opacity-50 pointer-events-none' : ''}
    `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        // стили пузыря по режиму display/edit
        className={`
            text-left rounded-xl max-w-full
            ${
              mode === 'edit'
                ? ''
                : mode === 'display'
                  ? 'p-2.5 flex flex-col bg-void-bg-1-alt text-void-fg-1 overflow-x-auto cursor-pointer'
                  : ''
            }
        `}
        onClick={() => {
          if (mode === 'display') {
            onOpenEdit();
          }
        }}
      >
        {chatbubbleContents}
      </div>

      <div
        className="absolute -top-1 -right-1 translate-x-0 -translate-y-0 z-1"
        // data-tooltip-id='sapphire-tooltip'
        // data-tooltip-content='Редактировать сообщение'
        // data-tooltip-place='left'
      >
        <EditSymbol
          size={18}
          className={`
                    cursor-pointer
                    p-[2px]
                    bg-void-bg-1 border border-void-border-1 rounded-md
                    transition-opacity duration-200 ease-in-out
                    ${isHovered || (isFocused && mode === 'edit') ? 'opacity-100' : 'opacity-0'}
                `}
          onClick={() => {
            if (mode === 'display') {
              onOpenEdit();
            } else if (mode === 'edit') {
              onCloseEdit();
            }
          }}
        />
      </div>
    </div>
  );
};
const AssistantMessageComponent = ({
  chatMessage,
  isCheckpointGhost,
  isCommitted,
  messageIdx,
  showContinueButton,
}: {
  chatMessage: ChatMessage & { role: 'assistant' };
  isCheckpointGhost: boolean;
  messageIdx: number;
  isCommitted: boolean;
  showContinueButton?: boolean;
}) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');

  const visibleTurn = promoteEmptyDisplayFromReasoning(
    chatMessage.displayContent,
    chatMessage.reasoning ?? '',
  );
  const displayContent = visibleTurn.displayContent;
  const reasoningStr = visibleTurn.reasoning.trim() || null;
  const hasReasoning = !!reasoningStr;
  const isDoneReasoning = !!displayContent;
  const thread = chatThreadsService.getCurrentThread();

  const chatMessageLocation: ChatMessageLocation = {
    threadId: thread.id,
    messageIdx,
  };

  const onContinue = useCallback(() => {
    void chatThreadsService.addUserMessageAndStreamResponse({
      userMessage: 'продолжай',
      threadId: thread.id,
    });
  }, [chatThreadsService, thread.id]);

  const isEmpty = !displayContent && !chatMessage.reasoning;
  if (isEmpty) return null;

  return (
    <>
      {/* Блок рассуждений */}
      {hasReasoning && (
        <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
          <ReasoningWrapper isDoneReasoning={isDoneReasoning} isStreaming={!isCommitted}>
            <SmallProseWrapper>
              <ChatMarkdownRender
                string={reasoningStr}
                chatMessageLocation={chatMessageLocation}
                isApplyEnabled={false}
                isLinkDetectionEnabled
              />
            </SmallProseWrapper>
          </ReasoningWrapper>
        </div>
      )}

      {/* Ответ ассистента */}
      {displayContent && (
        <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
          <ProseWrapper>
            <ChatMarkdownRender
              string={displayContent}
              chatMessageLocation={chatMessageLocation}
              isApplyEnabled
              isLinkDetectionEnabled
            />
          </ProseWrapper>
          {chatMessage.usage && (
            <div className="mt-1 text-[11px] text-void-fg-3">
              {formatTokenCount(chatMessage.usage.prompt_tokens)} →{' '}
              {formatTokenCount(chatMessage.usage.completion_tokens)}
              {' · всего '}
              {formatTokenCount(chatMessage.usage.total_tokens)}
              {chatMessage.outputTokensPerSecond != null
                ? ` · ${chatMessage.outputTokensPerSecond} Токенов / сек`
                : ''}
            </div>
          )}
          {showContinueButton && !isCheckpointGhost ? (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={onContinue}
                className="px-2 py-1 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:opacity-90 rounded-sm text-sm font-medium"
              >
                Продолжить
              </button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
};

const ReasoningWrapper = ({
  isDoneReasoning,
  isStreaming,
  children,
}: {
  isDoneReasoning: boolean;
  isStreaming: boolean;
  children: React.ReactNode;
}) => {
  const isWriting = isStreaming && !isDoneReasoning;
  // по умолчанию свёрнуто — пользователь раскрывает цепочку рассуждений
  const [isOpen, setIsOpen] = useState(false);
  return (
    <ToolHeaderWrapper
      title="Рассуждение"
      desc1={isWriting ? <IconLoading /> : ''}
      isOpen={isOpen}
      onClick={() => setIsOpen((v) => !v)}
    >
      <ToolChildrenWrapper>
        <div className="!select-text cursor-auto">{children}</div>
      </ToolChildrenWrapper>
    </ToolHeaderWrapper>
  );
};
const Checkpoint = ({
  _message,
  threadId,
  messageIdx,
  isCheckpointGhost,
  threadIsRunning,
}: {
  message: CheckpointEntry;
  threadId: string;
  messageIdx: number;
  isCheckpointGhost: boolean;
  threadIsRunning: boolean;
}) => {
  const accessor = useAccessor();
  const chatThreadService = accessor.get('IChatThreadService');
  const streamState = useFullChatThreadsStreamState();

  const isRunning = useChatThreadsStreamState(threadId)?.isRunning;
  const isDisabled = useMemo(() => {
    if (isRunning) return true;
    return !!Object.keys(streamState).find((threadId2) => streamState[threadId2]?.isRunning);
  }, [isRunning, streamState]);

  return (
    <div className={`flex items-center justify-center px-2 `}>
      <div
        className={`
                    text-xs
                    text-void-fg-3
                    select-none
                    ${isCheckpointGhost ? 'opacity-50' : 'opacity-100'}
					${isDisabled ? 'cursor-default' : 'cursor-pointer'}
                `}
        style={{ position: 'relative', display: 'inline-block' }} // relative для абсolute-иконки редактирования
        onClick={() => {
          if (threadIsRunning) return;
          if (isDisabled) return;
          chatThreadService.jumpToCheckpointBeforeMessageIdx({
            threadId,
            messageIdx,
            jumpToUserModified:
              messageIdx ===
              (chatThreadService.state.allThreads[threadId]?.messages.length ?? 0) - 1,
          });
        }}
        {...(isDisabled
          ? {
              'data-tooltip-id': 'sapphire-tooltip',
              'data-tooltip-content': `Недоступно ${isRunning ? 'во время выполнения' : 'пока выполняется другой чат'}`,
              'data-tooltip-place': 'top',
            }
          : {})}
      >
        Контрольная точка
      </div>
    </div>
  );
};

type ChatBubbleMode = 'display' | 'edit';
type ChatBubbleProps = {
  chatMessage: ChatMessage;
  messageIdx: number;
  isCommitted: boolean;
  chatIsRunning: IsRunningType;
  threadId: string;
  currCheckpointIdx: number | undefined;
  _scrollToBottom: (() => void) | null;
  showContinueButton?: boolean;
  /** fsPath плана для схлопывания create_plan/update_plan в ленте (пин или building/built). */
  collapsePlanUriFsPath?: string | null;
};

const ChatBubble = (props: ChatBubbleProps) => (
  <ErrorBoundary>
    <_ChatBubble {...props} />
  </ErrorBoundary>
);

const _ChatBubble = ({
  threadId,
  chatMessage,
  currCheckpointIdx,
  isCommitted,
  messageIdx,
  chatIsRunning,
  _scrollToBottom,
  showContinueButton,
  collapsePlanUriFsPath,
}: ChatBubbleProps) => {
  const role = chatMessage.role;

  const isCheckpointGhost = messageIdx > (currCheckpointIdx ?? Infinity) && !chatIsRunning; // «призрак» после checkpoint: серый, пока чат не идёт

  if (role === 'user') {
    // служебные user-сообщения без текста не показываем
    if (!chatMessage.displayContent?.trim() && !chatMessage.images?.length) {
      return null;
    }
    return (
      <UserMessageComponent
        chatMessage={chatMessage}
        isCheckpointGhost={isCheckpointGhost}
        currCheckpointIdx={currCheckpointIdx}
        messageIdx={messageIdx}
        _scrollToBottom={_scrollToBottom}
      />
    );
  }
  if (role === 'assistant') {
    return (
      <AssistantMessageComponent
        chatMessage={chatMessage}
        isCheckpointGhost={isCheckpointGhost}
        messageIdx={messageIdx}
        isCommitted={isCommitted}
        showContinueButton={showContinueButton}
      />
    );
  }
  if (role === 'tool') {
    if (chatMessage.type === 'invalid_params') {
      return (
        <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
          <InvalidTool
            toolName={chatMessage.name}
            message={chatMessage.content}
            mcpServerName={chatMessage.mcpServerName}
          />
        </div>
      );
    }

    if (shouldCollapsePlanToolInThread(chatMessage, collapsePlanUriFsPath)) {
      return (
        <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
          <PlanToolInlinePlaceholder
            toolMessage={chatMessage as ToolMessage<'create_plan'> | ToolMessage<'update_plan'>}
          />
        </div>
      );
    }

    const toolName = chatMessage.name;
    const isBuiltInTool = isABuiltinToolName(toolName);
    const ToolResultWrapper = isBuiltInTool
      ? (builtinToolNameToComponent[toolName]?.resultWrapper as ResultWrapper<ToolName>)
      : (MCPToolWrapper as ResultWrapper<ToolName>);

    if (ToolResultWrapper)
      return (
        <>
          <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
            <ToolResultWrapper
              toolMessage={chatMessage}
              messageIdx={messageIdx}
              threadId={threadId}
            />
          </div>
          {chatMessage.type === 'tool_request' ? (
            <div className={`${isCheckpointGhost ? 'opacity-50 pointer-events-none' : ''}`}>
              <ToolRequestAcceptRejectButtons toolName={chatMessage.name} />
            </div>
          ) : null}
        </>
      );
    return null;
  }
  if (role === 'interrupted_streaming_tool') {
    return (
      <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
        <CanceledTool toolName={chatMessage.name} mcpServerName={chatMessage.mcpServerName} />
      </div>
    );
  }
  if (role === 'context_summary') {
    const from = chatMessage.compactedFromTokens;
    const to = chatMessage.compactedToTokens;
    const tokenHint =
      from != null && to != null
        ? `${formatTokenCount(from)} → ${formatTokenCount(to)}`
        : from != null
          ? `было ~${formatTokenCount(from)}`
          : null;
    return (
      <div
        className={`my-2 rounded-md border border-void-border-2 bg-void-bg-2/60 px-3 py-2 ${isCheckpointGhost ? 'opacity-50' : ''}`}
      >
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <div className="text-[11px] font-medium text-void-fg-2">Сводка контекста</div>
          {tokenHint ? (
            <div className="text-[11px] text-void-fg-3 whitespace-nowrap">{tokenHint}</div>
          ) : null}
        </div>
        <ProseWrapper>
          <ChatMarkdownRender
            string={chatMessage.displayContent || chatMessage.content}
            chatMessageLocation={{ threadId, messageIdx }}
            isApplyEnabled={false}
            isLinkDetectionEnabled
          />
        </ProseWrapper>
      </div>
    );
  }
  if (role === 'checkpoint') {
    return (
      <Checkpoint
        threadId={threadId}
        message={chatMessage}
        messageIdx={messageIdx}
        isCheckpointGhost={isCheckpointGhost}
        threadIsRunning={!!chatIsRunning}
      />
    );
  }
};

const countDiffLineStats = (
  sortedDiffIds: string[] | undefined,
  diffOfId: Record<string, Diff>,
): { added: number; removed: number } => {
  let added = 0;
  let removed = 0;
  if (!sortedDiffIds) return { added, removed };

  for (const diffId of sortedDiffIds) {
    const diff = diffOfId[diffId];
    if (!diff) continue;

    if (diff.type === 'insertion') {
      added += diff.endLine - diff.startLine + 1;
    } else if (diff.type === 'deletion') {
      removed += diff.originalEndLine - diff.originalStartLine + 1;
    } else {
      added += diff.endLine - diff.startLine + 1;
      removed += diff.originalEndLine - diff.originalStartLine + 1;
    }
  }

  return { added, removed };
};

const filesCountLabel = (count: number) => {
  if (count === 1) return '1 файл';
  if (count > 1 && count < 5) return `${count} файла`;
  return `${count} файлов`;
};

const SUGGESTED_PROMPTS = [
  'Кратко опиши мой проект',
  'Как устроены типы в Rust?',
  'Создай файл .rules',
];

const COPY_CHAT_LOG_FEEDBACK_MS = 1600;

const CopyChatLogButton = () => {
  const accessor = useAccessor();
  const clipboardService = accessor.get('IClipboardService');
  const chatThreadsService = accessor.get('IChatThreadService');
  const [label, setLabel] = useState('Скопировать лог');

  useEffect(() => {
    if (label === 'Скопировать лог') {
      return;
    }
    const timer = setTimeout(() => setLabel('Скопировать лог'), COPY_CHAT_LOG_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [label]);

  const onCopy = useCallback(() => {
    const thread = chatThreadsService.getCurrentThread();
    const sendTrace = formatChatSendTrace();
    const threadLog = formatChatThreadLog(thread.messages, {
      threadId: thread.id,
      createdAt: thread.createdAt,
    });
    const text = `${sendTrace}\n\n---\n\n${threadLog}`;
    void clipboardService
      .writeText(text)
      .then(() => setLabel('Скопировано'))
      .catch(() => setLabel('Не удалось скопировать'));
  }, [chatThreadsService, clipboardService]);

  return (
    <div className="flex justify-end pt-1.5">
      <button
        type="button"
        className="px-2 py-0.5 text-xs text-void-fg-3 hover:text-void-fg-1 transition-colors cursor-pointer"
        onClick={onCopy}
        title="Скопировать лог отправки и историю чата (для диагностики зависания)"
      >
        {label}
      </button>
    </div>
  );
};

const CommandBarInChat = () => {
  const review = useAgentsReview();
  const { stateOfURI: commandBarStateOfURI, sortedURIs: sortedCommandBarURIs } =
    useCommandBarState();
  const numFilesChanged = sortedCommandBarURIs.length;

  const accessor = useAccessor();
  const editCodeService = accessor.get('IEditCodeService');
  const sapphireCommandBarService = accessor.get('ISapphireCommandBarService');
  const modelService = accessor.get('IModelService');
  const languageService = accessor.get('ILanguageService');

  const [fileDetailsOpenedState, setFileDetailsOpenedState] = useState<
    'auto-opened' | 'auto-closed' | 'user-opened' | 'user-closed'
  >('auto-closed');
  const isFileDetailsOpened =
    fileDetailsOpenedState === 'auto-opened' || fileDetailsOpenedState === 'user-opened';

  useEffect(() => {
    if (numFilesChanged === 0) {
      setFileDetailsOpenedState('auto-closed');
    } else if (fileDetailsOpenedState !== 'user-closed') {
      setFileDetailsOpenedState('auto-opened');
    }
  }, [fileDetailsOpenedState, numFilesChanged]);

  const isFinishedMakingThreadChanges =
    numFilesChanged !== 0 &&
    sortedCommandBarURIs.every((uri) => !commandBarStateOfURI[uri.fsPath]?.isStreaming);

  if (numFilesChanged === 0) {
    return null;
  }

  const onRejectAll = () => {
    sortedCommandBarURIs.forEach((uri) => {
      editCodeService.acceptOrRejectAllDiffAreas({
        uri,
        removeCtrlKs: true,
        behavior: 'reject',
        _addToHistory: true,
      });
    });
  };

  const onAcceptAll = () => {
    sortedCommandBarURIs.forEach((uri) => {
      editCodeService.acceptOrRejectAllDiffAreas({
        uri,
        removeCtrlKs: true,
        behavior: 'accept',
        _addToHistory: true,
      });
    });
  };

  const onReview = () => {
    if (review) {
      review.openReview(sortedCommandBarURIs[0]?.fsPath);
      return;
    }
    void sapphireCommandBarService.goToURIIdx(0);
  };

  return (
    <div className="select-none w-full rounded-t-lg bg-void-bg-3 text-void-fg-3 text-xs border-t border-l border-r border-void-border-3 overflow-hidden">
      <div className="flex w-full items-center justify-between px-2 py-1">
        <button
          type="button"
          className="flex items-center gap-1 cursor-pointer hover:brightness-125 transition-all duration-200"
          onClick={() =>
            isFileDetailsOpened
              ? setFileDetailsOpenedState('user-closed')
              : setFileDetailsOpenedState('user-opened')
          }
        >
          <ChevronRight
            className="size-3.5 transition-transform duration-200"
            style={{
              transform: isFileDetailsOpened ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          />
          <span>{filesCountLabel(numFilesChanged)}</span>
        </button>

        <div className="flex items-center gap-2">
          {isFinishedMakingThreadChanges && (
            <>
              <button
                type="button"
                className="px-1 py-0.5 text-void-fg-3 hover:text-void-fg-1 transition-colors cursor-pointer"
                onClick={onRejectAll}
              >
                Отменить все
              </button>
              <button
                type="button"
                className="px-1 py-0.5 text-void-fg-3 hover:text-void-fg-1 transition-colors cursor-pointer"
                onClick={onAcceptAll}
              >
                Оставить все
              </button>
            </>
          )}
          <button
            type="button"
            className="px-2 py-0.5 rounded bg-void-bg-2 text-void-fg-1 hover:brightness-125 transition-all cursor-pointer border border-void-border-2"
            onClick={onReview}
          >
            Проверить
          </button>
        </div>
      </div>

      <div
        className={`
					overflow-hidden transition-all duration-200 ease-in-out
					${isFileDetailsOpened ? 'max-h-64' : 'max-h-0'}
				`}
      >
        <div className="px-2 pb-1.5 flex flex-col gap-0.5 overflow-y-auto max-h-64 show-file-icons">
          {sortedCommandBarURIs.map((uri) => {
            const basename = getBasename(uri.fsPath);
            const { sortedDiffIds } = commandBarStateOfURI[uri.fsPath] ?? {};
            const { added, removed } = countDiffLineStats(sortedDiffIds, editCodeService.diffOfId);
            const iconClasses = getIconClasses(
              modelService,
              languageService,
              uri,
              FileKind.FILE,
            ).join(' ');

            return (
              <div
                key={uri.fsPath}
                className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:brightness-125 transition-all duration-200 min-w-0"
                onClick={() => {
                  if (review) {
                    review.openReview(uri.fsPath);
                    return;
                  }
                  sapphireOpenFileFn(uri, accessor);
                }}
              >
                <span
                  className={`monaco-icon-label ${iconClasses} shrink-0`}
                  style={{ width: 16, height: 16, paddingLeft: 16 }}
                />
                <span className="truncate text-void-fg-2">{basename}</span>
                <span className="flex items-center gap-1.5 shrink-0 ml-1 font-mono tabular-nums">
                  {added > 0 && <span className="text-green-500">+{added}</span>}
                  {removed > 0 && <span className="text-red-500">-{removed}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
export const SidebarChat = ({ variant = 'sidebar' }: { variant?: 'sidebar' | 'agents' }) => {
  const reviewOpen = useAgentsReview()?.reviewOpen ?? false;
  const planOpen = useAgentsPlan()?.planOpen ?? false;
  const sidePaneOpen = reviewOpen || planOpen;
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const textAreaFnsRef = useRef<TextAreaFns | null>(null);

  const accessor = useAccessor();
  const commandService = accessor.get('ICommandService');
  const chatThreadsService = accessor.get('IChatThreadService');
  const fileService = accessor.get('IFileService');
  const languageService = accessor.get('ILanguageService');

  const settingsState = useSettingsState();
  // ----- состояние из сервисов -----

  // треды и staging
  const chatThreadsState = useChatThreadsState();

  const currentThread = chatThreadsService.getCurrentThread();
  const previousMessages = currentThread?.messages ?? EMPTY_CHAT_MESSAGES;

  const selections = currentThread.state.stagingSelections;
  const setSelections = (s: StagingSelectionItem[]) => {
    chatThreadsService.setCurrentThreadState({ stagingSelections: s });
  };

  // стрим LLM / инструментов
  const currThreadStreamState = useChatThreadsStreamState(chatThreadsState.currentThreadId);
  const isRunning = currThreadStreamState?.isRunning;
  const latestError = currThreadStreamState?.error;
  const statusHint =
    currThreadStreamState?.isRunning === 'LLM' ||
    currThreadStreamState?.isRunning === 'idle' ||
    currThreadStreamState?.isRunning === 'preparing'
      ? currThreadStreamState.statusHint
      : undefined;
  const { displayContentSoFar, toolCallsSoFar, reasoningSoFar, firstTokenAt } =
    currThreadStreamState?.llmInfo ?? {};
  const liveTokensPerSecond = useLiveOutputTokensPerSecond(
    displayContentSoFar,
    reasoningSoFar,
    firstTokenAt,
    isRunning === 'LLM',
  );

  // генерация текста инструмента, не факт что весь агент «running»
  const toolIsGenerating = !!toolCallsSoFar?.some((tc) => !tc.isDone); // индикатор для медленных edit_file / rewrite

  // ----- локальное состояние композера -----

  // черновик и вложения (persist в thread.state через setComposerDraft)
  const threadIdForDraft = currentThread.id;
  const [instructionsAreEmpty, setInstructionsAreEmpty] = useState(
    !(currentThread.state.draftText ?? ''),
  );
  const [draftText, setDraftText] = useState(currentThread.state.draftText ?? '');
  const [stagingImages, setStagingImages] = useState<ChatImageAttachment[]>(
    currentThread.state.stagingImages ?? [],
  );
  /** initValue для SapphireInputBox2 — только при смене треда, не на каждый символ. */
  const [composerInitValue, setComposerInitValue] = useState<string | null>(
    currentThread.state.draftText || null,
  );
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const supportsVision = useChatSupportsVision();

  // восстановить черновик при смене треда (вместо wipe)
  useEffect(() => {
    const state = chatThreadsService.state.allThreads[threadIdForDraft]?.state;
    const text = state?.draftText ?? '';
    const images = state?.stagingImages ?? [];
    setDraftText(text);
    setStagingImages(images);
    setInstructionsAreEmpty(!text);
    setComposerInitValue(text || null);
  }, [threadIdForDraft, chatThreadsService]);

  useEffect(() => {
    if (!supportsVision) {
      setStagingImages((prev) => {
        if (!prev.length) return prev;
        const text =
          chatThreadsService.state.allThreads[threadIdForDraft]?.state.draftText ?? '';
        chatThreadsService.setComposerDraft(threadIdForDraft, {
          draftText: text,
          stagingImages: [],
        });
        return [];
      });
    }
  }, [supportsVision, chatThreadsService, threadIdForDraft]);

  const persistComposerDraft = useCallback(
    (text: string, images: ChatImageAttachment[]) => {
      chatThreadsService.setComposerDraft(threadIdForDraft, {
        draftText: text,
        stagingImages: images,
      });
    },
    [chatThreadsService, threadIdForDraft],
  );

  const setStagingImagesAndPersist = useCallback(
    (images: ChatImageAttachment[]) => {
      setStagingImages(images);
      const text =
        chatThreadsService.state.allThreads[threadIdForDraft]?.state.draftText ?? '';
      chatThreadsService.setComposerDraft(threadIdForDraft, {
        draftText: text,
        stagingImages: images,
      });
    },
    [chatThreadsService, threadIdForDraft],
  );

  const modelSelection = settingsState.modelSelectionOfFeature.Chat;
  const chatMode = settingsState.globalSettings.chatMode;
  const contextUsage = useChatContextUsage(
    previousMessages,
    chatMode,
    modelSelection,
    draftText,
    stagingImages,
    currentThread?.state.activePlan?.status === 'building',
    currentThread?.state.enabledMcpServers,
  );

  const isDisabled =
    (instructionsAreEmpty && stagingImages.length === 0) ||
    !!isFeatureNameDisabled('Chat', settingsState);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const appendStagingImages = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const next = await filesToChatImageAttachments(files, stagingImages);
      setStagingImagesAndPersist(next);
    },
    [stagingImages, setStagingImagesAndPersist],
  );

  const onPickComposerFiles = useCallback(() => {
    imageFileInputRef.current?.click();
  }, []);

  const onComposerFilesPicked = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const { imageFiles, selections: picked } = await partitionPickedChatFiles(files, {
        fileService,
        languageService,
        includeImages: supportsVision,
      });
      if (imageFiles.length) {
        await appendStagingImages(imageFiles);
      }
      for (const item of picked) {
        chatThreadsService.addNewStagingSelection(item);
      }
    },
    [appendStagingImages, chatThreadsService, fileService, languageService, supportsVision],
  );

  const chatDropZone = useChatDropZone({
    includeImages: supportsVision,
    onImages: appendStagingImages,
    onSelections: (items) => {
      for (const item of items) {
        chatThreadsService.addNewStagingSelection(item);
      }
    },
  });

  const onSubmit = useCallback(
    async (_forceSubmit?: string) => {
      if (isDisabled && !_forceSubmit) return;

      const threadId = chatThreadsService.state.currentThreadId;
      const userMessage = _forceSubmit || textAreaRef.current?.value || '';
      const images = stagingImages.length ? stagingImages : undefined;
      const currentSelections = selections.length ? [...selections] : undefined;

      const clearComposerForThread = () => {
        setSelections([]);
        setStagingImages([]);
        setDraftText('');
        setInstructionsAreEmpty(true);
        setComposerInitValue(null);
        chatThreadsService.setComposerDraft(threadId, {
          draftText: '',
          stagingImages: [],
        });
        textAreaFnsRef.current?.setValue('');
      };

      if (isRunning) {
        // Follow-up в очередь только при живом агенте (LLM/tool/idle).
        // preparing / stale React — обычный send, иначе мёртвая очередь без bubble.
        const serviceRunning = chatThreadsService.streamState[threadId]?.isRunning;
        chatTrace(
          threadId,
          'submit',
          `react=${isRunning} service=${serviceRunning ?? 'none'} chars=${userMessage.length}`,
        );
        if (canEnqueueFollowUp(serviceRunning)) {
          chatTrace(threadId, 'submit.enqueue', `service=${serviceRunning}`);
          chatThreadsService.enqueueUserMessage({
            threadId,
            text: userMessage,
            images,
            selections: currentSelections,
          });
          clearComposerForThread();
          textAreaRef.current?.focus();
          return;
        }
      }

      chatTrace(threadId, 'submit.send', `react=${isRunning ?? 'none'} chars=${userMessage.length}`);

      // Сразу очищаем поле — сообщение появится в ленте до окончания Jira/моста.
      // selections/images уже сняты в локальные константы и уходят в addUserMessage.
      clearComposerForThread();

      try {
        await chatThreadsService.addUserMessageAndStreamResponse({
          userMessage,
          threadId,
          images,
          _chatSelections: currentSelections,
        });
      } catch (e) {
        console.error('Error while sending message in chat:', e);
      }

      // Не трогаем композер другого чата: хвост await после Stop+новый чат
      if (chatThreadsService.state.currentThreadId !== threadId) {
        return;
      }
      textAreaRef.current?.focus();
    },
    [
      chatThreadsService,
      isDisabled,
      isRunning,
      textAreaRef,
      textAreaFnsRef,
      setSelections,
      selections,
      stagingImages,
    ],
  );

  const onAbort = async () => {
    const threadId = currentThread.id;
    await chatThreadsService.abortRunning(threadId);
  };

  const threadId = currentThread.id;
  const currCheckpointIdx =
    chatThreadsState.allThreads[threadId]?.state?.currCheckpointIdx ?? undefined; // нет checkpoint — считаем, что откат до «конца»

  // привязка textAreaRef к whenMounted (sidebar ↔ agents)
  const isResolved =
    chatThreadsState.allThreads[threadId]?.state.mountedInfo?.mountedIsResolvedRef.current;
  useEffect(() => {
    const mountInfo = chatThreadsState.allThreads[threadId]?.state.mountedInfo;
    if (!mountInfo) return;
    const scrollToBottomFn = () => scrollToBottom(scrollContainerRef);
    if (!mountInfo.mountedIsResolvedRef.current) {
      mountInfo._whenMountedResolver?.({
        textAreaRef,
        scrollToBottom: scrollToBottomFn,
      });
      return;
    }
    // другая поверхность могла уже зарегистрировать mount
    // перепривязываем ref к видимому композеру
    void mountInfo.whenMounted.then((mounted) => {
      mounted.textAreaRef = textAreaRef;
      mounted.scrollToBottom = scrollToBottomFn;
    });
  }, [chatThreadsState, threadId, textAreaRef, scrollContainerRef, isResolved]);

  // Полная карточка плана над композером (вне скролла) — только ready
  const pinnedPlanMessage = useMemo(
    () => findPinnedPlanToolMessage(previousMessages, currentThread?.state.activePlan),
    [previousMessages, currentThread?.state.activePlan],
  );
  const collapsePlanUriFsPath = planUriFsPathToCollapseInThread(
    currentThread?.state.activePlan,
  );

  const previousMessagesHTML = useMemo(
    () => {
      let lastPauseIdx = -1;
      for (let i = 0; i < previousMessages.length; i++) {
        const m = previousMessages[i];
        if (m.role === 'assistant' && m.pauseReason) {
          lastPauseIdx = i;
        }
      }
      const resumedAfterPause =
        lastPauseIdx >= 0 &&
        previousMessages.slice(lastPauseIdx + 1).some((m) => m.role === 'user');
      return previousMessages.map((message, i) => (
        <ChatBubble
          key={i}
          currCheckpointIdx={currCheckpointIdx}
          chatMessage={message}
          messageIdx={i}
          isCommitted
          chatIsRunning={isRunning}
          threadId={threadId}
          _scrollToBottom={() => scrollToBottom(scrollContainerRef)}
          showContinueButton={i === lastPauseIdx && !isRunning && !resumedAfterPause}
          collapsePlanUriFsPath={collapsePlanUriFsPath}
        />
      ));
    },
    [previousMessages, threadId, currCheckpointIdx, isRunning, collapsePlanUriFsPath],
  );

  const streamingChatIdx = previousMessagesHTML.length;
  const currStreamingMessageHTML =
    reasoningSoFar || displayContentSoFar || isRunning ? (
      <ChatBubble
        key="curr-streaming-msg"
        currCheckpointIdx={currCheckpointIdx}
        chatMessage={{
          role: 'assistant',
          displayContent: displayContentSoFar ?? '',
          reasoning: reasoningSoFar ?? '',
        }}
        messageIdx={streamingChatIdx}
        isCommitted={false}
        chatIsRunning={isRunning}

        threadId={threadId}
        _scrollToBottom={null}
      />
    ) : null;

  // параллельные tool_calls одного ответа LLM
  const generatingTool = toolIsGenerating
    ? (toolCallsSoFar ?? [])
        .filter((tc) => tc.name === 'edit_file' || tc.name === 'rewrite_file')
        .map((tc, i) => (
          <EditToolSoFar key={`curr-streaming-tool-${tc.id || i}`} toolCallSoFar={tc} />
        ))
    : null;

  const messagesHTML = (
    <ScrollToBottomContainer
      key={`messages${chatThreadsState.currentThreadId}`} // key по threadId — полный remount ленты
      scrollContainerRef={scrollContainerRef}
      style={{ flex: '1 1 auto', minHeight: 0 }}
      className={`
			flex flex-col
			px-4 py-4 space-y-4
			w-full
			overflow-x-hidden
			overflow-y-auto
			${previousMessagesHTML.length === 0 && !displayContentSoFar ? 'hidden' : ''}
		`}
    >
      {/* История сообщений */}
      {previousMessagesHTML}
      {currStreamingMessageHTML}

      {/* Стриминг edit/rewrite */}
      {generatingTool}

      {/* Индикатор «думаю» */}
      {isRunning === 'LLM' ||
      isRunning === 'preparing' ||
      (isRunning === 'idle' && !toolIsGenerating) ? (
        <ProseWrapper>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <IconLoading className="opacity-50 text-sm" label="Думаю" />
              {statusHint ? (
                <span className="text-[11px] leading-snug text-void-fg-3">{statusHint}</span>
              ) : null}
            </div>
            {isRunning === 'LLM' && liveTokensPerSecond != null ? (
              <span className="shrink-0 text-right text-[11px] tabular-nums text-void-fg-3">
                {liveTokensPerSecond} Токенов / сек
              </span>
            ) : null}
          </div>
        </ProseWrapper>
      ) : null}

      {/* Ошибка стрима */}
      {latestError === undefined ? null : (
        <div className="px-2 my-1">
          <ErrorDisplay
            message={latestError.message}
            fullError={latestError.fullError}
            onDismiss={() => {
              chatThreadsService.dismissStreamError(currentThread.id);
            }}
            showDismiss
          />

          <WarningBox
            className="text-sm my-2 mx-4"
            onClick={() => {
              commandService.executeCommand(SAPPHIRE_OPEN_SETTINGS_ACTION_ID);
            }}
            text="Открыть настройки"
          />
        </div>
      )}
    </ScrollToBottomContainer>
  );

  const onChangeText = useCallback(
    (newStr: string) => {
      setInstructionsAreEmpty(!newStr);
      setDraftText(newStr);
      persistComposerDraft(newStr, stagingImages);
    },
    [persistComposerDraft, stagingImages],
  );
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        if ((e.metaKey || e.ctrlKey) && isRunning) {
          const queue = chatThreadsService.getMessageQueue(threadId);
          if (queue.length) {
            e.preventDefault();
            void chatThreadsService.steerQueuedMessage(threadId, queue[0].id);
            return;
          }
        }
        e.preventDefault();
        onSubmit();
      } else if (e.key === 'Escape' && isRunning) {
        onAbort();
      }
    },
    [onSubmit, onAbort, isRunning, chatThreadsService, threadId],
  );

  const onEditQueued = useCallback(
    (item: {
      text: string;
      images?: ChatImageAttachment[];
      selections?: StagingSelectionItem[];
    }) => {
      const images = item.images ?? [];
      textAreaFnsRef.current?.setValue(item.text);
      setInstructionsAreEmpty(!item.text);
      setDraftText(item.text);
      setStagingImages(images);
      persistComposerDraft(item.text, images);
      if (item.selections) setSelections(item.selections);
      textAreaRef.current?.focus();
    },
    [persistComposerDraft, setSelections, textAreaFnsRef, textAreaRef],
  );

  const isLandingPage = previousMessages.length === 0;

  const inputChatArea = (
    <div className="flex flex-col">
      <QueuedMessagesPanel threadId={threadId} onEditQueued={onEditQueued} />
      <SapphireChatArea
        featureName="Chat"
        onSubmit={() => onSubmit()}
        onAbort={onAbort}
        isStreaming={!!isRunning}
        isDisabled={isDisabled}
        showSelections
        selections={selections}
        setSelections={setSelections}
        images={stagingImages}
        setImages={setStagingImagesAndPersist}
        onPickFiles={onPickComposerFiles}
        onClickAnywhere={() => {
          textAreaRef.current?.focus();
        }}
        contextUsage={isLandingPage ? undefined : contextUsage}
        showProjectIndexStatus={variant === 'agents'}
      >
        <input
          ref={imageFileInputRef}
          type="file"
          accept={chatAttachFileAccept(supportsVision)}
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            await onComposerFilesPicked(files);
          }}
        />
        <SapphireInputBox2
          enableAtToMention
          className="min-h-[81px] px-0.5 py-0.5"
          placeholder={
            variant === 'agents'
              ? 'Сообщение, / для скиллов, @ для контекста, файлы xlsx, docx, pptx, pdf'
              : supportsVision
                ? 'Продолжить… (изображение, xlsx, docx, pptx, pdf)'
                : 'Продолжить… (xlsx, docx, pptx, pdf)'
          }
          initValue={composerInitValue}
          onChangeText={onChangeText}
          onKeyDown={onKeyDown}
          onPaste={async (e) => {
            if (!supportsVision) return;
            const files = imageFilesFromDataTransfer(e.clipboardData);
            if (!files.length) return;
            e.preventDefault();
            await appendStagingImages(files);
          }}
          onFocus={() => {
            chatThreadsService.setCurrentlyFocusedMessageIdx(undefined);
          }}
          ref={textAreaRef}
          fnsRef={textAreaFnsRef}
          multiline
        />
      </SapphireChatArea>
    </div>
  );

  const initiallySuggestedPromptsHTML = (
    <div className="flex flex-col gap-2 w-full text-nowrap text-void-fg-3 select-none">
      {SUGGESTED_PROMPTS.map((text) => (
        <div
          key={text}
          className="py-1 px-2 rounded text-sm bg-void-bg-2-hover hover:bg-void-bg-2-alt cursor-pointer opacity-80 hover:opacity-100"
          onClick={() => onSubmit(text)}
        >
          {text}
        </div>
      ))}
    </div>
  );

  const suggestedPromptChips = (
    <div className="flex flex-wrap gap-2">
      {SUGGESTED_PROMPTS.map((text) => (
        <button
          key={text}
          type="button"
          className="py-1 px-3 rounded-full text-sm text-void-fg-3 border border-void-border-2 bg-void-bg-2 hover:bg-void-bg-2-alt hover:text-void-fg-1 cursor-pointer"
          onClick={() => onSubmit(text)}
        >
          {text}
        </button>
      ))}
    </div>
  );

  const threadPageInput = (
    <div
      key={`input${chatThreadsState.currentThreadId}`}
      className="px-2 pb-2"
      style={{ flex: '0 0 auto' }}
    >
      {pinnedPlanMessage ? (
        <div className="px-2 pb-1">
          <ErrorBoundary>
            <PlanToolCard toolMessage={pinnedPlanMessage} />
          </ErrorBoundary>
        </div>
      ) : null}
      <CommandBarInChat />
      {inputChatArea}
      <CopyChatLogButton />
    </div>
  );

  const landingPageInput = (
    <div>
      <div className="pt-3">{inputChatArea}</div>
    </div>
  );

  const projectName = accessor.get('IWorkspaceContextService').getWorkspace().folders[0]?.name;

  const landingPageContent =
    variant === 'agents' ? (
      <div
        ref={sidebarRef}
        className="relative w-full h-full flex items-center justify-center px-6"
        onDragEnter={chatDropZone.onDragEnter}
        onDragOver={chatDropZone.onDragOver}
        onDragLeave={chatDropZone.onDragLeave}
        onDrop={chatDropZone.onDrop}
      >
        <ChatDropOverlay visible={chatDropZone.isDragOver} />
        <div className={sidePaneOpen ? 'w-full' : 'w-full max-w-[800px]'}>
          <div className="mb-4">
            <div className="text-2xl text-void-fg-1">Новый чат</div>
            <div className="text-sm text-void-fg-3 mt-1">
              {projectName
                ? `Проект ${projectName}. Спросите про код, план или правку.`
                : 'Папка проекта не открыта. Спросите про код, план или правку.'}
            </div>
          </div>
          <ErrorBoundary>{landingPageInput}</ErrorBoundary>
          <div className="pt-4">
            <div className="mb-2 text-sm text-void-fg-3 select-none">Примеры запросов</div>
            {suggestedPromptChips}
          </div>
        </div>
      </div>
    ) : (
      <div
        ref={sidebarRef}
        className="relative w-full h-full max-h-full flex flex-col overflow-auto px-4"
        onDragEnter={chatDropZone.onDragEnter}
        onDragOver={chatDropZone.onDragOver}
        onDragLeave={chatDropZone.onDragLeave}
        onDrop={chatDropZone.onDrop}
      >
        <ChatDropOverlay visible={chatDropZone.isDragOver} />
        <ErrorBoundary>{landingPageInput}</ErrorBoundary>

        {Object.keys(chatThreadsState.allThreads).length > 1 ? ( // блок «Предыдущие чаты», если тредов больше одного
          <ErrorBoundary>
            <div className="pt-8 mb-2 text-void-fg-3 text-root select-none pointer-events-none">
              Предыдущие чаты
            </div>
            <PastThreadsList />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary>
            <div className="pt-8 mb-2 text-void-fg-3 text-root select-none pointer-events-none">
              Подсказки
            </div>
            {initiallySuggestedPromptsHTML}
          </ErrorBoundary>
        )}
      </div>
    );

  const threadPageContent = (
    <div
      ref={sidebarRef}
      className="relative w-full h-full flex flex-col overflow-hidden"
      onDragEnter={chatDropZone.onDragEnter}
      onDragOver={chatDropZone.onDragOver}
      onDragLeave={chatDropZone.onDragLeave}
      onDrop={chatDropZone.onDrop}
    >
      <ChatDropOverlay visible={chatDropZone.isDragOver} />
      <div
        className={`flex flex-col flex-1 min-h-0 h-full ${
          variant === 'agents'
            ? sidePaneOpen
              ? 'w-full'
              : 'w-full max-w-[800px] mx-auto'
            : 'w-full'
        }`}
      >
        <ErrorBoundary>{messagesHTML}</ErrorBoundary>
        <ErrorBoundary>{threadPageInput}</ErrorBoundary>
      </div>
    </div>
  );

  return (
    <Fragment
      key={threadId} // remount при смене треда
    >
      {isLandingPage ? landingPageContent : threadPageContent}
    </Fragment>
  );
};

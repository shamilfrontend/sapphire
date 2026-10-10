import { Disposable } from '../../../../base/common/lifecycle.js';
import { deepClone } from '../../../../base/common/objects.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import {
  ChatImageAttachment,
  ChatMessage,
  EMPTY_LLM_MESSAGE,
} from '../common/chatThreadServiceTypes.js';
import { chatImageToDataUrl } from '../common/chatImageUtils.js';
import {
  chatTokenCalibrator,
  estimateMessageTokens,
  estimateTextTokens,
  estimateToolCallTokens,
  MIN_CONTEXT_TOKEN_BUDGET,
} from '../common/estimateTokens.js';
import { compactOldToolResults } from '../common/compactChatContext.js';
import { contextSummaryToLlmContent } from '../common/contextCompaction.js';
import {
  estimateTrimableMessageTokens,
  trimMessagesToFreeTokens,
} from '../common/trimChatContext.js';
import {
  effectiveReservedOutputTokens,
  getIsReasoningEnabledState,
  getReservedOutputTokenSpace,
  getModelCapabilities,
} from '../common/modelCapabilities.js';
import {
  chat_systemMessage,
  estimateToolsJsonTokens,
  splitBuiltinAndMcpTools,
} from '../common/prompt/prompts.js';
import {
  LLMChatMessage,
  LLMFIMMessage,
  GatewayChatContentPart,
  GatewayChatMessage,
  RawToolParamsObj,
} from '../common/sendLLMMessageTypes.js';
import { ISapphireSettingsService } from '../common/sapphireSettingsService.js';
import {
  ChatMode,
  FeatureName,
  ModelSelection,
  ProviderName,
  skillInstructionsForUserText,
} from '../common/sapphireSettingsTypes.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import { ITerminalToolService } from './terminalToolService.js';
import { ISapphireModelService } from '../common/sapphireModelService.js';
import { URI } from '../../../../base/common/uri.js';
import { EndOfLinePreference } from '../../../../editor/common/model.js';
import { ToolName } from '../common/toolsServiceTypes.js';
import { IMCPService } from '../common/mcpService.js';
import { IMemoriesService } from '../common/memoriesService.js';
import {
  mergeEnabledMcpServers,
  onlineMcpServerNames,
} from '../common/prompt/mcpToolDisclosure.js';

type SimpleLLMMessage =
  | {
      role: 'tool';
      content: string;
      id: string;
      name: ToolName;
      rawParams: RawToolParamsObj;
    }
  | {
      role: 'user';
      content: string;
      images?: ChatImageAttachment[];
    }
  | {
      role: 'assistant';
      content: string;
    };

const userMessageToGatewayContent = (
  content: string,
  images: ChatImageAttachment[] | undefined,
  supportsVision: boolean,
): string | GatewayChatContentPart[] => {
  if (!supportsVision || !images?.length) {
    return content;
  }
  const parts: GatewayChatContentPart[] = [{ type: 'text', text: content || EMPTY_LLM_MESSAGE }];
  for (const img of images) {
    parts.push({
      type: 'image_url',
      image_url: { url: chatImageToDataUrl(img) },
    });
  }
  return parts;
};

// Нативный формат Chat Completions (wire как у OpenAI)
/*
"tool_calls":[{ "type":"function", "id":"…", "function":{ "name":"…", "arguments":"{…}" } }]
tool result: { "role":"tool", "tool_call_id":"…", "content":"…" }
*/

const prepareMessages_native_tools = (
  messages: SimpleLLMMessage[],
  supportsVision: boolean,
): GatewayChatMessage[] => {
  const newMessages: GatewayChatMessage[] = [];

  for (let i = 0; i < messages.length; i += 1) {
    const currMsg = messages[i];

    if (currMsg.role !== 'tool') {
      if (currMsg.role === 'user') {
        newMessages.push({
          role: 'user',
          content: userMessageToGatewayContent(currMsg.content, currMsg.images, supportsVision),
        });
      } else {
        newMessages.push({
          role: 'assistant',
          content: currMsg.content,
        });
      }
      continue;
    }

    // Дополняем предыдущее assistant-сообщение synthetic tool_calls
    // Идём назад мимо уже добавленных tool-результатов, чтобы несколько вызовов одного хода
    // попали в один assistant.tool_calls[] (append, не replace).
    let assistantMsg: GatewayChatMessage | undefined;
    for (let j = newMessages.length - 1; j >= 0; j -= 1) {
      const candidate = newMessages[j];
      if (candidate.role === 'assistant') {
        assistantMsg = candidate;
        break;
      }
      if (candidate.role !== 'tool') break;
    }
    if (assistantMsg?.role === 'assistant') {
      if (!assistantMsg.tool_calls) assistantMsg.tool_calls = [];
      assistantMsg.tool_calls.push({
        type: 'function',
        id: currMsg.id,
        function: {
          name: currMsg.name,
          arguments: JSON.stringify(currMsg.rawParams),
        },
      });
    }

    // Сам результат tool на wire
    newMessages.push({
      role: 'tool',
      tool_call_id: currMsg.id,
      content: currMsg.content,
    });
  }
  return newMessages;
};

// --- ЧАТ ---

const prepareGatewayMessages = ({
  messages: messages_,
  systemMessage,
  aiInstructions,
  skillInstructions,
  supportsSystemMessage,
  contextWindow,
  reservedOutputTokenSpace,
  supportsVision,
}: {
  messages: SimpleLLMMessage[];
  systemMessage: string;
  aiInstructions: string;
  skillInstructions: string;
  supportsSystemMessage: false | 'system-role';
  contextWindow: number;
  reservedOutputTokenSpace: number | null | undefined;
  supportsVision?: boolean;
}): { messages: GatewayChatMessage[]; separateSystemMessage: string | undefined } => {
  reservedOutputTokenSpace = effectiveReservedOutputTokens(
    contextWindow,
    reservedOutputTokenSpace,
  );
  let messages: SimpleLLMMessage[] = deepClone(messages_);

  // ================ system message (не участвует в весах trim) ================
  const sysMsgParts: string[] = [];
  if (aiInstructions)
    sysMsgParts.push(`GUIDELINES (from the user's .rules file):\n${aiInstructions}`);
  if (skillInstructions) sysMsgParts.push(`SKILLS:\n${skillInstructions}`);
  if (systemMessage) sysMsgParts.push(systemMessage);
  const combinedSystemMessage = sysMsgParts.join('\n\n');
  const systemTokens = estimateMessageTokens({ content: combinedSystemMessage });

  // ================ обрезка пробелов у не-tool сообщений ================
  messages = messages.map((m) => ({
    ...m,
    content: m.role !== 'tool' ? m.content.trim() : m.content,
  }));

  // ================ уложить диалог в контекст (system считается отдельно) ================
  // Больший вес → чаще попадает под trim. System в этот список не входит.
  const sumConversationTokens = () => {
    let tokens = 0;
    for (const m of messages) {
      tokens += estimateTrimableMessageTokens(m);
    }
    return tokens;
  };
  const tokenBudget = Math.max(contextWindow - reservedOutputTokenSpace, MIN_CONTEXT_TOKEN_BUDGET);
  const tokensOverBudget = () =>
    Math.max(0, chatTokenCalibrator.apply(sumConversationTokens() + systemTokens) - tokenBudget);
  // Сначала сжимаем старые дампы tool; обрезка до 120 символов — только если всё ещё не влезает.
  let remainingTokensToTrim = tokensOverBudget();
  if (remainingTokensToTrim > 0) {
    compactOldToolResults(messages);
    remainingTokensToTrim = tokensOverBudget();
  }
  trimMessagesToFreeTokens(messages, remainingTokensToTrim);

  // ================ сообщения → native Chat Completions wire ================
  const llmMessages = prepareMessages_native_tools(messages, !!supportsVision);

  let separateSystemMessageStr: string | undefined;

  if (supportsSystemMessage) {
    llmMessages.unshift({ role: 'system', content: combinedSystemMessage });
  } else {
    const first = llmMessages[0];
    const firstContent =
      typeof first?.content === 'string'
        ? first.content
        : Array.isArray(first?.content)
          ? ((
              first.content.find((c) => (c as { type: string }).type === 'text') as
                { text?: string } | undefined
            )?.text ?? '')
          : '';
    const newFirstMessage = {
      role: 'user' as const,
      content: `<SYSTEM_MESSAGE>\n${combinedSystemMessage}\n</SYSTEM_MESSAGE>\n${firstContent}`,
    };
    if (llmMessages.length) llmMessages.splice(0, 1);
    llmMessages.unshift(newFirstMessage);
  }

  // ================ пустые content заменяем placeholder (некоторые API падают на "") ================
  for (let i = 0; i < llmMessages.length; i += 1) {
    const currMsg: GatewayChatMessage = llmMessages[i];
    const nextMsg: GatewayChatMessage | undefined = llmMessages[i + 1];

    if (currMsg.role === 'tool') continue;

    if (typeof currMsg.content === 'string') {
      currMsg.content = currMsg.content || EMPTY_LLM_MESSAGE;
    } else {
      if (nextMsg?.role === 'tool') continue;

      for (const c of currMsg.content) {
        if (c.type === 'text') c.text = c.text || EMPTY_LLM_MESSAGE;
      }
      if (currMsg.content.length === 0)
        currMsg.content = [{ type: 'text', text: EMPTY_LLM_MESSAGE }];
      else if (
        currMsg.role === 'user' &&
        Array.isArray(currMsg.content) &&
        currMsg.content.every((c) => (c as { type: string }).type !== 'text') &&
        currMsg.content.some((c) => (c as { type: string }).type === 'image_url')
      ) {
        currMsg.content = [
          { type: 'text', text: EMPTY_LLM_MESSAGE },
          ...(currMsg.content as GatewayChatContentPart[]),
        ];
      }
    }
  }

  return {
    messages: llmMessages,
    separateSystemMessage: separateSystemMessageStr,
  } as const;
};

const prepareMessages = (params: {
  messages: SimpleLLMMessage[];
  systemMessage: string;
  aiInstructions: string;
  skillInstructions: string;
  supportsSystemMessage: false | 'system-role';
  contextWindow: number;
  reservedOutputTokenSpace: number | null | undefined;
  providerName: ProviderName;
  supportsVision?: boolean;
}): { messages: LLMChatMessage[]; separateSystemMessage: string | undefined } => {
  return prepareGatewayMessages(params);
};

type ContextUsageCategoryId = 'system' | 'tools' | 'rules' | 'skills' | 'mcp' | 'conversation';

type ContextUsageCategory = {
  id: ContextUsageCategoryId;
  label: string;
  tokens: number;
  color: string;
};

export type ChatContextUsage = {
  contextWindow: number;
  usedTokens: number;
  /** Токены, зарезервированные под ответ модели; совпадает с reserve при отправке. */
  reservedTokens: number;
  percentFull: number;
  categories: ContextUsageCategory[];
};

const CONTEXT_USAGE_META: Record<ContextUsageCategoryId, { label: string; color: string }> = {
  system: { label: 'Системный промпт', color: '#9CA3AF' },
  tools: { label: 'Определения инструментов', color: '#C4B5FD' },
  rules: { label: 'Правила', color: '#86EFAC' },
  skills: { label: 'Скиллы', color: '#FDE047' },
  mcp: { label: 'MCP и динамические инструменты', color: '#F9A8D4' },
  conversation: { label: 'Диалог', color: '#FB923C' },
};

export interface IConvertToLLMMessageService {
  readonly _serviceBrand: undefined;
  prepareLLMSimpleMessages: (opts: {
    simpleMessages: SimpleLLMMessage[];
    systemMessage: string;
    modelSelection: ModelSelection | null;
    featureName: FeatureName;
  }) => { messages: LLMChatMessage[]; separateSystemMessage: string | undefined };
  prepareLLMChatMessages: (opts: {
    chatMessages: ChatMessage[];
    chatMode: ChatMode;
    modelSelection: ModelSelection | null;
  }) => Promise<{ messages: LLMChatMessage[]; separateSystemMessage: string | undefined }>;
  prepareFIMMessage(opts: { messages: LLMFIMMessage }): {
    prefix: string;
    suffix: string;
    stopTokens: string[];
  };
  estimateChatContextUsage: (opts: {
    chatMessages: ChatMessage[];
    chatMode: ChatMode;
    modelSelection: ModelSelection | null;
    draftText?: string;
    draftImages?: ChatImageAttachment[];
    allowUpdatePlan?: boolean;
    /** MCP-серверы, уже включённые в треде; упоминания в draftText добавляются сверху. */
    enabledMcpServerNames?: readonly string[];
    excludedToolNames?: readonly string[];
  }) => Promise<ChatContextUsage | null>;
}

export const IConvertToLLMMessageService = createDecorator<IConvertToLLMMessageService>(
  'ConvertToLLMMessageService',
);

class ConvertToLLMMessageService extends Disposable implements IConvertToLLMMessageService {
  _serviceBrand: undefined;

  constructor(
    @IModelService private readonly modelService: IModelService,
    @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
    @IEditorService private readonly editorService: IEditorService,
    @IDirectoryStrService private readonly directoryStrService: IDirectoryStrService,
    @ITerminalToolService private readonly terminalToolService: ITerminalToolService,
    @ISapphireSettingsService private readonly sapphireSettingsService: ISapphireSettingsService,
    @ISapphireModelService private readonly sapphireModelService: ISapphireModelService,
    @IMCPService private readonly mcpService: IMCPService,
    @IMemoriesService private readonly memoriesService: IMemoriesService,
  ) {
    super();
  }

  // Читаем .rules (или legacy .voidrules) из папок workspace
  private _getSapphireRulesFileContents(): string {
    try {
      const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
      let sapphireRules = '';
      for (const folder of workspaceFolders) {
        for (const name of ['.rules', '.voidrules'] as const) {
          const uri = URI.joinPath(folder.uri, name);
          const { model } = this.sapphireModelService.getModel(uri);
          if (!model) {
            continue;
          }
          sapphireRules += `${model.getValue(EndOfLinePreference.LF)}\n\n`;
          break;
        }
      }
      return sapphireRules.trim();
    } catch (_e) {
      return '';
    }
  }

  // Объединяем AI-инструкции из настроек и .rules
  private _getCombinedAIInstructions(): string {
    const globalAIInstructions = this.sapphireSettingsService.state.globalSettings.aiInstructions;
    const sapphireRulesFileContent = this._getSapphireRulesFileContents();

    const ans: string[] = [];
    if (globalAIInstructions) ans.push(globalAIInstructions);
    if (sapphireRulesFileContent) ans.push(sapphireRulesFileContent);
    return ans.join('\n\n');
  }

  // Читаем .skills (или legacy .voidskills) из папок workspace
  private _getSapphireSkillsFileContents(): string {
    try {
      const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
      let sapphireSkills = '';
      for (const folder of workspaceFolders) {
        for (const name of ['.skills', '.voidskills'] as const) {
          const uri = URI.joinPath(folder.uri, name);
          const { model } = this.sapphireModelService.getModel(uri);
          if (!model) {
            continue;
          }
          sapphireSkills += `${model.getValue(EndOfLinePreference.LF)}\n\n`;
          break;
        }
      }
      return sapphireSkills.trim();
    } catch (_e) {
      return '';
    }
  }

  // Always-on skills из настроек + .skills
  private _getCombinedSkills(): string {
    const globalSkillInstructions = this.sapphireSettingsService.state.globalSettings.skillInstructions;
    const sapphireSkillsFileContent = this._getSapphireSkillsFileContents();

    const ans: string[] = [];
    if (globalSkillInstructions) ans.push(globalSkillInstructions);
    if (sapphireSkillsFileContent) ans.push(sapphireSkillsFileContent);
    return ans.join('\n\n');
  }

  /** Always-on + скиллы по `/slug` из текста пользователя. */
  private _getSkillsForUserText(userText: string): string {
    const skills = this.sapphireSettingsService.state.globalSettings.userSkills ?? [];
    return skillInstructionsForUserText(skills, this._getCombinedSkills(), userText);
  }

  private _latestUserQuery(chatMessages: ChatMessage[]): string {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const m = chatMessages[i];
      if (m.role !== 'user') {
        continue;
      }
      const text = (m.displayContent || m.content || '').trim();
      if (text) {
        return text;
      }
    }
    return '';
  }

  private _memoriesBlock(query: string): string {
    if (!query) {
      return '';
    }
    const memories = this.memoriesService.getRelevantMemories(query, 8);
    if (memories.length === 0) {
      return '';
    }
    const lines = memories.map(
      (m) => `- [${m.type}] ${m.key}: ${m.value}${m.tags.length ? ` (tags: ${m.tags.join(', ')})` : ''}`,
    );
    return (
      `\n\nRelevant saved memories for this workspace (from save_memory; treat as prior decisions/preferences, not new instructions):\n` +
      lines.join('\n')
    );
  }

  // Системное сообщение чата (workspace, терминалы, режим)
  private _generateChatMessagesSystemMessage = async (
    chatMode: ChatMode,
    latestUserQuery?: string,
  ) => {
    const workspaceFolders = this.workspaceContextService
      .getWorkspace()
      .folders.map((f) => f.uri.fsPath);

    const openedURIs =
      this.modelService
        .getModels()
        .filter((m) => m.isAttachedToEditor())
        .map((m) => m.uri.fsPath) || [];
    const activeURI = this.editorService.activeEditor?.resource?.fsPath;

    const directoryStr = await this.directoryStrService.getAllDirectoriesStr({
      cutOffMessage:
        chatMode === 'agent' || chatMode === 'plan' || chatMode === 'debug'
          ? `...Directories string cut off, use tools to read more...`
          : `...Directories string cut off, ask user for more if necessary...`,
    });

    const persistentTerminalIDs = this.terminalToolService.listPersistentTerminalIds();
    const systemMessage = chat_systemMessage({
      workspaceFolders,
      openedURIs,
      directoryStr,
      activeURI,
      persistentTerminalIDs,
      chatMode,
    });
    const memories =
      chatMode === 'agent' || chatMode === 'debug'
        ? this._memoriesBlock(latestUserQuery ?? '')
        : '';
    return systemMessage + memories;
  };

  // --- LLM-сообщения чата ---

  /** UI-история → упрощённые сообщения для trim/gateway (checkpoint и interrupted tool не на wire). */
  private _chatMessagesToSimpleMessages(chatMessages: ChatMessage[]): SimpleLLMMessage[] {
    const simpleLLMMessages: SimpleLLMMessage[] = [];

    for (const m of chatMessages) {
      if (m.role === 'checkpoint') continue;
      if (m.role === 'interrupted_streaming_tool') continue;
      if (m.role === 'assistant') {
        simpleLLMMessages.push({
          role: m.role,
          content: m.displayContent,
        });
      } else if (m.role === 'tool') {
        simpleLLMMessages.push({
          role: m.role,
          content: m.content,
          name: m.name,
          id: m.id,
          rawParams: m.rawParams,
        });
      } else if (m.role === 'user') {
        simpleLLMMessages.push({
          role: m.role,
          content: m.content,
          ...(m.images?.length ? { images: m.images } : {}),
        });
      } else if (m.role === 'context_summary') {
        simpleLLMMessages.push({
          role: 'user',
          content: contextSummaryToLlmContent(m),
        });
      }
    }
    return simpleLLMMessages;
  }

  prepareLLMSimpleMessages: IConvertToLLMMessageService['prepareLLMSimpleMessages'] = ({
    simpleMessages,
    systemMessage,
    modelSelection,
    featureName,
  }) => {
    if (modelSelection === null) return { messages: [], separateSystemMessage: undefined };

    const { overridesOfModel } = this.sapphireSettingsService.state;

    const { providerName, modelName } = modelSelection;
    const { contextWindow, supportsSystemMessage, supportsVision } = getModelCapabilities(
      providerName,
      modelName,
      overridesOfModel,
    );

    const modelSelectionOptions =
      this.sapphireSettingsService.state.optionsOfModelSelection[featureName][
        modelSelection.providerName
      ]?.[modelSelection.modelName];

    // Правила и always-on skills (simple path без истории чата)
    const aiInstructions = this._getCombinedAIInstructions();
    const skillInstructions = this._getCombinedSkills();

    const isReasoningEnabled = getIsReasoningEnabledState(
      featureName,
      providerName,
      modelName,
      modelSelectionOptions,
      overridesOfModel,
    );
    const reservedOutputTokenSpace = getReservedOutputTokenSpace(providerName, modelName, {
      isReasoningEnabled,
      overridesOfModel,
    });

    const { messages, separateSystemMessage } = prepareMessages({
      messages: simpleMessages,
      systemMessage,
      aiInstructions,
      skillInstructions,
      supportsSystemMessage,
      contextWindow,
      reservedOutputTokenSpace,
      providerName,
      supportsVision,
    });
    return { messages, separateSystemMessage };
  };

  prepareLLMChatMessages: IConvertToLLMMessageService['prepareLLMChatMessages'] = async ({
    chatMessages,
    chatMode,
    modelSelection,
  }) => {
    if (modelSelection === null) return { messages: [], separateSystemMessage: undefined };

    const { overridesOfModel } = this.sapphireSettingsService.state;

    const { providerName, modelName } = modelSelection;
    const { contextWindow, supportsSystemMessage, supportsVision } = getModelCapabilities(
      providerName,
      modelName,
      overridesOfModel,
    );

    const { disableSystemMessage } = this.sapphireSettingsService.state.globalSettings;
    const latestUserQuery = this._latestUserQuery(chatMessages);
    const fullSystemMessage = await this._generateChatMessagesSystemMessage(
      chatMode,
      latestUserQuery,
    );
    const systemMessage = disableSystemMessage ? '' : fullSystemMessage;

    const modelSelectionOptions =
      this.sapphireSettingsService.state.optionsOfModelSelection.Chat[modelSelection.providerName]?.[
        modelSelection.modelName
      ];

    // Правила + always-on skills + `/slug` из последнего user-сообщения
    const aiInstructions = this._getCombinedAIInstructions();
    const skillInstructions = this._getSkillsForUserText(latestUserQuery);
    const isReasoningEnabled = getIsReasoningEnabledState(
      'Chat',
      providerName,
      modelName,
      modelSelectionOptions,
      overridesOfModel,
    );
    const reservedOutputTokenSpace = getReservedOutputTokenSpace(providerName, modelName, {
      isReasoningEnabled,
      overridesOfModel,
    });
    const llmMessages = this._chatMessagesToSimpleMessages(chatMessages);

    const { messages, separateSystemMessage } = prepareMessages({
      messages: llmMessages,
      systemMessage,
      aiInstructions,
      skillInstructions,
      supportsSystemMessage,
      contextWindow,
      reservedOutputTokenSpace,
      providerName,
      supportsVision,
    });
    return { messages, separateSystemMessage };
  };

  estimateChatContextUsage: IConvertToLLMMessageService['estimateChatContextUsage'] = async ({
    chatMessages,
    chatMode,
    modelSelection,
    draftText,
    draftImages,
    allowUpdatePlan,
    enabledMcpServerNames,
    excludedToolNames,
  }) => {
    if (modelSelection === null) return null;

    const { overridesOfModel } = this.sapphireSettingsService.state;
    const { providerName, modelName } = modelSelection;
    const { contextWindow } = getModelCapabilities(providerName, modelName, overridesOfModel);
    const modelSelectionOptions =
      this.sapphireSettingsService.state.optionsOfModelSelection.Chat[providerName]?.[modelName];
    const isReasoningEnabled = getIsReasoningEnabledState(
      'Chat',
      providerName,
      modelName,
      modelSelectionOptions,
      overridesOfModel,
    );
    const reservedTokens = Math.round(
      effectiveReservedOutputTokens(
        contextWindow,
        getReservedOutputTokenSpace(providerName, modelName, {
          isReasoningEnabled,
          overridesOfModel,
        }),
      ),
    );

    const { disableSystemMessage } = this.sapphireSettingsService.state.globalSettings;
    const mcpTools = this.mcpService.getMCPTools();
    const enabledForEstimate = mergeEnabledMcpServers(
      enabledMcpServerNames,
      draftText ?? '',
      onlineMcpServerNames(mcpTools),
    );

    // Те же поля, что уходят на wire (system / tools / rules / skills / диалог+tool_calls)
    let systemTokens = 0;
    if (!disableSystemMessage) {
      const latestUserQuery = draftText?.trim() || this._latestUserQuery(chatMessages);
      const systemWithoutTools = await this._generateChatMessagesSystemMessage(
        chatMode,
        latestUserQuery,
      );
      systemTokens = estimateMessageTokens({ content: systemWithoutTools });
    }

    const { builtin, mcp } = splitBuiltinAndMcpTools(chatMode, mcpTools, {
      allowUpdatePlan,
      enabledMcpServerNames: enabledForEstimate,
      excludedToolNames,
    });
    const toolsTokens = estimateToolsJsonTokens(builtin);
    const mcpTokens = estimateToolsJsonTokens(mcp);

    const rulesTokens = estimateTextTokens(this._getCombinedAIInstructions());
    const skillEstimateText =
      draftText?.trim() || this._latestUserQuery(chatMessages);
    const skillsTokens = estimateTextTokens(this._getSkillsForUserText(skillEstimateText));

    let conversationTokens = 0;
    for (const m of chatMessages) {
      if (m.role === 'checkpoint' || m.role === 'interrupted_streaming_tool') continue;
      if (m.role === 'assistant') {
        // На wire: content ассистента (displayContent) + synthetic tool_calls из следующих tool-msg
        conversationTokens += estimateMessageTokens({ content: m.displayContent ?? '' });
      } else if (m.role === 'tool') {
        conversationTokens += estimateMessageTokens({ content: m.content ?? '' });
        conversationTokens += estimateToolCallTokens({
          name: m.name,
          argumentsJson: JSON.stringify(m.rawParams ?? {}),
        });
      } else if (m.role === 'user') {
        conversationTokens += estimateMessageTokens({
          content: m.content ?? '',
          imageCount: m.images?.length ?? 0,
        });
      } else if (m.role === 'context_summary') {
        conversationTokens += estimateMessageTokens({
          content: contextSummaryToLlmContent(m),
        });
      }
    }
    if (draftText || draftImages?.length) {
      conversationTokens += estimateMessageTokens({
        content: draftText ?? '',
        imageCount: draftImages?.length ?? 0,
      });
    }

    const raw: { id: ContextUsageCategoryId; tokens: number }[] = [
      { id: 'system', tokens: systemTokens },
      { id: 'tools', tokens: toolsTokens },
      { id: 'rules', tokens: rulesTokens },
      { id: 'skills', tokens: skillsTokens },
      { id: 'mcp', tokens: mcpTokens },
      { id: 'conversation', tokens: conversationTokens },
    ];

    const categories: ContextUsageCategory[] = raw
      .map(({ id, tokens }) => ({
        id,
        label: CONTEXT_USAGE_META[id].label,
        color: CONTEXT_USAGE_META[id].color,
        tokens: chatTokenCalibrator.apply(tokens),
      }))
      .filter((c) => c.tokens > 0);

    const usedTokens = categories.reduce((sum, c) => sum + c.tokens, 0);
    const percentFull =
      contextWindow > 0 ? Math.min(100, Math.round((usedTokens / contextWindow) * 100)) : 0;

    return {
      contextWindow,
      usedTokens,
      reservedTokens,
      percentFull,
      categories,
    };
  };

  // --- FIM (fill-in-the-middle) ---

  prepareFIMMessage: IConvertToLLMMessageService['prepareFIMMessage'] = ({ messages }) => {
    // Инструкции из настроек/.rules встраиваем в prefix как комментарии (не трогаем строки ниже)
    const combinedInstructions = this._getCombinedAIInstructions();

    let prefix = `\
${
  !combinedInstructions
    ? ''
    : `\
// Instructions:
// Do not output an explanation. Try to avoid outputting comments. Only output the middle code.
${combinedInstructions
  .split('\n')
  .map((line) => `//${line}`)
  .join('\n')}`
}

${messages.prefix}`;

    const suffix = messages.suffix;
    const stopTokens = messages.stopTokens;
    return { prefix, suffix, stopTokens };
  };
}

registerSingleton(IConvertToLLMMessageService, ConvertToLLMMessageService, InstantiationType.Eager);

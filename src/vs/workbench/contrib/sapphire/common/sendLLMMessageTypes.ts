/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { InternalToolInfo } from './prompt/prompts.js';
import { ToolName, ToolParamName } from './toolsServiceTypes.js';
import {
  ChatMode,
  FeatureName,
  ModelSelection,
  ModelSelectionOptions,
  OverridesOfModel,
  ProviderName,
  SettingsOfProvider,
} from './sapphireSettingsTypes.js';

export const errorDetails = (fullError: Error | null): string | null => {
  if (fullError === null) {
    return null;
  }
  if (typeof fullError === 'object') {
    if (Object.keys(fullError).length === 0) return null;
    return JSON.stringify(fullError, null, 2);
  }
  if (typeof fullError === 'string') {
    return null;
  }
  return null;
};

export const getErrorMessage: (error: unknown) => string = (error) => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return `${error}`;
};

/** Multimodal-части user-сообщения для Chat Completions. */
export type GatewayChatContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** Форма сообщений Chat Completions (OpenAI-совместимая). */
export type GatewayChatMessage =
  | {
      role: 'system';
      content: string;
    }
  | {
      role: 'user';
      content: string | GatewayChatContentPart[];
    }
  | {
      role: 'assistant';
      content: string | { type: 'text'; text: string }[];
      tool_calls?: {
        type: 'function';
        id: string;
        function: { name: string; arguments: string };
      }[];
    }
  | {
      role: 'tool';
      content: string;
      tool_call_id: string;
    };

export type LLMChatMessage = GatewayChatMessage;

export type LLMFIMMessage = {
  prefix: string;
  suffix: string;
  stopTokens: string[];
};

export type RawToolParamsObj = {
  [paramName in ToolParamName<ToolName>]?: string;
};
export type RawToolCallObj = {
  name: ToolName;
  rawParams: RawToolParamsObj;
  doneParams: ToolParamName<ToolName>[];
  id: string;
  isDone: boolean;
};

/** Токены из `usage` шлюза (биллинг). Опционально — в стриме может не быть. */
export type LLMUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type OnText = (p: {
  fullText: string;
  fullReasoning: string;
  toolCalls?: RawToolCallObj[];
}) => void;
/** `choices[].finish_reason` шлюза в конце стрима (`stop`, `length`, `tool_calls`, …). */
export type LLMFinishReason = string;

export type OnFinalMessage = (p: {
  fullText: string;
  fullReasoning: string;
  toolCalls?: RawToolCallObj[];
  usage?: LLMUsage;
  /** Последний непустой `finish_reason` из стрима. */
  finishReason?: LLMFinishReason;
  /** Имена tools с невалидным JSON аргументов (часто обрезка при finishReason `length`). */
  truncatedToolNames?: string[];
}) => void;
export type OnError = (p: {
  message: string;
  fullError: Error | null;
  /**
   * Шлюз исчерпал ретраи 408/429 для этого запроса.
   * Agent loop показывает ошибку сразу (без лишних idle CHAT_RETRIES).
   */
  gatewayRetryExhausted?: boolean;
}) => void;
/** Перед паузой ретрая 408/429 на стороне шлюза. */
export type OnRetry = (p: {
  attempt: number;
  maxAttempts: number;
  status?: number;
  retryAfterSec?: number;
}) => void;
type OnAbort = () => void;
export type AbortRef = { current: (() => void) | null };

// типы сервисного слоя
type SendLLMType =
  | {
      messagesType: 'chatMessages';
      messages: LLMChatMessage[];
      separateSystemMessage: string | undefined;
      chatMode: ChatMode | null;
      /** false — agent/debug без update_plan. Если поле опущено, считается false. */
      allowUpdatePlan?: boolean;
      /**
       * MCP-серверы с полными схемами в контексте.
       * Если опущено — ни одного: модель видит только enable_mcp_server до включения сервера.
       */
      enabledMcpServerNames?: readonly string[];
      /** Builtin/MCP tools, исключённые из списка tools шлюза (напр. вложенный subagent). */
      excludedToolNames?: readonly string[];
      /** Если задано — на шлюз уходят только эти tools. */
      allowedToolNames?: readonly string[];
      /** true — tools не отправляются (wrap-up / синтез). */
      disableAllTools?: boolean;
    }
  | {
      messagesType: 'FIMMessage';
      messages: LLMFIMMessage;
      separateSystemMessage?: undefined;
      chatMode?: undefined;
      allowUpdatePlan?: undefined;
      enabledMcpServerNames?: undefined;
      excludedToolNames?: undefined;
      allowedToolNames?: undefined;
      disableAllTools?: undefined;
    };
export type ServiceSendLLMMessageParams = {
  onText: OnText;
  onFinalMessage: OnFinalMessage;
  onError: OnError;
  /** Опционально — не передаётся в autocomplete/SCM и т.п. */
  onRetry?: OnRetry;
  logging: { loggingName: string; loggingExtras?: { [k: string]: any } };
  featureName: FeatureName;
  modelSelection: ModelSelection | null;
  modelSelectionOptions: ModelSelectionOptions | undefined;
  overridesOfModel: OverridesOfModel | undefined;
  onAbort: OnAbort;
} & SendLLMType;

// параметры низкоуровневой sendLLMMessage
export type SendLLMMessageParams = {
  onText: OnText;
  onFinalMessage: OnFinalMessage;
  onError: OnError;
  onRetry?: OnRetry;
  logging: { loggingName: string; loggingExtras?: { [k: string]: any } };
  abortRef: AbortRef;
  requestId: string;
  featureName: FeatureName;

  modelSelection: ModelSelection;
  modelSelectionOptions: ModelSelectionOptions | undefined;
  overridesOfModel: OverridesOfModel | undefined;

  settingsOfProvider: SettingsOfProvider;
  mcpTools: InternalToolInfo[] | undefined;
} & SendLLMType;

// функции через IPC/proxy не передать — только event-listeners
type BlockedMainLLMMessageParams = 'onText' | 'onFinalMessage' | 'onError' | 'onRetry' | 'abortRef';
export type MainSendLLMMessageParams = Omit<SendLLMMessageParams, BlockedMainLLMMessageParams> & {
  requestId: string;
} & SendLLMType;

export type MainLLMMessageAbortParams = { requestId: string };

export type EventLLMMessageOnTextParams = Parameters<OnText>[0] & { requestId: string };
export type EventLLMMessageOnFinalMessageParams = Parameters<OnFinalMessage>[0] & {
  requestId: string;
};
export type EventLLMMessageOnErrorParams = Parameters<OnError>[0] & { requestId: string };
export type EventLLMMessageOnRetryParams = Parameters<OnRetry>[0] & { requestId: string };

// service → main → internal → event (обратно в renderer)

export type GatewayModelResponse = {
  id: string;
  created: number;
  object: 'model';
  owned_by: string;
};

// параметры низкоуровневого list models
export type ModelListParams<ModelResponse> = {
  providerName: ProviderName;
  settingsOfProvider: SettingsOfProvider;
  onSuccess: (param: { models: ModelResponse[] }) => void;
  onError: (param: { error: string }) => void;
  requestId?: string;
};

// параметры сервисного слоя (browser)
export type ServiceModelListParams<modelResponse> = {
  providerName: ProviderName;
  onSuccess: (param: { models: modelResponse[] }) => void;
  onError: (param: { error: any }) => void;
};

type BlockedMainModelListParams = 'onSuccess' | 'onError';
export type MainModelListParams<modelResponse> = Omit<
  ModelListParams<modelResponse>,
  BlockedMainModelListParams
> & { providerName: ProviderName; requestId: string };

export type EventModelListOnSuccessParams<modelResponse> = Parameters<
  ModelListParams<modelResponse>['onSuccess']
>[0] & { requestId: string };
export type EventModelListOnErrorParams<modelResponse> = Parameters<
  ModelListParams<modelResponse>['onError']
>[0] & { requestId: string };

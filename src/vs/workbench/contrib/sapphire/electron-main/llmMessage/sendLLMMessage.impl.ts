/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/* eslint-disable */
import OpenAI, { APIError } from 'openai';
/* eslint-enable */

import {
  LLMChatMessage,
  LLMFIMMessage,
  LLMUsage,
  ModelListParams,
  OnError,
  OnFinalMessage,
  OnRetry,
  OnText,
  RawToolCallObj,
  RawToolParamsObj,
} from '../../common/sendLLMMessageTypes.js';
import {
  ChatMode,
  displayInfoOfProviderName,
  FeatureName,
  ModelSelectionOptions,
  OverridesOfModel,
  ProviderName,
  SettingsOfProvider,
} from '../../common/sapphireSettingsTypes.js';
import {
  getSendableReasoningInfo,
  getModelCapabilities,
  getProviderCapabilities,
} from '../../common/modelCapabilities.js';
import {
  LLM_ERROR_HINTS,
  LLM_FIM_DEFAULT_MAX_TOKENS,
  parseExtraHeaders,
  resolveOpenAICompatibleBaseURL,
  type ProviderConnectionSettings,
} from '../../common/llmProviderConfig.js';
import { PPR_LLM_CONNECT_TIMEOUT_MS, PPR_LLM_STREAM_IDLE_MS } from '../../common/llmRetryStatus.js';
import { listAnthropicModels, sendAnthropicChat } from './sendAnthropic.js';
import { listGeminiModels, sendGeminiChat } from './sendGemini.js';
import { availableTools, InternalToolInfo } from '../../common/prompt/prompts.js';
import {
  getGatewayHttpAgentWithSystemCertificates,
  isTlsCertificateError,
} from './systemCertificatesFetch.js';

/** Ошибка таймаута до первого chunk стрима (create завис). */
class LLMConnectTimeoutError extends Error {
  override readonly name = 'LLMConnectTimeoutError';
  constructor() {
    super(LLM_ERROR_HINTS.connectTimeout);
  }
}

/**
 * AbortSignal для create с wall-clock таймаутом подключения.
 * При таймауте abort'ит локальный controller (не путать с user abort родителя).
 */
const withConnectTimeoutSignal = (
  parent: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; clear: () => void; didTimeout: () => boolean } => {
  const local = new AbortController();
  let timedOut = false;
  const onParentAbort = () => local.abort();
  if (parent.aborted) {
    local.abort();
  } else {
    parent.addEventListener('abort', onParentAbort);
  }
  const timer = setTimeout(() => {
    timedOut = true;
    local.abort();
  }, timeoutMs);
  return {
    signal: local.signal,
    didTimeout: () => timedOut,
    clear: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onParentAbort);
    },
  };
};

type InternalCommonMessageParams = {
  onText: OnText;
  onFinalMessage: OnFinalMessage;
  onError: OnError;
  onRetry?: OnRetry;
  providerName: ProviderName;
  settingsOfProvider: SettingsOfProvider;
  modelSelectionOptions: ModelSelectionOptions | undefined;
  overridesOfModel: OverridesOfModel | undefined;
  modelName: string;
  _setAborter: (aborter: () => void) => void;
  requestId: string;
  featureName: FeatureName;
};

type SendChatParams_Internal = InternalCommonMessageParams & {
  messages: LLMChatMessage[];
  separateSystemMessage: string | undefined;
  chatMode: ChatMode | null;
  mcpTools: InternalToolInfo[] | undefined;
  allowUpdatePlan?: boolean;
  enabledMcpServerNames?: readonly string[];
  excludedToolNames?: readonly string[];
  allowedToolNames?: readonly string[];
  disableAllTools?: boolean;
};
type SendFIMParams_Internal = InternalCommonMessageParams & {
  messages: LLMFIMMessage;
  separateSystemMessage: string | undefined;
};
type ListParams_Internal<ModelResponse> = ModelListParams<ModelResponse>;

const providerTitle = (providerName: ProviderName) => displayInfoOfProviderName(providerName).title;

const invalidApiKeyMessage = (providerName: ProviderName) =>
  LLM_ERROR_HINTS.unauthorized(providerTitle(providerName));

/** Максимум попыток при 408/429 (включая первую). */
const PPR_GATEWAY_MAX_ATTEMPTS = 3;
const PPR_GATEWAY_DEFAULT_RETRY_MS = 1_000;
const PPR_GATEWAY_MAX_RETRY_MS = 30_000;

const getGatewayErrorHeader = (error: APIError, name: string): string | undefined => {
  const headers = error.headers;
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  const value = headers[lower] ?? headers[name];
  return value == null || value === '' ? undefined : value;
};

/** Секунды из `Retry-After` (число или HTTP-date). */
const getRetryAfterSeconds = (error: APIError): number | undefined => {
  const raw = getGatewayErrorHeader(error, 'retry-after');
  if (!raw) return undefined;
  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber) && asNumber >= 0) return Math.ceil(asNumber);
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    const sec = Math.ceil((asDate - Date.now()) / 1000);
    return sec > 0 ? sec : 0;
  }
  return undefined;
};

const isRetryableProviderError = (error: unknown): error is APIError => {
  if (!(error instanceof OpenAI.APIError)) return false;
  if (error instanceof OpenAI.APIUserAbortError) return false;
  return error.status === 408 || error.status === 429;
};

/**
 * Повтор запросов при 408 / 429.
 * Уважает `Retry-After`, не ретраит abort и 401.
 * `run` получает AbortSignal текущего in-flight запроса; abort отменяет HTTP и retry-delay.
 */
const withProviderRetries = async <T>(
  run: (signal: AbortSignal) => Promise<T>,
  opts?: { setAborter?: (aborter: () => void) => void; onRetry?: OnRetry },
): Promise<T> => {
  let lastError: unknown;
  let aborted = false;
  let inFlight: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryReject: ((err: unknown) => void) | null = null;

  const abortAll = () => {
    aborted = true;
    inFlight?.abort();
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (retryReject) {
      const reject = retryReject;
      retryReject = null;
      reject(new OpenAI.APIUserAbortError());
    }
  };
  opts?.setAborter?.(abortAll);

  for (let attempt = 0; attempt < PPR_GATEWAY_MAX_ATTEMPTS; attempt++) {
    if (aborted) {
      throw new OpenAI.APIUserAbortError();
    }
    inFlight = new AbortController();
    try {
      return await run(inFlight.signal);
    } catch (error) {
      lastError = error;
      if (error instanceof OpenAI.APIUserAbortError || aborted) {
        throw error instanceof OpenAI.APIUserAbortError ? error : new OpenAI.APIUserAbortError();
      }
      if (!isRetryableProviderError(error) || attempt === PPR_GATEWAY_MAX_ATTEMPTS - 1) {
        throw error;
      }

      const retryAfterSec = getRetryAfterSeconds(error);
      const baseMs =
        retryAfterSec != null ? retryAfterSec * 1000 : PPR_GATEWAY_DEFAULT_RETRY_MS * 2 ** attempt;
      const delayMs = Math.min(Math.max(baseMs, 0), PPR_GATEWAY_MAX_RETRY_MS);
      // attempt — номер неудачной попытки (0-based); следующая — (attempt+2) из max.
      opts?.onRetry?.({
        attempt: attempt + 2,
        maxAttempts: PPR_GATEWAY_MAX_ATTEMPTS,
        status: error.status,
        ...(retryAfterSec != null ? { retryAfterSec } : {}),
      });

      await new Promise<void>((resolve, reject) => {
        retryReject = reject;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          retryReject = null;
          resolve();
        }, delayMs);
      });
    }
  }
  throw lastError;
};

/** Таймаут простоя открытого SSE/stream-итератора по wall-clock. */
const createStreamIdleWatchdog = (opts: {
  idleMs: number;
  onIdle: () => void;
}): { poke: () => void; clear: () => void } => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const poke = () => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      opts.onIdle();
    }, opts.idleMs);
  };
  poke();
  return { poke, clear };
};

/**
 * Приводит ошибку OpenAI-SDK к человеческому сообщению (401 / 408 / 429 / сеть).
 * Возвращает `null`, если это не «известная» ошибка — вызывающий код сам разберётся.
 *
 * Важно: OpenAI SDK часто оборачивает сетевые сбои в `APIConnectionError`
 * с текстом `"Connection error."` (а не в сырой `TypeError: fetch failed`).
 */
const humanizeGatewayError = (providerName: ProviderName, error: unknown): string | null => {
  if (!(error instanceof OpenAI.APIError)) return null;

  // Сеть / DNS / TLS / proxy — до HTTP-статуса дело не дошло.
  if (error instanceof OpenAI.APIConnectionError) {
    return isTlsCertificateError(error)
      ? LLM_ERROR_HINTS.tlsCertificate(providerTitle(providerName))
      : LLM_ERROR_HINTS.unreachable(providerTitle(providerName));
  }

  if (error instanceof OpenAI.APIUserAbortError) {
    return null; // abort и прочие пути обрабатывает вызывающий код
  }

  if (error.status === 401) return invalidApiKeyMessage(providerName);
  if (error.status === 408) {
    const retryAfterSec = getRetryAfterSeconds(error);
    return retryAfterSec != null
      ? `${LLM_ERROR_HINTS.queueTimeout} Повторите через ~${retryAfterSec} с.`
      : LLM_ERROR_HINTS.queueTimeout;
  }
  if (error.status === 429) {
    const retryAfterSec = getRetryAfterSeconds(error);
    const rateLimitType = getGatewayErrorHeader(error, 'rate_limit_type');
    const extras: string[] = [];
    if (retryAfterSec != null) extras.push(`повторите через ~${retryAfterSec} с`);
    if (rateLimitType) extras.push(`тип лимита: ${rateLimitType}`);
    return extras.length > 0
      ? `${LLM_ERROR_HINTS.rateLimited} (${extras.join(', ')})`
      : LLM_ERROR_HINTS.rateLimited;
  }
  if (error.status && error.status >= 500) {
    return `Ошибка провайдера ${providerTitle(providerName)} (${error.status}). Попробуйте позже.`;
  }
  return null;
};

// ------------ OpenAI-compatible (вспомогательные) ------------

const gatewayRequestOptions = (
  signal: AbortSignal | undefined,
  requestId: string | undefined,
  featureName?: FeatureName,
) => ({
  ...(signal ? { signal } : {}),
  headers: {
    ...(requestId ? { 'X-Request-Id': requestId } : {}),
    ...(featureName ? { 'X-Feature': featureName } : {}),
  },
});

const llmUsageFromGateway = (
  usage:
    | {
        prompt_tokens?: number | null;
        completion_tokens?: number | null;
        total_tokens?: number | null;
      }
    | null
    | undefined,
): LLMUsage | undefined => {
  if (!usage) return undefined;
  const prompt_tokens = usage.prompt_tokens ?? 0;
  const completion_tokens = usage.completion_tokens ?? 0;
  const total_tokens = usage.total_tokens ?? prompt_tokens + completion_tokens;
  if (prompt_tokens === 0 && completion_tokens === 0 && total_tokens === 0) return undefined;
  return { prompt_tokens, completion_tokens, total_tokens };
};

const gatewayErrorHaystack = (error: APIError): string =>
  `${error.message} ${JSON.stringify(error.error ?? '')}`.toLowerCase();

const isStreamOptionsRejected = (error: unknown): boolean => {
  if (!(error instanceof APIError) || error.status !== 400) return false;
  return gatewayErrorHaystack(error).includes('stream_options');
};

/** 400: шлюз/модель не поддерживает `stream: true` на /v1/completions. */
const isStreamUnsupported = (error: unknown): boolean => {
  if (!(error instanceof APIError) || error.status !== 400) return false;
  if (isStreamOptionsRejected(error)) return false;
  return gatewayErrorHaystack(error).includes('stream');
};

const newOpenAICompatibleSDK = async ({
  settingsOfProvider,
  providerName,
  modelName,
  purpose = 'chat',
}: {
  settingsOfProvider: SettingsOfProvider;
  providerName: ProviderName;
  modelName?: string;
  purpose?: 'chat' | 'list';
}) => {
  const thisConfig = settingsOfProvider[providerName] as ProviderConnectionSettings;
  const apiKey = thisConfig.apiKey || 'unused';
  const baseURL = resolveOpenAICompatibleBaseURL(providerName, thisConfig, modelName, purpose);
  // https.Agent ломает http:// (ERR_INVALID_PROTOCOL) — для локальных Ollama/LM Studio/vLLM и т.п.
  const httpAgent = /^https:/i.test(baseURL)
    ? await getGatewayHttpAgentWithSystemCertificates()
    : undefined;
  const extraHeaders = parseExtraHeaders(thisConfig.headersJSON);
  if (providerName === 'microsoftAzure') {
    return new OpenAI({
      dangerouslyAllowBrowser: true,
      baseURL,
      apiKey,
      defaultQuery: { 'api-version': thisConfig.azureApiVersion || '2024-05-01-preview' },
      defaultHeaders: {
        'api-key': apiKey,
        'X-Client': 'sapphire',
        ...extraHeaders,
      },
      ...(httpAgent ? { httpAgent } : {}),
    });
  }
  return new OpenAI({
    dangerouslyAllowBrowser: true,
    baseURL,
    apiKey,
    defaultHeaders: {
      'X-Client': 'sapphire',
      ...extraHeaders,
    },
    ...(httpAgent ? { httpAgent } : {}),
  });
};

const _sendGatewayFIM = async ({
  messages: { prefix, suffix, stopTokens },
  onText,
  onFinalMessage,
  onError,
  onRetry,
  settingsOfProvider,
  modelName: modelName_,
  _setAborter,
  providerName,
  overridesOfModel,
  requestId,
  featureName,
}: SendFIMParams_Internal) => {
  const { modelName, supportsFIM, additionalGatewayPayload, fimMaxTokens } = getModelCapabilities(
    providerName,
    modelName_,
    overridesOfModel,
  );

  if (!supportsFIM) {
    if (modelName === modelName_)
      onError({ message: `Model ${modelName} does not support FIM.`, fullError: null });
    else
      onError({
        message: `Model ${modelName_} (${modelName}) does not support FIM.`,
        fullError: null,
      });
    return;
  }

  const maxTokens = fimMaxTokens ?? LLM_FIM_DEFAULT_MAX_TOKENS;

  const openai = await newOpenAICompatibleSDK({
    providerName,
    settingsOfProvider,
    modelName,
  });

  const fimBody = {
    model: modelName,
    prompt: prefix,
    suffix,
    stop: stopTokens,
    max_tokens: maxTokens,
    ...additionalGatewayPayload,
  };

  withProviderRetries(
    async (signal) => {
      const req = gatewayRequestOptions(signal, requestId, featureName);
      try {
        const response = await openai.completions.create(
          { ...fimBody, stream: true, stream_options: { include_usage: true } },
          req,
        );
        return { mode: 'stream' as const, response };
      } catch (error) {
        if (isStreamOptionsRejected(error)) {
          const response = await openai.completions.create({ ...fimBody, stream: true }, req);
          return { mode: 'stream' as const, response };
        }
        if (isStreamUnsupported(error)) {
          const response = await openai.completions.create(fimBody, req);
          return { mode: 'sync' as const, response };
        }
        throw error;
      }
    },
    { setAborter: _setAborter, onRetry },
  )
    .then(async (result) => {
      if (result.mode === 'sync') {
        const fullText = result.response.choices[0]?.text ?? '';
        const usage = llmUsageFromGateway(result.response.usage);
        onFinalMessage({ fullText, fullReasoning: '', ...(usage ? { usage } : {}) });
        return;
      }

      const response = result.response;
      _setAborter(() => response.controller.abort());
      let fullText = '';
      let lastUsage: LLMUsage | undefined;
      for await (const chunk of response) {
        const fromChunk = llmUsageFromGateway(chunk.usage);
        if (fromChunk) lastUsage = fromChunk;
        fullText += chunk.choices[0]?.text ?? '';
        onText({ fullText, fullReasoning: '' });
      }
      onFinalMessage({
        fullText,
        fullReasoning: '',
        ...(lastUsage ? { usage: lastUsage } : {}),
      });
    })
    .catch((error) => {
      if (error instanceof OpenAI.APIUserAbortError) return;
      const humanized = humanizeGatewayError(providerName, error);
      const gatewayRetryExhausted =
        error instanceof OpenAI.APIError && (error.status === 408 || error.status === 429);
      if (humanized) {
        onError({ message: humanized, fullError: error, gatewayRetryExhausted });
      } else {
        onError({ message: `${error}`, fullError: error, gatewayRetryExhausted });
      }
    });
};

const toGatewayTool = (toolInfo: InternalToolInfo) => {
  const { name, description, params } = toolInfo;

  const paramsWithType: { [s: string]: { description: string; type: 'string' } } = {};
  for (const key in params) {
    paramsWithType[key] = { ...params[key], type: 'string' };
  }

  return {
    type: 'function',
    function: {
      name,
      // strict: true — строгий режим function calling OpenAI
      description,
      parameters: {
        type: 'object',
        properties: paramsWithType,
        // required: Object.keys(params),
        // additionalProperties: false,
      },
    },
  } satisfies OpenAI.Chat.Completions.ChatCompletionTool;
};

const gatewayTools = (
  chatMode: ChatMode | null,
  mcpTools: InternalToolInfo[] | undefined,
  allowUpdatePlan?: boolean,
  enabledMcpServerNames?: readonly string[],
  excludedToolNames?: readonly string[],
  allowedToolNames?: readonly string[],
  disableAllTools?: boolean,
) => {
  const allowedTools = availableTools(chatMode, mcpTools, {
    allowUpdatePlan,
    enabledMcpServerNames,
    excludedToolNames,
    allowedToolNames,
    disableAllTools,
  });
  if (!allowedTools || allowedTools.length === 0) return null;

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  for (const t in allowedTools ?? {}) {
    tools.push(toGatewayTool(allowedTools[t]));
  }
  return tools;
};

// Парсинг tool call из JSON-аргументов LLM во внутренний формат
const rawToolCallObjOfParamsStr = (
  name: string,
  toolParamsStr: string,
  id: string,
): RawToolCallObj | null => {
  let input: unknown;
  try {
    input = JSON.parse(toolParamsStr);
  } catch (_e) {
    return null;
  }

  if (input === null) return null;
  if (typeof input !== 'object') return null;

  const rawParams: RawToolParamsObj = input;
  return { id, name, rawParams, doneParams: Object.keys(rawParams), isDone: true };
};

// ------------ OpenAI-compatible Chat Completions ------------

const _sendGatewayChat = async ({
  messages,
  onText,
  onFinalMessage,
  onError,
  onRetry,
  settingsOfProvider,
  modelSelectionOptions,
  modelName: modelName_,
  _setAborter,
  providerName,
  chatMode,
  overridesOfModel,
  mcpTools,
  allowUpdatePlan,
  enabledMcpServerNames,
  excludedToolNames,
  allowedToolNames,
  disableAllTools,
  requestId,
  featureName,
}: SendChatParams_Internal) => {
  const { modelName, reasoningCapabilities, additionalGatewayPayload, reservedOutputTokenSpace } =
    getModelCapabilities(providerName, modelName_, overridesOfModel);

  const { providerReasoningIOSettings } = getProviderCapabilities(providerName);

  const reasoningInfo = getSendableReasoningInfo(
    'Chat',
    providerName,
    modelName_,
    modelSelectionOptions,
    overridesOfModel,
  ); // modelName_ — как выбрал пользователь в UI

  const includeInPayload = {
    ...providerReasoningIOSettings?.input?.includeInPayload?.(reasoningInfo),
    ...additionalGatewayPayload,
  };

  // Инструменты — нативный function calling Chat Completions
  const potentialTools = gatewayTools(
    chatMode,
    mcpTools,
    allowUpdatePlan,
    enabledMcpServerNames,
    excludedToolNames,
    allowedToolNames,
    disableAllTools,
  );
  const nativeToolsObj = potentialTools ? ({ tools: potentialTools } as const) : {};

  const maxTokens =
    (reasoningInfo &&
    reasoningCapabilities &&
    reasoningCapabilities.reasoningReservedOutputTokenSpace != null
      ? reasoningCapabilities.reasoningReservedOutputTokenSpace
      : reservedOutputTokenSpace) ?? 4_096;

  const openai: OpenAI = await newOpenAICompatibleSDK({
    providerName,
    settingsOfProvider,
    modelName,
  });
  const options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model: modelName,
    messages: messages as any,
    stream: true,
    ...nativeToolsObj,
    max_tokens: maxTokens,
    // reasoning_effort и прочие поля тела — здесь, не в ClientOptions SDK
    ...includeInPayload,
  };

  const { nameOfFieldInDelta: nameOfReasoningFieldInDelta } =
    providerReasoningIOSettings?.output ?? {};

  let fullReasoningSoFar = '';
  let fullTextSoFar = '';
  let lastFinishReason: string | undefined;

  // tool_calls стримятся по index (параллельные вызовы) — копим отдельные «ведёрки»
  const toolBuckets = new Map<number, { name: string; id: string; paramsStr: string }>();

  const toolCallsSoFarFromBuckets = (): RawToolCallObj[] | undefined => {
    if (toolBuckets.size === 0) return undefined;
    return [...toolBuckets.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, b]) => !!b.name)
      .map(([, b]) => ({
        name: b.name as RawToolCallObj['name'],
        rawParams: {},
        doneParams: [],
        id: b.id,
        isDone: false,
      }));
  };

  withProviderRetries(
    async (signal) => {
      const connect = withConnectTimeoutSignal(signal, PPR_LLM_CONNECT_TIMEOUT_MS);
      try {
        const req = gatewayRequestOptions(connect.signal, requestId, featureName);
        try {
          return await openai.chat.completions.create(
            { ...options, stream_options: { include_usage: true } },
            req,
          );
        } catch (error) {
          if (connect.didTimeout()) {
            throw new LLMConnectTimeoutError();
          }
          if (isStreamOptionsRejected(error)) {
            const retryConnect = withConnectTimeoutSignal(signal, PPR_LLM_CONNECT_TIMEOUT_MS);
            try {
              return await openai.chat.completions.create(
                options,
                gatewayRequestOptions(retryConnect.signal, requestId, featureName),
              );
            } catch (retryError) {
              if (retryConnect.didTimeout()) {
                throw new LLMConnectTimeoutError();
              }
              throw retryError;
            } finally {
              retryConnect.clear();
            }
          }
          throw error;
        }
      } finally {
        connect.clear();
      }
    },
    { setAborter: _setAborter, onRetry },
  )
    .then(async (response) => {
      let idleTimedOut = false;
      const idle = createStreamIdleWatchdog({
        idleMs: PPR_LLM_STREAM_IDLE_MS,
        onIdle: () => {
          idleTimedOut = true;
          try {
            response.controller.abort();
          } catch {
            /* игнорируем */
          }
        },
      });
      // После create — abort контроллера стрима (дублируется signal в withProviderRetries).
      _setAborter(() => {
        idle.clear();
        response.controller.abort();
      });
      let lastUsage: LLMUsage | undefined;
      try {
        for await (const chunk of response) {
          if (idleTimedOut) break;
          idle.poke();
          const fromChunk = llmUsageFromGateway(chunk.usage);
          if (fromChunk) lastUsage = fromChunk;
          const finishReason = chunk.choices[0]?.finish_reason;
          if (finishReason) lastFinishReason = finishReason;
          const newText = chunk.choices[0]?.delta?.content ?? '';
          fullTextSoFar += newText;

          // Все индексы tool_calls (параллельные вызовы)
          for (const tool of chunk.choices[0]?.delta?.tool_calls ?? []) {
            const index = tool.index ?? 0;
            const bucket = toolBuckets.get(index) ?? { name: '', id: '', paramsStr: '' };
            bucket.name += tool.function?.name ?? '';
            bucket.paramsStr += tool.function?.arguments ?? '';
            bucket.id += tool.id ?? '';
            toolBuckets.set(index, bucket);
          }

          let newReasoning = '';
          if (nameOfReasoningFieldInDelta) {
            // @ts-ignore
            newReasoning = `${chunk.choices[0]?.delta?.[nameOfReasoningFieldInDelta] || ''}`;
            fullReasoningSoFar += newReasoning;
          }

          onText({
            fullText: fullTextSoFar,
            fullReasoning: fullReasoningSoFar,
            toolCalls: toolCallsSoFarFromBuckets(),
          });
        }
      } catch (error) {
        idle.clear();
        if (idleTimedOut) {
          onError({ message: LLM_ERROR_HINTS.streamIdleTimeout, fullError: null });
          return;
        }
        throw error;
      } finally {
        idle.clear();
      }
      if (idleTimedOut) {
        onError({ message: LLM_ERROR_HINTS.streamIdleTimeout, fullError: null });
        return;
      }
      if (!fullTextSoFar && !fullReasoningSoFar && toolBuckets.size === 0) {
        onError({ message: 'Sapphire: Response from model was empty.', fullError: null });
      } else {
        const truncatedToolNames: string[] = [];
        const toolCalls = [...toolBuckets.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, b]) => {
            const parsed = rawToolCallObjOfParamsStr(b.name, b.paramsStr, b.id);
            if (parsed) return parsed;
            if (b.name) truncatedToolNames.push(b.name);
            return null;
          })
          .filter((tc): tc is RawToolCallObj => tc !== null && !!tc.name);
        onFinalMessage({
          fullText: fullTextSoFar,
          fullReasoning: fullReasoningSoFar,
          ...(toolCalls.length ? { toolCalls } : {}),
          ...(lastUsage ? { usage: lastUsage } : {}),
          ...(lastFinishReason ? { finishReason: lastFinishReason } : {}),
          ...(truncatedToolNames.length ? { truncatedToolNames } : {}),
        });
      }
    })
    // Ошибки и .create(), и for-await внутри .then
    .catch((error) => {
      if (error instanceof OpenAI.APIUserAbortError) return;
      if (error instanceof LLMConnectTimeoutError) {
        onError({ message: LLM_ERROR_HINTS.connectTimeout, fullError: error });
        return;
      }
      const humanized = humanizeGatewayError(providerName, error);
      const gatewayRetryExhausted =
        error instanceof OpenAI.APIError && (error.status === 408 || error.status === 429);
      if (humanized) {
        onError({ message: humanized, fullError: error, gatewayRetryExhausted });
      } else {
        const status =
          error instanceof OpenAI.APIError && error.status != null ? error.status : undefined;
        const message = status != null ? `${error} (код ${status})` : `${error}`;
        onError({ message, fullError: error, gatewayRetryExhausted });
      }
    });
};

type OpenAIModel = {
  id: string;
  created: number;
  object: 'model';
  owned_by: string;
};
const _gatewayModelList = async ({
  onSuccess: onSuccess_,
  onError: onError_,
  settingsOfProvider,
  providerName,
  requestId,
}: ListParams_Internal<OpenAIModel>) => {
  const onSuccess = ({ models }: { models: OpenAIModel[] }) => {
    onSuccess_({ models });
  };
  const onError = ({ error }: { error: string }) => {
    onError_({ error });
  };
  try {
    const openai = await newOpenAICompatibleSDK({
      providerName,
      settingsOfProvider,
      purpose: 'list',
    });
    openai.models
      .list(gatewayRequestOptions(undefined, requestId))
      .then(async (response) => {
        const models: OpenAIModel[] = [];
        models.push(...response.data);
        while (response.hasNextPage()) {
          models.push(...(await response.getNextPage()).data);
        }
        onSuccess({ models });
      })
      .catch((error) => {
        onError({ error: `${error}` });
      });
  } catch (error) {
    onError({ error: `${error}` });
  }
};

type CallFnOfProvider = {
  [providerName in ProviderName]: {
    sendChat: (params: SendChatParams_Internal) => Promise<void>;
    sendFIM: ((params: SendFIMParams_Internal) => void) | null;
    list: ((params: ListParams_Internal<any>) => void) | null;
  };
};

const openAICompat = {
  sendChat: (params: SendChatParams_Internal) => _sendGatewayChat(params),
  sendFIM: (params: SendFIMParams_Internal) => _sendGatewayFIM(params),
  list: (params: ListParams_Internal<OpenAIModel>) => _gatewayModelList(params),
};

export const sendLLMMessageToProviderImplementation = {
  anthropic: {
    sendChat: (params) => sendAnthropicChat(params),
    sendFIM: null,
    list: (params) => {
      void listAnthropicModels(params);
    },
  },
  openAI: openAICompat,
  deepseek: openAICompat,
  ollama: openAICompat,
  vLLM: openAICompat,
  openRouter: openAICompat,
  openAICompatible: openAICompat,
  gemini: {
    sendChat: (params) => sendGeminiChat(params),
    sendFIM: null,
    list: (params) => {
      void listGeminiModels(params);
    },
  },
  groq: openAICompat,
  xAI: openAICompat,
  mistral: openAICompat,
  lmStudio: openAICompat,
  liteLLM: openAICompat,
  googleVertex: openAICompat,
  microsoftAzure: openAICompat,
  awsBedrock: openAICompat,
} satisfies CallFnOfProvider;

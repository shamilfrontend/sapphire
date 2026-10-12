/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import {
  SendLLMMessageParams,
  OnText,
  OnFinalMessage,
  OnError,
  OnRetry,
} from '../../common/sendLLMMessageTypes.js';
import { LLM_ERROR_HINTS } from '../../common/llmProviderConfig.js';
import { displayInfoOfProviderName } from '../../common/sapphireSettingsTypes.js';
import { sendLLMMessageToProviderImplementation } from './sendLLMMessage.impl.js';
import { isTlsCertificateError } from './systemCertificatesFetch.js';

export const sendLLMMessage = async ({
  messagesType,
  messages: messages_,
  onText: onText_,
  onFinalMessage: onFinalMessage_,
  onError: onError_,
  onRetry: onRetry_,
  abortRef: abortRef_,
  settingsOfProvider,
  modelSelection,
  modelSelectionOptions,
  overridesOfModel,
  chatMode,
  separateSystemMessage,
  mcpTools,
  allowUpdatePlan,
  enabledMcpServerNames,
  excludedToolNames,
  allowedToolNames,
  disableAllTools,
  requestId,
  featureName,
}: SendLLMMessageParams) => {
  const { providerName, modelName } = modelSelection;

  let _aborter: (() => void) | null = null;
  let _setAborter = (fn: () => void) => {
    _aborter = fn;
  };
  let _didAbort = false;

  const onText: OnText = (params) => {
    if (_didAbort) return;
    onText_(params);
  };

  const onFinalMessage: OnFinalMessage = (params) => {
    if (_didAbort) return;
    if (params.usage) {
      console.log(
        `[llm] feature=${featureName} provider=${providerName} requestId=${requestId} prompt=${params.usage.prompt_tokens} completion=${params.usage.completion_tokens} total=${params.usage.total_tokens}`,
      );
    }
    onFinalMessage_(params);
  };

  const onError: OnError = ({ message: errorMessage, fullError, gatewayRetryExhausted }) => {
    if (_didAbort) return;
    console.error('sendLLMMessage onError:', errorMessage);

    // fetch failed / connection error — по умолчанию почти без деталей
    const isNetworkFailure =
      errorMessage === 'TypeError: fetch failed' ||
      errorMessage === 'Error: Connection error.' ||
      /connection error/i.test(errorMessage);
    if (isNetworkFailure) {
      const title = displayInfoOfProviderName(providerName).title;
      errorMessage =
        isTlsCertificateError(fullError) || isTlsCertificateError(errorMessage)
          ? LLM_ERROR_HINTS.tlsCertificate(title)
          : LLM_ERROR_HINTS.unreachable(title);
    }

    onError_({ message: errorMessage, fullError, gatewayRetryExhausted });
  };

  const onRetry: OnRetry = (params) => {
    if (_didAbort) return;
    onRetry_?.(params);
  };

  // onAbort вызываем только снаружи (UI Stop), не изнутри sendLLMMessage
  const onAbort = () => {
    try {
      _aborter?.();
    } catch (_e) {
      // abort-handler иногда сам бросает — игнорируем
    }
    _didAbort = true;
  };
  abortRef_.current = onAbort;

  try {
    const implementation = sendLLMMessageToProviderImplementation[providerName];
    if (!implementation) {
      onError({ message: `Error: Provider "${providerName}" not recognized.`, fullError: null });
      return;
    }
    const { sendFIM, sendChat } = implementation;
    if (messagesType === 'chatMessages') {
      await sendChat({
        messages: messages_,
        onText,
        onFinalMessage,
        onError,
        onRetry,
        settingsOfProvider,
        modelSelectionOptions,
        overridesOfModel,
        modelName,
        _setAborter,
        providerName,
        separateSystemMessage,
        chatMode,
        mcpTools,
        allowUpdatePlan,
        enabledMcpServerNames,
        excludedToolNames,
        allowedToolNames,
        disableAllTools,
        requestId,
        featureName,
      });
      return;
    }
    if (messagesType === 'FIMMessage') {
      if (sendFIM) {
        await sendFIM({
          messages: messages_,
          onText,
          onFinalMessage,
          onError,
          onRetry,
          settingsOfProvider,
          modelSelectionOptions,
          overridesOfModel,
          modelName,
          _setAborter,
          providerName,
          separateSystemMessage,
          requestId,
          featureName,
        });
        return;
      }
      onError({
        message: `Error running Autocomplete with ${providerName} - ${modelName}.`,
        fullError: null,
      });
      return;
    }
    onError({ message: `Error: Message type "${messagesType}" not recognized.`, fullError: null });
  } catch (error) {
    if (error instanceof Error) {
      onError({ message: `${error}`, fullError: error });
    } else {
      onError({ message: `Unexpected Error in sendLLMMessage: ${error}`, fullError: error });
    }
    // ; (_aborter as any)?.()
    // _didAbort = true
  }
};

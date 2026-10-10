/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Регистрация в app.ts.
// Можно было бы оформить сервисом, но канал держит меньше файлов.

import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import {
  EventLLMMessageOnTextParams,
  EventLLMMessageOnErrorParams,
  EventLLMMessageOnFinalMessageParams,
  EventLLMMessageOnRetryParams,
  MainSendLLMMessageParams,
  AbortRef,
  SendLLMMessageParams,
  MainLLMMessageAbortParams,
  ModelListParams,
  EventModelListOnSuccessParams,
  EventModelListOnErrorParams,
  GatewayModelResponse,
  MainModelListParams,
} from '../common/sendLLMMessageTypes.js';
import { sendLLMMessage } from './llmMessage/sendLLMMessage.js';
import { sendLLMMessageToProviderImplementation } from './llmMessage/sendLLMMessage.impl.js';
import { displayInfoOfProviderName } from '../common/sapphireSettingsTypes.js';

// Реализация в main: вызов sendLLMMessage и проброс событий в рендерер

export class LLMMessageChannel implements IServerChannel {
  private readonly llmMessageEmitters = {
    onText: new Emitter<EventLLMMessageOnTextParams>(),
    onFinalMessage: new Emitter<EventLLMMessageOnFinalMessageParams>(),
    onError: new Emitter<EventLLMMessageOnErrorParams>(),
    onRetry: new Emitter<EventLLMMessageOnRetryParams>(),
  };

  // Активные запросы и их abortRef
  private readonly _infoOfRunningRequest: Record<
    string,
    { waitForSend: Promise<void> | undefined; abortRef: AbortRef }
  > = {};

  private readonly listEmitters = {
    openaiCompat: {
      success: new Emitter<EventModelListOnSuccessParams<GatewayModelResponse>>(),
      error: new Emitter<EventModelListOnErrorParams<GatewayModelResponse>>(),
    },
  };

  // Каналы не получают @IService через DI
  constructor() {}

  listen(_: unknown, event: string): Event<any> {
    if (event === 'onText_sendLLMMessage') return this.llmMessageEmitters.onText.event;
    if (event === 'onFinalMessage_sendLLMMessage')
      return this.llmMessageEmitters.onFinalMessage.event;
    if (event === 'onError_sendLLMMessage') return this.llmMessageEmitters.onError.event;
    if (event === 'onRetry_sendLLMMessage') return this.llmMessageEmitters.onRetry.event;
    if (event === 'onSuccess_list_gateway') return this.listEmitters.openaiCompat.success.event;
    if (event === 'onError_list_gateway') return this.listEmitters.openaiCompat.error.event;
    throw new Error(`Event not found: ${event}`);
  }

  // Команды с рендерера (см. sendLLMMessageService.ts)
  async call(_: unknown, command: string, params: any): Promise<any> {
    try {
      if (command === 'sendLLMMessage') {
        this._callSendLLMMessage(params);
      } else if (command === 'abort') {
        await this._callAbort(params);
      } else if (command === 'gatewayModelList') {
        this._callGatewayModelList(params);
      } else {
        throw new Error(`Sapphire sendLLM: command "${command}" not recognized.`);
      }
    } catch (e) {
      console.log('llmMessageChannel: Call Error:', e);
    }
  }

  // Единственное место, где вызывается sendLLMMessage
  private _callSendLLMMessage(params: MainSendLLMMessageParams) {
    const { requestId } = params;

    if (!(requestId in this._infoOfRunningRequest))
      this._infoOfRunningRequest[requestId] = {
        waitForSend: undefined,
        abortRef: { current: null },
      };

    const mainThreadParams: SendLLMMessageParams = {
      ...params,
      onText: (p) => {
        this.llmMessageEmitters.onText.fire({ requestId, ...p });
      },
      onFinalMessage: (p) => {
        this.llmMessageEmitters.onFinalMessage.fire({ requestId, ...p });
      },
      onError: (p) => {
        console.log('sendLLM: firing err');
        this.llmMessageEmitters.onError.fire({ requestId, ...p });
      },
      onRetry: (p) => {
        this.llmMessageEmitters.onRetry.fire({ requestId, ...p });
      },
      abortRef: this._infoOfRunningRequest[requestId].abortRef,
    };
    const p = sendLLMMessage(mainThreadParams);
    this._infoOfRunningRequest[requestId].waitForSend = p;
  }

  private async _callAbort(params: MainLLMMessageAbortParams) {
    const { requestId } = params;
    if (!(requestId in this._infoOfRunningRequest)) return;
    const { waitForSend, abortRef } = this._infoOfRunningRequest[requestId];
    await waitForSend; // дождаться старта, чтобы abortRef был установлен
    abortRef?.current?.();
    delete this._infoOfRunningRequest[requestId];
  }

  _callGatewayModelList = (params: MainModelListParams<GatewayModelResponse>) => {
    const { requestId, providerName } = params;
    const emitters = this.listEmitters.openaiCompat;
    const list = sendLLMMessageToProviderImplementation[providerName]?.list;
    if (!list) {
      emitters.error.fire({
        requestId,
        error: `${displayInfoOfProviderName(providerName).title} не отдаёт список моделей.`,
      });
      return;
    }
    const mainThreadParams: ModelListParams<GatewayModelResponse> = {
      ...params,
      onSuccess: (p) => {
        emitters.success.fire({ requestId, ...p });
      },
      onError: (p) => {
        emitters.error.fire({ requestId, ...p });
      },
    };
    list(mainThreadParams);
  };
}

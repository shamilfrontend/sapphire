/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import {
  EventLLMMessageOnTextParams,
  EventLLMMessageOnErrorParams,
  EventLLMMessageOnFinalMessageParams,
  EventLLMMessageOnRetryParams,
  ServiceSendLLMMessageParams,
  MainSendLLMMessageParams,
  MainLLMMessageAbortParams,
  ServiceModelListParams,
  EventModelListOnSuccessParams,
  EventModelListOnErrorParams,
  MainModelListParams,
  GatewayModelResponse,
} from './sendLLMMessageTypes.js';

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ISapphireSettingsService } from './sapphireSettingsService.js';
import { IMCPService } from './mcpService.js';

// фичи реализуются через вызов IPC-канала
export const ILLMMessageService = createDecorator<ILLMMessageService>('llmMessageService');

export interface ILLMMessageService {
  readonly _serviceBrand: undefined;
  sendLLMMessage: (params: ServiceSendLLMMessageParams) => string | null;
  abort: (requestId: string) => void;
  gatewayModelList: (params: ServiceModelListParams<GatewayModelResponse>) => void;
}

// удобно держать рядом с llmMessageChannel.ts
class LLMMessageService extends Disposable implements ILLMMessageService {
  readonly _serviceBrand: undefined;

  private readonly channel: IChannel; // LLMMessageChannel

  // sendLLMMessage
  private readonly llmMessageHooks = {
    onText: {} as { [eventId: string]: (params: EventLLMMessageOnTextParams) => void },
    onFinalMessage: {} as {
      [eventId: string]: (params: EventLLMMessageOnFinalMessageParams) => void;
    },
    onError: {} as { [eventId: string]: (params: EventLLMMessageOnErrorParams) => void },
    onRetry: {} as { [eventId: string]: (params: EventLLMMessageOnRetryParams) => void },
    onAbort: {} as { [eventId: string]: () => void }, // локально, не через IPC — abort() мгновенный
  };

  // list hooks
  private readonly listHooks = {
    gateway: {
      success: {} as {
        [eventId: string]: (params: EventModelListOnSuccessParams<GatewayModelResponse>) => void;
      },
      error: {} as {
        [eventId: string]: (params: EventModelListOnErrorParams<GatewayModelResponse>) => void;
      },
    },
  };

  constructor(
    @IMainProcessService private readonly mainProcessService: IMainProcessService, // renderer / browser side
    @ISapphireSettingsService private readonly sapphireSettingsService: ISapphireSettingsService,
    // @INotificationService private readonly notificationService: INotificationService,
    @IMCPService private readonly mcpService: IMCPService,
  ) {
    super();

    // см. llmMessageChannel.ts
    this.channel = this.mainProcessService.getChannel('sapphire-channel-llmMessage');

    // .listen поднимает IPC с задержкой — слушатели сразу, хуки по requestId
    // llm events
    this._register(
      (this.channel.listen('onText_sendLLMMessage') satisfies Event<EventLLMMessageOnTextParams>)(
        (e) => {
          this.llmMessageHooks.onText[e.requestId]?.(e);
        },
      ),
    );
    this._register(
      (
        this.channel.listen(
          'onFinalMessage_sendLLMMessage',
        ) satisfies Event<EventLLMMessageOnFinalMessageParams>
      )((e) => {
        this.llmMessageHooks.onFinalMessage[e.requestId]?.(e);
        this._clearChannelHooks(e.requestId);
      }),
    );
    this._register(
      (this.channel.listen('onError_sendLLMMessage') satisfies Event<EventLLMMessageOnErrorParams>)(
        (e) => {
          this.llmMessageHooks.onError[e.requestId]?.(e);
          this._clearChannelHooks(e.requestId);
          console.error('Error in LLMMessageService:', JSON.stringify(e));
        },
      ),
    );
    this._register(
      (this.channel.listen('onRetry_sendLLMMessage') satisfies Event<EventLLMMessageOnRetryParams>)(
        (e) => {
          this.llmMessageHooks.onRetry[e.requestId]?.(e);
        },
      ),
    );
    // .list()
    this._register(
      (
        this.channel.listen('onSuccess_list_gateway') satisfies Event<
          EventModelListOnSuccessParams<GatewayModelResponse>
        >
      )((e) => {
        this.listHooks.gateway.success[e.requestId]?.(e);
        this._clearChannelHooks(e.requestId);
      }),
    );
    this._register(
      (
        this.channel.listen('onError_list_gateway') satisfies Event<
          EventModelListOnErrorParams<GatewayModelResponse>
        >
      )((e) => {
        this.listHooks.gateway.error[e.requestId]?.(e);
        this._clearChannelHooks(e.requestId);
      }),
    );
  }

  sendLLMMessage(params: ServiceSendLLMMessageParams) {
    const { onText, onFinalMessage, onError, onRetry, onAbort, modelSelection, ...proxyParams } =
      params;

    // нет modelSelection — UI обычно не даёт дойти; дублируем проверку на backend (Apply и т.п.)
    if (modelSelection === null) {
      // PPR AI: обычно означает, что у пользователя не сохранён валидный токен —
      // онбординг перекроет workbench, пока провайдер не настроен.
      const message = `Не выбрана модель. Подключите провайдера в Settings → Провайдеры.`;
      onError({ message, fullError: null });
      return null;
    }

    if (params.messagesType === 'chatMessages' && (params.messages?.length ?? 0) === 0) {
      const message = `No messages detected.`;
      onError({ message, fullError: null });
      return null;
    }

    const { settingsOfProvider } = this.sapphireSettingsService.state;

    const mcpTools = this.mcpService.getMCPTools();

    // хуки по requestId
    const requestId = generateUuid();
    this.llmMessageHooks.onText[requestId] = onText;
    this.llmMessageHooks.onFinalMessage[requestId] = onFinalMessage;
    this.llmMessageHooks.onError[requestId] = onError;
    if (onRetry) {
      this.llmMessageHooks.onRetry[requestId] = onRetry;
    }
    this.llmMessageHooks.onAbort[requestId] = onAbort; // только локальный abort()

    // функции из params через IPC не передаются
    this.channel.call('sendLLMMessage', {
      ...proxyParams,
      requestId,
      settingsOfProvider,
      modelSelection,
      mcpTools,
    } satisfies MainSendLLMMessageParams);

    return requestId;
  }

  abort(requestId: string) {
    this.llmMessageHooks.onAbort[requestId]?.(); // локальный hook, без round-trip IPC
    this.channel.call('abort', { requestId } satisfies MainLLMMessageAbortParams);
    this._clearChannelHooks(requestId);
  }

  gatewayModelList = (params: ServiceModelListParams<GatewayModelResponse>) => {
    const { onSuccess, onError, ...proxyParams } = params;

    const { settingsOfProvider } = this.sapphireSettingsService.state;

    // хуки по requestId
    const requestId_ = generateUuid();
    this.listHooks.gateway.success[requestId_] = onSuccess;
    this.listHooks.gateway.error[requestId_] = onError;

    this.channel.call('gatewayModelList', {
      ...proxyParams,
      settingsOfProvider,
      requestId: requestId_,
    } satisfies MainModelListParams<GatewayModelResponse>);
  };

  private _clearChannelHooks(requestId: string) {
    delete this.llmMessageHooks.onText[requestId];
    delete this.llmMessageHooks.onFinalMessage[requestId];
    delete this.llmMessageHooks.onError[requestId];
    delete this.llmMessageHooks.onRetry[requestId];
    delete this.llmMessageHooks.onAbort[requestId];

    delete this.listHooks.gateway.success[requestId];
    delete this.listHooks.gateway.error[requestId];
  }
}

registerSingleton(ILLMMessageService, LLMMessageService, InstantiationType.Eager);

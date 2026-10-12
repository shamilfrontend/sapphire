/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Регистрация в app.ts.
// Отдельный сервис не подходит: нужны main process и node-зависимости.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  MCPConfigFileJSON,
  MCPConfigFileEntryJSON,
  MCPServer,
  RawMCPToolCall,
  MCPToolErrorResponse,
  MCPServerEventResponse,
  MCPToolCallParams,
  removeMCPToolNamePrefix,
} from '../common/mcpServiceTypes.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { MCPUserStateOfName } from '../common/sapphireSettingsTypes.js';
import { MAX_TOOL_ABSOLUTE_TIME } from '../common/prompt/prompts.js';
import { stableMcpToolName } from '../common/prompt/mcpToolDisclosure.js';
import { generateUuid } from '../../../../base/common/uuid.js';

const getClientConfig = (serverName: string) => ({
  name: `${serverName}-client`,
  version: '0.1.0',
  // debug: true,
});

type MCPServerNonError = MCPServer & { status: Omit<MCPServer['status'], 'error'> };
type MCPServerError = MCPServer & { status: 'error' };

type ClientInfo =
  | {
      // _client — SDK-клиент к MCP-серверу; в остальном коде MCP-серверы называем «server».
      _client: Client;
      mcpServerEntryJSON: MCPConfigFileEntryJSON;
      mcpServer: MCPServerNonError;
    }
  | {
      _client?: undefined;
      mcpServerEntryJSON: MCPConfigFileEntryJSON;
      mcpServer: MCPServerError;
    };

type InfoOfClientId = {
  [clientId: string]: ClientInfo;
};

export class MCPChannel implements IServerChannel {
  private readonly infoOfClientId: InfoOfClientId = {};

  private readonly _refreshingServerNames: Set<string> = new Set();

  private readonly _activeToolCalls = new Map<string, AbortController>();

  // Эмиттеры событий MCP
  private readonly mcpEmitters = {
    serverEvent: {
      onAdd: new Emitter<MCPServerEventResponse>(),
      onUpdate: new Emitter<MCPServerEventResponse>(),
      onDelete: new Emitter<MCPServerEventResponse>(),
    },
  } satisfies {
    serverEvent: {
      onAdd: Emitter<MCPServerEventResponse>;
      onUpdate: Emitter<MCPServerEventResponse>;
      onDelete: Emitter<MCPServerEventResponse>;
    };
  };

  constructor() {}

  // Рендерер подписывается на события через listen
  listen(_: unknown, event: string): Event<any> {
    // События серверов
    if (event === 'onAdd_server') return this.mcpEmitters.serverEvent.onAdd.event;
    if (event === 'onUpdate_server') return this.mcpEmitters.serverEvent.onUpdate.event;
    if (event === 'onDelete_server') return this.mcpEmitters.serverEvent.onDelete.event;
    // else if (event === 'onLoading_server') return this.mcpEmitters.serverEvent.onChangeLoading.event;
    // Неизвестное событие
    throw new Error(`Event not found: ${event}`);
  }

  // Рендерер вызывает команды через call (см. mcpService.ts)
  async call(_: unknown, command: string, params: any): Promise<any> {
    try {
      if (command === 'refreshMCPServers') {
        await this._refreshMCPServers(params);
      } else if (command === 'closeAllMCPServers') {
        await this._closeAllMCPServers();
      } else if (command === 'toggleMCPServer') {
        await this._toggleMCPServer(params.serverName, params.isOn);
      } else if (command === 'callTool') {
        const p: MCPToolCallParams = params;
        const callId = p.callId ?? generateUuid();
        const abort = new AbortController();
        this._activeToolCalls.set(callId, abort);
        try {
          return await this._safeCallTool(p.serverName, p.toolName, p.params, abort.signal);
        } finally {
          this._activeToolCalls.delete(callId);
        }
      } else if (command === 'cancelTool') {
        const callId = params?.callId as string | undefined;
        if (callId) {
          this._activeToolCalls.get(callId)?.abort();
          this._activeToolCalls.delete(callId);
        }
        return;
      } else {
        throw new Error(`Sapphire sendLLM: command "${command}" not recognized.`);
      }
    } catch (e) {
      console.error('mcp channel: Call Error:', e);
      // Пробрасываем ошибку, чтобы рендерер видел сбой/таймаут, а не undefined.
      throw e;
    }
  }

  // Управление MCP-серверами

  private async _refreshMCPServers(params: {
    mcpConfigFileJSON: MCPConfigFileJSON;
    userStateOfName: MCPUserStateOfName;
    addedServerNames: string[];
    removedServerNames: string[];
    updatedServerNames: string[];
  }) {
    const {
      mcpConfigFileJSON,
      userStateOfName,
      addedServerNames,
      removedServerNames,
      updatedServerNames,
    } = params;

    const { mcpServers: mcpServersJSON } = mcpConfigFileJSON;

    const allChanges: { type: 'added' | 'removed' | 'updated'; serverName: string }[] = [
      ...addedServerNames.map((n) => ({ serverName: n, type: 'added' }) as const),
      ...removedServerNames.map((n) => ({ serverName: n, type: 'removed' }) as const),
      ...updatedServerNames.map((n) => ({ serverName: n, type: 'updated' }) as const),
    ];

    await Promise.all(
      allChanges.map(async ({ serverName, type }) => {
        // Не запускать повторное обновление того же сервера
        if (this._refreshingServerNames.has(serverName)) return;
        this._refreshingServerNames.add(serverName);

        const prevServer = this.infoOfClientId[serverName]?.mcpServer;

        // Закрыть старый клиент и убрать из кэша
        if (type === 'removed' || type === 'updated') {
          await this._closeClient(serverName);
          delete this.infoOfClientId[serverName];
          this.mcpEmitters.serverEvent.onDelete.fire({
            response: { prevServer, name: serverName },
          });
        }

        // Создать новый клиент
        if (type === 'added' || type === 'updated') {
          const clientInfo = await this._createClient(
            mcpServersJSON[serverName],
            serverName,
            userStateOfName[serverName]?.isOn,
          );
          this.infoOfClientId[serverName] = clientInfo;
          this.mcpEmitters.serverEvent.onAdd.fire({
            response: { newServer: clientInfo.mcpServer, name: serverName },
          });
        }
      }),
    );

    allChanges.forEach(({ serverName }) => {
      this._refreshingServerNames.delete(serverName);
    });
  }

  private async _createClientUnsafe(
    server: MCPConfigFileEntryJSON,
    serverName: string,
    isOn: boolean,
  ): Promise<ClientInfo> {
    const clientConfig = getClientConfig(serverName);
    const client = new Client(clientConfig);
    let transport: Transport;
    let info: MCPServerNonError;

    if (server.url) {
      const serverUrl = new URL(server.url);
      // Сначала Streamable HTTP, при ошибке — SSE
      try {
        transport = new StreamableHTTPClientTransport(serverUrl);
        await client.connect(transport);
        console.log(`Connected via HTTP to ${serverName}`);
        const { tools } = await client.listTools();
        const toolsWithUniqueName = tools.map(({ name, ...rest }) => ({
          name: stableMcpToolName(serverName, name),
          ...rest,
        }));
        info = {
          status: isOn ? 'success' : 'offline',
          tools: toolsWithUniqueName,
          command: server.url,
        };
      } catch (httpErr) {
        console.warn(`HTTP failed for ${serverName}, trying SSE…`, httpErr);
        transport = new SSEClientTransport(serverUrl);
        await client.connect(transport);
        const { tools } = await client.listTools();
        const toolsWithUniqueName = tools.map(({ name, ...rest }) => ({
          name: stableMcpToolName(serverName, name),
          ...rest,
        }));
        console.log(`Connected via SSE to ${serverName}`);
        info = {
          status: isOn ? 'success' : 'offline',
          tools: toolsWithUniqueName,
          command: server.url,
        };
      }
    } else if (server.command) {
      // console.log('ENV DATA: ', server.env)
      transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: {
          ...server.env,
          ...process.env,
        } as Record<string, string>,
      });

      await client.connect(transport);

      // Список инструментов с сервера
      const { tools } = await client.listTools();
      const toolsWithUniqueName = tools.map(({ name, ...rest }) => ({
        name: stableMcpToolName(serverName, name),
        ...rest,
      }));

      // Строка команды для отображения в UI
      const fullCommand = `${server.command} ${server.args?.join(' ') || ''}`;

      // Состояние сервера для рендерера
      info = {
        status: isOn ? 'success' : 'offline',
        tools: toolsWithUniqueName,
        command: fullCommand,
      };
    } else {
      throw new Error(`No url or command for server ${serverName}`);
    }

    return { _client: client, mcpServerEntryJSON: server, mcpServer: info };
  }

  private async _createClient(
    serverConfig: MCPConfigFileEntryJSON,
    serverName: string,
    isOn = true,
  ): Promise<ClientInfo> {
    try {
      const c: ClientInfo = await this._createClientUnsafe(serverConfig, serverName, isOn);
      return c;
    } catch (err) {
      console.error(`❌ Failed to connect to server "${serverName}":`, err);
      const fullCommand = !serverConfig.command
        ? ''
        : `${serverConfig.command} ${serverConfig.args?.join(' ') || ''}`;
      const c: MCPServerError = { status: 'error', error: `${err}`, command: fullCommand };
      return { mcpServerEntryJSON: serverConfig, mcpServer: c };
    }
  }

  private async _closeAllMCPServers() {
    for (const serverName in this.infoOfClientId) {
      await this._closeClient(serverName);
      delete this.infoOfClientId[serverName];
    }
    console.log('Closed all MCP servers');
  }

  private async _closeClient(serverName: string) {
    const info = this.infoOfClientId[serverName];
    if (!info) return;
    const { _client: client } = info;
    if (client) {
      await client.close();
    }
    console.log(`Closed MCP server ${serverName}`);
  }

  private async _toggleMCPServer(serverName: string, isOn: boolean) {
    const prevServer = this.infoOfClientId[serverName]?.mcpServer;
    // Включение сервера
    if (isOn) {
      // this.mcpEmitters.serverEvent.onChangeLoading.fire(getLoadingServerObject(serverName, isOn))
      const clientInfo = await this._createClientUnsafe(
        this.infoOfClientId[serverName].mcpServerEntryJSON,
        serverName,
        isOn,
      );
      this.mcpEmitters.serverEvent.onUpdate.fire({
        response: {
          name: serverName,
          newServer: clientInfo.mcpServer,
          prevServer,
        },
      });
    }
    // Выключение сервера
    else {
      // this.mcpEmitters.serverEvent.onChangeLoading.fire(getLoadingServerObject(serverName, isOn))
      this._closeClient(serverName);
      delete this.infoOfClientId[serverName]._client;

      this.mcpEmitters.serverEvent.onUpdate.fire({
        response: {
          name: serverName,
          newServer: {
            status: 'offline',
            tools: [],
            command: '',
            // Сброс поля error после прошлой ошибки подключения
            error: undefined,
          },
          prevServer,
        },
      });
    }
  }

  // Вызов инструментов MCP

  private async _callTool(
    serverName: string,
    toolName: string,
    params: any,
    signal?: AbortSignal,
  ): Promise<RawMCPToolCall> {
    const server = this.infoOfClientId[serverName];
    if (!server) throw new Error(`Server ${serverName} not found`);
    const { _client: client } = server;
    if (!client) throw new Error(`Client for server ${serverName} not found`);

    // Вызов инструмента с аргументами от агента
    const response = await client.callTool(
      {
        name: removeMCPToolNamePrefix(toolName),
        arguments: params,
      },
      undefined,
      {
        signal,
        timeout: MAX_TOOL_ABSOLUTE_TIME * 1000,
      },
    );
    const { content } = response as CallToolResult;
    const returnValue = content[0];

    if (returnValue.type === 'text') {
      // Текстовый ответ инструмента

      if (response.isError) {
        throw new Error(`Tool call error: ${returnValue.text}`);
      }

      // Успешный текстовый результат
      return {
        event: 'text',
        text: returnValue.text,
        toolName,
        serverName,
      };
    }

    throw new Error(
      `Tool call error: We don\'t support ${returnValue.type} tool response yet for tool ${toolName} on server ${serverName}`,
    );
  }

  // Обёртка: ошибки инструмента → MCPToolErrorResponse для рендерера
  private async _safeCallTool(
    serverName: string,
    toolName: string,
    params: any,
    signal?: AbortSignal,
  ): Promise<RawMCPToolCall> {
    try {
      const response = await this._callTool(serverName, toolName, params, signal);
      return response;
    } catch (err) {
      let errorMessage: string;

      // Ответ MCP с кодом JSON-RPC
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code) {
        const code = (err as { code: unknown }).code;
        let codeDescription = '';
        if (code === -32700) codeDescription = 'Parse Error';
        if (code === -32600) codeDescription = 'Invalid Request';
        if (code === -32601) codeDescription = 'Method Not Found';
        if (code === -32602) codeDescription = 'Invalid Parameters';
        if (code === -32603) codeDescription = 'Internal Error';
        errorMessage = `${codeDescription}. Full response:\n${JSON.stringify(err, null, 2)}`;
      } else if (typeof err === 'string') {
        errorMessage = err;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      } else {
        // Нестандартный формат ошибки
        errorMessage = JSON.stringify(err, null, 2);
      }

      const fullErrorMessage = `❌ Failed to call tool "${toolName}" on server "${serverName}": ${errorMessage}`;
      const errorResponse: MCPToolErrorResponse = {
        event: 'error',
        text: fullErrorMessage,
        toolName,
        serverName,
      };
      return errorResponse;
    }
  }
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import {
  MCPServerOfName,
  MCPConfigFileJSON,
  MCPConfigFileEntryJSON,
  MCPServer,
  MCPToolCallParams,
  RawMCPToolCall,
  MCPServerEventResponse,
} from './mcpServiceTypes.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { InternalToolInfo } from './prompt/prompts.js';
import { ISapphireSettingsService } from './sapphireSettingsService.js';
import { MCPUserStateOfName } from './sapphireSettingsTypes.js';

type MCPServiceState = {
  mcpServerOfName: MCPServerOfName;
  error: string | undefined; // ошибка разбора mcp.json (глобально)
};

export interface IMCPService {
  readonly _serviceBrand: undefined;
  revealMCPConfigFile(): Promise<void>;
  /** URI mcp.json; создаёт файл с пустым mcpServers, если его ещё нет. */
  getOrCreateMCPConfigFile(): Promise<URI>;
  toggleServerIsOn(serverName: string, isOn: boolean): Promise<void>;

  readonly state: MCPServiceState; // не сохраняется в storage
  onDidChangeState: Event<void>;

  getMCPTools(): InternalToolInfo[] | undefined;
  callMCPTool(toolData: MCPToolCallParams): {
    result: Promise<{ result: RawMCPToolCall }>;
    interruptTool: () => void;
  };
  stringifyResult(result: RawMCPToolCall): string;
}

export const IMCPService = createDecorator<IMCPService>('mcpConfigService');

const MCP_CONFIG_FILE_NAME = 'mcp.json';
// Раньше этот сервер дописывался в mcp.json при старте. Снимаем только эту запись.
const BUNDLED_FIGMA_DESKTOP_MCP_SERVER_NAME = 'figma-desktop';
const BUNDLED_FIGMA_DESKTOP_MCP_URL = 'http://127.0.0.1:3845/mcp';
const MCP_CONFIG_SAMPLE = {
  mcpServers: {},
};
const MCP_CONFIG_SAMPLE_STRING = JSON.stringify(MCP_CONFIG_SAMPLE, null, 2);

class MCPService extends Disposable implements IMCPService {
  _serviceBrand: undefined;

  private readonly channel: IChannel;

  // Снимок MCP-серверов с main process (mcpChannel)
  state: MCPServiceState = {
    mcpServerOfName: {},
    error: undefined,
  };

  // Сигнал об изменении state после событий серверов
  private readonly _onDidChangeState = new Emitter<void>();

  public readonly onDidChangeState = this._onDidChangeState.event;

  // private readonly _onLoadingServersChange = new Emitter<MCPServerEventLoadingParam>();
  // public readonly onLoadingServersChange = this._onLoadingServersChange.event;

  constructor(
    @IFileService private readonly fileService: IFileService,
    @IPathService private readonly pathService: IPathService,
    @IProductService private readonly productService: IProductService,
    @IEditorService private readonly editorService: IEditorService,
    @IMainProcessService private readonly mainProcessService: IMainProcessService,
    @ISapphireSettingsService private readonly sapphireSettingsService: ISapphireSettingsService,
  ) {
    super();
    this.channel = this.mainProcessService.getChannel('sapphire-channel-mcp');

    const onEvent = (e: MCPServerEventResponse) => {
      // console.log('GOT EVENT', e)
      this._setMCPServerState(e.response.name, e.response.newServer);
    };
    this._register(
      (this.channel.listen('onAdd_server') satisfies Event<MCPServerEventResponse>)(onEvent),
    );
    this._register(
      (this.channel.listen('onUpdate_server') satisfies Event<MCPServerEventResponse>)(onEvent),
    );
    this._register(
      (this.channel.listen('onDelete_server') satisfies Event<MCPServerEventResponse>)(onEvent),
    );

    this._initialize();
  }

  private async _initialize() {
    try {
      await this.sapphireSettingsService.waitForInitState;

      // Создать mcp.json при первом запуске
      const mcpConfigUri = await this._getMCPConfigFilePath();
      const fileExists = await this._configFileExists(mcpConfigUri);
      if (!fileExists) {
        await this._createMCPConfigFile(mcpConfigUri);
        console.log('MCP Config file created:', mcpConfigUri.toString());
      }
      await this._removeBundledFigmaMCPServer(mcpConfigUri);
      await this._addMCPConfigFileWatcher();
      await this._refreshMCPServers();
    } catch (error) {
      console.error('Error initializing MCPService:', error);
    }
  }

  private readonly _setMCPServerState = async (
    serverName: string,
    newServer: MCPServer | undefined,
  ) => {
    if (newServer === undefined) {
      // Удалить сервер из state
      const { [serverName]: removed, ...remainingServers } = this.state.mcpServerOfName;
      this.state = {
        ...this.state,
        mcpServerOfName: remainingServers,
      };
    } else {
      // Добавить или обновить сервер
      this.state = {
        ...this.state,
        mcpServerOfName: {
          ...this.state.mcpServerOfName,
          [serverName]: newServer,
        },
      };
    }
    this._onDidChangeState.fire();
  };

  private readonly _setHasError = async (errMsg: string | undefined) => {
    this.state = {
      ...this.state,
      error: errMsg,
    };
    this._onDidChangeState.fire();
  };

  // Создать файл конфигурации MCP
  private async _createMCPConfigFile(mcpConfigUri: URI): Promise<void> {
    await this.fileService.createFile(mcpConfigUri.with({ path: mcpConfigUri.path }));
    const buffer = VSBuffer.fromString(MCP_CONFIG_SAMPLE_STRING);
    await this.fileService.writeFile(mcpConfigUri, buffer);
  }

  // Убрать figma-desktop, который раньше ставился сам. Свою запись с тем же именем не трогаем.
  private async _removeBundledFigmaMCPServer(mcpConfigUri: URI): Promise<void> {
    try {
      const fileContent = await this.fileService.readFile(mcpConfigUri);
      const contentString = fileContent.value.toString();
      const configFileJson = JSON.parse(contentString) as MCPConfigFileJSON;
      if (!configFileJson.mcpServers || typeof configFileJson.mcpServers !== 'object') {
        return;
      }
      const entry = configFileJson.mcpServers[BUNDLED_FIGMA_DESKTOP_MCP_SERVER_NAME];
      if (!entry || !this._isBundledFigmaDesktopServer(entry)) {
        return;
      }
      delete configFileJson.mcpServers[BUNDLED_FIGMA_DESKTOP_MCP_SERVER_NAME];
      const buffer = VSBuffer.fromString(JSON.stringify(configFileJson, null, 2));
      await this.fileService.writeFile(mcpConfigUri, buffer);
    } catch (error) {
      console.error('Error removing bundled Figma MCP server:', error);
    }
  }

  private _isBundledFigmaDesktopServer(entry: MCPConfigFileEntryJSON): boolean {
    return (
      Object.keys(entry).length === 1 &&
      entry.url === BUNDLED_FIGMA_DESKTOP_MCP_URL
    );
  }

  private async _addMCPConfigFileWatcher(): Promise<void> {
    const mcpConfigUri = await this._getMCPConfigFilePath();
    this._register(this.fileService.watch(mcpConfigUri));

    this._register(
      this.fileService.onDidFilesChange(async (e) => {
        if (!e.contains(mcpConfigUri)) {return;}
        await this._refreshMCPServers();
      }),
    );
  }

  // Публичный API рендерера

  public async getOrCreateMCPConfigFile(): Promise<URI> {
    const mcpConfigUri = await this._getMCPConfigFilePath();
    if (!(await this._configFileExists(mcpConfigUri))) {
      await this._createMCPConfigFile(mcpConfigUri);
    }
    return mcpConfigUri;
  }

  public async revealMCPConfigFile(): Promise<void> {
    try {
      const mcpConfigUri = await this.getOrCreateMCPConfigFile();
      await this.editorService.openEditor({
        resource: mcpConfigUri,
        options: {
          pinned: true,
          revealIfOpened: true,
        },
      });
    } catch (error) {
      console.error('Error opening MCP config file:', error);
    }
  }

  public getMCPTools(): InternalToolInfo[] | undefined {
    const allTools: InternalToolInfo[] = [];
    for (const serverName in this.state.mcpServerOfName) {
      const server = this.state.mcpServerOfName[serverName];
      server.tools?.forEach((tool) => {
        allTools.push({
          description: tool.description || '',
          params: this._transformInputSchemaToParams(tool.inputSchema),
          name: tool.name,
          mcpServerName: serverName,
        });
      });
    }
    if (allTools.length === 0) {return undefined;}
    return allTools;
  }

  private _transformInputSchemaToParams(inputSchema?: Record<string, unknown>): {
    [paramName: string]: { description: string };
  } {
    // Без properties схема не даёт параметров для промпта
    if (!inputSchema || !inputSchema.properties) {return {};}

    const properties = inputSchema.properties as Record<string, unknown>;
    const params: { [paramName: string]: { description: string } } = {};
    Object.keys(properties).forEach((paramName) => {
      const propertyValues = properties[paramName];

      // Некорректное описание свойства в JSON Schema
      if (typeof propertyValues !== 'object') {
        console.warn(
          `Invalid property value for ${paramName}: expected object, got ${typeof propertyValues}`,
        );
        return; // в forEach return = continue
      }

      const description = (propertyValues as { description?: unknown }).description;
      params[paramName] = {
        description: JSON.stringify(description || '', null, 2) || '',
      };
    });
    return params;
  }

  private async _getMCPConfigFilePath(): Promise<URI> {
    const appName = this.productService.dataFolderName;
    const userHome = await this.pathService.userHome();
    const uri = URI.joinPath(userHome, appName, MCP_CONFIG_FILE_NAME);
    return uri;
  }

  private async _configFileExists(mcpConfigUri: URI): Promise<boolean> {
    try {
      await this.fileService.stat(mcpConfigUri);
      return true;
    } catch (_error) {
      return false;
    }
  }

  private async _parseMCPConfigFile(): Promise<MCPConfigFileJSON | null> {
    const mcpConfigUri = await this._getMCPConfigFilePath();
    try {
      const fileContent = await this.fileService.readFile(mcpConfigUri);
      const contentString = fileContent.value.toString();
      const configFileJson = JSON.parse(contentString);
      if (!configFileJson.mcpServers) {
        throw new Error('Missing mcpServers property');
      }
      return configFileJson as MCPConfigFileJSON;
    } catch (error) {
      const fullError = `Error parsing MCP config file: ${error}`;
      this._setHasError(fullError);
      return null;
    }
  }

  // Перечитать mcp.json и синхронизировать серверы с main
  private async _refreshMCPServers(): Promise<void> {
    this._setHasError(undefined);

    const newConfigFileJSON = await this._parseMCPConfigFile();
    if (!newConfigFileJSON) {
      console.log(`Not setting state: MCP config file not found`);
      return;
    }
    if (!newConfigFileJSON?.mcpServers) {
      console.log(`Not setting state: MCP config file did not have an 'mcpServers' field`);
      return;
    }

    const oldConfigFileNames = Object.keys(this.state.mcpServerOfName);
    const newConfigFileNames = Object.keys(newConfigFileJSON.mcpServers);

    const addedServerNames = newConfigFileNames.filter(
      (serverName) => !oldConfigFileNames.includes(serverName),
    );
    const removedServerNames = oldConfigFileNames.filter(
      (serverName) => !newConfigFileNames.includes(serverName),
    );

    // Новым серверам в конфиге — isOn: true в настройках
    const addedUserStateOfName: MCPUserStateOfName = {};
    for (const name of addedServerNames) {
      addedUserStateOfName[name] = { isOn: true };
    }
    await this.sapphireSettingsService.addMCPUserStateOfNames(addedUserStateOfName);

    // Удалить isOn для серверов, убранных из конфига
    await this.sapphireSettingsService.removeMCPUserStateOfNames(removedServerNames);

    // Показать loading, пока main переподключает серверы
    for (const serverName in newConfigFileJSON.mcpServers) {
      this._setMCPServerState(serverName, { status: 'loading', tools: [] });
    }
    const updatedServerNames = Object.keys(newConfigFileJSON.mcpServers).filter(
      (serverName) =>
        !addedServerNames.includes(serverName) && !removedServerNames.includes(serverName),
    );

    this.channel.call('refreshMCPServers', {
      mcpConfigFileJSON: newConfigFileJSON,
      addedServerNames,
      removedServerNames,
      updatedServerNames,
      userStateOfName: this.sapphireSettingsService.state.mcpUserStateOfName,
    });
  }

  stringifyResult(result: RawMCPToolCall): string {
    let toolResultStr: string;
    if (result.event === 'text') {
      toolResultStr = result.text;
    } else if (result.event === 'image') {
      toolResultStr = `[Image: ${result.image.mimeType}]`;
    } else if (result.event === 'audio') {
      toolResultStr = `[Audio content]`;
    } else if (result.event === 'resource') {
      toolResultStr = `[Resource content]`;
    } else {
      toolResultStr = JSON.stringify(result);
    }
    return toolResultStr;
  }

  // Переключить сервер и сохранить isOn в void settings
  public async toggleServerIsOn(serverName: string, isOn: boolean): Promise<void> {
    this._setMCPServerState(serverName, { status: 'loading', tools: [] });

    await this.sapphireSettingsService.setMCPServerState(serverName, { isOn });
    this.channel.call('toggleMCPServer', { serverName, isOn });
  }

  public callMCPTool(toolData: MCPToolCallParams): {
    result: Promise<{ result: RawMCPToolCall }>;
    interruptTool: () => void;
  } {
    const callId = toolData.callId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let cancelled = false;

    const result = (async () => {
      const raw = await this.channel.call<RawMCPToolCall>('callTool', { ...toolData, callId });
      if (cancelled) {
        throw new Error('MCP tool call was interrupted');
      }
      if (!raw) {
        throw new Error('MCP tool call failed with no response');
      }
      if (raw.event === 'error') {
        throw new Error(`Error: ${raw.text}`);
      }
      return { result: raw };
    })();

    return {
      result,
      interruptTool: () => {
        cancelled = true;
        void this.channel.call('cancelTool', { callId });
      },
    };
  }
}

registerSingleton(IMCPService, MCPService, InstantiationType.Eager);

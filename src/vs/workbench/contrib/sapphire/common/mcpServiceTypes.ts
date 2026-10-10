/**
 * Типы MCP-сервиса для моста renderer ↔ main.
 */

export interface MCPTool {
  /** Уникальное имя инструмента */
  name: string;
  /** Описание для пользователя и модели */
  description?: string;
  /** JSON Schema аргументов вызова */
  inputSchema?: Record<string, unknown>;
  /** Произвольные аннотации (поведение, безопасность и т.д.) */
  annotations?: Record<string, unknown>;
}

// ТИПЫ ФАЙЛА КОНФИГУРАЦИИ MCP -----------------------------

export interface MCPConfigFileEntryJSON {
  // Сервер, запускаемый командой
  command?: string;
  args?: string[];
  env?: Record<string, string>;

  // Сервер по URL (в JSON строка; при подключении — URL)
  url?: string;
  headers?: Record<string, string>;
}

export interface MCPConfigFileJSON {
  mcpServers: Record<string, MCPConfigFileEntryJSON>;
}

// СОБЫТИЯ СЕРВЕРА ------------------------------------------

export type MCPServer =
  | {
      tools: MCPTool[];
      status: 'loading' | 'success' | 'offline';
      command?: string;
      error?: string;
    }
  | {
      tools?: undefined;
      status: 'error';
      command?: string;
      error: string;
    };

export interface MCPServerOfName {
  [serverName: string]: MCPServer;
}

export type MCPServerEvent = {
  name: string;
  prevServer?: MCPServer;
  newServer?: MCPServer;
};
export type MCPServerEventResponse = { response: MCPServerEvent };

// ВЫЗОВ ИНСТРУМЕНТОВ ------------------------------------------

type MCPToolResponseType = 'text' | 'image' | 'audio' | 'resource' | 'error';

type ResponseImageTypes =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml'
  | 'image/bmp'
  | 'image/tiff'
  | 'image/vnd.microsoft.icon';

interface ImageData {
  data: string;
  mimeType: ResponseImageTypes;
}

interface MCPToolResponseBase {
  toolName: string;
  serverName?: string;
  event: MCPToolResponseType;
  text?: string;
  image?: ImageData;
}

type MCPToolResponseConstraints = {
  text: {
    image?: never;
    text: string;
  };
  error: {
    image?: never;
    text: string;
  };
  image: {
    text?: never;
    image: ImageData;
  };
  audio: {
    text?: never;
    image?: never;
  };
  resource: {
    text?: never;
    image?: never;
  };
};

type MCPToolEventResponse<T extends MCPToolResponseType> = Omit<
  MCPToolResponseBase,
  'event' | keyof MCPToolResponseConstraints
> &
  MCPToolResponseConstraints[T] & { event: T };

// Варианты ответа инструмента
export type MCPToolErrorResponse = MCPToolEventResponse<'error'>;
type MCPToolTextResponse = MCPToolEventResponse<'text'>;
type MCPToolImageResponse = MCPToolEventResponse<'image'>;
type MCPToolAudioResponse = MCPToolEventResponse<'audio'>;
type MCPToolResourceResponse = MCPToolEventResponse<'resource'>;
export type RawMCPToolCall =
  | MCPToolTextResponse
  | MCPToolErrorResponse
  | MCPToolImageResponse
  | MCPToolAudioResponse
  | MCPToolResourceResponse;

export interface MCPToolCallParams {
  serverName: string;
  toolName: string;
  params: Record<string, unknown>;
  /** Отмена вызова с рендерера по id. */
  callId?: string;
}

export const removeMCPToolNamePrefix = (name: string) => name.split('_').slice(1).join('_');

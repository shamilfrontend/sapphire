/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineComponent, h, onMounted, onUnmounted, onWatcherCleanup, ref, watch, type PropType, type VNodeChild } from 'vue';
import { ChevronRight, Hammer } from 'lucide-vue-next';
import { useAccessor, useChatThreadsState, useChatThreadsStreamState, useSettingsState } from '../util/services.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { getActiveWindow } from '../../../../../../../base/browser/dom.js';
import ChatMarkdownRender from '../markdown/ChatMarkdownRender.vue';
import { getApplyBoxId } from '../markdown/ChatMarkdownRender.js';
import BlockCode from '../util/BlockCode.vue';
import SapphireDiffEditor from '../util/SapphireDiffEditor.vue';
import CopyButton from '../markdown/CopyButton.vue';
import EditToolAcceptRejectButtonsHTML from '../markdown/EditToolAcceptRejectButtonsHTML.vue';
import { useEditToolStreamState } from '../markdown/ApplyBlockHoverButtons.js';
import { ChatMessage, ToolMessage } from '../../../../common/chatThreadServiceTypes.js';
import { approvalTypeOfBuiltinToolName, BrowserToolResult, BuiltinToolCallParams, BuiltinToolName, BuiltinToolResultType, LintErrorItem, ToolName } from '../../../../common/toolsServiceTypes.js';
import { builtinToolNames, isABuiltinToolName, MAX_FILE_CHARS_PAGE } from '../../../../common/prompt/prompts.js';
import { resolveThreadChatMode } from '../../../../common/sapphireSettingsTypes.js';
import { RawToolCallObj } from '../../../../common/sendLLMMessageTypes.js';
import ToolApprovalTypeSwitch from '../void-settings-tsx/ToolApprovalTypeSwitch.vue';
import { persistentTerminalNameOfId } from '../../../terminalToolService.js';
import { removeMCPToolNamePrefix } from '../../../../common/mcpServiceTypes.js';
import { getBasename, getFolderName } from '../../../../common/pathLabels.js';
import { getRelative, sapphireOpenFileFn } from './chatFileUtils.js';
import { useAgentsPlan } from '../agents-window-tsx/AgentsPlanContext.js';
import IconLoading from './IconLoading.vue';
import SmallProseWrapper from './SmallProseWrapper.vue';
import CodeChildren from './CodeChildren.vue';
import ListableToolItem from './ListableToolItem.vue';
import ToolChildrenWrapper from './ToolChildrenWrapper.vue';
import ToolHeaderWrapper from './ToolHeaderWrapper.vue';
type ToolHeaderParams = {
  icon?: VNodeChild;
  title: VNodeChild;
  desc1: VNodeChild;
  desc1OnClick?: () => void;
  desc2?: VNodeChild;
  isError?: boolean;
  info?: string;
  desc1Info?: string;
  isRejected?: boolean;
  numResults?: number;
  hasNextPage?: boolean;
  children?: VNodeChild;
  bottomChildren?: VNodeChild;
  onClick?: () => void;
  desc2OnClick?: () => void;
  isOpen?: boolean;
  className?: string;
};
const toolHeader = (params: ToolHeaderParams) => {
  const { children, ...props } = params;
  return children === undefined
    ? h(ToolHeaderWrapper, props)
    : h(ToolHeaderWrapper, props, () => children);
};

const EditTool = ({
  toolMessage,
  threadId,
  messageIdx,
  content
}: Parameters<ResultWrapper<'edit_file' | 'rewrite_file'>>[0] & {
  content: string;
}) => {
  const accessor = useAccessor();
  const isError = false;
  const isRejected = toolMessage.type === 'rejected';
  const title = getTitle(toolMessage);
  const {
    desc1,
    desc1Info
  } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
  const icon = null;
  const {
    params,
    name
  } = toolMessage;
  const desc1OnClick = () => sapphireOpenFileFn(params.uri, accessor);
  const componentParams: ToolHeaderParams = {
    title,
    desc1,
    desc1OnClick,
    desc1Info,
    isError,
    icon,
    isRejected
  };
  const editToolType = toolMessage.name === 'edit_file' ? 'diff' : 'rewrite';
  if (toolMessage.type === 'running_now' || toolMessage.type === 'tool_request') {
    componentParams.children = h(ToolChildrenWrapper, {
      class: 'bg-void-bg-3'
    }, h(EditToolChildren, {
      uri: params.uri,
      code: content,
      type: editToolType
    }));
  } else if (toolMessage.type === 'success' || toolMessage.type === 'rejected' || toolMessage.type === 'tool_error') {
    // блок Apply для кода
    const applyBoxId = getApplyBoxId({
      threadId,
      messageIdx,
      tokenIdx: 'N/A'
    });
    componentParams.desc2 = h(EditToolHeaderButtons, {
      applyBoxId: applyBoxId,
      uri: params.uri,
      codeStr: content,
      toolName: name,
      threadId: threadId
    });

    // дочерние элементы карточки
    componentParams.children = h(ToolChildrenWrapper, {
      class: 'bg-void-bg-3'
    }, h(EditToolChildren, {
      uri: params.uri,
      code: content,
      type: editToolType
    }));
    if (toolMessage.type === 'success' || toolMessage.type === 'rejected') {
      const {
        result
      } = toolMessage;
      componentParams.bottomChildren = h(BottomChildren, {
        title: 'Ошибки линтера'
      }, result?.lintErrors?.map((error, i) => h('div', {
        key: i,
        class: 'whitespace-nowrap'
      }, '\n              Строки ', error.startLineNumber, '-', error.endLineNumber, ': ', error.message)));
    } else if (toolMessage.type === 'tool_error') {
      // ветка ошибки
      const {
        result
      } = toolMessage;
      componentParams.bottomChildren = h(BottomChildren, {
        title: 'Ошибка'
      }, h(CodeChildren, null, result));
    }
  }
  return toolHeader(componentParams);
};
const formatDurationMs = (ms: number): string => {
  if (ms < 1000) {return `${(ms / 1000).toFixed(1)}с`;}
  const sec = Math.floor(ms / 1000);
  if (sec < 60) {return `${sec}с`;}
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}м ${String(s).padStart(2, '0')}с`;
};
const loadingTitleWrapper = (item: VNodeChild): VNodeChild => h('span', {
  class: 'flex items-center flex-nowrap'
}, item, h(IconLoading, {
  class: 'w-3 text-sm'
}));
const TerminalRunningTitle = defineComponent({
  name: 'TerminalRunningTitle',
  props: {
    startedAt: { type: Number, required: true },
  },
  setup(props) {
    const now = ref(Date.now());
    let id = 0;
    onMounted(() => {
      id = getActiveWindow().setInterval(() => {
        now.value = Date.now();
      }, 250);
    });
    onUnmounted(() => getActiveWindow().clearInterval(id));
    return () => loadingTitleWrapper(`Выполнение в терминале · ${formatDurationMs(now.value - props.startedAt)}`);
  },
});
const titleOfBuiltinToolName = {
  read_file: {
    done: 'Прочитан файл',
    proposed: 'Прочитать файл',
    running: loadingTitleWrapper('Чтение файла')
  },
  ls_dir: {
    done: 'Просмотрена папка',
    proposed: 'Просмотреть папку',
    running: loadingTitleWrapper('Просмотр папки')
  },
  get_dir_tree: {
    done: 'Просмотрено дерево папок',
    proposed: 'Просмотреть дерево папок',
    running: loadingTitleWrapper('Просмотр дерева папок')
  },
  search_pathnames_only: {
    done: 'Поиск по имени файла',
    proposed: 'Искать по имени файла',
    running: loadingTitleWrapper('Поиск по имени файла')
  },
  search_project_index: {
    done: 'Поиск по индексу проекта',
    proposed: 'Искать в индексе проекта',
    running: loadingTitleWrapper('Поиск по индексу проекта')
  },
  diff_impact: {
    done: 'Оценён охват изменений',
    proposed: 'Оценить охват изменений',
    running: loadingTitleWrapper('Оценка охвата изменений')
  },
  get_project_tour: {
    done: 'Тур онбординга',
    proposed: 'Прочитать тур онбординга',
    running: loadingTitleWrapper('Чтение тура онбординга')
  },
  search_for_files: {
    done: 'Поиск выполнен',
    proposed: 'Поиск',
    running: loadingTitleWrapper('Поиск')
  },
  grep_search: {
    done: 'Grep выполнен',
    proposed: 'Grep по содержимому',
    running: loadingTitleWrapper('Grep по содержимому')
  },
  glob_files: {
    done: 'Glob выполнен',
    proposed: 'Glob по файлам',
    running: loadingTitleWrapper('Glob по файлам')
  },
  web_search: {
    done: 'Веб-поиск выполнен',
    proposed: 'Веб-поиск',
    running: loadingTitleWrapper('Веб-поиск')
  },
  browse_url: {
    done: 'Страница прочитана',
    proposed: 'Открыть URL',
    running: loadingTitleWrapper('Чтение URL')
  },
  browser_navigate: {
    done: 'Страница открыта',
    proposed: 'Открыть в браузере',
    running: loadingTitleWrapper('Открытие в браузере')
  },
  browser_snapshot: {
    done: 'Снимок страницы',
    proposed: 'Снять снимок страницы',
    running: loadingTitleWrapper('Снимок страницы')
  },
  browser_click: {
    done: 'Клик выполнен',
    proposed: 'Клик в браузере',
    running: loadingTitleWrapper('Клик в браузере')
  },
  browser_type: {
    done: 'Текст введён',
    proposed: 'Ввод в браузере',
    running: loadingTitleWrapper('Ввод в браузере')
  },
  browser_scroll: {
    done: 'Страница прокручена',
    proposed: 'Прокрутить страницу',
    running: loadingTitleWrapper('Прокрутка страницы')
  },
  browser_screenshot: {
    done: 'Скриншот сделан',
    proposed: 'Скриншот браузера',
    running: loadingTitleWrapper('Скриншот браузера')
  },
  save_memory: {
    done: 'Память сохранена',
    proposed: 'Сохранить в память',
    running: loadingTitleWrapper('Сохранение в память')
  },
  create_file_or_folder: {
    done: `Создано`,
    proposed: `Создать`,
    running: loadingTitleWrapper(`Создание`)
  },
  delete_file_or_folder: {
    done: `Удалено`,
    proposed: `Удалить`,
    running: loadingTitleWrapper(`Удаление`)
  },
  edit_file: {
    done: `Файл отредактирован`,
    proposed: 'Редактировать файл',
    running: loadingTitleWrapper('Редактирование файла')
  },
  rewrite_file: {
    done: `Файл записан`,
    proposed: 'Записать файл',
    running: loadingTitleWrapper('Запись файла')
  },
  run_command: {
    done: `Команда выполнена`,
    proposed: 'Выполнить в терминале',
    running: loadingTitleWrapper('Выполнение в терминале')
  },
  run_persistent_command: {
    done: `Команда выполнена`,
    proposed: 'Выполнить в терминале',
    running: loadingTitleWrapper('Выполнение в терминале')
  },
  open_persistent_terminal: {
    done: `Терминал открыт`,
    proposed: 'Открыть терминал',
    running: loadingTitleWrapper('Открытие терминала')
  },
  kill_persistent_terminal: {
    done: `Терминал закрыт`,
    proposed: 'Закрыть терминал',
    running: loadingTitleWrapper('Закрытие терминала')
  },
  read_lint_errors: {
    done: `Ошибки линтера прочитаны`,
    proposed: 'Прочитать ошибки линтера',
    running: loadingTitleWrapper('Чтение ошибок линтера')
  },
  get_diagnostics: {
    done: 'Диагностика прочитана',
    proposed: 'Прочитать диагностику',
    running: loadingTitleWrapper('Чтение диагностики')
  },
  go_to_definition: {
    done: 'Определение найдено',
    proposed: 'Перейти к определению',
    running: loadingTitleWrapper('Поиск определения')
  },
  find_references: {
    done: 'Ссылки найдены',
    proposed: 'Найти ссылки',
    running: loadingTitleWrapper('Поиск ссылок')
  },
  search_symbols: {
    done: 'Символы найдены',
    proposed: 'Искать символы',
    running: loadingTitleWrapper('Поиск символов')
  },
  rename_symbol: {
    done: 'Символ переименован',
    proposed: 'Переименовать символ',
    running: loadingTitleWrapper('Переименование символа')
  },
  run_subagent: {
    done: 'Субагент завершён',
    proposed: 'Запустить субагента',
    running: loadingTitleWrapper('Субагент работает')
  },
  run_parallel_subagents: {
    done: 'Параллельные субагенты завершены',
    proposed: 'Запустить параллельных субагентов',
    running: loadingTitleWrapper('Параллельные субагенты')
  },
  get_chat_history: {
    done: 'История чатов прочитана',
    proposed: 'Прочитать историю чатов',
    running: loadingTitleWrapper('Чтение истории чатов')
  },
  search_in_file: {
    done: 'Поиск в файле выполнен',
    proposed: 'Искать в файле',
    running: loadingTitleWrapper('Поиск в файле')
  },
  create_plan: {
    done: 'План создан',
    proposed: 'Создать план',
    running: loadingTitleWrapper('Создание плана')
  },
  update_plan: {
    done: 'План обновлён',
    proposed: 'Обновить план',
    running: loadingTitleWrapper('Обновление плана')
  },
  enable_mcp_server: {
    done: 'MCP-сервер включён',
    proposed: 'Включить MCP-сервер',
    running: loadingTitleWrapper('Включение MCP-сервера')
  }
} as const satisfies Record<BuiltinToolName, {
  done: VNodeChild;
  proposed: VNodeChild;
  running: VNodeChild;
}>;
const getTitle = (toolMessage: Pick<ChatMessage & {
  role: 'tool';
}, 'name' | 'type' | 'mcpServerName' | 'startedAt' | 'durationMs'>): VNodeChild => {
  const t = toolMessage;

  // заголовок для MCP / внешних инструментов
  if (!builtinToolNames.includes(t.name as BuiltinToolName)) {
    // подпись «Выполняется» / «Выполнено» и т.п.
    const descriptor = t.type === 'success' ? 'Вызван' : t.type === 'running_now' ? 'Вызов' : t.type === 'tool_request' ? 'Вызов' : t.type === 'rejected' ? 'Вызов' : t.type === 'invalid_params' ? 'Вызов' : t.type === 'tool_error' ? 'Вызов' : 'Вызов';
    const title = `${descriptor} ${toolMessage.mcpServerName || 'MCP'}`;
    if (t.type === 'running_now' || t.type === 'tool_request') {return loadingTitleWrapper(title);}
    return title;
  }

  // заголовок встроенного инструмента

  const toolName = t.name as BuiltinToolName;
  const isTerminal = toolName === 'run_command' || toolName === 'run_persistent_command';
  if (isTerminal && t.type === 'running_now' && t.startedAt) {
    return h(TerminalRunningTitle, {
      startedAt: t.startedAt
    });
  }
  if (t.type === 'success') {
    const done = titleOfBuiltinToolName[toolName].done;
    if (isTerminal && (t.durationMs !== null && t.durationMs !== undefined)) {
      return `${done} · ${formatDurationMs(t.durationMs)}`;
    }
    return done;
  }
  if (t.type === 'tool_error') {
    const proposed = titleOfBuiltinToolName[toolName].proposed;
    if (isTerminal && (t.durationMs !== null && t.durationMs !== undefined)) {
      return `${proposed} · ${formatDurationMs(t.durationMs)}`;
    }
    return proposed;
  }
  if (t.type === 'running_now') {return titleOfBuiltinToolName[toolName].running;}
  return titleOfBuiltinToolName[toolName].proposed;
};
const toolNameToDesc = (toolName: BuiltinToolName, _toolParams: BuiltinToolCallParams[BuiltinToolName] | undefined, accessor: ReturnType<typeof useAccessor>): {
  desc1: VNodeChild;
  desc1Info?: string;
} => {
  if (!_toolParams) {
    return {
      desc1: ''
    };
  }
  const x = {
    read_file: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['read_file'];
      return {
        desc1: getBasename(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor)
      };
    },
    ls_dir: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['ls_dir'];
      return {
        desc1: getFolderName(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor)
      };
    },
    search_pathnames_only: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['search_pathnames_only'];
      return {
        desc1: `"${toolParams.query}"`
      };
    },
    search_project_index: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['search_project_index'];
      return {
        desc1: `"${toolParams.query}"`
      };
    },
    diff_impact: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['diff_impact'];
      const paths = toolParams.paths ?? '';
      return {
        desc1: paths.split(/[\n,]/).map((part) => part.trim()).filter(Boolean).slice(0, 3).join(', ') || 'paths'
      };
    },
    get_project_tour: () => {
      return {
        desc1: 'tour.json'
      };
    },
    search_for_files: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['search_for_files'];
      return {
        desc1: `"${toolParams.query}"`
      };
    },
    grep_search: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['grep_search'];
      return {
        desc1: `"${toolParams.query}"`
      };
    },
    glob_files: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['glob_files'];
      return {
        desc1: `"${toolParams.pattern}"`
      };
    },
    web_search: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['web_search'];
      return {
        desc1: `"${toolParams.query}"`
      };
    },
    browse_url: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['browse_url'];
      return {
        desc1: toolParams.url
      };
    },
    browser_navigate: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['browser_navigate'];
      return {
        desc1: toolParams.url
      };
    },
    browser_snapshot: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['browser_snapshot'];
      return {
        desc1: toolParams.pageId
      };
    },
    browser_click: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['browser_click'];
      return {
        desc1: toolParams.element
      };
    },
    browser_type: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['browser_type'];
      return {
        desc1: toolParams.element
      };
    },
    browser_scroll: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['browser_scroll'];
      return {
        desc1: toolParams.direction
      };
    },
    browser_screenshot: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['browser_screenshot'];
      return {
        desc1: toolParams.pageId
      };
    },
    save_memory: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['save_memory'];
      return {
        desc1: `${toolParams.type}: ${toolParams.key}`
      };
    },
    search_in_file: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['search_in_file'];
      return {
        desc1: `"${toolParams.query}"`,
        desc1Info: getRelative(toolParams.uri, accessor)
      };
    },
    create_file_or_folder: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['create_file_or_folder'];
      return {
        desc1: toolParams.isFolder ? getFolderName(toolParams.uri.fsPath) ?? '/' : getBasename(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor)
      };
    },
    delete_file_or_folder: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['delete_file_or_folder'];
      return {
        desc1: toolParams.isFolder ? getFolderName(toolParams.uri.fsPath) ?? '/' : getBasename(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor)
      };
    },
    rewrite_file: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['rewrite_file'];
      return {
        desc1: getBasename(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor)
      };
    },
    edit_file: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['edit_file'];
      return {
        desc1: getBasename(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor)
      };
    },
    run_command: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['run_command'];
      return {
        desc1: toolParams.command
      };
    },
    run_persistent_command: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['run_persistent_command'];
      return {
        desc1: toolParams.command
      };
    },
    open_persistent_terminal: () => {
      return {
        desc1: ''
      };
    },
    kill_persistent_terminal: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['kill_persistent_terminal'];
      return {
        desc1: toolParams.persistentTerminalId
      };
    },
    get_dir_tree: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['get_dir_tree'];
      return {
        desc1: getFolderName(toolParams.uri.fsPath) ?? '/',
        desc1Info: getRelative(toolParams.uri, accessor)
      };
    },
    read_lint_errors: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['read_lint_errors'];
      return {
        desc1: getBasename(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor)
      };
    },
    get_diagnostics: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['get_diagnostics'];
      if (toolParams.uri) {
        return {
          desc1: getBasename(toolParams.uri.fsPath),
          desc1Info: getRelative(toolParams.uri, accessor)
        };
      }
      return {
        desc1: 'workspace'
      };
    },
    go_to_definition: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['go_to_definition'];
      const sym = toolParams.symbol ? ` ${toolParams.symbol}` : '';
      return {
        desc1: `${getBasename(toolParams.uri.fsPath)}:${toolParams.line}${sym}`,
        desc1Info: getRelative(toolParams.uri, accessor)
      };
    },
    find_references: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['find_references'];
      const sym = toolParams.symbol ? ` ${toolParams.symbol}` : '';
      return {
        desc1: `${getBasename(toolParams.uri.fsPath)}:${toolParams.line}${sym}`,
        desc1Info: getRelative(toolParams.uri, accessor)
      };
    },
    search_symbols: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['search_symbols'];
      return {
        desc1: `"${toolParams.query}"`,
        desc1Info: toolParams.uri ? getRelative(toolParams.uri, accessor) : undefined
      };
    },
    rename_symbol: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['rename_symbol'];
      const from = toolParams.symbol ?? getBasename(toolParams.uri.fsPath);
      return {
        desc1: `${from} → ${toolParams.newName}`,
        desc1Info: getRelative(toolParams.uri, accessor)
      };
    },
    run_subagent: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['run_subagent'];
      return {
        desc1: toolParams.description
      };
    },
    run_parallel_subagents: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['run_parallel_subagents'];
      const n = toolParams.tasks?.length ?? 0;
      return {
        desc1: `${n}`
      };
    },
    get_chat_history: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['get_chat_history'];
      if (toolParams.threadId) {
        return {
          desc1: toolParams.threadId.slice(0, 8),
          desc1Info: toolParams.threadId
        };
      }
      return {
        desc1: 'обзор'
      };
    },
    create_plan: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['create_plan'];
      return {
        desc1: toolParams.name
      };
    },
    update_plan: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['update_plan'];
      return {
        desc1: getBasename(toolParams.planUri.fsPath),
        desc1Info: getRelative(toolParams.planUri, accessor)
      };
    },
    enable_mcp_server: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['enable_mcp_server'];
      return {
        desc1: toolParams.serverName
      };
    }
  };
  try {
    return x[toolName]?.() || {
      desc1: ''
    };
  } catch {
    return {
      desc1: ''
    };
  }
};

export const ToolRequestAcceptRejectButtons = ({
  toolName
}: {
  toolName: ToolName;
}) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');
  const onAccept = () => {
    try {
      const threadId = chatThreadsService.state.currentThreadId;
      const running = chatThreadsService.streamState[threadId]?.isRunning;
      if (running === 'tool' || running === 'LLM') {
        return;
      }
      chatThreadsService.approveLatestToolRequest(threadId);
    } catch (e) {
      console.error('Error while approving message in chat:', e);
    }
  };
  const onReject = () => {
    try {
      const threadId = chatThreadsService.state.currentThreadId;
      chatThreadsService.rejectLatestToolRequest(threadId);
    } catch (e) {
      console.error('Error while approving message in chat:', e);
    }
  };
  const approveButton = h('button', {
    onClick: onAccept,
    class: `
                px-2 py-1
                bg-void-success
                text-white
                hover:opacity-90
                rounded-sm
                text-sm font-medium
            `
  }, '\n      Одобрить\n    ');
  const cancelButton = h('button', {
    onClick: onReject,
    class: `
                px-2 py-1
                bg-void-bg-2-alt
                text-void-fg-1
                border border-void-border-2
                hover:bg-void-bg-2-hover
                rounded-sm
                text-sm font-medium
            `
  }, '\n      Отмена\n    ');
  const approvalType = isABuiltinToolName(toolName) ? approvalTypeOfBuiltinToolName[toolName] : 'MCP tools';
  const approvalDesc =
    approvalType === 'edits'
      ? 'правки'
      : approvalType === 'terminal'
        ? 'терминал'
        : approvalType === 'network'
          ? 'сеть'
          : approvalType === 'browser'
            ? 'браузер'
            : 'MCP';

  const approvalToggle = approvalType ? h('div', {
    key: approvalType,
    class: 'flex items-center ml-2 gap-x-1'
  }, h(ToolApprovalTypeSwitch, {
    size: 'xs',
    approvalType: approvalType,
    desc: `Автоодобрение: ${approvalDesc}`
  })) : null;
  return h('div', {
    class: 'flex gap-2 mx-0.5 items-center'
  }, approveButton, cancelButton, approvalToggle);
};
export { findPinnedPlanToolMessage, planUriFsPathFromPlanTool, planUriFsPathToCollapseInThread, shouldCollapsePlanToolInThread } from '../../../../common/planToolPin.js';

/** Компактная строка в ленте, когда полная карточка закреплена или план building/built. */
export const PlanToolInlinePlaceholder = ({
  toolMessage
}: {
  toolMessage: ToolMessage<'create_plan'> | ToolMessage<'update_plan'>;
}) => {
  const name = toolMessage.type === 'success' && toolMessage.result && Object.hasOwn(toolMessage.result, 'name') ? toolMessage.result.name : toolMessage.params && Object.hasOwn(toolMessage.params, 'name') ? toolMessage.params.name : undefined;
  return h(ToolHeaderWrapper, {
    title: getTitle(toolMessage),
    desc1: name ?? (toolMessage.name === 'update_plan' ? 'План обновлён' : 'План создан'),
    isError: false,
    icon: null
  });
};
export const PlanToolCard = defineComponent({
  name: 'PlanToolCard',
  props: {
    toolMessage: { type: Object as PropType<ToolMessage<'create_plan'> | ToolMessage<'update_plan'>>, required: true },
  },
  setup(props) {
    const accessor = useAccessor();
    const agentsPlan = useAgentsPlan();
    const chatThreadsService = accessor.get('IChatThreadService');
    const chatThreadsState = useChatThreadsState();
    const streamState = useChatThreadsStreamState(() => chatThreadsState.value.currentThreadId);
    return () => {
      const toolMessage = props.toolMessage;
      const title = getTitle(toolMessage);
  const isRejected = toolMessage.type === 'rejected';
  if (toolMessage.type === 'tool_request' || toolMessage.type === 'running_now') {
    return h(ToolHeaderWrapper, {
      title: title,
      desc1: toolMessage.name === 'create_plan' ? 'Создание…' : 'Обновление…',
      isError: false,
      icon: null
    });
  }
  if (toolMessage.type === 'invalid_params' || toolMessage.type === 'tool_error') {
    return h(ToolHeaderWrapper, {
      title: title,
      desc1: 'Ошибка',
      isError: true,
      icon: null,
      isRejected: false,
      bottomChildren: h(BottomChildren, {
        title: 'Ошибка'
      }, h(CodeChildren, null, toolMessage.content))
    });
  }
  const result = toolMessage.type === 'success' ? toolMessage.result as BuiltinToolResultType['create_plan'] : null;
  const name = result?.name ?? (toolMessage.params && Object.hasOwn(toolMessage.params, 'name') ? (toolMessage.params as BuiltinToolCallParams['create_plan']).name : 'План');
  const overview = result?.overview ?? (toolMessage.params && Object.hasOwn(toolMessage.params, 'overview') ? (toolMessage.params as BuiltinToolCallParams['create_plan']).overview : '');
  const planUri = result?.planUri ?? (toolMessage.params && Object.hasOwn(toolMessage.params, 'planUri') ? (toolMessage.params as BuiltinToolCallParams['update_plan']).planUri : null);
  const threads = chatThreadsState.value;
  const activePlan = threads.allThreads[threads.currentThreadId]?.state.activePlan;
  const isThisActivePlan = !!(planUri && activePlan?.planUriFsPath === planUri.fsPath);
  const planStatus = isThisActivePlan ? activePlan?.status : undefined;
  const isRunning = !!streamState.value?.isRunning;

  // обычные функции (не useCallback), чтобы число хуков не менялось при
  // переходах running_now → success после ранних return выше
  const onViewPlan = () => {
    if (!planUri) {return;}
    if (agentsPlan) {
      agentsPlan.openPlan(planUri.fsPath);
      return;
    }
    sapphireOpenFileFn(planUri, accessor);
  };
  const onBuild = () => {
    const threadId = chatThreadsService.state.currentThreadId;
    void chatThreadsService.buildActivePlan(threadId);
  };
  const buildLabel = planStatus === 'building' && isRunning ? 'Выполняется…' : planStatus === 'building' && !isRunning ? 'Продолжить' : planStatus === 'built' ? 'Выполнить снова' : 'Сделать по плану';
  const canBuild = isThisActivePlan && (planStatus === 'ready' || planStatus === 'built' || planStatus === 'building' && !isRunning) && !isRunning && !isRejected;
  const progressLabel = isThisActivePlan ? activePlan?.progressLabel : undefined;
  return h('div', {
    class: 'mx-0.5 my-1 rounded-md border border-void-border-2 bg-void-bg-2 overflow-hidden'
  }, h('div', {
    class: 'px-3 pt-2.5 pb-1 text-[11px] uppercase tracking-wide text-void-fg-3'
  }, toolMessage.name === 'update_plan' ? 'План обновлён' : 'План создан'), h('div', {
    class: 'px-3 pb-2'
  }, h('div', {
    class: 'text-sm font-medium text-void-fg-1'
  }, name), overview ? h('div', {
    class: 'mt-1 text-xs text-void-fg-3 leading-relaxed'
  }, overview) : null, progressLabel && (planStatus === 'building' || planStatus === 'built') ? h('div', {
    class: 'mt-1.5 text-xs text-void-fg-2'
  }, progressLabel) : null), h('div', {
    class: 'flex items-center justify-end gap-3 px-3 py-2 border-t border-void-border-1 bg-void-bg-1/50'
  }, planUri ? h('button', {
    type: 'button',
    onClick: onViewPlan,
    class: 'text-xs text-void-fg-3 hover:text-void-fg-1 underline-offset-2 hover:underline'
  }, '\n            Открыть план\n          ') : null, h('button', {
    type: 'button',
    disabled: !canBuild,
    onClick: onBuild,
    class: `
						inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-sm font-medium
						${canBuild ? 'bg-void-success text-white hover:opacity-90' : 'opacity-50 cursor-not-allowed bg-void-bg-3 text-void-fg-3'}
					`
  }, h(Hammer, {
    class: 'w-3.5 h-3.5'
  }), buildLabel)), isRejected ? h('div', {
    class: 'px-3 py-1 text-xs text-void-fg-3'
  }, 'Отклонено') : null);
    };
  },
});


/** В agent — однострочная строка инструмента; в plan — карточка с подтверждением. */
export const UpdatePlanToolCard = defineComponent({
  name: 'UpdatePlanToolCard',
  props: {
    toolMessage: { type: Object as PropType<ToolMessage<'update_plan'>>, required: true },
  },
  setup(props) {
    const settingsState = useSettingsState();
    const threadsState = useChatThreadsState();
    const accessor = useAccessor();
    const agentsPlan = useAgentsPlan();
    return () => {
      const toolMessage = props.toolMessage;
      const threads = threadsState.value;
      const chatMode = resolveThreadChatMode(
        threads.allThreads[threads.currentThreadId]?.state.chatMode,
        settingsState.value.globalSettings.chatMode,
      );
  if (chatMode !== 'agent') {
    return h(PlanToolCard, {
      toolMessage: toolMessage
    });
  }
  const title = getTitle(toolMessage);
  const isRejected = toolMessage.type === 'rejected';
  const isError = toolMessage.type === 'invalid_params' || toolMessage.type === 'tool_error';
  const {
    desc1,
    desc1Info
  } = toolNameToDesc(toolMessage.name, Object.hasOwn(toolMessage, 'params') ? toolMessage.params : undefined, accessor);
  const planUri = toolMessage.type !== 'invalid_params' && toolMessage.params && Object.hasOwn(toolMessage.params, 'planUri') ? toolMessage.params.planUri : undefined;
  const componentParams: ToolHeaderParams = {
    title,
    desc1,
    desc1Info,
    isError,
    icon: null,
    isRejected
  };
  if (planUri && (toolMessage.type === 'success' || toolMessage.type === 'rejected')) {
    componentParams.onClick = () => {
      if (agentsPlan) {
        agentsPlan.openPlan(planUri.fsPath);
        return;
      }
      sapphireOpenFileFn(planUri, accessor);
    };
  }
  if (isError) {
    componentParams.bottomChildren = h(BottomChildren, {
      title: 'Ошибка'
    }, h(CodeChildren, null, toolMessage.content));
  }
  return toolHeader(componentParams);
    };
  },
});

const EditToolChildren = ({
  uri,
  code,
  type
}: {
  uri: URI | undefined;
  code: string;
  type: 'diff' | 'rewrite';
}) => {
  const content = type === 'diff' ? h(SapphireDiffEditor, {
    uri: uri,
    searchReplaceBlocks: code
  }) : h(ChatMarkdownRender, {
    string: `\`\`\`\n${code}\n\`\`\``,
    codeURI: uri,
    chatMessageLocation: undefined
  });
  return h('div', {
    class: '!select-text cursor-auto'
  }, h(SmallProseWrapper, null, content));
};
const LintErrorChildren = ({
  lintErrors
}: {
  lintErrors: LintErrorItem[];
}) => h('div', {
  class: 'text-xs text-void-fg-4 opacity-80 border-l-2 border-void-warning px-2 py-0.5 flex flex-col gap-0.5 overflow-x-auto whitespace-nowrap'
}, lintErrors.map((error, i) => h('div', {
  key: i
}, '\n        Lines ', error.startLineNumber, '-', error.endLineNumber, ': ', error.message)));
const BottomChildren = defineComponent({
  name: 'BottomChildren',
  props: {
    title: { type: String, required: true },
  },
  setup(props, { slots }) {
    const isOpen = ref(false);
    return () => {
      const children = slots.default?.();
      if (!children) {return null;}
      return h('div', {
        class: 'w-full px-2 mt-0.5'
      }, h('div', {
        class: 'flex items-center cursor-pointer select-none transition-colors duration-150 pl-0 py-0.5 rounded group',
        onClick: () => {
          isOpen.value = !isOpen.value;
        },
        style: {
          background: 'none'
        }
      }, h(ChevronRight, {
        class: `mr-1 h-3 w-3 flex-shrink-0 transition-transform duration-100 text-void-fg-4 group-hover:text-void-fg-3 ${isOpen.value ? 'rotate-90' : ''}`
      }), h('span', {
        class: 'font-medium text-void-fg-4 group-hover:text-void-fg-3 text-xs'
      }, props.title)), h('div', {
        class: `overflow-hidden transition-all duration-200 ease-in-out ${isOpen.value ? 'opacity-100' : 'max-h-0 opacity-0'} text-xs pl-4`
      }, h('div', {
        class: 'overflow-x-auto text-void-fg-4 opacity-90 border-l-2 border-void-warning px-2 py-0.5'
      }, children)));
    };
  },
});
const EditToolHeaderButtons = defineComponent({
  name: 'EditToolHeaderButtons',
  props: {
    threadId: { type: String, required: true },
    applyBoxId: { type: String, required: true },
    uri: { type: Object as PropType<URI>, required: true },
    codeStr: { type: String, required: true },
    toolName: { type: String as PropType<'edit_file' | 'rewrite_file'>, required: true },
  },
  setup(props) {
    const editState = useEditToolStreamState({
      applyBoxId: props.applyBoxId,
      uri: props.uri,
    });
    return () => h('div', {
      class: 'flex items-center gap-1'
    }, editState.streamState.value === 'idle-no-changes' && h(CopyButton, {
      codeStr: props.codeStr,
      toolTipName: 'Копировать'
    }), h(EditToolAcceptRejectButtonsHTML, {
      type: props.toolName,
      codeStr: props.codeStr,
      applyBoxId: props.applyBoxId,
      uri: props.uri,
      threadId: props.threadId
    }));
  },
});
export const InvalidTool = ({
  toolName,
  message,
  mcpServerName
}: {
  toolName: ToolName;
  message: string;
  mcpServerName: string | undefined;
}) => {
  const title = getTitle({
    name: toolName,
    type: 'invalid_params',
    mcpServerName
  });
  const desc1 = 'Неверные параметры';
  const icon = null;
  const isError = true;
  const componentParams: ToolHeaderParams = {
    title,
    desc1,
    isError,
    icon
  };
  componentParams.children = h(ToolChildrenWrapper, null, h(CodeChildren, {
    class: 'bg-void-bg-3'
  }, message));
  return toolHeader(componentParams);
};
export const CanceledTool = ({
  toolName,
  mcpServerName
}: {
  toolName: ToolName;
  mcpServerName: string | undefined;
}) => {
  const title = getTitle({
    name: toolName,
    type: 'rejected',
    mcpServerName
  });
  const desc1 = '';
  const icon = null;
  const isRejected = true;
  const componentParams: ToolHeaderParams = {
    title,
    desc1,
    icon,
    isRejected
  };
  return toolHeader(componentParams);
};
type CommandToolProps = {
  threadId: string;
} & ({
  toolMessage: Exclude<ToolMessage<'run_command'>, { type: 'invalid_params' }>;
  type: 'run_command';
} | {
  toolMessage: Exclude<ToolMessage<'run_persistent_command'>, { type: 'invalid_params' }>;
  type: 'run_persistent_command';
});

const CommandTool = defineComponent({
  name: 'CommandTool',
  props: {
    toolMessage: { type: Object as PropType<CommandToolProps['toolMessage']>, required: true },
    type: { type: String as PropType<CommandToolProps['type']>, required: true },
    threadId: { type: String, required: true },
  },
  setup(props: CommandToolProps) {
  const accessor = useAccessor();
  const terminalToolsService = accessor.get('ITerminalToolService');
  const toolsService = accessor.get('IToolsService');
  const streamState = useChatThreadsStreamState(() => props.threadId);
  const divRef = ref<HTMLDivElement | null>(null);
  watch(() => streamState.value?.isRunning, () => {
    const toolMessage = props.toolMessage;
    const type = props.type;
    if (streamState.value?.isRunning !== 'tool') {return;}
    if (type !== 'run_command' || toolMessage.type !== 'running_now') {return;}
    let cancelled = false;
    let detach: (() => void) | undefined;
    (async () => {
      const deadline = Date.now() + 35_000;
      let terminal = terminalToolsService.getTemporaryTerminal(toolMessage.params.terminalId);
      while (!cancelled && !terminal && Date.now() < deadline) {
        await new Promise<void>(r => setTimeout(r, 50));
        terminal = terminalToolsService.getTemporaryTerminal(toolMessage.params.terminalId);
      }
      if (cancelled || !terminal) {return;}
      const container = divRef.value;
      if (!container) {return;}
      try {
        terminal.attachToElement(container);
        terminal.setVisible(true);
      } catch {}
      const resizeObserver = new ResizeObserver(entries => {
        const height = entries[0].borderBoxSize[0].blockSize;
        const width = entries[0].borderBoxSize[0].inlineSize;
        if (typeof terminal.layout === 'function') {
          terminal.layout({
            width,
            height
          });
        }
      });
      resizeObserver.observe(container);
      detach = () => {
        try {
          terminal.detachFromElement();
        } catch {}
        resizeObserver.disconnect();
      };
    })();
    onWatcherCleanup(() => {
      cancelled = true;
      detach?.();
    });
  }, { immediate: true });
  return () => {
  const toolMessage = props.toolMessage;
  const type = props.type;
  const isError = false;
  const title = getTitle(toolMessage);
  const {
    desc1,
    desc1Info
  } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
  const icon = null;
  const isRejected = toolMessage.type === 'rejected';
  const componentParams: ToolHeaderParams = {
    title,
    desc1,
    desc1Info,
    isError,
    icon,
    isRejected
  };
  if (toolMessage.type === 'success') {
    const {
      result
    } = toolMessage;
    let msg: string;
    if (type === 'run_command') {msg = toolsService.stringOfResult.run_command(toolMessage.params, result);}else {msg = toolsService.stringOfResult.run_persistent_command(toolMessage.params, result);}
    if (type === 'run_persistent_command') {
      componentParams.info = persistentTerminalNameOfId(toolMessage.params.persistentTerminalId);
    }
    componentParams.children = h(ToolChildrenWrapper, {
      class: 'whitespace-pre text-nowrap overflow-auto text-sm'
    }, h('div', {
      class: '!select-text cursor-auto'
    }, h(BlockCode, {
      initValue: `${msg.trim()}`,
      language: 'shellscript'
    })));
  } else if (toolMessage.type === 'tool_error') {
    const {
      result
    } = toolMessage;
    componentParams.bottomChildren = h(BottomChildren, {
      title: 'Ошибка'
    }, h(CodeChildren, null, result));
  } else if (toolMessage.type === 'running_now') {
    if (type === 'run_command') {componentParams.children = h('div', {
      ref: divRef,
      class: 'relative h-[300px] text-sm'
    });}
  } else if (toolMessage.type === 'rejected' || toolMessage.type === 'tool_request') {}
  componentParams.isOpen = type === 'run_command' && toolMessage.type === 'running_now' ? true : undefined;
  return toolHeader(componentParams);
  };
  },
});

type WrapperProps<T extends ToolName> = {
  toolMessage: Exclude<ToolMessage<T>, {
    type: 'invalid_params';
  }>;
  messageIdx: number;
  threadId: string;
};
export const MCPToolWrapper = ({
  toolMessage
}: WrapperProps<string>) => {
  const accessor = useAccessor();
  const mcpService = accessor.get('IMCPService');
  const title = getTitle(toolMessage);
  const desc1 = removeMCPToolNamePrefix(toolMessage.name);
  const icon = null;
  if (toolMessage.type === 'running_now') {return null;} // не показываем состояние running_now

  const isError = false;
  const isRejected = toolMessage.type === 'rejected';
  const {
    params
  } = toolMessage;
  const componentParams: ToolHeaderParams = {
    title,
    desc1,
    isError,
    icon,
    isRejected
  };
  const paramsStr = JSON.stringify(params, null, 2);
  componentParams.desc2 = h(CopyButton, {
    codeStr: paramsStr,
    toolTipName: `Копировать параметры: ${paramsStr}`
  });
  componentParams.info = !toolMessage.mcpServerName ? 'MCP-инструмент не найден' : undefined;

  // кнопка копирования входных данных в desc2

  if (toolMessage.type === 'success' || toolMessage.type === 'tool_request') {
    const {
      result
    } = toolMessage;
    const resultStr = result ? mcpService.stringifyResult(result) : 'null';
    componentParams.children = h(ToolChildrenWrapper, null, h(SmallProseWrapper, null, h(ChatMarkdownRender, {
      string: `\`\`\`json\n${resultStr}\n\`\`\``,
      chatMessageLocation: undefined,
      isApplyEnabled: false,
      isLinkDetectionEnabled: true
    })));
  } else if (toolMessage.type === 'tool_error') {
    const {
      result
    } = toolMessage;
    componentParams.bottomChildren = h(BottomChildren, {
      title: 'Ошибка'
    }, h(CodeChildren, null, result));
  }
  return toolHeader(componentParams);
};
const CodeNavToolCard = ({
  toolMessage
}: {
  toolMessage: ToolMessage<'go_to_definition'> | ToolMessage<'find_references'>;
}) => {
  const accessor = useAccessor();
  const title = getTitle(toolMessage);
  const {
    desc1,
    desc1Info
  } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
  if (toolMessage.type === 'tool_request') {return null;}
  if (toolMessage.type === 'running_now') {return null;}
  const isRejected = toolMessage.type === 'rejected';
  const {
    params
  } = toolMessage;
  const componentParams: ToolHeaderParams = {
    title,
    desc1,
    desc1Info,
    isError: false,
    icon: null,
    isRejected
  };
  componentParams.info = getRelative(params.uri, accessor);
  if (toolMessage.type === 'success') {
    const {
      result
    } = toolMessage;
    componentParams.onClick = () => {
      sapphireOpenFileFn(params.uri, accessor, [params.line, params.line]);
    };
    if (result.message) {
      componentParams.children = h(ToolChildrenWrapper, {
        class: 'text-void-fg-3 text-sm'
      }, result.message);
    } else {
      const truncated = toolMessage.name === 'find_references' && Object.hasOwn(result, 'truncated') ? result.truncated : false;
      componentParams.numResults = result.locations.length;
      componentParams.hasNextPage = truncated;
      componentParams.children = result.locations.length === 0 ? undefined : h(ToolChildrenWrapper, null, result.locations.map((loc, i) => h(ListableToolItem, {
        key: i,
        name: `${getBasename(loc.uri.fsPath)}:${loc.startLine}${loc.preview ? ` — ${loc.preview.slice(0, 80)}` : ''}`,
        class: 'w-full overflow-auto',
        onClick: () => {
          sapphireOpenFileFn(loc.uri, accessor, [loc.startLine, loc.endLine]);
        }
      })), truncated && h(ListableToolItem, {
        name: 'Results truncated.',
        isSmall: true,
        class: 'w-full overflow-auto'
      }));
    }
  } else if (toolMessage.type === 'tool_error') {
    componentParams.bottomChildren = h(BottomChildren, {
      title: 'Ошибка'
    }, h(CodeChildren, null, toolMessage.result));
  }
  return toolHeader(componentParams);
};
const renderBrowserToolCard = (toolMessage: ToolMessage<BuiltinToolName>): VNodeChild => {
  const accessor = useAccessor();
  const title = getTitle(toolMessage);
  const params = toolMessage.type === 'invalid_params' ? undefined : toolMessage.params;
  const {
    desc1,
    desc1Info
  } = toolNameToDesc(toolMessage.name, params, accessor);
  if (toolMessage.type === 'tool_request' || toolMessage.type === 'running_now' || toolMessage.type === 'invalid_params') {
    return null;
  }
  const componentParams: ToolHeaderParams = {
    title,
    desc1,
    desc1Info,
    isError: false,
    icon: null,
    isRejected: toolMessage.type === 'rejected'
  };
  if (toolMessage.type === 'success' && toolMessage.result && typeof toolMessage.result === 'object' && 'summary' in toolMessage.result) {
    const result = toolMessage.result as BrowserToolResult;
    const preview = result.summary.length > 2000 ? `${result.summary.slice(0, 2000)}\n…` : result.summary;
    componentParams.info = result.url || result.pageId;
    const image = result.imageDataUrl ? h('img', {
      src: result.imageDataUrl,
      alt: '',
      class: 'max-h-48 max-w-full rounded border border-void-border-2'
    }) : null;
    componentParams.children = h(ToolChildrenWrapper, null, image, h(CodeChildren, {
      class: 'bg-void-bg-3'
    }, h('pre', {
      class: 'font-mono whitespace-pre-wrap'
    }, preview)));
  } else if (toolMessage.type === 'tool_error') {
    componentParams.bottomChildren = h(BottomChildren, {
      title: 'Ошибка'
    }, h(CodeChildren, null, toolMessage.result));
  }
  return toolHeader(componentParams);
};
export type ResultWrapper<T extends ToolName> = (props: WrapperProps<T>) => VNodeChild;
export const builtinToolNameToComponent: { [T in BuiltinToolName]: {
  resultWrapper: ResultWrapper<T>;
} } = {
  read_file: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;
      if (toolMessage.type === 'tool_request') {return null;} // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') {return null;} // не показываем состояние running_now

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const {
        params
      } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected
      };
      let range: [number, number] | undefined;
      if (toolMessage.params.startLine !== null || toolMessage.params.endLine !== null) {
        const start = toolMessage.params.startLine === null ? `1` : `${toolMessage.params.startLine}`;
        const end = toolMessage.params.endLine === null ? `` : `${toolMessage.params.endLine}`;
        const addStr = `(${start}-${end})`;
        componentParams.desc1 += ` ${addStr}`;
        range = [params.startLine || 1, params.endLine || 1];
      }
      if (toolMessage.type === 'success') {
        const {
          result
        } = toolMessage;
        componentParams.onClick = () => {
          sapphireOpenFileFn(params.uri, accessor, range);
        };
        if (result.hasNextPage && params.pageNumber === 1)
          // первая страница вывода
          {componentParams.desc2 = `(truncated after ${Math.round(MAX_FILE_CHARS_PAGE) / 1000}k)`;}else if (params.pageNumber > 1)
          // следующие страницы
          {componentParams.desc2 = `(part ${params.pageNumber})`;}
      } else if (toolMessage.type === 'tool_error') {
        const {
          result
        } = toolMessage;
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, result));
      }
      return toolHeader(componentParams);
    }
  },
  get_dir_tree: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;
      if (toolMessage.type === 'tool_request') {return null;} // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') {return null;} // не показываем состояние running_now

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const {
        params
      } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected
      };
      if (params.uri) {
        const rel = getRelative(params.uri, accessor);
        if (rel) {componentParams.info = `Only search in ${rel}`;}
      }
      if (toolMessage.type === 'success') {
        const {
          result
        } = toolMessage;
        componentParams.children = h(ToolChildrenWrapper, null, h(SmallProseWrapper, null, h(ChatMarkdownRender, {
          string: `\`\`\`\n${result.str}\n\`\`\``,
          chatMessageLocation: undefined,
          isApplyEnabled: false,
          isLinkDetectionEnabled: true
        })));
      } else if (toolMessage.type === 'tool_error') {
        const {
          result
        } = toolMessage;
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, result));
      }
      return toolHeader(componentParams);
    }
  },
  ls_dir: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;
      if (toolMessage.type === 'tool_request') {return null;} // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') {return null;} // не показываем состояние running_now

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const {
        params
      } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected
      };
      if (params.uri) {
        const rel = getRelative(params.uri, accessor);
        if (rel) {componentParams.info = `Only search in ${rel}`;}
      }
      if (toolMessage.type === 'success') {
        const {
          result
        } = toolMessage;
        componentParams.numResults = result.children?.length;
        componentParams.hasNextPage = result.hasNextPage;
        const isEmpty = !result.children || result.children.length === 0;
        componentParams.children = isEmpty ? h(ToolChildrenWrapper, {
          class: 'text-void-fg-3 text-sm'
        }, '\n            Directory exists but is empty.\n          ') : h(ToolChildrenWrapper, null, result.children!.map((child, i) => h(ListableToolItem, {
          key: i,
          name: `${child.name}${child.isDirectory ? '/' : ''}`,
          class: 'w-full overflow-auto',
          onClick: () => {
            sapphireOpenFileFn(child.uri, accessor);
            // commandService.executeCommand('workbench.view.explorer'); // открыть в проводнике вместо reveal
            // explorerService.select(child.uri, true); — выделить файл в дереве
          }
        })), result.hasNextPage && h(ListableToolItem, {
          name: `Results truncated (${result.itemsRemaining} remaining).`,
          isSmall: true,
          class: 'w-full overflow-auto'
        }));
      } else if (toolMessage.type === 'tool_error') {
        const {
          result
        } = toolMessage;
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, result));
      }
      return toolHeader(componentParams);
    }
  },
  search_project_index: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected
      };
      if (toolMessage.type === 'success') {
        const {
          result
        } = toolMessage;
        const rows = result.hits.map(hit => h('div', {
          key: hit.uri.fsPath,
          class: 'text-xs text-void-fg-2 truncate'
        }, getBasename(hit.uri.fsPath), ' — ', (hit.purpose || hit.localRole).slice(0, 80)));
        componentParams.children = h(ToolChildrenWrapper, null, rows);
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  diff_impact: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const isRejected = toolMessage.type === 'rejected';
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected
      };
      if (toolMessage.type === 'success') {
        const summary = h(CodeChildren, null, h('pre', {
          class: 'font-mono whitespace-pre-wrap'
        }, toolMessage.result.summary));
        componentParams.children = h(ToolChildrenWrapper, null, summary);
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  get_project_tour: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const isRejected = toolMessage.type === 'rejected';
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected
      };
      if (toolMessage.type === 'success') {
        const {
          result
        } = toolMessage;
        componentParams.info = result.stepCount ? `${result.stepCount} шагов` : undefined;
        const summary = h(CodeChildren, null, h('pre', {
          class: 'font-mono whitespace-pre-wrap'
        }, result.summary.slice(0, 2000)));
        componentParams.children = h(ToolChildrenWrapper, null, summary);
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  search_pathnames_only: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;
      if (toolMessage.type === 'tool_request') {return null;} // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') {return null;} // не показываем состояние running_now

      const {
        params
      } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected
      };
      if (params.includePattern) {
        componentParams.info = `Only search in ${params.includePattern}`;
      }
      if (toolMessage.type === 'success') {
        const {
          result
        } = toolMessage;
        componentParams.numResults = result.uris.length;
        componentParams.hasNextPage = result.hasNextPage;
        componentParams.children = result.uris.length === 0 ? undefined : h(ToolChildrenWrapper, null, result.uris.map((uri, i) => h(ListableToolItem, {
          key: i,
          name: getBasename(uri.fsPath),
          class: 'w-full overflow-auto',
          onClick: () => {
            sapphireOpenFileFn(uri, accessor);
          }
        })), result.hasNextPage && h(ListableToolItem, {
          name: 'Results truncated.',
          isSmall: true,
          class: 'w-full overflow-auto'
        }));
      } else if (toolMessage.type === 'tool_error') {
        const {
          result
        } = toolMessage;
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, result));
      }
      return toolHeader(componentParams);
    }
  },
  search_for_files: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;
      if (toolMessage.type === 'tool_request') {return null;} // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') {return null;} // не показываем состояние running_now

      const {
        params
      } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected
      };
      if (params.searchInFolder || params.isRegex) {
        const info: string[] = [];
        if (params.searchInFolder) {
          const rel = getRelative(params.searchInFolder, accessor);
          if (rel) {info.push(`Only search in ${rel}`);}
        }
        if (params.isRegex) {
          info.push(`Uses regex search`);
        }
        componentParams.info = info.join('; ');
      }
      if (toolMessage.type === 'success') {
        const {
          result
        } = toolMessage;
        componentParams.numResults = result.uris.length;
        componentParams.hasNextPage = result.hasNextPage;
        componentParams.children = result.uris.length === 0 ? undefined : h(ToolChildrenWrapper, null, result.uris.map((uri, i) => h(ListableToolItem, {
          key: i,
          name: getBasename(uri.fsPath),
          class: 'w-full overflow-auto',
          onClick: () => {
            sapphireOpenFileFn(uri, accessor);
          }
        })), result.hasNextPage && h(ListableToolItem, {
          name: 'Results truncated.',
          isSmall: true,
          class: 'w-full overflow-auto'
        }));
      } else if (toolMessage.type === 'tool_error') {
        const {
          result
        } = toolMessage;
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, result));
      }
      return toolHeader(componentParams);
    }
  },
  search_in_file: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const toolsService = accessor.get('IToolsService');
      const title = getTitle(toolMessage);
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;
      if (toolMessage.type === 'tool_request') {return null;} // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') {return null;} // не показываем состояние running_now

      const {
        params
      } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected
      };
      const infoarr: string[] = [];
      const uriStr = getRelative(params.uri, accessor);
      if (uriStr) {infoarr.push(uriStr);}
      if (params.isRegex) {infoarr.push('Uses regex search');}
      componentParams.info = infoarr.join('; ');
      if (toolMessage.type === 'success') {
        const {
          result
        } = toolMessage; // result — массив фрагментов
        componentParams.numResults = result.lines.length;
        componentParams.children = result.lines.length === 0 ? undefined : h(ToolChildrenWrapper, null, h(CodeChildren, {
          class: 'bg-void-bg-3'
        }, h('pre', {
          class: 'font-mono whitespace-pre'
        }, toolsService.stringOfResult.search_in_file(params, result))));
      } else if (toolMessage.type === 'tool_error') {
        const {
          result
        } = toolMessage;
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, result));
      }
      return toolHeader(componentParams);
    }
  },
  read_lint_errors: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const {
        uri
      } = toolMessage.params ?? {};
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;
      if (toolMessage.type === 'tool_request') {return null;} // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') {return null;} // не показываем состояние running_now

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const {
        params
      } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected
      };
      componentParams.info = getRelative(uri, accessor); // полный путь в подсказке

      if (toolMessage.type === 'success') {
        const {
          result
        } = toolMessage;
        componentParams.onClick = () => {
          sapphireOpenFileFn(params.uri, accessor);
        };
        if (result.lintErrors) {componentParams.children = h(LintErrorChildren, {
          lintErrors: result.lintErrors
        });}else {componentParams.children = `No lint errors found.`;}
      } else if (toolMessage.type === 'tool_error') {
        const {
          result
        } = toolMessage;
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, result));
      }
      return toolHeader(componentParams);
    }
  },
  go_to_definition: {
    resultWrapper: ({
      toolMessage
    }) => h(CodeNavToolCard, {
      toolMessage: toolMessage
    })
  },
  find_references: {
    resultWrapper: ({
      toolMessage
    }) => h(CodeNavToolCard, {
      toolMessage: toolMessage
    })
  },
  grep_search: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const toolsService = accessor.get('IToolsService');
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected'
      };
      if (toolMessage.type === 'success') {
        const {
          params,
          result
        } = toolMessage;
        componentParams.numResults = result.matches.length;
        componentParams.hasNextPage = result.totalMatches > result.matches.length;
        const body = toolsService.stringOfResult.grep_search(params, result);
        componentParams.children = result.matches.length === 0 ? undefined : h(ToolChildrenWrapper, null, h(CodeChildren, {
          class: 'bg-void-bg-3'
        }, h('pre', {
          class: 'font-mono whitespace-pre-wrap'
        }, body)));
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  get_diagnostics: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const toolsService = accessor.get('IToolsService');
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected'
      };
      if (toolMessage.type === 'success') {
        const {
          params,
          result
        } = toolMessage;
        componentParams.numResults = result.diagnostics.length;
        const body = toolsService.stringOfResult.get_diagnostics(params, result);
        componentParams.children = result.diagnostics.length === 0 ? h(ToolChildrenWrapper, null, 'No diagnostics found.') : h(ToolChildrenWrapper, null, h(CodeChildren, {
          class: 'bg-void-bg-3'
        }, h('pre', {
          class: 'font-mono whitespace-pre-wrap'
        }, body)));
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  search_symbols: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const toolsService = accessor.get('IToolsService');
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected'
      };
      if (toolMessage.type === 'success') {
        const {
          params,
          result
        } = toolMessage;
        componentParams.numResults = result.symbols.length;
        componentParams.hasNextPage = result.truncated;
        const body = toolsService.stringOfResult.search_symbols(params, result);
        componentParams.children = result.symbols.length === 0 ? undefined : h(ToolChildrenWrapper, null, h(CodeChildren, {
          class: 'bg-void-bg-3'
        }, h('pre', {
          class: 'font-mono whitespace-pre-wrap'
        }, body)));
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  rename_symbol: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const toolsService = accessor.get('IToolsService');
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected'
      };
      if (toolMessage.type === 'success') {
        const {
          params,
          result
        } = toolMessage;
        componentParams.numResults = result.changes.length;
        const body = toolsService.stringOfResult.rename_symbol(params, result);
        componentParams.children = h(ToolChildrenWrapper, null, h(CodeChildren, {
          class: 'bg-void-bg-3'
        }, h('pre', {
          class: 'font-mono whitespace-pre-wrap'
        }, body)));
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  get_chat_history: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const chatThreadsService = accessor.get('IChatThreadService');
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const threadId = toolMessage.params && Object.hasOwn(toolMessage.params, 'threadId') ? toolMessage.params.threadId : null;
      const canSwitch = !!threadId && !!chatThreadsService.state.allThreads[threadId];
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
        desc1OnClick: canSwitch ? () => chatThreadsService.switchToThread(threadId) : undefined
      };
      if (toolMessage.type === 'success') {
        const summary = toolMessage.result.summary ?? '';
        componentParams.desc2 = summary ? h(CopyButton, {
          codeStr: summary,
          toolTipName: 'Копировать'
        }) : undefined;
        componentParams.children = summary ? h(ToolChildrenWrapper, null, h(CodeChildren, {
          class: 'bg-void-bg-3'
        }, h('pre', {
          class: 'font-mono whitespace-pre-wrap'
        }, summary))) : undefined;
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  run_subagent: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected'
      };
      if (toolMessage.type === 'success') {
        const summary = toolMessage.result.summary ?? '';
        componentParams.desc2 = summary ? h(CopyButton, {
          codeStr: summary,
          toolTipName: 'Копировать'
        }) : undefined;
        componentParams.children = summary ? h(ToolChildrenWrapper, null, h(CodeChildren, {
          class: 'bg-void-bg-3'
        }, h('pre', {
          class: 'font-mono whitespace-pre-wrap'
        }, summary))) : undefined;
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  glob_files: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected'
      };
      if (toolMessage.type === 'success') {
        const {
          result
        } = toolMessage;
        componentParams.numResults = result.files.length;
        componentParams.hasNextPage = result.truncated;
        componentParams.children = result.files.length === 0 ? undefined : h(ToolChildrenWrapper, null, result.files.map((f, i) => h(ListableToolItem, {
          key: i,
          name: getBasename(f.uri.fsPath),
          class: 'w-full overflow-auto',
          onClick: () => {
            sapphireOpenFileFn(f.uri, accessor);
          }
        })), result.truncated && h(ListableToolItem, {
          name: 'Results truncated.',
          isSmall: true,
          class: 'w-full overflow-auto'
        }));
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  web_search: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected'
      };
      if (toolMessage.type === 'success') {
        const {
          result
        } = toolMessage;
        componentParams.numResults = result.results.length;
        componentParams.children = result.results.length === 0 ? undefined : h(ToolChildrenWrapper, null, result.results.map((r, i) => h(ListableToolItem, {
          key: i,
          name: r.title || r.url,
          class: 'w-full overflow-auto',
          onClick: () => {
            getActiveWindow().open(r.url, '_blank', 'noopener,noreferrer');
          }
        })));
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  browse_url: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const toolsService = accessor.get('IToolsService');
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected'
      };
      if (toolMessage.type === 'success') {
        const {
          params,
          result
        } = toolMessage;
        const preview = toolsService.stringOfResult.browse_url(params, result);
        componentParams.info = result.title ?? undefined;
        componentParams.children = h(ToolChildrenWrapper, null, h(CodeChildren, {
          class: 'bg-void-bg-3'
        }, h('pre', {
          class: 'font-mono whitespace-pre-wrap'
        }, preview.slice(0, 2000))));
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  browser_navigate: {
    resultWrapper: ({ toolMessage }) => renderBrowserToolCard(toolMessage)
  },
  browser_snapshot: {
    resultWrapper: ({ toolMessage }) => renderBrowserToolCard(toolMessage)
  },
  browser_click: {
    resultWrapper: ({ toolMessage }) => renderBrowserToolCard(toolMessage)
  },
  browser_type: {
    resultWrapper: ({ toolMessage }) => renderBrowserToolCard(toolMessage)
  },
  browser_scroll: {
    resultWrapper: ({ toolMessage }) => renderBrowserToolCard(toolMessage)
  },
  browser_screenshot: {
    resultWrapper: ({ toolMessage }) => renderBrowserToolCard(toolMessage)
  },
  save_memory: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected'
      };
      if (toolMessage.type === 'success') {
        componentParams.info = `key=${toolMessage.result.key}`;
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  run_parallel_subagents: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected'
      };
      if (toolMessage.type === 'running_now') {
        const tasks = toolMessage.params?.tasks ?? [];
        componentParams.children = h(ToolChildrenWrapper, null, tasks.map((t, i) => h('div', {
          key: i,
          class: 'text-sm opacity-80'
        }, `… ${t.description || 'задача'}`)));
        return toolHeader(componentParams);
      }
      if (toolMessage.type === 'success') {
        const {
          results
        } = toolMessage.result;
        componentParams.numResults = results.length;
        componentParams.children = h(ToolChildrenWrapper, null, results.map((r, i) => h('div', {
          key: i,
          class: 'mb-2'
        }, h('div', {
          class: 'text-sm opacity-80'
        }, r.completed ? '✓' : '✗', r.description), r.summary ? h(CodeChildren, {
          class: 'bg-void-bg-3'
        }, h('pre', {
          class: 'font-mono whitespace-pre-wrap'
        }, r.summary)) : null)));
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  create_plan: {
    resultWrapper: ({
      toolMessage
    }) => h(PlanToolCard, {
      toolMessage: toolMessage
    })
  },
  update_plan: {
    resultWrapper: ({
      toolMessage
    }) => h(UpdatePlanToolCard, {
      toolMessage: toolMessage
    })
  },
  enable_mcp_server: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      if (toolMessage.type === 'tool_request') {return null;}
      if (toolMessage.type === 'running_now') {return null;}
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected'
      };
      if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, toolMessage.result));
      }
      return toolHeader(componentParams);
    }
  },
  // --- разделитель секций ---

  create_file_or_folder: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;
      const {
        params
      } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected
      };
      componentParams.info = getRelative(params.uri, accessor); // полный путь в подсказке

      if (toolMessage.type === 'success') {
        componentParams.onClick = () => {
          sapphireOpenFileFn(params.uri, accessor);
        };
      } else if (toolMessage.type === 'rejected') {
        componentParams.onClick = () => {
          sapphireOpenFileFn(params.uri, accessor);
        };
      } else if (toolMessage.type === 'tool_error') {
        const {
          result
        } = toolMessage;
        if (params) {
          componentParams.onClick = () => {
            sapphireOpenFileFn(params.uri, accessor);
          };
        }
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, result));
      } else if (toolMessage.type === 'running_now') {
        // дополнительная разметка не нужна
      } else if (toolMessage.type === 'tool_request') {
        // дополнительная разметка не нужна
      }
      return toolHeader(componentParams);
    }
  },
  delete_file_or_folder: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const title = getTitle(toolMessage);
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;
      const {
        params
      } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected
      };
      componentParams.info = getRelative(params.uri, accessor); // полный путь в подсказке

      if (toolMessage.type === 'success') {
        componentParams.onClick = () => {
          sapphireOpenFileFn(params.uri, accessor);
        };
      } else if (toolMessage.type === 'rejected') {
        componentParams.onClick = () => {
          sapphireOpenFileFn(params.uri, accessor);
        };
      } else if (toolMessage.type === 'tool_error') {
        const {
          result
        } = toolMessage;
        if (params) {
          componentParams.onClick = () => {
            sapphireOpenFileFn(params.uri, accessor);
          };
        }
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, result));
      } else if (toolMessage.type === 'running_now') {
        componentParams.onClick = () => {
          sapphireOpenFileFn(params.uri, accessor);
        };
      } else if (toolMessage.type === 'tool_request') {
        componentParams.onClick = () => {
          sapphireOpenFileFn(params.uri, accessor);
        };
      }
      return toolHeader(componentParams);
    }
  },
  rewrite_file: {
    resultWrapper: params => h(EditTool, {
      ...params,
      content: params.toolMessage.params.newContent
    })
  },
  edit_file: {
    resultWrapper: params => h(EditTool, {
      ...params,
      content: params.toolMessage.params.searchReplaceBlocks
    })
  },
  // --- разделитель секций ---

  run_command: {
    resultWrapper: params => h(CommandTool, {
      ...params,
      type: 'run_command'
    })
  },
  run_persistent_command: {
    resultWrapper: params => h(CommandTool, {
      ...params,
      type: 'run_persistent_command'
    })
  },
  open_persistent_terminal: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const terminalToolsService = accessor.get('ITerminalToolService');
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const title = getTitle(toolMessage);
      const icon = null;
      if (toolMessage.type === 'tool_request') {return null;} // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') {return null;} // не показываем состояние running_now

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const {
        params
      } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected
      };
      const relativePath = params.cwd ? getRelative(URI.file(params.cwd), accessor) : '';
      componentParams.info = relativePath ? `Running in ${relativePath}` : undefined;
      if (toolMessage.type === 'success') {
        const {
          result
        } = toolMessage;
        const {
          persistentTerminalId
        } = result;
        componentParams.desc1 = persistentTerminalNameOfId(persistentTerminalId);
        componentParams.onClick = () => terminalToolsService.focusPersistentTerminal(persistentTerminalId);
      } else if (toolMessage.type === 'tool_error') {
        const {
          result
        } = toolMessage;
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, result));
      }
      return toolHeader(componentParams);
    }
  },
  kill_persistent_terminal: {
    resultWrapper: ({
      toolMessage
    }) => {
      const accessor = useAccessor();
      const terminalToolsService = accessor.get('ITerminalToolService');
      const {
        desc1,
        desc1Info
      } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const title = getTitle(toolMessage);
      const icon = null;
      if (toolMessage.type === 'tool_request') {return null;} // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') {return null;} // не показываем состояние running_now

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const {
        params
      } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected
      };
      if (toolMessage.type === 'success') {
        const {
          persistentTerminalId
        } = params;
        componentParams.desc1 = persistentTerminalNameOfId(persistentTerminalId);
        componentParams.onClick = () => terminalToolsService.focusPersistentTerminal(persistentTerminalId);
      } else if (toolMessage.type === 'tool_error') {
        const {
          result
        } = toolMessage;
        componentParams.bottomChildren = h(BottomChildren, {
          title: 'Ошибка'
        }, h(CodeChildren, null, result));
      }
      return toolHeader(componentParams);
    }
  }
};
export const EditToolSoFar = ({
  toolCallSoFar
}: {
  toolCallSoFar: RawToolCallObj;
}) => {
  const accessor = useAccessor();
  if (!isABuiltinToolName(toolCallSoFar.name)) {return null;}
  const uri = toolCallSoFar.rawParams.uri ? URI.file(toolCallSoFar.rawParams.uri) : undefined;
  const title = titleOfBuiltinToolName[toolCallSoFar.name].proposed;
  const uriDone = toolCallSoFar.doneParams.includes('uri');
  const desc1 = h('span', {
    class: 'flex items-center'
  }, uriDone ? getBasename(toolCallSoFar.rawParams.uri ?? 'unknown') : `Генерация`, h(IconLoading, null));
  const desc1OnClick = () => {
    if (uri) {
      sapphireOpenFileFn(uri, accessor);
    }
  };

  // URI ещё не задан
  return h(ToolHeaderWrapper, {
    title: title,
    desc1: desc1,
    desc1OnClick: desc1OnClick
  }, h(EditToolChildren, {
    uri: uri,
    code: toolCallSoFar.rawParams.search_replace_blocks ?? toolCallSoFar.rawParams.new_content ?? '',
    type: 'rewrite'
  }), h(IconLoading, null));
};

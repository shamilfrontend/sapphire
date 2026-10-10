/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Ban, ChevronRight, CircleEllipsis, Hammer } from 'lucide-react';
import {
  useAccessor,
  useChatThreadsState,
  useChatThreadsStreamState,
  useSettingsState,
} from '../util/services.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { ChatMarkdownRender, getApplyBoxId } from '../markdown/ChatMarkdownRender.js';
import { BlockCode, SapphireDiffEditor } from '../util/inputs.js';
import {
  CopyButton,
  EditToolAcceptRejectButtonsHTML,
  useEditToolStreamState,
} from '../markdown/ApplyBlockHoverButtons.js';
import { ChatMessage, ToolMessage } from '../../../../common/chatThreadServiceTypes.js';
import {
  approvalTypeOfBuiltinToolName,
  BuiltinToolCallParams,
  BuiltinToolName,
  LintErrorItem,
  ToolName,
} from '../../../../common/toolsServiceTypes.js';
import {
  builtinToolNames,
  isABuiltinToolName,
  MAX_FILE_CHARS_PAGE,
} from '../../../../common/prompt/prompts.js';
import { RawToolCallObj } from '../../../../common/sendLLMMessageTypes.js';
import { ToolApprovalTypeSwitch } from '../void-settings-tsx/Settings.js';
import { persistentTerminalNameOfId } from '../../../terminalToolService.js';
import { removeMCPToolNamePrefix } from '../../../../common/mcpServiceTypes.js';
import { getBasename, getFolderName } from '../../../../common/pathLabels.js';
import { getRelative, sapphireOpenFileFn } from './chatFileUtils.js';
import { useAgentsPlan } from '../agents-window-tsx/AgentsPlanContext.js';
import { IconLoading } from './chatIcons.js';
import { SmallProseWrapper } from './ChatProse.js';
import { CodeChildren, ListableToolItem, ToolChildrenWrapper } from './ChatToolPrimitives.js';

type ToolHeaderParams = {
  icon?: React.ReactNode;
  title: React.ReactNode;
  desc1: React.ReactNode;
  desc1OnClick?: () => void;
  desc2?: React.ReactNode;
  isError?: boolean;
  info?: string;
  desc1Info?: string;
  isRejected?: boolean;
  numResults?: number;
  hasNextPage?: boolean;
  children?: React.ReactNode;
  bottomChildren?: React.ReactNode;
  onClick?: () => void;
  desc2OnClick?: () => void;
  isOpen?: boolean;
  className?: string;
};

export const ToolHeaderWrapper = ({
  _icon,
  title,
  desc1,
  desc1OnClick,
  desc1Info,
  desc2,
  numResults,
  hasNextPage,
  children,
  info,
  bottomChildren,
  isError,
  onClick,
  desc2OnClick,
  isOpen,
  isRejected,
  className, // className для основного содержимого
}: ToolHeaderParams) => {
  const [isOpen_, setIsOpen] = useState(false);
  const isExpanded = isOpen !== undefined ? isOpen : isOpen_;

  const isDropdown = children !== undefined; // null — допустимое значение: включает dropdown
  const isClickable = !!(isDropdown || onClick);

  const isDesc1Clickable = !!desc1OnClick;

  const desc1HTML = (
    <span
      className={`text-void-fg-4 text-xs italic truncate ml-2
			${isDesc1Clickable ? 'cursor-pointer hover:brightness-125 transition-all duration-150' : ''}
		`}
      onClick={desc1OnClick}
      {...(desc1Info
        ? {
            'data-tooltip-id': 'sapphire-tooltip',
            'data-tooltip-content': desc1Info,
            'data-tooltip-place': 'top',
            'data-tooltip-delay-show': 1000,
          }
        : {})}
    >
      {desc1}
    </span>
  );

  return (
    <div className="">
      <div
        className={`w-full border border-void-border-3 rounded-lg px-2.5 py-1.5 bg-void-bg-3 overflow-hidden ${className}`}
      >
        {/* Заголовок карточки */}
        <div className="select-none flex items-center min-h-[24px]">
          <div
            className={`flex items-center w-full gap-x-2 overflow-hidden justify-between ${isRejected ? 'line-through' : ''}`}
          >
            {/* Левая часть заголовка */}
            <div // обёртка: desc1 может быть кликабельным
              className="ml-1 flex items-center overflow-hidden"
            >
              {/* Заголовок, напр. «> Edited File» */}
              <div
                className={`
							flex items-center min-w-0 overflow-hidden grow
							${isClickable ? 'cursor-pointer hover:brightness-125 transition-all duration-150' : ''}
						`}
                onClick={() => {
                  if (isDropdown) {
                    setIsOpen((v) => !v);
                  }
                  if (onClick) {
                    onClick();
                  }
                }}
              >
                {isDropdown && (
                  <ChevronRight
                    className={`
								text-void-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]
								${isExpanded ? 'rotate-90' : ''}
							`}
                  />
                )}
                <span className="text-void-fg-3 flex-shrink-0">{title}</span>

                {!isDesc1Clickable && desc1HTML}
              </div>
              {isDesc1Clickable && desc1HTML}
            </div>

            {/* Правая часть заголовка */}
            <div className="flex items-center gap-x-2 flex-shrink-0">
              {info && (
                <CircleEllipsis
                  className="ml-2 text-void-fg-4 opacity-60 flex-shrink-0"
                  size={14}
                  data-tooltip-id="sapphire-tooltip"
                  data-tooltip-content={info}
                  data-tooltip-place="top-end"
                />
              )}

              {isError && (
                <AlertTriangle
                  className="text-void-warning opacity-90 flex-shrink-0"
                  size={14}
                  data-tooltip-id="sapphire-tooltip"
                  data-tooltip-content="Ошибка выполнения инструмента"
                  data-tooltip-place="top"
                />
              )}
              {isRejected && (
                <Ban
                  className="text-void-fg-4 opacity-90 flex-shrink-0"
                  size={14}
                  data-tooltip-id="sapphire-tooltip"
                  data-tooltip-content="Отменено"
                  data-tooltip-place="top"
                />
              )}
              {desc2 && (
                <span className="text-void-fg-4 text-xs" onClick={desc2OnClick}>
                  {desc2}
                </span>
              )}
              {numResults !== undefined && (
                <span className="text-void-fg-4 text-xs ml-auto mr-1">
                  {`${numResults}${hasNextPage ? '+' : ''} ${numResults === 1 ? 'результат' : numResults > 1 && numResults < 5 ? 'результата' : 'результатов'}`}
                </span>
              )}
            </div>
          </div>
        </div>
        {/* Тело карточки */}
        {
          <div
            className={`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'opacity-100 py-1' : 'max-h-0 opacity-0'}
					text-void-fg-4 rounded-sm overflow-x-auto
				  `}
            //    bg-black bg-opacity-10 border border-void-border-4 border-opacity-50
          >
            {children}
          </div>
        }
      </div>
      {bottomChildren}
    </div>
  );
};

const EditTool = ({
  toolMessage,
  threadId,
  messageIdx,
  content,
}: Parameters<ResultWrapper<'edit_file' | 'rewrite_file'>>[0] & { content: string }) => {
  const accessor = useAccessor();
  const isError = false;
  const isRejected = toolMessage.type === 'rejected';

  const title = getTitle(toolMessage);

  const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
  const icon = null;

  const { params, name } = toolMessage;
  const desc1OnClick = () => sapphireOpenFileFn(params.uri, accessor);
  const componentParams: ToolHeaderParams = {
    title,
    desc1,
    desc1OnClick,
    desc1Info,
    isError,
    icon,
    isRejected,
  };

  const editToolType = toolMessage.name === 'edit_file' ? 'diff' : 'rewrite';
  if (toolMessage.type === 'running_now' || toolMessage.type === 'tool_request') {
    componentParams.children = (
      <ToolChildrenWrapper className="bg-void-bg-3">
        <EditToolChildren uri={params.uri} code={content} type={editToolType} />
      </ToolChildrenWrapper>
    );
  } else if (
    toolMessage.type === 'success' ||
    toolMessage.type === 'rejected' ||
    toolMessage.type === 'tool_error'
  ) {
    // блок Apply для кода
    const applyBoxId = getApplyBoxId({
      threadId,
      messageIdx,
      tokenIdx: 'N/A',
    });
    componentParams.desc2 = (
      <EditToolHeaderButtons
        applyBoxId={applyBoxId}
        uri={params.uri}
        codeStr={content}
        toolName={name}
        threadId={threadId}
      />
    );

    // дочерние элементы карточки
    componentParams.children = (
      <ToolChildrenWrapper className="bg-void-bg-3">
        <EditToolChildren uri={params.uri} code={content} type={editToolType} />
      </ToolChildrenWrapper>
    );

    if (toolMessage.type === 'success' || toolMessage.type === 'rejected') {
      const { result } = toolMessage;
      componentParams.bottomChildren = (
        <BottomChildren title="Ошибки линтера">
          {result?.lintErrors?.map((error, i) => (
            <div key={i} className="whitespace-nowrap">
              Строки {error.startLineNumber}-{error.endLineNumber}: {error.message}
            </div>
          ))}
        </BottomChildren>
      );
    } else if (toolMessage.type === 'tool_error') {
      // ветка ошибки
      const { result } = toolMessage;
      componentParams.bottomChildren = (
        <BottomChildren title="Ошибка">
          <CodeChildren>{result}</CodeChildren>
        </BottomChildren>
      );
    }
  }

  return <ToolHeaderWrapper {...componentParams} />;
};

const formatDurationMs = (ms: number): string => {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}с`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}с`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}м ${String(s).padStart(2, '0')}с`;
};

const loadingTitleWrapper = (item: React.ReactNode): React.ReactNode => (
  <span className="flex items-center flex-nowrap">
    {item}
    <IconLoading className="w-3 text-sm" />
  </span>
);

const TerminalRunningTitle = ({ startedAt }: { startedAt: number }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  return loadingTitleWrapper(`Выполнение в терминале · ${formatDurationMs(now - startedAt)}`);
};

const titleOfBuiltinToolName = {
  read_file: {
    done: 'Прочитан файл',
    proposed: 'Прочитать файл',
    running: loadingTitleWrapper('Чтение файла'),
  },
  ls_dir: {
    done: 'Просмотрена папка',
    proposed: 'Просмотреть папку',
    running: loadingTitleWrapper('Просмотр папки'),
  },
  get_dir_tree: {
    done: 'Просмотрено дерево папок',
    proposed: 'Просмотреть дерево папок',
    running: loadingTitleWrapper('Просмотр дерева папок'),
  },
  search_pathnames_only: {
    done: 'Поиск по имени файла',
    proposed: 'Искать по имени файла',
    running: loadingTitleWrapper('Поиск по имени файла'),
  },
  search_project_index: {
    done: 'Поиск по индексу проекта',
    proposed: 'Искать в индексе проекта',
    running: loadingTitleWrapper('Поиск по индексу проекта'),
  },
  search_for_files: {
    done: 'Поиск выполнен',
    proposed: 'Поиск',
    running: loadingTitleWrapper('Поиск'),
  },
  grep_search: {
    done: 'Grep выполнен',
    proposed: 'Grep по содержимому',
    running: loadingTitleWrapper('Grep по содержимому'),
  },
  glob_files: {
    done: 'Glob выполнен',
    proposed: 'Glob по файлам',
    running: loadingTitleWrapper('Glob по файлам'),
  },
  web_search: {
    done: 'Веб-поиск выполнен',
    proposed: 'Веб-поиск',
    running: loadingTitleWrapper('Веб-поиск'),
  },
  browse_url: {
    done: 'Страница прочитана',
    proposed: 'Открыть URL',
    running: loadingTitleWrapper('Чтение URL'),
  },
  save_memory: {
    done: 'Память сохранена',
    proposed: 'Сохранить в память',
    running: loadingTitleWrapper('Сохранение в память'),
  },
  create_file_or_folder: {
    done: `Создано`,
    proposed: `Создать`,
    running: loadingTitleWrapper(`Создание`),
  },
  delete_file_or_folder: {
    done: `Удалено`,
    proposed: `Удалить`,
    running: loadingTitleWrapper(`Удаление`),
  },
  edit_file: {
    done: `Файл отредактирован`,
    proposed: 'Редактировать файл',
    running: loadingTitleWrapper('Редактирование файла'),
  },
  rewrite_file: {
    done: `Файл записан`,
    proposed: 'Записать файл',
    running: loadingTitleWrapper('Запись файла'),
  },
  run_command: {
    done: `Команда выполнена`,
    proposed: 'Выполнить в терминале',
    running: loadingTitleWrapper('Выполнение в терминале'),
  },
  run_persistent_command: {
    done: `Команда выполнена`,
    proposed: 'Выполнить в терминале',
    running: loadingTitleWrapper('Выполнение в терминале'),
  },

  open_persistent_terminal: {
    done: `Терминал открыт`,
    proposed: 'Открыть терминал',
    running: loadingTitleWrapper('Открытие терминала'),
  },
  kill_persistent_terminal: {
    done: `Терминал закрыт`,
    proposed: 'Закрыть терминал',
    running: loadingTitleWrapper('Закрытие терминала'),
  },

  read_lint_errors: {
    done: `Ошибки линтера прочитаны`,
    proposed: 'Прочитать ошибки линтера',
    running: loadingTitleWrapper('Чтение ошибок линтера'),
  },
  get_diagnostics: {
    done: 'Диагностика прочитана',
    proposed: 'Прочитать диагностику',
    running: loadingTitleWrapper('Чтение диагностики'),
  },
  go_to_definition: {
    done: 'Определение найдено',
    proposed: 'Перейти к определению',
    running: loadingTitleWrapper('Поиск определения'),
  },
  find_references: {
    done: 'Ссылки найдены',
    proposed: 'Найти ссылки',
    running: loadingTitleWrapper('Поиск ссылок'),
  },
  search_symbols: {
    done: 'Символы найдены',
    proposed: 'Искать символы',
    running: loadingTitleWrapper('Поиск символов'),
  },
  rename_symbol: {
    done: 'Символ переименован',
    proposed: 'Переименовать символ',
    running: loadingTitleWrapper('Переименование символа'),
  },
  run_subagent: {
    done: 'Субагент завершён',
    proposed: 'Запустить субагента',
    running: loadingTitleWrapper('Субагент работает'),
  },
  run_parallel_subagents: {
    done: 'Параллельные субагенты завершены',
    proposed: 'Запустить параллельных субагентов',
    running: loadingTitleWrapper('Параллельные субагенты'),
  },
  get_chat_history: {
    done: 'История чатов прочитана',
    proposed: 'Прочитать историю чатов',
    running: loadingTitleWrapper('Чтение истории чатов'),
  },
  search_in_file: {
    done: 'Поиск в файле выполнен',
    proposed: 'Искать в файле',
    running: loadingTitleWrapper('Поиск в файле'),
  },
  create_plan: {
    done: 'План создан',
    proposed: 'Создать план',
    running: loadingTitleWrapper('Создание плана'),
  },
  update_plan: {
    done: 'План обновлён',
    proposed: 'Обновить план',
    running: loadingTitleWrapper('Обновление плана'),
  },
  enable_mcp_server: {
    done: 'MCP-сервер включён',
    proposed: 'Включить MCP-сервер',
    running: loadingTitleWrapper('Включение MCP-сервера'),
  },
} as const satisfies Record<BuiltinToolName, { done: any; proposed: any; running: any }>;

const getTitle = (
  toolMessage: Pick<
    ChatMessage & { role: 'tool' },
    'name' | 'type' | 'mcpServerName' | 'startedAt' | 'durationMs'
  >,
): React.ReactNode => {
  const t = toolMessage;

  // заголовок для MCP / внешних инструментов
  if (!builtinToolNames.includes(t.name as BuiltinToolName)) {
    // подпись «Выполняется» / «Выполнено» и т.п.
    const descriptor =
      t.type === 'success'
        ? 'Вызван'
        : t.type === 'running_now'
          ? 'Вызов'
          : t.type === 'tool_request'
            ? 'Вызов'
            : t.type === 'rejected'
              ? 'Вызов'
              : t.type === 'invalid_params'
                ? 'Вызов'
                : t.type === 'tool_error'
                  ? 'Вызов'
                  : 'Вызов';

    const title = `${descriptor} ${toolMessage.mcpServerName || 'MCP'}`;
    if (t.type === 'running_now' || t.type === 'tool_request') return loadingTitleWrapper(title);
    return title;
  }

  // заголовок встроенного инструмента

  const toolName = t.name as BuiltinToolName;
  const isTerminal = toolName === 'run_command' || toolName === 'run_persistent_command';

  if (isTerminal && t.type === 'running_now' && t.startedAt) {
    return <TerminalRunningTitle startedAt={t.startedAt} />;
  }

  if (t.type === 'success') {
    const done = titleOfBuiltinToolName[toolName].done;
    if (isTerminal && t.durationMs != null) {
      return `${done} · ${formatDurationMs(t.durationMs)}`;
    }
    return done;
  }
  if (t.type === 'tool_error') {
    const proposed = titleOfBuiltinToolName[toolName].proposed;
    if (isTerminal && t.durationMs != null) {
      return `${proposed} · ${formatDurationMs(t.durationMs)}`;
    }
    return proposed;
  }
  if (t.type === 'running_now') return titleOfBuiltinToolName[toolName].running;
  return titleOfBuiltinToolName[toolName].proposed;
};

const toolNameToDesc = (
  toolName: BuiltinToolName,
  _toolParams: BuiltinToolCallParams[BuiltinToolName] | undefined,
  accessor: ReturnType<typeof useAccessor>,
): {
  desc1: React.ReactNode;
  desc1Info?: string;
} => {
  if (!_toolParams) {
    return { desc1: '' };
  }

  const x = {
    read_file: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['read_file'];
      return {
        desc1: getBasename(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor),
      };
    },
    ls_dir: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['ls_dir'];
      return {
        desc1: getFolderName(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor),
      };
    },
    search_pathnames_only: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['search_pathnames_only'];
      return {
        desc1: `"${toolParams.query}"`,
      };
    },
    search_project_index: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['search_project_index'];
      return {
        desc1: `"${toolParams.query}"`,
      };
    },
    search_for_files: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['search_for_files'];
      return {
        desc1: `"${toolParams.query}"`,
      };
    },
    grep_search: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['grep_search'];
      return {
        desc1: `"${toolParams.query}"`,
      };
    },
    glob_files: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['glob_files'];
      return {
        desc1: `"${toolParams.pattern}"`,
      };
    },
    web_search: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['web_search'];
      return {
        desc1: `"${toolParams.query}"`,
      };
    },
    browse_url: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['browse_url'];
      return {
        desc1: toolParams.url,
      };
    },
    save_memory: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['save_memory'];
      return {
        desc1: `${toolParams.type}: ${toolParams.key}`,
      };
    },
    search_in_file: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['search_in_file'];
      return {
        desc1: `"${toolParams.query}"`,
        desc1Info: getRelative(toolParams.uri, accessor),
      };
    },
    create_file_or_folder: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['create_file_or_folder'];
      return {
        desc1: toolParams.isFolder
          ? (getFolderName(toolParams.uri.fsPath) ?? '/')
          : getBasename(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor),
      };
    },
    delete_file_or_folder: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['delete_file_or_folder'];
      return {
        desc1: toolParams.isFolder
          ? (getFolderName(toolParams.uri.fsPath) ?? '/')
          : getBasename(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor),
      };
    },
    rewrite_file: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['rewrite_file'];
      return {
        desc1: getBasename(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor),
      };
    },
    edit_file: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['edit_file'];
      return {
        desc1: getBasename(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor),
      };
    },
    run_command: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['run_command'];
      return {
        desc1: toolParams.command,
      };
    },
    run_persistent_command: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['run_persistent_command'];
      return {
        desc1: toolParams.command,
      };
    },
    open_persistent_terminal: () => {
      return { desc1: '' };
    },
    kill_persistent_terminal: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['kill_persistent_terminal'];
      return { desc1: toolParams.persistentTerminalId };
    },
    get_dir_tree: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['get_dir_tree'];
      return {
        desc1: getFolderName(toolParams.uri.fsPath) ?? '/',
        desc1Info: getRelative(toolParams.uri, accessor),
      };
    },
    read_lint_errors: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['read_lint_errors'];
      return {
        desc1: getBasename(toolParams.uri.fsPath),
        desc1Info: getRelative(toolParams.uri, accessor),
      };
    },
    get_diagnostics: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['get_diagnostics'];
      if (toolParams.uri) {
        return {
          desc1: getBasename(toolParams.uri.fsPath),
          desc1Info: getRelative(toolParams.uri, accessor),
        };
      }
      return { desc1: 'workspace' };
    },
    go_to_definition: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['go_to_definition'];
      const sym = toolParams.symbol ? ` ${toolParams.symbol}` : '';
      return {
        desc1: `${getBasename(toolParams.uri.fsPath)}:${toolParams.line}${sym}`,
        desc1Info: getRelative(toolParams.uri, accessor),
      };
    },
    find_references: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['find_references'];
      const sym = toolParams.symbol ? ` ${toolParams.symbol}` : '';
      return {
        desc1: `${getBasename(toolParams.uri.fsPath)}:${toolParams.line}${sym}`,
        desc1Info: getRelative(toolParams.uri, accessor),
      };
    },
    search_symbols: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['search_symbols'];
      return {
        desc1: `"${toolParams.query}"`,
        desc1Info: toolParams.uri ? getRelative(toolParams.uri, accessor) : undefined,
      };
    },
    rename_symbol: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['rename_symbol'];
      const from = toolParams.symbol ?? getBasename(toolParams.uri.fsPath);
      return {
        desc1: `${from} → ${toolParams.newName}`,
        desc1Info: getRelative(toolParams.uri, accessor),
      };
    },
    run_subagent: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['run_subagent'];
      return { desc1: toolParams.description };
    },
    run_parallel_subagents: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['run_parallel_subagents'];
      const n = toolParams.tasks?.length ?? 0;
      return { desc1: `${n}` };
    },
    get_chat_history: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['get_chat_history'];
      if (toolParams.threadId) {
        return {
          desc1: toolParams.threadId.slice(0, 8),
          desc1Info: toolParams.threadId,
        };
      }
      return { desc1: 'обзор' };
    },
    create_plan: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['create_plan'];
      return { desc1: toolParams.name };
    },
    update_plan: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['update_plan'];
      return {
        desc1: getBasename(toolParams.planUri.fsPath),
        desc1Info: getRelative(toolParams.planUri, accessor),
      };
    },
    enable_mcp_server: () => {
      const toolParams = _toolParams as BuiltinToolCallParams['enable_mcp_server'];
      return { desc1: toolParams.serverName };
    },
  };

  try {
    return x[toolName]?.() || { desc1: '' };
  } catch {
    return { desc1: '' };
  }
};

export const ToolRequestAcceptRejectButtons = ({ toolName }: { toolName: ToolName }) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');

  const onAccept = useCallback(() => {
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
  }, [chatThreadsService]);

  const onReject = useCallback(() => {
    try {
      const threadId = chatThreadsService.state.currentThreadId;
      chatThreadsService.rejectLatestToolRequest(threadId);
    } catch (e) {
      console.error('Error while approving message in chat:', e);
    }
  }, [chatThreadsService]);

  const approveButton = (
    <button
      onClick={onAccept}
      className={`
                px-2 py-1
                bg-void-success
                text-white
                hover:opacity-90
                rounded-sm
                text-sm font-medium
            `}
    >
      Одобрить
    </button>
  );

  const cancelButton = (
    <button
      onClick={onReject}
      className={`
                px-2 py-1
                bg-void-bg-2-alt
                text-void-fg-1
                border border-void-border-2
                hover:bg-void-bg-2-hover
                rounded-sm
                text-sm font-medium
            `}
    >
      Отмена
    </button>
  );

  const approvalType = isABuiltinToolName(toolName)
    ? approvalTypeOfBuiltinToolName[toolName]
    : 'MCP tools';
  const approvalToggle = approvalType ? (
    <div key={approvalType} className="flex items-center ml-2 gap-x-1">
      <ToolApprovalTypeSwitch
        size="xs"
        approvalType={approvalType}
        desc={`Автоодобрение: ${approvalType}`}
      />
    </div>
  ) : null;

  return (
    <div className="flex gap-2 mx-0.5 items-center">
      {approveButton}
      {cancelButton}
      {approvalToggle}
    </div>
  );
};

export {
  findPinnedPlanToolMessage,
  planUriFsPathFromPlanTool,
  planUriFsPathToCollapseInThread,
  shouldCollapsePlanToolInThread,
} from '../../../../common/planToolPin.js';

/** Компактная строка в ленте, когда полная карточка закреплена или план building/built. */
export const PlanToolInlinePlaceholder = ({
  toolMessage,
}: {
  toolMessage: ToolMessage<'create_plan'> | ToolMessage<'update_plan'>;
}) => {
  const name =
    toolMessage.type === 'success' && toolMessage.result && 'name' in toolMessage.result
      ? toolMessage.result.name
      : toolMessage.params && 'name' in toolMessage.params
        ? toolMessage.params.name
        : undefined;
  return (
    <ToolHeaderWrapper
      title={getTitle(toolMessage)}
      desc1={name ?? (toolMessage.name === 'update_plan' ? 'План обновлён' : 'План создан')}
      isError={false}
      icon={null}
    />
  );
};

export const PlanToolCard = ({
  toolMessage,
}: {
  toolMessage: ToolMessage<'create_plan'> | ToolMessage<'update_plan'>;
}) => {
  const accessor = useAccessor();
  const agentsPlan = useAgentsPlan();
  const chatThreadsService = accessor.get('IChatThreadService');
  const chatThreadsState = useChatThreadsState();
  const streamState = useChatThreadsStreamState(chatThreadsState.currentThreadId);

  const title = getTitle(toolMessage);
  const isRejected = toolMessage.type === 'rejected';

  if (toolMessage.type === 'tool_request' || toolMessage.type === 'running_now') {
    return (
      <ToolHeaderWrapper
        title={title}
        desc1={toolMessage.name === 'create_plan' ? 'Создание…' : 'Обновление…'}
        isError={false}
        icon={null}
      />
    );
  }

  if (toolMessage.type === 'invalid_params' || toolMessage.type === 'tool_error') {
    return (
      <ToolHeaderWrapper
        title={title}
        desc1="Ошибка"
        isError
        icon={null}
        isRejected={false}
        bottomChildren={
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.content}</CodeChildren>
          </BottomChildren>
        }
      />
    );
  }

  const result =
    toolMessage.type === 'success'
      ? (toolMessage.result as BuiltinToolResultType['create_plan'])
      : null;
  const name =
    result?.name ??
    (toolMessage.params && 'name' in toolMessage.params
      ? (toolMessage.params as BuiltinToolCallParams['create_plan']).name
      : 'План');
  const overview =
    result?.overview ??
    (toolMessage.params && 'overview' in toolMessage.params
      ? (toolMessage.params as BuiltinToolCallParams['create_plan']).overview
      : '');
  const planUri =
    result?.planUri ??
    (toolMessage.params && 'planUri' in toolMessage.params
      ? (toolMessage.params as BuiltinToolCallParams['update_plan']).planUri
      : null);

  const activePlan =
    chatThreadsState.allThreads[chatThreadsState.currentThreadId]?.state.activePlan;
  const isThisActivePlan = !!(planUri && activePlan?.planUriFsPath === planUri.fsPath);
  const planStatus = isThisActivePlan ? activePlan?.status : undefined;
  const isRunning = !!streamState?.isRunning;

  // обычные функции (не useCallback), чтобы число хуков не менялось при
  // переходах running_now → success после ранних return выше
  const onViewPlan = () => {
    if (!planUri) return;
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

  const buildLabel =
    planStatus === 'building' && isRunning
      ? 'Выполняется…'
      : planStatus === 'building' && !isRunning
        ? 'Продолжить'
        : planStatus === 'built'
          ? 'Выполнить снова'
          : 'Сделать по плану';

  const canBuild =
    isThisActivePlan &&
    (planStatus === 'ready' ||
      planStatus === 'built' ||
      (planStatus === 'building' && !isRunning)) &&
    !isRunning &&
    !isRejected;

  const progressLabel = isThisActivePlan ? activePlan?.progressLabel : undefined;

  return (
    <div className="mx-0.5 my-1 rounded-md border border-void-border-2 bg-void-bg-2 overflow-hidden">
      <div className="px-3 pt-2.5 pb-1 text-[11px] uppercase tracking-wide text-void-fg-3">
        {toolMessage.name === 'update_plan' ? 'План обновлён' : 'План создан'}
      </div>
      <div className="px-3 pb-2">
        <div className="text-sm font-medium text-void-fg-1">{name}</div>
        {overview ? (
          <div className="mt-1 text-xs text-void-fg-3 leading-relaxed">{overview}</div>
        ) : null}
        {progressLabel && (planStatus === 'building' || planStatus === 'built') ? (
          <div className="mt-1.5 text-xs text-void-fg-2">{progressLabel}</div>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-3 px-3 py-2 border-t border-void-border-1 bg-void-bg-1/50">
        {planUri ? (
          <button
            type="button"
            onClick={onViewPlan}
            className="text-xs text-void-fg-3 hover:text-void-fg-1 underline-offset-2 hover:underline"
          >
            Открыть план
          </button>
        ) : null}
        <button
          type="button"
          disabled={!canBuild}
          onClick={onBuild}
          className={`
						inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-sm font-medium
						${
              canBuild
                ? 'bg-void-success text-white hover:opacity-90'
                : 'opacity-50 cursor-not-allowed bg-void-bg-3 text-void-fg-3'
            }
					`}
        >
          <Hammer className="w-3.5 h-3.5" />
          {buildLabel}
        </button>
      </div>
      {isRejected ? <div className="px-3 py-1 text-xs text-void-fg-3">Отклонено</div> : null}
    </div>
  );
};

/** В agent/debug — однострочная строка инструмента; в plan — карточка с подтверждением. */
export const UpdatePlanToolCard = ({
  toolMessage,
}: {
  toolMessage: ToolMessage<'update_plan'>;
}) => {
  const chatMode = useSettingsState().globalSettings.chatMode;
  const accessor = useAccessor();
  const agentsPlan = useAgentsPlan();
  if (chatMode !== 'agent' && chatMode !== 'debug') {
    return <PlanToolCard toolMessage={toolMessage} />;
  }

  const title = getTitle(toolMessage);
  const isRejected = toolMessage.type === 'rejected';
  const isError = toolMessage.type === 'invalid_params' || toolMessage.type === 'tool_error';
  const { desc1, desc1Info } = toolNameToDesc(
    toolMessage.name,
    'params' in toolMessage ? toolMessage.params : undefined,
    accessor,
  );
  const planUri =
    toolMessage.type !== 'invalid_params' && toolMessage.params && 'planUri' in toolMessage.params
      ? toolMessage.params.planUri
      : undefined;

  const componentParams: ToolHeaderParams = {
    title,
    desc1,
    desc1Info,
    isError,
    icon: null,
    isRejected,
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
    componentParams.bottomChildren = (
      <BottomChildren title="Ошибка">
        <CodeChildren>{toolMessage.content}</CodeChildren>
      </BottomChildren>
    );
  }

  return <ToolHeaderWrapper {...componentParams} />;
};

const EditToolChildren = ({
  uri,
  code,
  type,
}: {
  uri: URI | undefined;
  code: string;
  type: 'diff' | 'rewrite';
}) => {
  const content =
    type === 'diff' ? (
      <SapphireDiffEditor uri={uri} searchReplaceBlocks={code} />
    ) : (
      <ChatMarkdownRender
        string={`\`\`\`\n${code}\n\`\`\``}
        codeURI={uri}
        chatMessageLocation={undefined}
      />
    );

  return (
    <div className="!select-text cursor-auto">
      <SmallProseWrapper>{content}</SmallProseWrapper>
    </div>
  );
};

const LintErrorChildren = ({ lintErrors }: { lintErrors: LintErrorItem[] }) => (
  <div className="text-xs text-void-fg-4 opacity-80 border-l-2 border-void-warning px-2 py-0.5 flex flex-col gap-0.5 overflow-x-auto whitespace-nowrap">
    {lintErrors.map((error, i) => (
      <div key={i}>
        Lines {error.startLineNumber}-{error.endLineNumber}: {error.message}
      </div>
    ))}
  </div>
);

const BottomChildren = ({ children, title }: { children: React.ReactNode; title: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  if (!children) return null;
  return (
    <div className="w-full px-2 mt-0.5">
      <div
        className="flex items-center cursor-pointer select-none transition-colors duration-150 pl-0 py-0.5 rounded group"
        onClick={() => setIsOpen((o) => !o)}
        style={{ background: 'none' }}
      >
        <ChevronRight
          className={`mr-1 h-3 w-3 flex-shrink-0 transition-transform duration-100 text-void-fg-4 group-hover:text-void-fg-3 ${isOpen ? 'rotate-90' : ''}`}
        />
        <span className="font-medium text-void-fg-4 group-hover:text-void-fg-3 text-xs">
          {title}
        </span>
      </div>
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'opacity-100' : 'max-h-0 opacity-0'} text-xs pl-4`}
      >
        <div className="overflow-x-auto text-void-fg-4 opacity-90 border-l-2 border-void-warning px-2 py-0.5">
          {children}
        </div>
      </div>
    </div>
  );
};

const EditToolHeaderButtons = ({
  applyBoxId,
  uri,
  codeStr,
  toolName,
  threadId,
}: {
  threadId: string;
  applyBoxId: string;
  uri: URI;
  codeStr: string;
  toolName: 'edit_file' | 'rewrite_file';
}) => {
  const { streamState } = useEditToolStreamState({ applyBoxId, uri });
  return (
    <div className="flex items-center gap-1">
      {streamState === 'idle-no-changes' && (
        <CopyButton codeStr={codeStr} toolTipName="Копировать" />
      )}
      <EditToolAcceptRejectButtonsHTML
        type={toolName}
        codeStr={codeStr}
        applyBoxId={applyBoxId}
        uri={uri}
        threadId={threadId}
      />
    </div>
  );
};

export const InvalidTool = ({
  toolName,
  message,
  mcpServerName,
}: {
  toolName: ToolName;
  message: string;
  mcpServerName: string | undefined;
}) => {
  const title = getTitle({ name: toolName, type: 'invalid_params', mcpServerName });
  const desc1 = 'Неверные параметры';
  const icon = null;
  const isError = true;
  const componentParams: ToolHeaderParams = { title, desc1, isError, icon };

  componentParams.children = (
    <ToolChildrenWrapper>
      <CodeChildren className="bg-void-bg-3">{message}</CodeChildren>
    </ToolChildrenWrapper>
  );
  return <ToolHeaderWrapper {...componentParams} />;
};

export const CanceledTool = ({
  toolName,
  mcpServerName,
}: {
  toolName: ToolName;
  mcpServerName: string | undefined;
}) => {
  const title = getTitle({ name: toolName, type: 'rejected', mcpServerName });
  const desc1 = '';
  const icon = null;
  const isRejected = true;
  const componentParams: ToolHeaderParams = { title, desc1, icon, isRejected };
  return <ToolHeaderWrapper {...componentParams} />;
};

const CommandTool = ({
  toolMessage,
  type,
  threadId,
}: { threadId: string } & (
  | {
      toolMessage: Exclude<ToolMessage<'run_command'>, { type: 'invalid_params' }>;
      type: 'run_command';
    }
  | {
      toolMessage: Exclude<ToolMessage<'run_persistent_command'>, { type: 'invalid_params' }>;
      type: 'run_persistent_command';
    }
)) => {
  const accessor = useAccessor();

  const terminalToolsService = accessor.get('ITerminalToolService');
  const toolsService = accessor.get('IToolsService');
  const isError = false;
  const title = getTitle(toolMessage);
  const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
  const icon = null;
  const streamState = useChatThreadsStreamState(threadId);

  const divRef = useRef<HTMLDivElement | null>(null);

  const isRejected = toolMessage.type === 'rejected';
  const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected };

  useEffect(() => {
    if (streamState?.isRunning !== 'tool') return;
    if (type !== 'run_command' || toolMessage.type !== 'running_now') return;

    let cancelled = false;
    let detach: (() => void) | undefined;

    (async () => {
      const deadline = Date.now() + 35_000;
      let terminal = terminalToolsService.getTemporaryTerminal(toolMessage.params.terminalId);
      while (!cancelled && !terminal && Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, 50));
        terminal = terminalToolsService.getTemporaryTerminal(toolMessage.params.terminalId);
      }
      if (cancelled || !terminal) return;

      const container = divRef.current;
      if (!container) return;

      try {
        terminal.attachToElement(container);
        terminal.setVisible(true);
      } catch {}

      const resizeObserver = new ResizeObserver((entries) => {
        const height = entries[0].borderBoxSize[0].blockSize;
        const width = entries[0].borderBoxSize[0].inlineSize;
        if (typeof terminal.layout === 'function') {
          terminal.layout({ width, height });
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

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [terminalToolsService, toolMessage, toolMessage.type, type, streamState?.isRunning]);

  if (toolMessage.type === 'success') {
    const { result } = toolMessage;

    let msg: string;
    if (type === 'run_command')
      msg = toolsService.stringOfResult.run_command(toolMessage.params, result);
    else msg = toolsService.stringOfResult.run_persistent_command(toolMessage.params, result);

    if (type === 'run_persistent_command') {
      componentParams.info = persistentTerminalNameOfId(toolMessage.params.persistentTerminalId);
    }

    componentParams.children = (
      <ToolChildrenWrapper className="whitespace-pre text-nowrap overflow-auto text-sm">
        <div className="!select-text cursor-auto">
          <BlockCode initValue={`${msg.trim()}`} language="shellscript" />
        </div>
      </ToolChildrenWrapper>
    );
  } else if (toolMessage.type === 'tool_error') {
    const { result } = toolMessage;
    componentParams.bottomChildren = (
      <BottomChildren title="Ошибка">
        <CodeChildren>{result}</CodeChildren>
      </BottomChildren>
    );
  } else if (toolMessage.type === 'running_now') {
    if (type === 'run_command')
      componentParams.children = <div ref={divRef} className="relative h-[300px] text-sm" />;
  } else if (toolMessage.type === 'rejected' || toolMessage.type === 'tool_request') {
  }

  return (
    <ToolHeaderWrapper
      {...componentParams}
      isOpen={type === 'run_command' && toolMessage.type === 'running_now' ? true : undefined}
    />
  );
};

type WrapperProps<T extends ToolName> = {
  toolMessage: Exclude<ToolMessage<T>, { type: 'invalid_params' }>;
  messageIdx: number;
  threadId: string;
};
export const MCPToolWrapper = ({ toolMessage }: WrapperProps<string>) => {
  const accessor = useAccessor();
  const mcpService = accessor.get('IMCPService');

  const title = getTitle(toolMessage);
  const desc1 = removeMCPToolNamePrefix(toolMessage.name);
  const icon = null;

  if (toolMessage.type === 'running_now') return null; // не показываем состояние running_now

  const isError = false;
  const isRejected = toolMessage.type === 'rejected';
  const { params } = toolMessage;
  const componentParams: ToolHeaderParams = { title, desc1, isError, icon, isRejected };

  const paramsStr = JSON.stringify(params, null, 2);
  componentParams.desc2 = (
    <CopyButton codeStr={paramsStr} toolTipName={`Копировать параметры: ${paramsStr}`} />
  );

  componentParams.info = !toolMessage.mcpServerName ? 'MCP-инструмент не найден' : undefined;

  // кнопка копирования входных данных в desc2

  if (toolMessage.type === 'success' || toolMessage.type === 'tool_request') {
    const { result } = toolMessage;
    const resultStr = result ? mcpService.stringifyResult(result) : 'null';
    componentParams.children = (
      <ToolChildrenWrapper>
        <SmallProseWrapper>
          <ChatMarkdownRender
            string={`\`\`\`json\n${resultStr}\n\`\`\``}
            chatMessageLocation={undefined}
            isApplyEnabled={false}
            isLinkDetectionEnabled
          />
        </SmallProseWrapper>
      </ToolChildrenWrapper>
    );
  } else if (toolMessage.type === 'tool_error') {
    const { result } = toolMessage;
    componentParams.bottomChildren = (
      <BottomChildren title="Ошибка">
        <CodeChildren>{result}</CodeChildren>
      </BottomChildren>
    );
  }

  return <ToolHeaderWrapper {...componentParams} />;
};

const CodeNavToolCard = ({
  toolMessage,
}: {
  toolMessage: ToolMessage<'go_to_definition'> | ToolMessage<'find_references'>;
}) => {
  const accessor = useAccessor();
  const title = getTitle(toolMessage);
  const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);

  if (toolMessage.type === 'tool_request') return null;
  if (toolMessage.type === 'running_now') return null;

  const isRejected = toolMessage.type === 'rejected';
  const { params } = toolMessage;
  const componentParams: ToolHeaderParams = {
    title,
    desc1,
    desc1Info,
    isError: false,
    icon: null,
    isRejected,
  };

  componentParams.info = getRelative(params.uri, accessor);

  if (toolMessage.type === 'success') {
    const { result } = toolMessage;
    componentParams.onClick = () => {
      sapphireOpenFileFn(params.uri, accessor, [params.line, params.line]);
    };
    if (result.message) {
      componentParams.children = (
        <ToolChildrenWrapper className="text-void-fg-3 text-sm">{result.message}</ToolChildrenWrapper>
      );
    } else {
      const truncated =
        toolMessage.name === 'find_references' && 'truncated' in result ? result.truncated : false;
      componentParams.numResults = result.locations.length;
      componentParams.hasNextPage = truncated;
      componentParams.children =
        result.locations.length === 0 ? undefined : (
          <ToolChildrenWrapper>
            {result.locations.map((loc, i) => (
              <ListableToolItem
                key={i}
                name={`${getBasename(loc.uri.fsPath)}:${loc.startLine}${loc.preview ? ` — ${loc.preview.slice(0, 80)}` : ''}`}
                className="w-full overflow-auto"
                onClick={() => {
                  sapphireOpenFileFn(loc.uri, accessor, [loc.startLine, loc.endLine]);
                }}
              />
            ))}
            {truncated && (
              <ListableToolItem name="Results truncated." isSmall className="w-full overflow-auto" />
            )}
          </ToolChildrenWrapper>
        );
    }
  } else if (toolMessage.type === 'tool_error') {
    componentParams.bottomChildren = (
      <BottomChildren title="Ошибка">
        <CodeChildren>{toolMessage.result}</CodeChildren>
      </BottomChildren>
    );
  }

  return <ToolHeaderWrapper {...componentParams} />;
};

export type ResultWrapper<T extends ToolName> = (props: WrapperProps<T>) => React.ReactNode;

export const builtinToolNameToComponent: {
  [T in BuiltinToolName]: { resultWrapper: ResultWrapper<T> };
} = {
  read_file: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);

      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;

      if (toolMessage.type === 'tool_request') return null; // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') return null; // не показываем состояние running_now

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const { params } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
      };

      let range: [number, number] | undefined;
      if (toolMessage.params.startLine !== null || toolMessage.params.endLine !== null) {
        const start =
          toolMessage.params.startLine === null ? `1` : `${toolMessage.params.startLine}`;
        const end = toolMessage.params.endLine === null ? `` : `${toolMessage.params.endLine}`;
        const addStr = `(${start}-${end})`;
        componentParams.desc1 += ` ${addStr}`;
        range = [params.startLine || 1, params.endLine || 1];
      }

      if (toolMessage.type === 'success') {
        const { result } = toolMessage;
        componentParams.onClick = () => {
          sapphireOpenFileFn(params.uri, accessor, range);
        };
        if (result.hasNextPage && params.pageNumber === 1)
          // первая страница вывода
          componentParams.desc2 = `(truncated after ${Math.round(MAX_FILE_CHARS_PAGE) / 1000}k)`;
        else if (params.pageNumber > 1)
          // следующие страницы
          componentParams.desc2 = `(part ${params.pageNumber})`;
      } else if (toolMessage.type === 'tool_error') {
        const { result } = toolMessage;
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },
  get_dir_tree: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;

      if (toolMessage.type === 'tool_request') return null; // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') return null; // не показываем состояние running_now

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const { params } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
      };

      if (params.uri) {
        const rel = getRelative(params.uri, accessor);
        if (rel) componentParams.info = `Only search in ${rel}`;
      }

      if (toolMessage.type === 'success') {
        const { result } = toolMessage;
        componentParams.children = (
          <ToolChildrenWrapper>
            <SmallProseWrapper>
              <ChatMarkdownRender
                string={`\`\`\`\n${result.str}\n\`\`\``}
                chatMessageLocation={undefined}
                isApplyEnabled={false}
                isLinkDetectionEnabled
              />
            </SmallProseWrapper>
          </ToolChildrenWrapper>
        );
      } else if (toolMessage.type === 'tool_error') {
        const { result } = toolMessage;
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },
  ls_dir: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;

      if (toolMessage.type === 'tool_request') return null; // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') return null; // не показываем состояние running_now

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const { params } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
      };

      if (params.uri) {
        const rel = getRelative(params.uri, accessor);
        if (rel) componentParams.info = `Only search in ${rel}`;
      }

      if (toolMessage.type === 'success') {
        const { result } = toolMessage;
        componentParams.numResults = result.children?.length;
        componentParams.hasNextPage = result.hasNextPage;
        const isEmpty = !result.children || result.children.length === 0;
        componentParams.children = isEmpty ? (
          <ToolChildrenWrapper className="text-void-fg-3 text-sm">
            Directory exists but is empty.
          </ToolChildrenWrapper>
        ) : (
          <ToolChildrenWrapper>
            {result.children!.map((child, i) => (
              <ListableToolItem
                key={i}
                name={`${child.name}${child.isDirectory ? '/' : ''}`}
                className="w-full overflow-auto"
                onClick={() => {
                  sapphireOpenFileFn(child.uri, accessor);
                  // commandService.executeCommand('workbench.view.explorer'); // открыть в проводнике вместо reveal
                  // explorerService.select(child.uri, true); — выделить файл в дереве
                }}
              />
            ))}
            {result.hasNextPage && (
              <ListableToolItem
                name={`Results truncated (${result.itemsRemaining} remaining).`}
                isSmall
                className="w-full overflow-auto"
              />
            )}
          </ToolChildrenWrapper>
        );
      } else if (toolMessage.type === 'tool_error') {
        const { result } = toolMessage;
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },
  search_project_index: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
      };

      if (toolMessage.type === 'success') {
        const { result } = toolMessage;
        componentParams.children = (
          <ToolChildrenWrapper>
            {result.hits.map((h) => (
              <div key={h.uri.fsPath} className="text-xs text-void-fg-2 truncate">
                {getBasename(h.uri.fsPath)} — {(h.purpose || h.localRole).slice(0, 80)}
              </div>
            ))}
          </ToolChildrenWrapper>
        );
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },
  search_pathnames_only: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;

      if (toolMessage.type === 'tool_request') return null; // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') return null; // не показываем состояние running_now

      const { params } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
      };

      if (params.includePattern) {
        componentParams.info = `Only search in ${params.includePattern}`;
      }

      if (toolMessage.type === 'success') {
        const { result } = toolMessage;
        componentParams.numResults = result.uris.length;
        componentParams.hasNextPage = result.hasNextPage;
        componentParams.children =
          result.uris.length === 0 ? undefined : (
            <ToolChildrenWrapper>
              {result.uris.map((uri, i) => (
                <ListableToolItem
                  key={i}
                  name={getBasename(uri.fsPath)}
                  className="w-full overflow-auto"
                  onClick={() => {
                    sapphireOpenFileFn(uri, accessor);
                  }}
                />
              ))}
              {result.hasNextPage && (
                <ListableToolItem
                  name="Results truncated."
                  isSmall
                  className="w-full overflow-auto"
                />
              )}
            </ToolChildrenWrapper>
          );
      } else if (toolMessage.type === 'tool_error') {
        const { result } = toolMessage;
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },
  search_for_files: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;

      if (toolMessage.type === 'tool_request') return null; // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') return null; // не показываем состояние running_now

      const { params } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
      };

      if (params.searchInFolder || params.isRegex) {
        let info: string[] = [];
        if (params.searchInFolder) {
          const rel = getRelative(params.searchInFolder, accessor);
          if (rel) info.push(`Only search in ${rel}`);
        }
        if (params.isRegex) {
          info.push(`Uses regex search`);
        }
        componentParams.info = info.join('; ');
      }

      if (toolMessage.type === 'success') {
        const { result } = toolMessage;
        componentParams.numResults = result.uris.length;
        componentParams.hasNextPage = result.hasNextPage;
        componentParams.children =
          result.uris.length === 0 ? undefined : (
            <ToolChildrenWrapper>
              {result.uris.map((uri, i) => (
                <ListableToolItem
                  key={i}
                  name={getBasename(uri.fsPath)}
                  className="w-full overflow-auto"
                  onClick={() => {
                    sapphireOpenFileFn(uri, accessor);
                  }}
                />
              ))}
              {result.hasNextPage && (
                <ListableToolItem
                  name="Results truncated."
                  isSmall
                  className="w-full overflow-auto"
                />
              )}
            </ToolChildrenWrapper>
          );
      } else if (toolMessage.type === 'tool_error') {
        const { result } = toolMessage;
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{result}</CodeChildren>
          </BottomChildren>
        );
      }
      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  search_in_file: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const toolsService = accessor.get('IToolsService');
      const title = getTitle(toolMessage);
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;

      if (toolMessage.type === 'tool_request') return null; // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') return null; // не показываем состояние running_now

      const { params } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
      };

      const infoarr: string[] = [];
      const uriStr = getRelative(params.uri, accessor);
      if (uriStr) infoarr.push(uriStr);
      if (params.isRegex) infoarr.push('Uses regex search');
      componentParams.info = infoarr.join('; ');

      if (toolMessage.type === 'success') {
        const { result } = toolMessage; // result — массив фрагментов
        componentParams.numResults = result.lines.length;
        componentParams.children =
          result.lines.length === 0 ? undefined : (
            <ToolChildrenWrapper>
              <CodeChildren className="bg-void-bg-3">
                <pre className="font-mono whitespace-pre">
                  {toolsService.stringOfResult.search_in_file(params, result)}
                </pre>
              </CodeChildren>
            </ToolChildrenWrapper>
          );
      } else if (toolMessage.type === 'tool_error') {
        const { result } = toolMessage;
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  read_lint_errors: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);

      const { uri } = toolMessage.params ?? {};
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;

      if (toolMessage.type === 'tool_request') return null; // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') return null; // не показываем состояние running_now

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const { params } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
      };

      componentParams.info = getRelative(uri, accessor); // полный путь в подсказке

      if (toolMessage.type === 'success') {
        const { result } = toolMessage;
        componentParams.onClick = () => {
          sapphireOpenFileFn(params.uri, accessor);
        };
        if (result.lintErrors)
          componentParams.children = <LintErrorChildren lintErrors={result.lintErrors} />;
        else componentParams.children = `No lint errors found.`;
      } else if (toolMessage.type === 'tool_error') {
        const { result } = toolMessage;
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  go_to_definition: {
    resultWrapper: ({ toolMessage }) => <CodeNavToolCard toolMessage={toolMessage} />,
  },
  find_references: {
    resultWrapper: ({ toolMessage }) => <CodeNavToolCard toolMessage={toolMessage} />,
  },

  grep_search: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const toolsService = accessor.get('IToolsService');
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected',
      };

      if (toolMessage.type === 'success') {
        const { params, result } = toolMessage;
        componentParams.numResults = result.matches.length;
        componentParams.hasNextPage = result.totalMatches > result.matches.length;
        const body = toolsService.stringOfResult.grep_search(params, result);
        componentParams.children =
          result.matches.length === 0 ? undefined : (
            <ToolChildrenWrapper>
              <CodeChildren className="bg-void-bg-3">
                <pre className="font-mono whitespace-pre-wrap">{body}</pre>
              </CodeChildren>
            </ToolChildrenWrapper>
          );
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  get_diagnostics: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const toolsService = accessor.get('IToolsService');
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected',
      };

      if (toolMessage.type === 'success') {
        const { params, result } = toolMessage;
        componentParams.numResults = result.diagnostics.length;
        const body = toolsService.stringOfResult.get_diagnostics(params, result);
        componentParams.children =
          result.diagnostics.length === 0 ? (
            <ToolChildrenWrapper>No diagnostics found.</ToolChildrenWrapper>
          ) : (
            <ToolChildrenWrapper>
              <CodeChildren className="bg-void-bg-3">
                <pre className="font-mono whitespace-pre-wrap">{body}</pre>
              </CodeChildren>
            </ToolChildrenWrapper>
          );
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  search_symbols: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const toolsService = accessor.get('IToolsService');
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected',
      };

      if (toolMessage.type === 'success') {
        const { params, result } = toolMessage;
        componentParams.numResults = result.symbols.length;
        componentParams.hasNextPage = result.truncated;
        const body = toolsService.stringOfResult.search_symbols(params, result);
        componentParams.children =
          result.symbols.length === 0 ? undefined : (
            <ToolChildrenWrapper>
              <CodeChildren className="bg-void-bg-3">
                <pre className="font-mono whitespace-pre-wrap">{body}</pre>
              </CodeChildren>
            </ToolChildrenWrapper>
          );
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  rename_symbol: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const toolsService = accessor.get('IToolsService');
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected',
      };

      if (toolMessage.type === 'success') {
        const { params, result } = toolMessage;
        componentParams.numResults = result.changes.length;
        const body = toolsService.stringOfResult.rename_symbol(params, result);
        componentParams.children = (
          <ToolChildrenWrapper>
            <CodeChildren className="bg-void-bg-3">
              <pre className="font-mono whitespace-pre-wrap">{body}</pre>
            </CodeChildren>
          </ToolChildrenWrapper>
        );
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  get_chat_history: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const chatThreadsService = accessor.get('IChatThreadService');
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const threadId =
        toolMessage.params && 'threadId' in toolMessage.params ? toolMessage.params.threadId : null;
      const canSwitch = !!threadId && !!chatThreadsService.state.allThreads[threadId];
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
        desc1OnClick: canSwitch ? () => chatThreadsService.switchToThread(threadId) : undefined,
      };

      if (toolMessage.type === 'success') {
        const summary = toolMessage.result.summary ?? '';
        componentParams.desc2 = summary ? (
          <CopyButton codeStr={summary} toolTipName="Копировать" />
        ) : undefined;
        componentParams.children = summary ? (
          <ToolChildrenWrapper>
            <CodeChildren className="bg-void-bg-3">
              <pre className="font-mono whitespace-pre-wrap">{summary}</pre>
            </CodeChildren>
          </ToolChildrenWrapper>
        ) : undefined;
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  run_subagent: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected',
      };

      if (toolMessage.type === 'success') {
        const summary = toolMessage.result.summary ?? '';
        componentParams.desc2 = summary ? (
          <CopyButton codeStr={summary} toolTipName="Копировать" />
        ) : undefined;
        componentParams.children = summary ? (
          <ToolChildrenWrapper>
            <CodeChildren className="bg-void-bg-3">
              <pre className="font-mono whitespace-pre-wrap">{summary}</pre>
            </CodeChildren>
          </ToolChildrenWrapper>
        ) : undefined;
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  glob_files: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected',
      };

      if (toolMessage.type === 'success') {
        const { result } = toolMessage;
        componentParams.numResults = result.files.length;
        componentParams.hasNextPage = result.truncated;
        componentParams.children =
          result.files.length === 0 ? undefined : (
            <ToolChildrenWrapper>
              {result.files.map((f, i) => (
                <ListableToolItem
                  key={i}
                  name={getBasename(f.uri.fsPath)}
                  className="w-full overflow-auto"
                  onClick={() => {
                    sapphireOpenFileFn(f.uri, accessor);
                  }}
                />
              ))}
              {result.truncated && (
                <ListableToolItem
                  name="Results truncated."
                  isSmall
                  className="w-full overflow-auto"
                />
              )}
            </ToolChildrenWrapper>
          );
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  web_search: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected',
      };

      if (toolMessage.type === 'success') {
        const { result } = toolMessage;
        componentParams.numResults = result.results.length;
        componentParams.children =
          result.results.length === 0 ? undefined : (
            <ToolChildrenWrapper>
              {result.results.map((r, i) => (
                <ListableToolItem
                  key={i}
                  name={r.title || r.url}
                  className="w-full overflow-auto"
                  onClick={() => {
                    window.open(r.url, '_blank', 'noopener,noreferrer');
                  }}
                />
              ))}
            </ToolChildrenWrapper>
          );
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  browse_url: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const toolsService = accessor.get('IToolsService');
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected',
      };

      if (toolMessage.type === 'success') {
        const { params, result } = toolMessage;
        const preview = toolsService.stringOfResult.browse_url(params, result);
        componentParams.info = result.title ?? undefined;
        componentParams.children = (
          <ToolChildrenWrapper>
            <CodeChildren className="bg-void-bg-3">
              <pre className="font-mono whitespace-pre-wrap">{preview.slice(0, 2000)}</pre>
            </CodeChildren>
          </ToolChildrenWrapper>
        );
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  save_memory: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected',
      };

      if (toolMessage.type === 'success') {
        componentParams.info = `key=${toolMessage.result.key}`;
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  run_parallel_subagents: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected',
      };

      if (toolMessage.type === 'success') {
        const { results } = toolMessage.result;
        componentParams.numResults = results.length;
        componentParams.children = (
          <ToolChildrenWrapper>
            {results.map((r, i) => (
              <div key={i} className="mb-2">
                <div className="text-sm opacity-80">
                  {r.completed ? '✓' : '✗'} {r.description}
                </div>
                {r.summary ? (
                  <CodeChildren className="bg-void-bg-3">
                    <pre className="font-mono whitespace-pre-wrap">{r.summary}</pre>
                  </CodeChildren>
                ) : null}
              </div>
            ))}
          </ToolChildrenWrapper>
        );
      } else if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  create_plan: {
    resultWrapper: ({ toolMessage }) => <PlanToolCard toolMessage={toolMessage} />,
  },
  update_plan: {
    resultWrapper: ({ toolMessage }) => <UpdatePlanToolCard toolMessage={toolMessage} />,
  },

  enable_mcp_server: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);

      if (toolMessage.type === 'tool_request') return null;
      if (toolMessage.type === 'running_now') return null;

      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError: false,
        icon: null,
        isRejected: toolMessage.type === 'rejected',
      };

      if (toolMessage.type === 'tool_error') {
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{toolMessage.result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },

  // --- разделитель секций ---

  create_file_or_folder: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;

      const { params } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
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
        const { result } = toolMessage;
        if (params) {
          componentParams.onClick = () => {
            sapphireOpenFileFn(params.uri, accessor);
          };
        }
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{result}</CodeChildren>
          </BottomChildren>
        );
      } else if (toolMessage.type === 'running_now') {
        // дополнительная разметка не нужна
      } else if (toolMessage.type === 'tool_request') {
        // дополнительная разметка не нужна
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },
  delete_file_or_folder: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const title = getTitle(toolMessage);
      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const icon = null;

      const { params } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
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
        const { result } = toolMessage;
        if (params) {
          componentParams.onClick = () => {
            sapphireOpenFileFn(params.uri, accessor);
          };
        }
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{result}</CodeChildren>
          </BottomChildren>
        );
      } else if (toolMessage.type === 'running_now') {
        componentParams.onClick = () => {
          sapphireOpenFileFn(params.uri, accessor);
        };
      } else if (toolMessage.type === 'tool_request') {
        componentParams.onClick = () => {
          sapphireOpenFileFn(params.uri, accessor);
        };
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },
  rewrite_file: {
    resultWrapper: (params) => (
      <EditTool {...params} content={params.toolMessage.params.newContent} />
    ),
  },
  edit_file: {
    resultWrapper: (params) => (
      <EditTool {...params} content={params.toolMessage.params.searchReplaceBlocks} />
    ),
  },

  // --- разделитель секций ---

  run_command: {
    resultWrapper: (params) => <CommandTool {...params} type="run_command" />,
  },

  run_persistent_command: {
    resultWrapper: (params) => <CommandTool {...params} type="run_persistent_command" />,
  },
  open_persistent_terminal: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const terminalToolsService = accessor.get('ITerminalToolService');

      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const title = getTitle(toolMessage);
      const icon = null;

      if (toolMessage.type === 'tool_request') return null; // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') return null; // не показываем состояние running_now

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const { params } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
      };

      const relativePath = params.cwd ? getRelative(URI.file(params.cwd), accessor) : '';
      componentParams.info = relativePath ? `Running in ${relativePath}` : undefined;

      if (toolMessage.type === 'success') {
        const { result } = toolMessage;
        const { persistentTerminalId } = result;
        componentParams.desc1 = persistentTerminalNameOfId(persistentTerminalId);
        componentParams.onClick = () =>
          terminalToolsService.focusPersistentTerminal(persistentTerminalId);
      } else if (toolMessage.type === 'tool_error') {
        const { result } = toolMessage;
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },
  kill_persistent_terminal: {
    resultWrapper: ({ toolMessage }) => {
      const accessor = useAccessor();
      const terminalToolsService = accessor.get('ITerminalToolService');

      const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
      const title = getTitle(toolMessage);
      const icon = null;

      if (toolMessage.type === 'tool_request') return null; // не показываем устаревшие tool_request в истории
      if (toolMessage.type === 'running_now') return null; // не показываем состояние running_now

      const isError = false;
      const isRejected = toolMessage.type === 'rejected';
      const { params } = toolMessage;
      const componentParams: ToolHeaderParams = {
        title,
        desc1,
        desc1Info,
        isError,
        icon,
        isRejected,
      };

      if (toolMessage.type === 'success') {
        const { persistentTerminalId } = params;
        componentParams.desc1 = persistentTerminalNameOfId(persistentTerminalId);
        componentParams.onClick = () =>
          terminalToolsService.focusPersistentTerminal(persistentTerminalId);
      } else if (toolMessage.type === 'tool_error') {
        const { result } = toolMessage;
        componentParams.bottomChildren = (
          <BottomChildren title="Ошибка">
            <CodeChildren>{result}</CodeChildren>
          </BottomChildren>
        );
      }

      return <ToolHeaderWrapper {...componentParams} />;
    },
  },
};
export const EditToolSoFar = ({ toolCallSoFar }: { toolCallSoFar: RawToolCallObj }) => {
  const accessor = useAccessor();

  if (!isABuiltinToolName(toolCallSoFar.name)) return null;

  const uri = toolCallSoFar.rawParams.uri ? URI.file(toolCallSoFar.rawParams.uri) : undefined;

  const title = titleOfBuiltinToolName[toolCallSoFar.name].proposed;

  const uriDone = toolCallSoFar.doneParams.includes('uri');
  const desc1 = (
    <span className="flex items-center">
      {uriDone ? getBasename(toolCallSoFar.rawParams.uri ?? 'unknown') : `Генерация`}
      <IconLoading />
    </span>
  );

  const desc1OnClick = () => {
    if (uri) {
      sapphireOpenFileFn(uri, accessor);
    }
  };

  // URI ещё не задан
  return (
    <ToolHeaderWrapper title={title} desc1={desc1} desc1OnClick={desc1OnClick}>
      <EditToolChildren
        uri={uri}
        code={
          toolCallSoFar.rawParams.search_replace_blocks ?? toolCallSoFar.rawParams.new_content ?? ''
        }
        type="rewrite" // при стриме — режим rewrite, без diff-редактора
      />
      <IconLoading />
    </ToolHeaderWrapper>
  );
};

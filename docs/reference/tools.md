# Builtin tools

Определения: `common/prompt/prompts.ts`. Исполнение: `browser/toolsService.ts`. Набор по режиму — `availableTools()`.

**Chat (normal)** — builtin tools не передаются модели.

| Tool | Plan | Agent | Approval | Назначение |
| --- | :-: | :-: | --- | --- |
| `read_file` | ✓ | ✓ | — | Содержимое файла (office → извлечённый текст) |
| `ls_dir` | ✓ | ✓ | — | Список файлов/папок |
| `get_dir_tree` | ✓ | ✓ | — | Дерево каталога |
| `search_pathnames_only` | ✓ | ✓ | — | Поиск по именам файлов |
| `search_project_index` | ✓ | ✓ | — | Поиск по `.sapphire/index` (purpose, теги, символы) |
| `diff_impact` | ✓ | ✓ | — | охват изменений по графу индекса (до 2 hops) |
| `get_project_tour` | ✓ | ✓ | — | Сохранённый тур онбординга (`tour.json`) |
| `search_for_files` | ✓ | ✓ | — | Пути файлов по содержимому |
| `search_in_file` | ✓ | ✓ | — | Строки внутри файла |
| `grep_search` | ✓ | ✓ | — | Совпадения по workspace (path + строка) |
| `glob_files` | ✓ | ✓ | — | Файлы по glob |
| `get_diagnostics` | ✓ | ✓ | — | Diagnostics workspace или файла |
| `read_lint_errors` | ✓ | ✓ | — | Lint одного файла |
| `go_to_definition` | ✓ | ✓ | — | Definition через language service |
| `find_references` | ✓ | ✓ | — | References (до 30) |
| `search_symbols` | ✓ | ✓ | — | Символы по имени (outline / workspace) |
| `get_chat_history` | ✓ | ✓ | — | Сжатая история других вкладок чата |
| `create_plan` | ✓ | ✗ | — | Создать `.sapphire/plans/*.plan.md` |
| `update_plan` | ✓ | \* | — | Обновить план / todos |
| `rename_symbol` | ✗ | ✓ | edits | Rename через LSP |
| `create_file_or_folder` | ✗ | ✓ | edits | Создать файл или папку |
| `delete_file_or_folder` | ✗ | ✓ | edits | Удалить файл или папку |
| `edit_file` | ✗ | ✓ | edits | SEARCH/REPLACE (для `.pdf` — текстовый слой) |
| `rewrite_file` | ✗ | ✓ | edits | Полная перезапись / создание; для `.pdf` — новый текстовый PDF |
| `run_command` | ✗ | ✓ | terminal | Команда в терминале |
| `run_persistent_command` | ✗ | ✓ | terminal | Команда в persistent terminal |
| `open_persistent_terminal` | ✗ | ✓ | terminal | Открыть persistent terminal |
| `kill_persistent_terminal` | ✗ | ✓ | terminal | Закрыть persistent terminal |
| `web_search` | ✗ | ✓ | — | Поиск в публичном интернете (agent-only) |
| `browse_url` | ✗ | ✓ | — | Текст публичной http(s)-страницы (agent-only) |
| `browser_navigate` | ✗ | ✓ | browser | Открыть URL во встроенном браузере, включая localhost |
| `browser_snapshot` | ✗ | ✓ | browser | Снимок страницы с ref; `page_id` опционален (активная вкладка) |
| `browser_click` | ✗ | ✓ | browser | Клик по ref из снимка |
| `browser_type` | ✗ | ✓ | browser | Ввод текста в элемент по ref |
| `browser_scroll` | ✗ | ✓ | browser | Прокрутка страницы |
| `browser_screenshot` | ✗ | ✓ | browser | Скриншот страницы |
| `save_memory` | ✗ | ✓ | — | Долгий факт в workspace memory (agent-only) |
| `run_subagent` | ✗ | ✓ | — | Дочерний агент со своим tool loop (agent-only) |
| `run_parallel_subagents` | ✗ | ✓ | — | До 4 read-only subagents параллельно (agent-only) |
| `enable_mcp_server` | ✗ | \*\* | — | Включить MCP-сервер в треде (deferred) |
| MCP tools | ✗ | \*\* | MCP | Tools включённых серверов |

\* **`update_plan` в Agent** — только пока выполняется утверждённый план (`allowUpdatePlan`, статус `building`). В Plan доступен всегда.

\*\* **`enable_mcp_server` и MCP tools** — только в Agent при online MCP. Сначала каталог + `enable_mcp_server`; полные схемы tools сервера — после enable в треде.

## Заметки

- `read_file` / `search_in_file` для `.xlsx` / `.xlsm`, `.docx`, `.pptx`, `.pdf` — извлечённый текст; скан PDF распознаётся локально (rus+eng). Файл > 25 МБ не разбирается. См. [Офисные файлы](/guide/office), [архитектура](/architecture/office-extract).
- `edit_file` / `rewrite_file` для `.pdf` с текстовым слоем пишут байты PDF. Для `.docx` / `.xlsx` / `.xlsm` / `.pptx` `edit_file` меняет текст в существующем файле, `rewrite_file` собирает новый простой пакет. Скан PDF (OCR) эти tools не пишут.
- `search_project_index` — локальный индекс (token-score). См. [Индекс проекта](/architecture/project-index).
- `diff_impact` — BFS до 2 hops по графу индекса (импорты и вызовы) для относительных путей. Тот же расчёт попадает в генерацию commit message.
- `get_project_tour` — шаги онбординга из `.sapphire/index/tour.json` (появляется сам после индексации, если тура нет или он устарел).
- Планы: `.sapphire/plans/*.plan.md` (YAML frontmatter + markdown, опционально Mermaid).
- `web_search` / `browse_url` идут в публичную сеть, не на LLM-шлюз. См. [Приватность](/guide/privacy).
- `browser_*` управляют встроенным браузером (в том числе localhost). Уже открытые вкладки перечислены в system info агента; для них достаточно `browser_snapshot` (share при первом доступе). Новый URL — `browser_navigate`, затем click/type по `ref` из снимка. `page_id` можно опустить. Каждое действие — approval `browser`.
- Параллельные subagents — только read-only набор; `run_subagent` у дочернего агента недоступен (без вложенности).

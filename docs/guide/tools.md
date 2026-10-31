# Tools и approvals

В режимах **Plan** и **Agent** модель вызывает builtin tools (openai-style function calling). Полная таблица — [справка](/reference/tools).

## Категории

| Категория | Примеры | Approval |
| --- | --- | --- |
| Чтение / поиск | `read_file`, `ls_dir`, `grep_search`, `glob_files`, `search_*`, `get_diagnostics`, LSP (`go_to_definition`, `find_references`, `search_symbols`), `get_chat_history` | не требуется |
| Планы | `create_plan`, `update_plan` | не требуется |
| Правки | `edit_file`, `rewrite_file`, `create_*`, `delete_*`, `rename_symbol` (`.pdf` — новый текстовый PDF; xlsx/docx/pptx — правка текста в том же файле, `rewrite_file` собирает новый простой файл) | edits |
| Терминал | `run_command`, persistent terminal | terminal |
| Сеть (только Agent) | `web_search`, `browse_url` | network |
| Браузер (только Agent) | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_screenshot` | browser |
| Память / subagents | `save_memory`, `run_subagent`, `run_parallel_subagents` | не требуется |
| MCP | `enable_mcp_server` + tools серверов | MCP tools |

## По режимам

- **Chat** — без builtin tools.
- **Plan** — read/search + `create_plan` / `update_plan` (без правок, терминала, web, браузера, memory, subagents, MCP).
- **Agent** — все builtin кроме `create_plan`; MCP после deferred enable. `update_plan` только во время «Сделать по плану» (build утверждённого плана).

Соседние read-only tools из одного ответа выполняются параллельно. Правки, терминал, браузер, MCP, планы, web и subagents — по одному.

## Memories, subagents, web

- **`save_memory`** — короткий долгоживущий факт (decision / preference / context) в workspace.
- **`run_subagent`** — изолированный дочерний агент; в prompt нужно передать весь контекст. Таймаут до 10 мин; Stop родителя прерывает раньше.
- **`run_parallel_subagents`** — до 4 read-only исследований параллельно (без правок и сети).
- **`web_search` / `browse_url`** — публичный интернет; см. [Приватность](/guide/privacy).
- **Браузер** — видимая панель. Кнопка слева от Terminal открывает её без агента. В Agent в system info есть список уже открытых вкладок (title, url, page id). `browser_navigate` открывает новый http(s), включая localhost. Чтобы работать с уже открытой вкладкой — `browser_snapshot` (с `page_id` или без, для активной); дальше `browser_click` / `browser_type` / `browser_scroll` по `ref`. `browser_screenshot` показывает картинку в чате.

## Approve / Reject

Перед действием с типом approval IDE показывает запрос (если auto-approve выключен). Можно одобрить один вызов, отклонить или включить auto-approve в Settings → Tools.

**Дефолты Sapphire:** `edits`, `terminal`, `MCP tools`, `network` и `browser` — auto-approve **выключены**.

## Политика для корпоративного использования

Оставляйте ручной approve на **terminal**, **браузер** и **MCP**. `web_search` и `browse_url` ходят в публичную сеть и ждут approval `network`.

Настройка MCP-серверов: [Settings → MCP](/guide/settings#mcp).

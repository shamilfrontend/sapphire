# Tools и approvals

В режимах **Plan**, **Agent** и **Debug** модель вызывает builtin tools (openai-style function calling). Полная таблица — [справка](/reference/tools).

## Категории

| Категория | Примеры | Approval |
| --- | --- | --- |
| Чтение / поиск | `read_file`, `ls_dir`, `grep_search`, `glob_files`, `search_*`, `get_diagnostics`, LSP (`go_to_definition`, `find_references`, `search_symbols`), `get_chat_history` | не требуется |
| Планы | `create_plan`, `update_plan` | не требуется |
| Правки | `edit_file`, `rewrite_file`, `create_*`, `delete_*`, `rename_symbol` | edits |
| Терминал | `run_command`, persistent terminal | terminal |
| Сеть (только Agent/Debug) | `web_search`, `browse_url` | не требуется (трафик вне шлюза) |
| Память / subagents | `save_memory`, `run_subagent`, `run_parallel_subagents` | не требуется |
| MCP | `enable_mcp_server` + tools серверов | MCP tools |

## По режимам

- **Chat** — без builtin tools.
- **Plan** — read/search + `create_plan` / `update_plan` (без правок, терминала, web, memory, subagents, MCP).
- **Agent / Debug** — все builtin кроме `create_plan`; MCP после deferred enable. `update_plan` только во время «Сделать по плану» (build утверждённого плана).

Соседние read-only tools из одного ответа выполняются параллельно. Правки, терминал, MCP, планы, web и subagents — по одному.

## Memories, subagents, web

- **`save_memory`** — короткий долгоживущий факт (decision / preference / context) в workspace.
- **`run_subagent`** — изолированный дочерний агент; в prompt нужно передать весь контекст. Таймаут до 10 мин; Stop родителя прерывает раньше.
- **`run_parallel_subagents`** — до 4 read-only исследований параллельно (без правок и сети).
- **`web_search` / `browse_url`** — публичный интернет; см. [Приватность](/guide/privacy).

## Approve / Reject

Перед действием с типом approval IDE показывает запрос (если auto-approve выключен). Можно одобрить один вызов, отклонить или включить auto-approve в Settings → Tools.

**Дефолты Sapphire:** `edits` — auto-approve **включён**; `terminal` и `MCP tools` — **выключены**.

## Политика для корпоративного использования

Оставляйте ручной approve на **terminal** и **MCP**. Учитывайте, что web-tools ходят наружу даже без отдельного approve.

Настройка MCP-серверов: [Settings → MCP](/guide/settings#mcp).

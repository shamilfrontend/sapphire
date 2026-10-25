# Добавление builtin tool

Builtin tools объявляются в `common/prompt/prompts.ts` и исполняются в `browser/toolsService.ts`. Цикл агента — `browser/chatThreadAgentLoop.ts`.

## Шаги

1. **Типы** — `BuiltinToolCallParams` / `BuiltinToolResultType` в `toolsServiceTypes.ts`.
2. **`builtinTools`** в `prompts.ts` — `name`, `description`, `params`.
3. **`approvalTypeOfBuiltinToolName`** — для опасных (`edits` / `terminal`); иначе tool попадает в read-only Plan (если не в `AGENT_ONLY_BUILTIN_TOOLS` и не plan/MCP-специфичный).
4. **Agent-only** — при необходимости добавьте имя в `AGENT_ONLY_BUILTIN_TOOLS` (сейчас: web, memory, subagents).
5. **`toolsService.ts`** — validate + execute (или обработка в agent loop для subagents).
6. **Промпт** — при необходимости system / tool-calling instructions.
7. **Документация** — строка в [`reference/tools.md`](/reference/tools).
8. **Проверка** — Plan без edit/terminal/web; Agent — approvals и deferred MCP.

## Режимы и availableTools

```ts
// упрощённо из availableTools()
normal  → нет builtin tools
plan    → read/search (без AGENT_ONLY) + create_plan + update_plan
agent → все builtin кроме create_plan
            + update_plan только если allowUpdatePlan (build плана)
            + enable_mcp_server если есть online MCP
            + MCP tools только для enabledMcpServerNames
```

Subagent не получает `run_subagent` / `run_parallel_subagents` (`excludedToolNames`). Параллельные subagents ограничены `READ_ONLY_SUBAGENT_TOOLS`.

## OpenAI-style tools

Tools уходят на шлюз как function calling (`tool_calls`). Отдельного grammar/XML-канала нет.

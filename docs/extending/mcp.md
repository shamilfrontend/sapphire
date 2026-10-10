# MCP-серверы (для разработчиков)

Пользовательская настройка: [Settings → MCP](/guide/settings#mcp).

## Код

| Файл | Роль |
| --- | --- |
| `common/mcpService.ts` (и связанные) | фасад настроек/состояния |
| `electron-main/mcpChannel.ts` | запуск MCP на main |
| `common/prompt/mcpToolDisclosure.ts` | deferred enable / фильтр схем |
| `prompts.ts` → `availableTools` | MCP для `agent` и `debug` (`isAgentLike`) |

## Deferred enable

`availableTools` отдаёт `enable_mcp_server` (если есть online MCP) и только tools серверов из `enabledMcpServerNames` треда. Полные JSON-схемы остальных серверов в контекст не кладутся, пока модель их не enable’ит.

## Добавить сервер для команды

1. Опишите MCP server в конфиге (команда, args, env).
2. Убедитесь, что процесс стартует в корпоративном окружении (VPN, бинарники).
3. В Agent или Debug проверьте: каталог → `enable_mcp_server` → tool виден и проходит approval.
4. Задокументируйте во внутреннем runbook (секреты не коммитить).

## Безопасность

MCP может выполнять произвольные действия от имени пользователя. Для prod оставляйте manual approve на MCP tools.

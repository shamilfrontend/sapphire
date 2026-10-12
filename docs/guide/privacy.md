# Приватность

## Куда уходит LLM-трафик

Чат, Agent, Tab, Ctrl+K, Apply, SCM и LLM-purpose индекса идут **на endpoint выбранного провайдера** (облачный API или локальный сервер). Другие провайдеры из этого запроса не вызываются.

В ядре отключены:

- телеметрия Sapphire / PostHog;
- phone-home проверки обновлений на GitHub / voideditor.com.

## Отдельный канал: web-tools

В Agent/Debug builtin tools **`web_search`** и **`browse_url`** ходят в **публичный интернет**, не через LLM API. Запросы и содержимое страниц уходят на внешние хосты. Отдельного approve на эти tools нет — контролируйте режим и промпт.

## Что на совести разработчика

**Marketplace-расширения** и **MCP** (stdio, Playwright, Figma и т.п.) IDE не цензурирует. Вы сами выбираете, что ставить и куда подключаться.

## Связанное

- [Модели и провайдеры](/intro/models)
- [Tools](/guide/tools)
- [Settings → MCP](/guide/settings#mcp)
- [Settings](/guide/settings)

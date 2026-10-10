# LLM-шлюз: устарело

Страница описывала интеграцию с корпоративным шлюзом. Этот шлюз удалён. Запросы идут на endpoint выбранного провайдера. Retry, usage и заголовки остались в OpenAI-совместимом клиенте.

Связанное: [Модели и провайдеры](/intro/models), [Ключ и ошибки](/intro/token-and-errors).

Ключевые файлы клиента: `llmProviderConfig.ts`, `sendLLMMessage.impl.ts`, `sendAnthropic.ts`, `sendGemini.ts`, `modelCapabilities.ts`.

## Не делать без явной боли

- GLiNER redaction «на всякий случай»
- Свой HTTP-клиент вместо OpenAI SDK

# Модели и провайдеры

Sapphire ходит в провайдера, которого вы выбрали в онбординге или в **Settings → Провайдеры**.

OpenAI-совместимые провайдеры (OpenAI, DeepSeek, Groq, OpenRouter, xAI, Mistral, Ollama, vLLM, LM Studio, LiteLLM, Vertex, Azure, Bedrock и свой endpoint) используют один клиент Chat Completions. Anthropic и Gemini — отдельные API.

## DeepSeek

- Чат: `https://api.deepseek.com/v1`
- Модели по умолчанию: `deepseek-chat`, `deepseek-reasoner` (`reasoning_content`)
- Ключ и расход: [platform.deepseek.com/usage](https://platform.deepseek.com/usage)

Endpoint чата пользователь не правит: для DeepSeek он задан в коде. Вводится API-ключ.

## Список моделей

`GET /v1/models` (или аналог у Anthropic и Gemini) мержится со списком по умолчанию провайдера. Capabilities — в `modelCapabilities.ts`.

Картинки в чат уходят только если у выбранной chat-модели `supportsVision`. Tab-автодополнение доступно моделям с `supportsFIM`.

## Хранение ключа

Ключ валидируется запросом списка моделей и хранится через `IEncryptionService`.

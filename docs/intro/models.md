# Модели и провайдеры

Sapphire ходит в провайдера, которого вы выбрали в онбординге или в **Settings → Провайдеры**.

OpenAI-совместимые провайдеры (OpenAI, DeepSeek, Kimi, Groq, OpenRouter, xAI, Mistral, Ollama, vLLM, LM Studio, LiteLLM, Vertex, Azure, Bedrock и свой endpoint) используют один клиент Chat Completions. Anthropic и Gemini — отдельные API.

## DeepSeek

- Чат: `https://api.deepseek.com/v1`
- Ключ и расход: [platform.deepseek.com/usage](https://platform.deepseek.com/usage)

Endpoint чата пользователь не правит: для DeepSeek он задан в коде. Вводится API-ключ.

В запросе уходит API id; в пикере и Settings показывается версия из `displayName` в `modelCapabilities.ts`.

| API id | Версия сейчас |
| --- | --- |
| `deepseek-flash` | DeepSeek V4.1 Flash 1017 |
| `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` | то же (legacy-алиасы) |
| `deepseek-v4-pro` | DeepSeek V4 Pro |
| `deepseek-chat`, `deepseek-reasoner` | старые id без отдельной подписи версии |

Когда DeepSeek сменит чекпоинт за `deepseek-flash`, обновите `displayName` в каталоге.

## Kimi

- Чат: `https://api.moonshot.ai/v1`
- Ключ и расход: [platform.kimi.ai](https://platform.kimi.ai)

Endpoint чата пользователь не правит: для Kimi он задан в коде. Вводится API-ключ.

Список моделей в пикере берётся из `GET /v1/models` по ключу, а не из зашитого набора. Capabilities известных id (`kimi-k3`, `kimi-k3.1-pro`, `kimi-k3.1-pro-highspeed`, `kimi-k2.6`, `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`) — в `modelCapabilities.ts`.

## Auto

В пикере Chat сверху списка есть **Auto** — баланс качества и скорости.

- Пул: все **включённые** провайдеры и **видимые** модели (DeepSeek, Kimi и остальные).
- Если доступна одна модель — она используется сразу, без лишнего запроса.
- Если моделей несколько — сильная модель (большой `contextWindow`) коротко оценивает задачу и выбирает конкретную модель из списка.
- Выбор фиксируется на весь прогон агента; на новое сообщение пользователя роутинг повторяется.
- Если роутер не ответил или вернул неизвестный id — берётся лучшая «сильная» модель из пула.

Auto только для чата. Ctrl+K, Apply, SCM и автодополнение по-прежнему выбираются вручную.

Схема для разработчиков: [architecture/auto-mode.md](../architecture/auto-mode.md).

## Список моделей

`GET /v1/models` (или аналог у Anthropic и Gemini) мержится со списком по умолчанию провайдера. Capabilities — в `modelCapabilities.ts`.

Картинки в чат уходят только если у выбранной chat-модели `supportsVision`. Tab-автодополнение доступно моделям с `supportsFIM`.

## Хранение ключа

Ключ валидируется запросом списка моделей и хранится через `IEncryptionService`.

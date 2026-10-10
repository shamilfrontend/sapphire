# Добавление и настройка моделей

Список в UI мержит два источника (`sapphireSettingsService`):

| Источник | Тип | Откуда |
| --- | --- | --- |
| каталог провайдера | `autodetected` | `refreshModelService` (`GET /v1/models` или аналог Anthropic/Gemini) |
| `defaultModelsOfProvider` | `default` | хардкод в `modelCapabilities.ts` |

Новая модель с API появляется сама. Без записи в `modelCapabilities.ts` она получает fallback по имени.

## Чеклист

1. Модель есть в каталоге провайдера. Уточнить function calling, FIM, reasoning, vision и размер контекста.
2. Добавить id в `defaultModelsOfProvider` нужного провайдера, если она должна быть в дефолтном списке.
3. Запись capabilities в `modelOptions` этого провайдера.
4. Документация — `docs/intro/models.md`, если меняется дефолт DeepSeek или общий список.
5. Проверка — Chat, Agent tool call, Ctrl+K, Tab (если FIM), SCM.

Уже сохранённый state может держать старый id, пока его не скроют в Settings.

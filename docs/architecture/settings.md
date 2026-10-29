# Settings model

Состояние настроек держит **`sapphireSettingsService`** — неявная зависимость почти всех AI-сервисов.

## Термины

| Термин | Смысл |
| --- | --- |
| **FeatureName** | `Autocomplete` \| `Chat` \| `Ctrl+K` \| `Apply` \| `SCM` |
| **ModelSelection** | пара `{ providerName, modelName }` |
| **ProviderName** | ключ провайдера: `openAI`, `deepseek`, `anthropic`, … |
| **ModelName** | ID модели, напр. `deepseek-chat` |
| **ChatMode** | `normal` \| `plan` \| `agent` |
| **LayoutMode** | `ide` \| `agents` |
| **RefreshProvider** | провайдер, у которого обновляют список моделей |

## GlobalSettings

| Поле | Дефолт | Смысл |
| --- | --- | --- |
| `layoutMode` | `ide` | Режим IDE / Режим Агент |
| `autoApprove.edits` | `true` | Auto-approve правок |
| `autoApprove.terminal` / `MCP tools` | `false` | Ручной approve |
| `autoAttachActiveFile` | `true` | Активный файл в SELECTIONS |
| `autoRetrieveRelevantFiles` | `true` | Heuristic pre-retrieval |
| `projectIndexEnabled` / `IncludeOffice` / `LlmPurpose` | `true` | Индекс `.sapphire/index` |

## Провайдеры

Список и endpoint — `modelCapabilities.ts` и `llmProviderConfig.ts`.  
Видимость — `sapphireSettingsTypes.ts` (`providerNames`).  
Авто-refresh моделей — `refreshModelService.ts`.

## Persistence

Настройки персистятся через сервисы Sapphire; API key — через encryption service, не plain-text.

UI: `browser/vue/.../Settings.vue`. Action: `workbench.action.openSapphireSettings`.

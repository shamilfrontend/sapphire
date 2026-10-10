# Карта ключевых файлов

Файлы, которые чаще всего трогают при кастомизации Sapphire (пути относительно `src/vs/workbench/contrib/sapphire/`):

| Файл | Зачем |
| --- | --- |
| `common/llmProviderConfig.ts` | endpoint провайдеров и тексты ошибок |
| `common/modelCapabilities.ts` | capabilities моделей |
| `common/sapphireSettingsTypes.ts` | `providerNames`, дефолты, LayoutMode |
| `common/sapphireSettingsService.ts` | состояние настроек |
| `common/refreshModelService.ts` | refresh моделей при смене токена |
| `common/prompt/prompts.ts` | tools + промпты + `availableTools` |
| `common/prompt/mcpToolDisclosure.ts` | deferred MCP enable |
| `browser/toolsService.ts` | исполнение tools (web, memory, …) |
| `common/memoriesService.ts` | persist `save_memory` |
| `browser/chatThreadAgentLoop.ts` | цикл агента, subagents, MCP enable |
| `browser/chatThreadCheckpoints.ts` | checkpoints |
| `browser/chatThreadService.ts` | треды (фасад) |
| `common/office/officeDocument.ts` | лимиты офисных файлов |
| `common/officeExtractService.ts` | клиент разбора xlsx/docx/pptx/pdf |
| `node/office/extractOfficeBuffer.ts` | разбор ZIP и PDF |
| `browser/projectIndexService.ts` | фоновый индекс `.sapphire/index` |
| `common/projectIndex/*` | типы, analyze, search индекса |
| `browser/editCodeService.ts` | Apply / Ctrl+K / diffs |
| `browser/autocompleteService.ts` | Tab FIM |
| `browser/sapphireAgentsWindowService.ts` | оверлей Режим Агент |
| `common/jira/*` | URL Jira/Confluence + мост |
| `electron-main/llmMessage/sendLLMMessage.impl.ts` | HTTP-клиент Transitcard |
| `electron-main/mcpChannel.ts` | MCP на main |
| `browser/vue/.../SapphireOnboarding.vue` | онбординг |
| `browser/vue/.../Settings.vue` | Settings UI |
| `browser/vue/.../agents-window-tsx/` | UI Режима Агент |
| `browser/sapphire.contribution.ts` | регистрация контрибуции |
| `product.json` (корень репо) | trusted domains и branding |

Upstream: [Contribute → Upstream](/contribute/upstream).

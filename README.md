# Sapphire

IDE-редактор кода на базе VS Code. Чат, агент и автодополнение идут в выбранного провайдера: OpenAI, Anthropic, Gemini, DeepSeek, Groq, OpenRouter, xAI, Mistral, Ollama, vLLM, LM Studio, LiteLLM, Vertex, Azure, Bedrock или свой OpenAI-совместимый endpoint.

DeepSeek: API `https://api.deepseek.com`, ключ и расход — [platform.deepseek.com/usage](https://platform.deepseek.com/usage).

- **Agent-режим** — AI с полным доступом к файлам и терминалу, function calling.
- **Plan-режим** — исследование и план (`.sapphire/plans/`) без правок кода, затем Build → Agent.
- **Tab autocomplete** — inline-подсказки FIM через `POST /v1/completions`.
- **Inline Edit (Ctrl/Cmd+K)** — правка выделения на месте со стримингом и accept/reject diff.
- **Apply** — прогон крупных изменений (Search/Replace блоки, fast/slow-apply).
- **SCM** — генерация commit-сообщений.
- **Codebase search** — `@`-упоминания, heuristic, индекс `.sapphire/index` + tools (`search_*`, `grep_search`, `read_file`, …) в Plan/Agent/Debug.
- **Режим Агент** — полноэкранный layout рядом с классическим IDE.

## Модели

У каждого провайдера свой список по умолчанию (`modelCapabilities.ts`). Ответ `GET /v1/models` (у Anthropic и Gemini — их каталоги) мержится с ним. Capabilities неизвестных id подбираются по имени.

У DeepSeek по умолчанию `deepseek-chat` и `deepseek-reasoner`.

## Ключ

- **Онбординг**: выбор провайдера, ключ или endpoint, проверка списком моделей, затем выбор layout.
- **Смена**: `Settings → Провайдеры`. Ключ хранится зашифрованно (`IEncryptionService`).
- **Ошибки**: 401 — обновить ключ; 408 и 429 — повторить позже; сеть — проверить адрес API.

## Что остаётся от редактора

- **Agent** читает и ищет файлы, правит код и запускает команды (с политиками одобрения).
- **Tab** показывает inline-подсказку, если у модели есть FIM.
- **Ctrl/Cmd+K** меняет выделение со стримингом и accept/reject diff.
- **Codebase search** в Plan/Agent находит файлы через tools и `@mentions`.

## Документация

Полная документация (VitePress) — папка [`docs/`](docs/): возможности редактора, архитектура, как улучшать.

- [Changelog](docs/CHANGELOG.md) — продуктовые срезы с форка

```bash
cd docs && npm install && npm run docs:dev
# или из корня после установки зависимостей docs:
npm run docs:dev
```

## Разработка

Форк основан на upstream [`voideditor/void@b3166e7`](https://github.com/voideditor/void/commit/b3166e7ef2aefbdfeb139445fdf248a561b85d4d) (см. [`docs/contribute/upstream.md`](docs/contribute/upstream.md)). Дальнейшая работа ведётся здесь; cherry-pick из upstream — по необходимости.

### Сборка

Общие шаги как у VS Code / Void. Сначала зависимости:

```bash
npm install
```

#### Dev mode

Для ежедневной разработки:

```bash
npm run dev            # watch + watchvue + запуск приложения
```

`npm run compile` / `npm run build:task -- compile-client` / packaging (`npm run build:task -- vscode-*`) сами вызывают **build-react** перед компиляцией TS — отдельный `buildvue` для полной сборки не нужен.

По отдельности: `npm run watch`, `npm run watchvue`, `./scripts/code.sh` (или `npm run code`). Для итераций только по Vue UI удобен `npm run watchvue`.

#### Production (executable)

Локальная упаковка приложения под платформу (долго, ~25 мин):

| ОС                  | Команда                            |
| ------------------- | ---------------------------------- |
| macOS Apple Silicon | `npm run build:task -- vscode-darwin-arm64` |
| macOS Intel         | `npm run build:task -- vscode-darwin-x64`   |
| Windows x64         | `npm run build:task -- vscode-win32-x64`    |
| Linux x64           | `npm run build:task -- vscode-linux-x64`    |

Артефакт появится рядом с репозиторием, например `../VSCode-darwin-arm64/`.

Подробности — в [`docs/contribute/packaging.md`](docs/contribute/packaging.md), [`docs/contribute/dev-setup.md`](docs/contribute/dev-setup.md) и [`docs/architecture/layout.md`](docs/architecture/layout.md).

### Ключевые файлы кастомизации

- [`src/vs/workbench/contrib/sapphire/common/llmProviderConfig.ts`](src/vs/workbench/contrib/sapphire/common/llmProviderConfig.ts) — base URL провайдеров, в том числе DeepSeek, и тексты ошибок.
- [`src/vs/workbench/contrib/sapphire/common/modelCapabilities.ts`](src/vs/workbench/contrib/sapphire/common/modelCapabilities.ts) — реестр провайдеров и capabilities моделей.
- [`src/vs/workbench/contrib/sapphire/common/sapphireSettingsTypes.ts`](src/vs/workbench/contrib/sapphire/common/sapphireSettingsTypes.ts) — `providerNames`, дефолтные настройки.
- [`src/vs/workbench/contrib/sapphire/electron-main/llmMessage/sendLLMMessage.impl.ts`](src/vs/workbench/contrib/sapphire/electron-main/llmMessage/sendLLMMessage.impl.ts) — OpenAI-совместимый клиент; Anthropic и Gemini рядом.
- [`src/vs/workbench/contrib/sapphire/common/refreshModelService.ts`](src/vs/workbench/contrib/sapphire/common/refreshModelService.ts) — авто-refresh моделей при смене ключа.
- [`src/vs/workbench/contrib/sapphire/browser/vue/src/void-onboarding/SapphireOnboarding.vue`](src/vs/workbench/contrib/sapphire/browser/vue/src/void-onboarding/SapphireOnboarding.vue) — экран онбординга.
- [`src/vs/workbench/contrib/sapphire/browser/vue/src/void-settings-tsx/Settings.vue`](src/vs/workbench/contrib/sapphire/browser/vue/src/void-settings-tsx/Settings.vue) — Settings, секция провайдеров.

## Лицензия

MIT (наследуется от Sapphire / VS Code). См. [`LICENSE.txt`](LICENSE.txt) и [`LICENSE-VS-Code.txt`](LICENSE-VS-Code.txt).

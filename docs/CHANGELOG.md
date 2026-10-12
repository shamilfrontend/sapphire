# Changelog

Продуктовые срезы Sapphire с форка. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/). Даты вместо semver: `voidVersion` в `product.json` — версия upstream Void, не продукта.

## [Unreleased]

### Changed

- Документация VitePress синхронизирована с кодом: полный каталог tools, MCP+Debug, privacy/web, Layout Agents, сжатый Roadmap

## [2026-10-05]

### Added

- Чтение офисных файлов в чате и в `read_file`: `.xlsx` / `.xlsm`, `.docx`, `.pptx`, `.pdf` превращаются в текст (листы, абзацы, слайды, страницы). Старые `.doc` / `.xls` / `.ppt` и сканы PDF без текстового слоя не разбираются; руководство — [Офисные файлы](/guide/office)
- Скорость генерации в чате: приблизительные ток/с рядом с «Думаю» и точное значение из `completion_tokens` в строке usage под ответом
- Лимит одного запуска агента: не больше 25 LLM-шагов; третий подряд одинаковый набор tool calls не исполняется. Остановка — сообщение в чате, следующий запрос пользователя продолжает с нуля
- `edit_file`: уникальный SEARCH/REPLACE с допуском на перевод строки и краевые пробелы; если ORIGINAL не найден, ошибка содержит фрагмент файла
- Соседние read-only tools из одного ответа модели выполняются параллельно; правки, терминал, MCP и планы остаются по одному
- Откат checkpoint восстанавливает файл, который агент не менял, к тексту до первой ручной правки
- Heuristic pre-retrieval: при отправке сообщения без достаточных `@` автоматически ищет до 3 файлов в workspace и кладёт в SELECTIONS (чип «Найдено», настройка `autoRetrieveRelevantFiles`; без embeddings / изменений шлюза)
- Гибридный индекс проекта в `.sapphire/index/`: фоновый разбор (код через DocumentSymbol, office/csv), LLM-purpose, tool `search_project_index`, статус и модалка в композере Агента, команда Reindex; схема пайплайна — [Индекс проекта](/architecture/project-index)

### Changed

- Крупные модули Sapphire разрезаны без смены публичных импортов: FIM-хелперы autocomplete, `inputs.tsx`, вкладки Settings, diff-зоны Apply/Ctrl+K, цикл агента и checkpoints чата
- Второй проход сплита: очередь, codespan-ссылки, библиотека тредов и staging вынесены из `chatThreadService`; persist DiffZones, writeover, search/replace и accept/reject — из `editCodeService`. Публичные импорты прежние
- Промпт Plan/Agent разрешает несколько read-only tools в одном ответе. Если тред не влезает в окно, старые результаты tools на отправке заменяются коротким пересказом; история в чате не меняется

### Removed

- Неиспользуемый разбор тегов `<think>` и недостижимые ветки чужих провайдеров внутри клиента шлюза. В runtime по-прежнему только `transitcard`
- Выключенные чипы недавних файлов в чате и неиспользуемое действие обновления `reinstall`
- UI «Карта проекта» (панель в Агенте, editor, команда Open Project Map)

## [2026-09-20]

### Added

- Авто-вложение содержимого активного файла в чат (чип «Активный», × на сообщение, настройка в Settings)
- Unit-тесты `estimateTokens`, EMA-калибратора, политики trim контекста и `pathLabels`
- Редактор `.plan.md` с переключателем Просмотр / Markdown (превью без YAML)
- Drag-and-drop файлов и изображений в панель чата
- Инструмент `get_chat_history`: сжатая история других вкладок чата (обзор или конкретный thread)
- Wrap-up после tools и скрытый nudge, если агент завершил инструменты без текста пользователю

### Changed

- Разбор `SidebarChat.tsx` на соседние модули: path helpers, composer, attachments, tool cards
- Плейсхолдеры поля ввода чата зависят от `supportsVision`
- Подписи категорий context meter на русском
- Иконки Terminal / Chat / Settings в title bar: заливка при открытой панели; Settings как toggled

### Fixed

- Плейсхолдер `(empty message)` больше не показывается в UI чата
- Чип «Активный» сбрасывается, когда нет открытого редактора
- Залитые иконки title bar через CSS masks; выравнивание активной шестерёнки Settings

## [2026-09-19]

### Added

- `usage` / `stream_options.include_usage`, явный `max_tokens`, заголовки `X-Request-Id` / `X-Feature`
- Vision gating по `supportsVision` (base64 data URL)
- Unicode-оценка токенов контекста и калибровка meter по `usage.prompt_tokens` (EMA)
- Persist idle DiffZones: Accept/Reject переживают reload IDE
- Ручные правки файлов в checkpoints; persist mapping URI для Apply
- Streaming Tab FIM: ghost text до полного completion
- Уникальные abbreviated paths в `@`-mentions, чипах вложений и markdown codespan

### Changed

- Context meter и trim считают те же поля, что уходят на шлюз; system вне весов trim
- Диапазоны live model в Apply/Ctrl+K читаются через `ITextModel.getValueInRange`
- Ctrl+K system prompt сжат до четырёх правил

### Fixed

- Agent loading-state и interrupt/steer при параллельных tool/LLM циклах
- Autocomplete: баланс скобок, whole-line, postprocess

### Removed

- Мёртвый флаг `wasAddedAsCurrentFile` и подпись «Текущий файл» на чипах

## [2026-09-16]

### Added

- Parallel `tool_calls` со шлюза: аккумуляция по `index`, sequential execute, round-trip в истории

### Removed

- Остатки multi-provider алиасов в клиентском пути

## [2026-09-15]

### Added

- Lock-in на `transitcard`: сторонние LLM-бренды скрыты из UI и runtime
- Каталог моделей синхронизирован со шлюзом: `qwen3.8-27b` вместо `qwen3.5-35B`

### Removed

- Мёртвые пути Sapphire: XML tools, no-op metrics, leftover single-provider wiring

## [2026-09-13]

### Added

- Plan-режим, вкладки чата, Mermaid; режим Gather убран
- Privacy: без PostHog и GitHub updates; LLM только на корпоративный шлюз
- Retry 408/429 с уважением `Retry-After`
- Settings: вкладки Rules и Skills, team defaults

### Changed

- Чат: акценты режимов, reasoning на языке сообщения пользователя
- Settings упрощены вокруг transitcard; MCP URL hardened

### Fixed

- Зависания терминала агента, Stop/timeouts
- Дубли моделей в dropdown чата
- Запись файлов агентом

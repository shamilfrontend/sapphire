# Чат (Ctrl+L)

Боковая панель чата (или композер в [Режиме Агент](/guide/agents-layout)) — основной интерфейс общения с моделью.

## Открытие

| Платформа | Сочетание |
| --- | --- |
| macOS | <kbd>Cmd</kbd>+<kbd>L</kbd> |
| Windows / Linux | <kbd>Ctrl</kbd>+<kbd>L</kbd> |

Выделение в редакторе можно добавить в контекст (staging). <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> — новый чат (вкладка).

## Вкладки и треды

В шапке сайдбара — горизонтальные **вкладки** открытых чатов:

- **+** — новый чат
- **X** на вкладке — закрыть вкладку (чат остаётся в истории)
- иконка истории — список прошлых чатов
- в Режиме Агент — дерево папок и pinned-чаты

История и открытые вкладки персистятся между сессиями.

## Что умеет чат

- Отвечать с учётом прикреплённого контекста (`@`, активный файл, heuristic «Найдено»)
- Режимы **Chat / Plan / Agent / Debug** — см. [режимы](/guide/modes)
- Tools в Plan/Agent/Debug (поиск, правки, терминал, web, memory, subagents, MCP) — [tools](/guide/tools)
- Reasoning модели, если шлюз отдаёт `reasoning_content` и у модели включён reasoning
- Codeblock’и с **Apply**; в Plan — карточка плана «Сделать по плану»
- Картинки (paste/attach) при `supportsVision` — [Vision](/architecture/chat-image-attach)
- Drag-and-drop файлов и изображений в панель
- Скорость генерации: приблизительные ток/с рядом с «Думаю» и точное значение из `completion_tokens` в usage под ответом
- Лимит запуска агента: 25 LLM-шагов; см. [режимы](/guide/modes)

Подробнее: [контекст](/guide/context), [Apply](/guide/apply).

## Settings из чата

Настройки Sapphire: `workbench.action.openSapphireSettings` (Command Palette / шестерёнка). Новый чат и история — в полоске вкладок или дереве Режима Агент.

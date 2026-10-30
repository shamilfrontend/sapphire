# Checkpoints и треды

## Chat threads

`chatThreadService` — фасад тредов. Логика checkpoints вынесена в `chatThreadCheckpoints.ts`, цикл агента — в `chatThreadAgentLoop.ts`.

В состоянии треда:

- список тредов и сообщения;
- staging selections;
- состояние tool calls;
- checkpoints, привязанные к индексам сообщений;
- `applyBoxState` — mapping `applyBoxId → URI` для кнопок Apply (переживает remount сайдбара).

UI: `SidebarThreadSelector.tsx`, `SidebarChat.tsx`, `agents-window-tsx/`.

## Checkpoints

Перед/после применения LLM-правок делаются снимки затронутых файлов. Jump восстанавливает файлы к состоянию **до** выбранного сообщения (`jumpToCheckpointBeforeMessageIdx`).

Типы checkpoint:

- `tool_edit` — перед `edit_file` / `rewrite_file` (один URI, состояние до правки); для `.pdf` в snapshot кладутся байты (`sapphire-pdf-b64:…`), откат пишет файл через `IFileService`;
- `user_edit` — после завершения/abort агента: все URI из истории checkpoints, у которых контент изменился, **плюс** файлы, которые пользователь правил вручную вне agent history (`onDidUserChangeContent` → LRU → `_computeNewCheckpointInfo`).

Это отдельный механизм от git — удобен для итераций Agent внутри IDE.

## applyBoxState

`thread.state.applyBoxState[applyBoxId] = { uri }` пишется при Apply и чистится на Accept/Reject / truncate истории.

## Pending DiffZones (после reload)

Idle DiffZones персистятся отдельно (`void.pendingDiffZones`, workspace storage) как `SapphireFileSnapshot` без CtrlK. На старте `editCodeService` rehydrate’ит зоны через `restoreVoidFileSnapshot`, если текущий текст файла совпадает с `entireFileCode`; при drift entry сбрасывается. Mid-stream не пишется. Command bar / Accept/Reject снова активны после reload.

## Типы

См. `chatThreadServiceTypes.ts` (`CheckpointEntry`, `StagingSelectionItem`, типы сообщений).

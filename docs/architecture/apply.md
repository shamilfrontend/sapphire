# Apply / DiffZone

Все визуальные правки кода (Apply, Ctrl+K, tool edit) сходятся в **`editCodeService`**.

## Термины

- **DiffArea** — диапазон строк, который отслеживается.
- **DiffZone** — DiffArea, которая умеет **стримить** и хранит `llmCancelToken`.
- **Diff** — red/green отображение изменений внутри зоны.
- **CtrlKZone** — уменьшенная зона для inline edit.

При любом изменении файла зоны на нём пересчитывают diffs.

## Сценарии

| Сценарий             | Зона                           |
| -------------------- | ------------------------------ |
| Apply на файл        | DiffZone на весь файл          |
| Ctrl+K               | DiffZone на выделение          |
| Agent `edit_file`    | по сути Apply (Search/Replace) |
| Agent `rewrite_file` | Slow Apply / полная перезапись |

## Fast vs Slow

- **Fast** — LLM пишет Search/Replace блоки; `editCodeService` применяет их. При ошибке find/overlap **завершённые** блоки кэшируются и ретрай просит только оставшиеся (не полный revert).
- **Slow** — LLM отдаёт полный новый текст файла.

## Запись в файлы

Писать в буфер можно зная только **URI** модели — без обязательного открытия вкладки. Обвязка URI/model — в `sapphireModelService`.

## Approval state

Сырые структуры `editCodeService` неудобны для UI. Отдельный derived state (command bar) агрегирует pending diffs по URI / hunks.

## Persistence после reload

Idle DiffZones сохраняются в `void.pendingDiffZones` (см. [checkpoints](/architecture/checkpoints#pending-diffzones-после-reload)). После reload Accept/Reject восстанавливаются, если содержимое файла не уехало от снимка. CtrlK UI и mid-stream не персистятся.

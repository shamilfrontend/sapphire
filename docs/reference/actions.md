# Action / keybinding IDs

IDs из `browser/actionIDs.ts` и связанных contribution. Пользователь может переназначить клавиши в Keyboard Shortcuts.

| ID | Назначение | Дефолт |
| --- | --- | --- |
| `void.ctrlLAction` | Открыть чат / добавить контекст | Ctrl/Cmd+L |
| `void.ctrlKAction` | Inline Edit | Ctrl/Cmd+K |
| `void.sidebar.open` | Открыть сайдбар ассистента | — |
| `void.maximizeChat` | Развернуть чат | — |
| `void.acceptDiff` | Accept hunk | — |
| `void.rejectDiff` | Reject hunk | — |
| `void.goToNextDiff` | Следующий hunk | — |
| `void.goToPrevDiff` | Предыдущий hunk | — |
| `void.goToNextUri` | Следующий файл с diff | — |
| `void.goToPrevUri` | Предыдущий файл с diff | — |
| `void.acceptFile` | Accept файл | — |
| `void.rejectFile` | Reject файл | — |
| `void.acceptAllDiffs` | Accept все | — |
| `void.rejectAllDiffs` | Reject все | — |
| `void.cmdShiftL` | Новый чат (вкладка) | Ctrl/Cmd+Shift+L |
| `void.historyAction` | История чатов | — |
| `workbench.action.openSapphireSettings` | Settings Sapphire | — |
| `void.sapphireCheckUpdate` | Проверка обновлений | — |
| `Sapphire: Reindex Workspace` | Переиндексировать `.sapphire/index` | — |

Связанные updater actions: `void.updater.*`. Режим Агент: contribution `workbench.contrib.sapphireAgentsWindow` / переключение `layoutMode`.

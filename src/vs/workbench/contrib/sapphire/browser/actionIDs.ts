// ID обычно держат в registrator-файлах, но тогда при импорте ловим порядок модулей
// (импорт тянет весь файл ради константы). Отдельный actionIDs — меньше сюрпризов.

export const SAPPHIRE_CTRL_L_ACTION_ID = 'sapphire.ctrlLAction';

export const SAPPHIRE_CTRL_K_ACTION_ID = 'sapphire.ctrlKAction';

export const SAPPHIRE_OPEN_SIDEBAR_ACTION_ID = 'sapphire.sidebar.open';

export const SAPPHIRE_CMD_SHIFT_L_ACTION_ID = 'sapphire.cmdShiftL';

export const SAPPHIRE_MAXIMIZE_CHAT_ACTION_ID = 'sapphire.maximizeChat';

export const SAPPHIRE_ACCEPT_DIFF_ACTION_ID = 'sapphire.acceptDiff';

export const SAPPHIRE_REJECT_DIFF_ACTION_ID = 'sapphire.rejectDiff';

export const SAPPHIRE_GOTO_NEXT_DIFF_ACTION_ID = 'sapphire.goToNextDiff';

export const SAPPHIRE_GOTO_PREV_DIFF_ACTION_ID = 'sapphire.goToPrevDiff';

export const SAPPHIRE_GOTO_NEXT_URI_ACTION_ID = 'sapphire.goToNextUri';

export const SAPPHIRE_GOTO_PREV_URI_ACTION_ID = 'sapphire.goToPrevUri';

export const SAPPHIRE_ACCEPT_FILE_ACTION_ID = 'sapphire.acceptFile';

export const SAPPHIRE_REJECT_FILE_ACTION_ID = 'sapphire.rejectFile';

export const SAPPHIRE_ACCEPT_ALL_DIFFS_ACTION_ID = 'sapphire.acceptAllDiffs';

export const SAPPHIRE_REJECT_ALL_DIFFS_ACTION_ID = 'sapphire.rejectAllDiffs';

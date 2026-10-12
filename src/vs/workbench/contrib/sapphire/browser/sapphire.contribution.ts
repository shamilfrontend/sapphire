/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// inline diff в редакторе
import './editCodeService.js';

// боковая панель, state, действия и Ctrl+L
import './sidebarActions.js';
import './sidebarPane.js';

// quick edit (Ctrl+K)
import './quickEditActions.js';

// автодополнение
import './autocompleteService.js';

// панель настроек
import './sapphireSettingsPane.js';

// редактор .plan.md (Preview / Markdown)
import './planEditor.js';

// стили void
import './media/sapphire.css';

// обновления (UI; main — platform/)
import './sapphireUpdateActions.js';

import './convertToLLMMessageWorkbenchContrib.js';

// гибридный индекс проекта (.sapphire/index) — до tools/heuristic
import './projectIndexService.js';

// инструменты агента
import './toolsService.js';
import './terminalToolService.js';
import '../common/memoriesService.js';

// эвристический поиск файлов
import './heuristicFileRetrieveService.js';

// история тредов чата
import './chatThreadService.js';

// вспомогательные сервисы
import './helperServices/consistentItemService.js';

// виджет выделения
import './sapphireSelectionHelperWidget.js';

// тултипы
import './tooltipService.js';

// онбординг
import './sapphireOnboardingService.js';

// Режим Агент overlay + titlebar switch
import './sapphireAgentsWindowService.js';

// прочие contribution
import './miscWokrbenchContrib.js';

// контекстное меню проводника (копировать prompt)
import './fileService.js';

// SCM: генерация сообщения коммита
import './sapphireSCMService.js';

// ---------- common (импорт для регистрации singleton при загрузке contribution) ----------

import '../common/sendLLMMessageService.js';

import '../common/sapphireSettingsService.js';

import '../common/refreshModelService.js';

import '../common/sapphireUpdateService.js';

import '../common/sapphireModelService.js';

// office (xlsx, docx, pptx, pdf) для чата и tools
import '../common/officeExtractService.js';

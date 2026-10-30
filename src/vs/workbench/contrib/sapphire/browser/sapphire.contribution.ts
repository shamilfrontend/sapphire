/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

// registerColor + theming participant для подсветки Accept/Reject diff
import '../common/helpers/colors.js';

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

// стили void и разовый переход профиля на тему Sapphire UI
import './media/sapphire.css';
import './sapphireCursorChrome.js';

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

// Кнопка браузера в title bar (слева от Terminal)
import './sapphireBrowserTitlebar.js';

// прочие contribution
import './miscWokrbenchContrib.js';

// один раз прячет Outline и Timeline в уже сохранённом профиле
import './sapphireExplorerViews.js';

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

// DNS egress checks for browse_url / web tools
import '../common/webEgressService.js';

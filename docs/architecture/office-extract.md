# Офисные файлы (архитектура)

Пользовательский обзор: [Руководство → Офисные файлы](/guide/office).

`.xlsx` / `.xlsm`, `.docx` и `.pptx` открываются вкладкой редактора Sapphire (сетка, абзацы, холст слайда). `.pdf` открывается встроенным custom editor в `extensions/media-preview` (webview + pdf.js). При вложении в чат, в Copy Prompt и в `read_file` / `search_in_file` байты разбираются в main-процессе, а в модель уходит ограниченный текст.

## Что попадает в контекст

| Формат     | Текст                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------- |
| xlsx, xlsm | имена листов, размер, строки. Даты из стандартных числовых форматов Excel. Если в ячейке есть формула, в текст попадает она, а не кэш. Макросы не исполняются |
| docx       | абзацы, заголовки, таблицы. Комментарии и правки не включаются                                    |
| pptx       | текст слайдов и заметки докладчика. Во вкладке картинки только для показа                          |
| pdf        | текст по страницам. Если текстового слоя нет, страницы-картинки распознаются локально (tesseract, rus+eng, не больше 10 страниц). Правка такого PDF через tools недоступна |

`.csv` и обычные текстовые файлы идут прежним путём. `.doc`, `.xls`, `.ppt` не читаются: в контекст кладётся короткая фраза, байты — нет. Для PDF есть запись текстового слоя / сборка нового текстового PDF. Для OOXML `edit_file` меняет текст в существующих узлах и перепаковывает zip через `yazl`, не трогая стили, картинки и `vbaProject.bin`. `rewrite_file` собирает новый простой пакет. См. [руководство](/guide/office#чтение-vs-запись).

## Лимиты

- Файл больше 25 МБ не разбирается и не правится.
- Оглавление (листы, число страниц или слайдов) есть на каждой странице `read_file`.
- Тело режется тем же `page_number`, что и у текстовых файлов (`MAX_FILE_CHARS_PAGE`).
- Во вложении к сообщению пользователя — только первая страница и пометка, что дальше можно дочитать через `read_file`.

## Где в коде (чтение)

Разбор не живёт в `prompts.ts`: этот файл импортируется из main-процесса. `yauzl` и `pdfjs-dist` подключаются в node-слое, renderer их не импортирует.

1. Расширение определяется в `common/office/officeDocument.ts`.
2. Renderer вызывает канал `sapphire-channel-officeExtract` (`common/officeExtractService.ts`).
3. Main читает путь с диска (`electron-main/officeExtractChannel.ts`) и разбирает буфер (`node/office/extractOfficeBuffer.ts`).
4. ZIP (xlsx, docx, pptx) читается через уже стоящий `yauzl`. Модель для вкладки и extract собирается в `node/office/readOfficeModel.ts`. PDF — через `pdfjs-dist`. Скан без текстового слоя: битмап страницы собирается в PNG (`pngjs`) и распознаётся `tesseract.js` (`node/office/ocrPdf.ts`, словари `tessdata/`). Оба импорта только из node-слоя, не из renderer. Результат extract кэшируется в канале по размеру и mtime. `textOrigin: 'ocr'` запрещает `editPdf` / `rewritePdf`.
5. `messageOfSelection` получает колбэк `extractOffice`, чтобы не тянуть IPC в общий модуль промптов. Тот же колбэк используют отправка чата, Copy Prompt и файлы внутри прикреплённой папки.

## Просмотр PDF

- Contribution: `extensions/media-preview` → `customEditors` `vscode.pdfPreview`, `*.pdf`, `priority: builtin`.
- Webview: `media/pdfPreview.js` + vendored `media/pdfjs/pdf.min.mjs` / `pdf.worker.min.mjs`.
- pdf.js работает в потоке страницы webview (`globalThis.pdfjsWorker`), без `Worker`: документ webview и `vscode-resource` на разных origin, и модульный worker зависал десятки секунд. Байты PDF передаются в `getDocument({ data })`. В HTML есть `modulepreload` обоих скриптов.
- После записи файла на диск watcher в `MediaPreview` перерисовывает вкладку.

## Запись PDF

Команды канала `editPdf` / `rewritePdf` (`electron-main/officeExtractChannel.ts` → `node/office/writePdfBuffer.ts`):

- `edit_file` — SEARCH/REPLACE по извлечённому тексту (как у обычных файлов), затем pdf-lib собирает новый текстовый PDF (Noto Sans с кириллицей в `node/office/fonts/`). Overlay на старый stream не используется: старые text operators остались бы в файле.
- `rewrite_file` — pdf-lib собирает новый многостраничный текстовый PDF из `new_content`.
- `toolsService` для `.pdf` не открывает текстовую модель. Для `.docx` / `.xlsx` / `.pptx` `edit_file` вызывает `editOffice` (`node/office/editOfficeText.ts` → `patchOfficeBuffer.ts`): SEARCH/REPLACE по тексту extract, затем замена только изменившихся узлов и перепаковка zip. `rewrite_file` вызывает `rewriteOfficeFromText`. Вкладка — `browser/officeEditor.ts`, тот же `patchOffice`, с проверкой size/mtime.
- Чекпоинт перед правкой хранит байты файла (`sapphire-office-b64:…` в snapshot, старые PDF-снимки `sapphire-pdf-b64:` тоже читаются); откат пишет байты обратно через `IFileService`.

Renderer **не** импортирует `pdfjs-dist` / `pdf-lib`.

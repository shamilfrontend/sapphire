# Частые ошибки

| Симптом                                           | Что проверить                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Не та версия Node                                 | `nvm use` по `.nvmrc`                                                                                   |
| Пробелы в пути к репо                             | перенести проект                                                                                        |
| `Failed to fetch dynamically imported module`     | импорты с суффиксом `.js`                                                                               |
| Ошибки React / OOM                                | `NODE_OPTIONS="--max-old-space-size=8192" npm run buildreact`                                           |
| Пропали стили                                     | подождать сборку Tailwind, Reload Window                                                                |
| `libtool: unrecognised option: '-static'` (macOS) | нужен GNU libtool, не BSD                                                                               |
| SUID sandbox helper                               | `sudo chown root:root .build/electron/chrome-sandbox && sudo chmod 4755 .build/electron/chrome-sandbox` |
| Ctrl+C оставил watch в фоне                       | в терминале watch используйте Ctrl+D; или `deemon --kill`                                               |

Подробный список upstream: [HOW_TO_CONTRIBUTE в Void](https://github.com/voideditor/void/blob/main/HOW_TO_CONTRIBUTE.md) и [VS Code How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute).

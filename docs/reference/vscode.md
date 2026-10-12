# VS Code wiki и ссылки

Sapphire наследует организацию исходников VS Code. Полезные материалы:

## Для новичков

- [VS Code UI guide](https://code.visualstudio.com/docs/getstarted/userinterface)
- [UX guidelines](https://code.visualstudio.com/api/ux-guidelines/overview)

## Для контрибьюторов

- [Source Code Organization](https://github.com/microsoft/vscode/wiki/Source-Code-Organization) — самое важное: entry points, `browser/` / `common/`
- [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute)
- [Theme colors](https://code.visualstudio.com/api/references/theme-color) — CSS `var(--vscode-…)`
- [Webview theming](https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content)

## Прочее

- [Built-in commands](https://code.visualstudio.com/api/references/commands)
- Репозиторий VS Code = исходники Monaco (`ITextModel`, editors)

Sapphire — форк редактора, а не расширение VS Code, поэтому Extension API обычно не нужен.

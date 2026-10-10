# Сборка и packaging

## Рекомендуемый путь

Для ежедневной разработки используйте **Developer Mode** (`npm run watch` + `./scripts/code.sh`). Локальный gulp-executable нужен редко и занимает ~25 минут.

## Локальный executable (не рекомендуется без нужды)

Сначала войдите в Developer Mode, затем:

| ОС                  | Команда                            |
| ------------------- | ---------------------------------- |
| macOS Apple Silicon | `npm run gulp vscode-darwin-arm64` |
| macOS Intel         | `npm run gulp vscode-darwin-x64`   |
| Windows x64         | `npm run gulp vscode-win32-x64`    |
| Linux x64           | `npm run gulp vscode-linux-x64`    |

Артефакт появится **рядом** с репозиторием, например `../VSCode-darwin-arm64/`.

## Дистрибуция

Upstream Sapphire собирался через отдельный [void-builder](https://github.com/voideditor/void-builder) (форк VSCodium Actions). Для внутреннего релиза Sapphire настройте свой pipeline по аналогии; детали брендинга — в `product.json`.

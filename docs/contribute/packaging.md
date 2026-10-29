# Сборка и packaging

## Рекомендуемый путь

Для ежедневной разработки используйте **Developer Mode** (`npm run watch` + `./scripts/code.sh`). Полная локальная сборка executable нужна редко и занимает ~25 минут.

## Локальный executable (не рекомендуется без нужды)

Сначала войдите в Developer Mode, затем:

| ОС                  | Команда                            |
| ------------------- | ---------------------------------- |
| macOS Apple Silicon | `npm run gulp vscode-darwin-arm64` |
| macOS Intel         | `npm run gulp vscode-darwin-x64`   |
| Windows x64         | `npm run gulp vscode-win32-x64`    |
| Linux x64           | `npm run gulp vscode-linux-x64`    |

Артефакт появится **рядом** с репозиторием, например `../VSCode-darwin-arm64/`.

## Slim packaging (Sapphire default)

Локальный `vscode-*` packaging для Sapphire:

- **не** кладёт built-in `extensions/copilot`, native `@github/copilot-sdk-*`, `mermaid-markdown-features`;
- **не** включает source maps (экономия ~300 МБ); для отладки: `VSCODE_KEEP_SOURCEMAPS=1 npm run gulp vscode-darwin-arm64`;
- **не** стартует upstream Agent Host (GitHub Copilot / Claude agent SDK);
- телеметрия выключена в `product.json` (`enableTelemetry: false`).

AI продукта — только `contrib/sapphire` + LLM SDK (`openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, MCP). Mermaid в чате/планах идёт через root dep `mermaid` и Vue `MermaidBlock`, не через `mermaid-markdown-features`.

## Дистрибуция

Upstream Sapphire собирался через отдельный [void-builder](https://github.com/voideditor/void-builder) (форк VSCodium Actions). Для внутреннего релиза Sapphire настройте свой pipeline по аналогии; детали брендинга — в `product.json`.

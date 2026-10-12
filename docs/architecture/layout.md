# Структура кода

Почти весь AI-код Sapphire лежит в:

```text
src/vs/workbench/contrib/sapphire/
├── browser/          # UI, actions, Vue mounts, tools runtime, agent loop
│   ├── vue/src/      # sidebar, settings, onboarding, agents-window, quick-edit
│   ├── chatThreadAgentLoop.ts
│   ├── chatThreadCheckpoints.ts
│   ├── sapphireAgentsWindowService.ts
│   ├── projectIndexService.ts
│   └── sapphire.contribution.ts
├── common/           # settings, models, prompts, office, projectIndex
│   └── prompt/prompts.ts
├── node/             # office extract и др. node-only
└── electron-main/    # LLM send, MCP channel, SCM main, office channel
```

Sapphire — Electron-приложение (как VS Code): **main** и **browser** процессы.

| Папка | Где выполняется | Можно |
| --- | --- | --- |
| `browser/` | renderer | `window`, DOM; **нельзя** свободно импортировать node_modules |
| `electron-main/` | main | `node_modules`, сеть без CSP browser |
| `common/` | оба | без спец. API окружения |
| `node/` | node | разбор буферов (office и т.п.) |

## Обход CSP / node_modules

1. **Бандить** код в browser (так сделан Vue).
2. **IPC-канал** main ↔ browser (так сделан `sendLLMMessage`, MCP, office extract).

## Термины VS Code

- **Editor** — область редактирования (вкладки внутри).
- **Model** (`ITextModel`) — содержимое файла; одно на URI, шарится между editors.
- **URI** — путь ресурса.
- **Workbench** — оболочка: editors, terminal, explorer.
- **Service** — singleton через `registerSingleton`, инъекция `@IMyService`.
- **Action / Command** — регистрируется через `registerAction2`; доступна из palette и keybindings.

Точка входа контрибуции: `browser/sapphire.contribution.ts`. Карта файлов: [key-files](/extending/key-files).

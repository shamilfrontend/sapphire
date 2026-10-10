# React + Tailwind UI

Sapphire монтирует React+Tailwind в workbench — в чистом VS Code этого нет; сборка расширена отдельно.

## Где код

```text
src/vs/workbench/contrib/sapphire/browser/react/
├── src/           # компоненты (sidebar, settings, onboarding, …)
├── build.js       # сборка
├── tsup.config.js
└── out/           # артефакт (в gitignore)
```

## Команды

Из корня репозитория:

```bash
npm run compile       # включает build-react автоматически
npm run buildreact    # разовая сборка только React (редко нужно отдельно)
npm run watchreact    # watch React при правках UI
npm run dev           # watch + watchreact + приложение
```

Полная сборка (`compile`, `compile-client`, packaging `vscode-*`) всегда сначала собирает React в `react/out/`, затем копирует его в `out/` вместе с остальным client.

## Правила

1. Внешние импорты в React-коде должны заканчиваться на **`.js`** (иначе «Failed to fetch dynamically imported module»).
2. **`src/` не глубже одного уровня папок** — иначе ломается detection externals в `tsup.config.js`.
3. Tailwind **scoped**, чтобы не протекать в весь workbench.
4. Монтирование: `mountFnGenerator` + сервисы из `services.tsx`.

## Типичные экраны

- `void-onboarding/SapphireOnboarding.tsx` — токен + выбор Layout
- `void-settings-tsx/Settings.tsx`
- `sidebar-tsx/SidebarChat.tsx` — оркестратор чата; соседние модули: `ChatComposer`, `ChatAttachments`, `ChatToolCards`, `ChatToolPrimitives`, `ChatProse`, `chatFileUtils`, `chatIcons`; path helpers — `sapphire/common/pathLabels.ts`
- `agents-window-tsx/` — полноэкранный Режим Агент (дерево тредов, композер)
- `project-index-titlebar-tsx/` — статус индекса в title bar (Режим IDE)
- `quick-edit-tsx/` — Ctrl+K UI
- `plan-editor-tsx/` — превью `.plan.md` (Просмотр / Markdown)

При нехватке памяти: `NODE_OPTIONS="--max-old-space-size=8192" npm run buildreact`.

# Vue + Tailwind UI

Sapphire монтирует Vue+Tailwind в workbench — в чистом VS Code этого нет; сборка расширена отдельно.

## Где код

```text
src/vs/workbench/contrib/sapphire/browser/vue/
├── src/           # компоненты (sidebar, settings, onboarding, …)
├── build.js       # сборка
├── tsup.config.js
└── out/           # артефакт (в gitignore)
```

## Команды

Из корня репозитория:

```bash
npm run compile       # включает build-react автоматически
npm run buildvue    # разовая сборка только Vue (редко нужно отдельно)
npm run watchvue    # watch Vue при правках UI
npm run dev           # watch + watchvue + приложение
```

Полная сборка (`compile`, `compile-client`, packaging `vscode-*`) всегда сначала собирает Vue в `vue/out/`, затем копирует его в `out/` вместе с остальным client.

## Правила

1. Внешние импорты в Vue-коде должны заканчиваться на **`.js`** (иначе «Failed to fetch dynamically imported module»). Компоненты импортируются как `.vue`.
2. **`src/` не глубже одного уровня папок** — иначе ломается detection externals в `tsup.config.js`.
3. Tailwind **scoped**, чтобы не протекать в весь workbench.
4. Монтирование: `mountFnGenerator` + сервисы из `services.ts`.

## Типичные экраны

- `void-onboarding/SapphireOnboarding.vue` — токен + выбор Layout
- `void-settings-tsx/Settings.vue`
- `sidebar-tsx/SidebarChat.vue` — оркестратор чата; соседние модули: `ChatComposer`, `ChatAttachments`, `ChatToolCards`, `ChatToolPrimitives`, `ChatProse`, `chatFileUtils`, `chatIcons`; path helpers — `sapphire/common/pathLabels.ts`
- `agents-window-tsx/` — полноэкранный Режим Агент (дерево тредов, композер)
- `project-index-titlebar-tsx/` — статус индекса в title bar (Режим IDE)
- `quick-edit-tsx/` — Ctrl+K UI
- `plan-editor-tsx/` — превью `.plan.md` (Просмотр / Markdown)

При нехватке памяти: `NODE_OPTIONS="--max-old-space-size=8192" npm run buildvue`.

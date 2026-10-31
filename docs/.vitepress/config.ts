import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(
  defineConfig({
    title: 'Sapphire',
    description: 'IDE на базе VS Code с выбором моделей',
    lang: 'ru-RU',
    cleanUrls: true,
    ignoreDeadLinks: [/^https?:\/\//, /\.\.\/\.\.\/src\//],

    // Mermaid ≥11.17 тянет CJS `fastdom` без ESM default — Vite отдаёт сырой файл и падает в dev.
    vite: {
      optimizeDeps: {
        include: [
          'mermaid',
          'fastdom',
          'dayjs',
          'debug',
          'cytoscape',
          'cytoscape-cose-bilkent',
          '@braintree/sanitize-url',
        ],
      },
      ssr: {
        noExternal: ['mermaid', 'vitepress-plugin-mermaid'],
      },
    },

    themeConfig: {
      logo: undefined,
      nav: [
        { text: 'Введение', link: '/intro/models' },
        { text: 'Руководство', link: '/guide/onboarding' },
        { text: 'Архитектура', link: '/architecture/layout' },
        { text: 'Расширение', link: '/extending/models' },
        { text: 'Контрибут', link: '/contribute/dev-setup' },
        { text: 'Справка', link: '/reference/tools' },
      ],

      sidebar: [
        {
          text: 'Введение',
          items: [
            { text: 'Что такое Sapphire', link: '/' },
            { text: 'Changelog', link: '/CHANGELOG' },
            { text: 'Модели и провайдеры', link: '/intro/models' },
            { text: 'Токен и ошибки', link: '/intro/token-and-errors' },
          ],
        },
        {
          text: 'Руководство пользователя',
          items: [
            { text: 'Онбординг', link: '/guide/onboarding' },
            { text: 'Режим IDE / Режим Агент', link: '/guide/agents-layout' },
            { text: 'Чат (Ctrl+L)', link: '/guide/chat' },
            { text: 'Режимы Chat / Plan / Agent / Debug', link: '/guide/modes' },
            { text: 'Контекст и @-упоминания', link: '/guide/context' },
            { text: 'Офисные файлы', link: '/guide/office' },
            { text: 'Tab autocomplete', link: '/guide/autocomplete' },
            { text: 'Inline Edit (Ctrl+K)', link: '/guide/inline-edit' },
            { text: 'Apply и diffs', link: '/guide/apply' },
            { text: 'Checkpoints', link: '/guide/checkpoints' },
            { text: 'Tools и approvals', link: '/guide/tools' },
            { text: 'Settings', link: '/guide/settings' },
            { text: 'Приватность', link: '/guide/privacy' },
            { text: 'Миграция и импорт', link: '/guide/migration' },
          ],
        },
        {
          text: 'Архитектура',
          items: [
            { text: 'Структура кода', link: '/architecture/layout' },
            { text: 'LLM pipeline', link: '/architecture/llm-pipeline' },
            { text: 'Шлюз: улучшения', link: '/architecture/llm-gateway-improvements' },
            { text: 'Apply / DiffZone', link: '/architecture/apply' },
            { text: 'Settings model', link: '/architecture/settings' },
            { text: 'Режим Auto', link: '/architecture/auto-mode' },
            { text: 'Checkpoints и треды', link: '/architecture/checkpoints' },
            { text: 'Офисные файлы (разбор)', link: '/architecture/office-extract' },
            { text: 'Индекс проекта', link: '/architecture/project-index' },
            { text: 'Vision / картинки в чате', link: '/architecture/chat-image-attach' },
          ],
        },
        {
          text: 'Как улучшать',
          items: [
            { text: 'Модели', link: '/extending/models' },
            { text: 'Builtin tools', link: '/extending/tools' },
            { text: 'MCP-серверы', link: '/extending/mcp' },
            { text: 'React + Tailwind UI', link: '/extending/react' },
            { text: 'Промпты', link: '/extending/prompts' },
            { text: 'Карта ключевых файлов', link: '/extending/key-files' },
          ],
        },
        {
          text: 'Контрибут',
          items: [
            { text: 'Dev setup', link: '/contribute/dev-setup' },
            { text: 'Частые ошибки', link: '/contribute/common-fixes' },
            { text: 'Сборка и packaging', link: '/contribute/packaging' },
            { text: 'Upstream', link: '/contribute/upstream' },
          ],
        },
        {
          text: 'Справка',
          items: [
            { text: 'Builtin tools', link: '/reference/tools' },
            { text: 'Action IDs', link: '/reference/actions' },
            { text: 'Gateway API', link: '/reference/gateway-api' },
            { text: 'VS Code wiki', link: '/reference/vscode' },
          ],
        },
      ],

      search: {
        provider: 'local',
        options: {
          translations: {
            button: {
              buttonText: 'Поиск',
              buttonAriaLabel: 'Поиск',
            },
            modal: {
              noResultsText: 'Ничего не найдено',
              resetButtonTitle: 'Сбросить',
              footer: {
                selectText: 'выбрать',
                navigateText: 'навигация',
                closeText: 'закрыть',
              },
            },
          },
        },
      },

      socialLinks: [],

      outline: {
        label: 'На этой странице',
        level: [2, 3],
      },

      docFooter: {
        prev: 'Назад',
        next: 'Далее',
      },

      darkModeSwitchLabel: 'Тема',
      sidebarMenuLabel: 'Меню',
      returnToTopLabel: 'Наверх',
    },
  }),
);

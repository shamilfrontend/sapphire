---
layout: home

hero:
  name: Sapphire
  text: IDE на базе VS Code с выбором моделей
  tagline: 'OpenAI, Anthropic, Gemini, DeepSeek, Ollama и другие'
  actions:
    - theme: brand
      text: Начать работу
      link: /guide/onboarding
    - theme: alt
      text: Приватность
      link: /guide/privacy

features:
  - title: Без лишней телеметрии
    details: 'Нет телеметрии PostHog и phone-home. LLM-запрос уходит только выбранному провайдеру.'
  - title: Несколько провайдеров
    details: 'Ключ хранится зашифрованно. DeepSeek, OpenAI, Anthropic, Gemini, локальные серверы и свой endpoint.'
  - title: Agent, Plan, Tab, Ctrl+K
    details: 'Cursor-like UX: агент с tools, планирование, автодополнение и inline-правки.'
  - title: MCP и расширения — ваш выбор
    details: 'Marketplace и MCP не цензурируем — на совести разработчика.'
---

## Что это

**Sapphire** — IDE на базе форка [Void](https://github.com/voideditor/void). По возможностям близок к Cursor: агент, план, автодополнение и inline-правки. Модель выбирается в настройках. Подробнее — [Приватность](/guide/privacy).

## С чего начать

**Пользователь**

1. [Онбординг](/guide/onboarding) — провайдер и первый запуск
2. [Режимы](/guide/modes) — Chat / Plan / Agent / Debug
3. [Контекст](/guide/context) — `@`-упоминания и что видит модель
4. [Приватность](/guide/privacy) — куда уходит код

**Разработчик**

1. [Структура кода](/architecture/layout) — процессы и слои
2. [LLM pipeline](/architecture/llm-pipeline) — путь запроса к провайдеру
3. [Карта ключевых файлов](/extending/key-files) — куда смотреть в коде
4. [Dev setup](/contribute/dev-setup) — локальная сборка

## Документация

| Раздел | Для кого |
| --- | --- |
| [Changelog](/CHANGELOG) | Продуктовые срезы с форка |
| [Руководство](/guide/onboarding) | Пользователи: чат, режимы, Tab, Ctrl+K, Apply, MCP |
| [Модели и провайдеры](/intro/models) | Список моделей и провайдеры |
| [Приватность](/guide/privacy) | Куда уходит запрос; расширения и MCP |
| [Архитектура](/architecture/layout) | Разработчики: процессы, pipeline, DiffZone |
| [Как улучшать](/extending/models) | Контрибьюторы: модели, tools, React, промпты |
| [Контрибут](/contribute/dev-setup) | Локальная сборка и Developer Mode |
| [Справка](/reference/tools) | Таблицы tools и action IDs |

## Быстрый старт документации

```bash
cd docs
npm install
npm run docs:dev
```

Или из корня репозитория: `npm run docs:dev` (после `npm install` в `docs/`).

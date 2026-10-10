# Upstream

Sapphire основан на форке [voideditor/void](https://github.com/voideditor/void), который раньше был залочен на корпоративный шлюз.

| Поле       | Значение                                   |
| ---------- | ------------------------------------------ |
| Upstream   | `https://github.com/voideditor/void.git`   |
| Commit     | `b3166e7ef2aefbdfeb139445fdf248a561b85d4d` |
| Branch     | `main`                                     |
| Дата форка | 2026-09-13                                 |

Void закрыт и не развивается. Эта кодовая база самостоятельная; обновления из Void не планируются.

## Отличия от исходного Void

1. Внутренний модуль: `src/vs/workbench/contrib/sapphire` (раньше `contrib/void`).
2. Провайдеры снова выбираются в UI: Anthropic, OpenAI, DeepSeek, Gemini, Groq, OpenRouter, xAI, Mistral, Ollama, vLLM, LM Studio, LiteLLM, Vertex, Azure, Bedrock и произвольный OpenAI-совместимый endpoint.
3. DeepSeek ходит на `https://api.deepseek.com`; ключ и расход — [platform.deepseek.com/usage](https://platform.deepseek.com/usage).
4. Корпоративный шлюз, Jira, Confluence и browser-мост удалены.

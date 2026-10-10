# Промпты

Центральный файл: `src/vs/workbench/contrib/sapphire/common/prompt/prompts.ts`.

## Что там лежит

- описания **builtin tools** и helper-тексты;
- `availableTools(chatMode, mcpTools)`;
- system / task prompts для Chat, Apply, Ctrl+K, SCM, FIM (и связанные константы);
- инструкции по формату Search/Replace для Fast Apply.

Сборка финального списка messages для провайдера — в `convertToLLMMessageService.ts` (контекст файлов, `.rules`, global instructions, history).

## Как менять безопасно

1. Меняйте один сценарий за раз (например, только Apply).
2. Проверьте Fast Apply на большом файле и Slow Apply на маленьком.
3. Для Agent — что модель стабильно вызывает tools с нужными параметрами.
4. Tools на шлюзе — openai-style function calling, не XML/grammar-теги.

## FIM / SCM

Промпты autocomplete и commit message чувствительны к модели (`qwen3-8B`). После правок прогоните Tab и генерацию коммита вручную.

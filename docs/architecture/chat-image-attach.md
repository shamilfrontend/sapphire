# Vision: картинки в чате

В чате можно вставить или прикрепить изображение; для моделей с `supportsVision` оно уходит на шлюз как OpenAI content parts (`image_url` + **base64 data URL**).

## Поведение продукта

| Вопрос | Ответ |
| --- | --- |
| Какая модель видит картинки по умолчанию? | `glm-5.3-flash` (`supportsVision: true`) |
| Как прикрепить? | Paste из буфера или скрепка в композере; DnD файла-картинки |
| Формат на wire | `data:image/...;base64,...` в `image_url.url` |
| Публичные URL картинок | Не используются: шлюз не достучался до внешних хостов (smoke 2026-09-15) |
| Другие модели (Qwen и т.п.) | UI скрывает attach/paste; convert не шлёт `image_url` без `supportsVision` |

Токены vision: фиксированный вес на image (не длина base64). Persist: поле `images` на user-сообщении; старые треды без поля валидны.

## Контракт запроса

```json
{
  "model": "glm-5.3-flash",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "..." },
        {
          "type": "image_url",
          "image_url": { "url": "data:image/png;base64,..." }
        }
      ]
    }
  ]
}
```

Ключевые места в коде: staging/attach в React-композере чата → `chatThreadService` → `convertToLLMMessageService` → `sendLLMMessage.impl.ts` (OpenAI-совместимый клиент).

## Ограничения

- Resize / лимиты размера и числа картинок на сообщение (чтобы не раздувать persist треда и body).
- Нет: Anthropic/Gemini converters, video, image из MCP tool → vision.
- OpenAPI репо может описывать `content` как `string`; фактический gateway принимает array parts.

## Smoke-тест шлюза (2026-09-15)

На `glm-5.3-flash`: text control ок; base64 PNG — HTTP 200 и корректный ответ о цвете; public Wikimedia URL — 500 (connect с gateway-ноды).

Источники модели: [Z.ai GLM-5.3-Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash).

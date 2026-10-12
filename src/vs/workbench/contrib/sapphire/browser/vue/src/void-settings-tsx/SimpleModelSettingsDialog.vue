<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { ProviderName, displayInfoOfProviderName } from '../../../../common/sapphireSettingsTypes.js';
import { LLM_IDE_TITLE } from '../../../../common/llmProviderConfig.js';
import SapphireButtonBgDarken from '../util/SapphireButtonBgDarken.vue';
import SapphireSwitch from '../util/SapphireSwitch.vue';
import { useAccessor, useSettingsState } from '../util/services.js';
import ChatMarkdownRender from '../markdown/ChatMarkdownRender.vue';
import {
  getModelCapabilities,
  modelOverrideKeys,
  ModelOverrides,
} from '../../../../common/modelCapabilities.js';

const props = defineProps<{
  modelInfo: {
    modelName: string;
    providerName: ProviderName;
    type: 'autodetected' | 'custom' | 'default';
  };
}>();

const emit = defineEmits<{
  close: [];
}>();

const accessor = useAccessor();
const settingsState = useSettingsState();
const mouseDownInsideModal = ref(false); // mousedown начался внутри модалки (не закрывать по mouseup снаружи)
const settingsStateService = accessor.get('ISapphireSettingsService');

const modelName = computed(() => props.modelInfo.modelName);
const providerName = computed(() => props.modelInfo.providerName);
const type = computed(() => props.modelInfo.type);

const defaultModelCapabilities = computed(() =>
  getModelCapabilities(providerName.value, modelName.value, undefined),
);

const currentOverrides = computed(
  () => settingsState.value.overridesOfModel?.[providerName.value]?.[modelName.value] ?? undefined,
);

const recognizedModelName = computed(() => defaultModelCapabilities.value.recognizedModelName);
const isUnrecognizedModel = computed(() => defaultModelCapabilities.value.isUnrecognizedModel);

const assignModelOverride = (
  target: Partial<ModelOverrides>,
  key: (typeof modelOverrideKeys)[number],
  value: ModelOverrides[(typeof modelOverrideKeys)[number]],
) => {
  switch (key) {
    case 'contextWindow':
      target.contextWindow = value as ModelOverrides['contextWindow'];
      return;
    case 'reservedOutputTokenSpace':
      target.reservedOutputTokenSpace = value as ModelOverrides['reservedOutputTokenSpace'];
      return;
    case 'supportsSystemMessage':
      target.supportsSystemMessage = value as ModelOverrides['supportsSystemMessage'];
      return;
    case 'supportsFIM':
      target.supportsFIM = value as ModelOverrides['supportsFIM'];
      return;
    case 'fimMaxTokens':
      target.fimMaxTokens = value as ModelOverrides['fimMaxTokens'];
      return;
    case 'supportsVision':
      target.supportsVision = value as ModelOverrides['supportsVision'];
      return;
    case 'reasoningCapabilities':
      target.reasoningCapabilities = value as ModelOverrides['reasoningCapabilities'];
      return;
    case 'additionalGatewayPayload':
      target.additionalGatewayPayload = value as ModelOverrides['additionalGatewayPayload'];
      return;
    default: {
      const _never: never = key;
      return _never;
    }
  }
};

// Placeholder — JSON с дефолтами только по разрешённым ключам
const placeholder = computed(() => {
  const partialDefaults: Partial<ModelOverrides> = {};
  const caps = defaultModelCapabilities.value;
  for (const k of modelOverrideKeys) {
    if (caps[k]) assignModelOverride(partialDefaults, k, caps[k]);
  }
  return JSON.stringify(partialDefaults, null, 2);
});

const overrideEnabled = ref(!!currentOverrides.value);
const errorMsg = ref<string | null>(null);
const textAreaRef = ref<HTMLTextAreaElement | null>(null);

const textareaValue = computed(() =>
  overrideEnabled.value && currentOverrides.value
    ? JSON.stringify(currentOverrides.value, null, 2)
    : placeholder.value,
);

// Сброс состояния при открытии/закрытии диалога
watch(
  () =>
    [
      providerName.value,
      modelName.value,
      settingsState.value.overridesOfModel,
      placeholder.value,
    ] as const,
  () => {
    const cur = settingsState.value.overridesOfModel?.[providerName.value]?.[modelName.value];
    overrideEnabled.value = !!cur;
    errorMsg.value = null;
  },
);

const bindTextArea = (el: unknown) => {
  if (!(el instanceof HTMLTextAreaElement)) {
    textAreaRef.value = null;
    return;
  }
  textAreaRef.value = el;
  el.value = textareaValue.value;
};

const onClose = () => {
  emit('close');
};

const onSave = async () => {
  // Переопределение выключено — сбрасываем overrides
  if (!overrideEnabled.value) {
    await settingsStateService.setOverridesOfModel(providerName.value, modelName.value, undefined);
    onClose();
    return;
  }

  // Переопределение включено — парсим JSON
  let parsedInput: Record<string, unknown>;

  if (textAreaRef.value?.value) {
    try {
      parsedInput = JSON.parse(textAreaRef.value.value) as Record<string, unknown>;
    } catch (_e) {
      errorMsg.value = 'Некорректный JSON';
      return;
    }
  } else {
    errorMsg.value = 'Некорректный JSON';
    return;
  }

  // Оставляем только разрешённые ключи
  const cleaned: Partial<ModelOverrides> = {};
  for (const k of modelOverrideKeys) {
    if (!(k in parsedInput)) continue;
    const raw = parsedInput[k];
    const isEmpty = raw === '' || raw === null || raw === undefined;
    if (!isEmpty) {
      assignModelOverride(cleaned, k, raw as ModelOverrides[(typeof modelOverrideKeys)[number]]);
    }
  }
  await settingsStateService.setOverridesOfModel(providerName.value, modelName.value, cleaned);
  onClose();
};

const sourcecodeOverridesLink = `https://github.com/voideditor/void/blob/2e5ecb291d33afbe4565921664fb7e183189c1c5/src/vs/workbench/contrib/sapphire/common/modelCapabilities.ts#L146-L172`;

const overridesDoc = `См. [исходный код](${sourcecodeOverridesLink}) — справочник по формату JSON (для продвинутых).`;

const onBackdropMouseDown = () => {
  mouseDownInsideModal.value = false;
};

const onBackdropMouseUp = () => {
  if (!mouseDownInsideModal.value) {
    onClose();
  }
  mouseDownInsideModal.value = false;
};

const onModalMouseDown = () => {
  mouseDownInsideModal.value = true;
};

const providerTitle = computed(() => displayInfoOfProviderName(providerName.value).title);
</script>

<template>
  <!-- Затемнение фона -->
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999999]"
    @mousedown="onBackdropMouseDown"
    @mouseup="onBackdropMouseUp"
  >
    <!-- Модальное окно -->
    <div
      class="bg-void-bg-1 rounded-md p-4 max-w-xl w-full shadow-xl overflow-y-auto max-h-[90vh]"
      @click.stop
      @mousedown.stop="onModalMouseDown"
    >
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-medium">
          Параметры модели {{ modelName }} ({{ providerTitle }})
        </h3>
        <button class="text-void-fg-3 hover:text-void-fg-1" @click="onClose">
          <X class="size-5" />
        </button>
      </div>

      <!-- Статус распознавания модели шлюзом -->
      <div class="text-sm text-void-fg-3 mb-4">
        <template v-if="type === 'default'">
          {{
            `${modelName} уже есть в списке ${LLM_IDE_TITLE} — менять эти параметры обычно не нужно.`
          }}
        </template>
        <template v-else-if="isUnrecognizedModel">Модель не распознана.</template>
        <template v-else>
          {{ `${LLM_IDE_TITLE} распознаёт ${modelName} («${recognizedModelName}»).` }}
        </template>
      </div>

      <!-- Переключатель переопределения -->
      <div class="flex items-center gap-2 mb-4">
        <SapphireSwitch size="xs" :value="overrideEnabled" @change="overrideEnabled = $event" />
        <span class="text-void-fg-3 text-sm">Переопределить параметры по умолчанию</span>
      </div>

      <!-- Ссылка на справочник по формату JSON -->
      <div v-if="overrideEnabled" class="text-sm text-void-fg-3 mb-4">
        <ChatMarkdownRender :string="overridesDoc" :chatMessageLocation="undefined" />
      </div>

      <textarea
        :key="String(overrideEnabled)"
        :ref="bindTextArea"
        class="w-full min-h-[200px] p-2 rounded-sm border border-void-border-2 bg-void-bg-2 resize-none font-mono text-sm"
        :class="!overrideEnabled ? 'text-void-fg-3' : ''"
        :placeholder="placeholder"
        :readonly="!overrideEnabled"
      />
      <div v-if="errorMsg" class="text-red-500 mt-2 text-sm">{{ errorMsg }}</div>

      <div class="flex justify-end gap-2 mt-4">
        <SapphireButtonBgDarken class="px-3 py-1" @click="onClose">Отмена</SapphireButtonBgDarken>
        <SapphireButtonBgDarken
          class="px-3 py-1 bg-[#0e639c] text-white hover:bg-[#1177bb]"
          @click="onSave"
        >
          Сохранить
        </SapphireButtonBgDarken>
      </div>
    </div>
  </div>
</template>

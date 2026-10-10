<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  PPR Code — выбор layout-режима (Режим IDE / Режим Агент).
 *--------------------------------------------------------------------------------------*/

import { LayoutMode } from '../../../../common/sapphireSettingsTypes.js';

const CARDS: { id: LayoutMode; title: string; description: string }[] = [
  {
    id: 'ide',
    title: 'Режим IDE',
    description: 'Классический редактор кода и чат справа.',
  },
  {
    id: 'agents',
    title: 'Режим Агент',
    description: 'Чат на весь экран: список диалогов слева, сообщение по центру.',
  },
];

defineProps<{
  value: LayoutMode;
}>();

const emit = defineEmits<{
  change: [mode: LayoutMode];
}>();
</script>

<template>
  <div class="flex flex-col gap-3">
    <button
      v-for="card in CARDS"
      :key="card.id"
      type="button"
      :class="`text-left rounded-md border p-4 transition-colors ${
        value === card.id
          ? 'border-[#00b0cc] bg-[#00b0cc]/10'
          : 'border-void-border-2 bg-void-bg-2 hover:border-void-border-1'
      }`"
      @click="emit('change', card.id)"
    >
      <div class="text-void-fg-1 font-medium">{{ card.title }}</div>
      <div class="text-void-fg-3 text-sm mt-1">{{ card.description }}</div>
    </button>
  </div>
</template>

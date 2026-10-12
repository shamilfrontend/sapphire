<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { onWatcherCleanup, ref, watch } from 'vue';
import { useAccessor } from '../util/services.js';
import { formatChatSendTrace } from '../../../../common/chatSendTrace.js';
import { COPY_CHAT_LOG_FEEDBACK_MS } from './sidebarChatShared.js';

const LABEL = 'Общий лог';

const accessor = useAccessor();
const clipboardService = accessor.get('IClipboardService');
const label = ref(LABEL);

watch(
  label,
  (next) => {
    if (next === LABEL) {
      return;
    }
    const timer = setTimeout(() => {
      label.value = LABEL;
    }, COPY_CHAT_LOG_FEEDBACK_MS);
    onWatcherCleanup(() => clearTimeout(timer));
  },
  { immediate: true },
);

const onCopy = () => {
  void clipboardService
    .writeText(formatChatSendTrace())
    .then(() => {
      label.value = 'Скопировано';
    })
    .catch(() => {
      label.value = 'Не удалось скопировать';
    });
};
</script>

<template>
  <div class="flex pt-1.5">
    <button
      type="button"
      class="px-2 py-0.5 text-xs text-void-fg-3 hover:text-void-fg-1 transition-colors cursor-pointer"
      title="Скопировать журнал шагов всех чатов сессии (для диагностики зависания)"
      @click="onCopy"
    >
      {{ label }}
    </button>
  </div>
</template>

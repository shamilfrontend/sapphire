<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { onWatcherCleanup, ref, watch } from 'vue';
import { useAccessor } from '../util/services.js';
import { formatChatThreadLog } from '../../../../common/formatChatThreadLog.js';
import { formatChatSendTrace } from '../../../../common/chatSendTrace.js';
import { COPY_CHAT_LOG_FEEDBACK_MS } from './sidebarChatShared.js';

const accessor = useAccessor();
const clipboardService = accessor.get('IClipboardService');
const chatThreadsService = accessor.get('IChatThreadService');
const label = ref('Скопировать лог');

watch(
  label,
  (next) => {
    if (next === 'Скопировать лог') {
      return;
    }
    const timer = setTimeout(() => {
      label.value = 'Скопировать лог';
    }, COPY_CHAT_LOG_FEEDBACK_MS);
    onWatcherCleanup(() => clearTimeout(timer));
  },
  { immediate: true },
);

const onCopy = () => {
  const thread = chatThreadsService.getCurrentThread();
  const sendTrace = formatChatSendTrace();
  const threadLog = formatChatThreadLog(thread.messages, {
    threadId: thread.id,
    createdAt: thread.createdAt,
  });
  const text = `${sendTrace}\n\n---\n\n${threadLog}`;
  void clipboardService
    .writeText(text)
    .then(() => {
      label.value = 'Скопировано';
    })
    .catch(() => {
      label.value = 'Не удалось скопировать';
    });
};
</script>

<template>
  <div class="flex justify-end pt-1.5">
    <button
      type="button"
      class="px-2 py-0.5 text-xs text-void-fg-3 hover:text-void-fg-1 transition-colors cursor-pointer"
      title="Скопировать лог отправки и историю чата (для диагностики зависания)"
      @click="onCopy"
    >
      {{ label }}
    </button>
  </div>
</template>

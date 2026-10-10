<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ref } from 'vue';
import { ChevronDown, ChevronRight, Circle, Pencil, Trash2 } from 'lucide-vue-next';
import { isMacintosh } from '../../../../../../../base/common/platform.js';
import { useAccessor, useChatThreadMessageQueue } from '../util/services.js';
import { ChatImageAttachment, StagingSelectionItem } from '../../../../common/chatThreadServiceTypes.js';
import { chatImageToDataUrl } from '../../../../common/chatImageUtils.js';
import ImageLightbox from './ImageLightbox.vue';

const props = defineProps<{
  threadId: string;
  onEditQueued: (item: {
    text: string;
    images?: ChatImageAttachment[];
    selections?: StagingSelectionItem[];
  }) => void;
}>();

const accessor = useAccessor();
const chatThreadsService = accessor.get('IChatThreadService');
const queue = useChatThreadMessageQueue(() => props.threadId);
const expanded = ref(true);
const lightboxImage = ref<ChatImageAttachment | null>(null);
const steerShortcut = isMacintosh ? '⌘↵' : 'Ctrl+↵';

const titleOf = (count: number) => (count === 1 ? '1 в очереди' : `${count} в очереди`);
</script>

<template>
  <div
    v-if="queue.length"
    class="mb-2 rounded-xl border border-void-border-3 bg-void-bg-1 overflow-hidden"
  >
    <button
      type="button"
      class="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-void-fg-3 hover:text-void-fg-1 cursor-pointer"
      @click="expanded = !expanded"
    >
      <ChevronDown v-if="expanded" :size="14" />
      <ChevronRight v-else :size="14" />
      <span>{{ titleOf(queue.length) }}</span>
    </button>
    <div v-if="expanded" class="flex flex-col gap-0.5 px-2 pb-2">
      <div
        v-for="item in queue"
        :key="item.id"
        class="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-void-bg-2"
      >
        <Circle :size="12" class="mt-1 shrink-0 text-void-fg-3" />
        <div class="min-w-0 flex-1">
          <div class="text-sm text-void-fg-1 truncate">
            {{ item.text.trim() || (item.images?.length ? 'Изображение' : '(пусто)') }}
          </div>
          <div v-if="item.images && item.images.length > 0" class="flex flex-wrap gap-1 mt-1">
            <button
              v-for="img in item.images"
              :key="img.id"
              type="button"
              class="rounded overflow-hidden border border-void-border-3 cursor-pointer"
              @click="lightboxImage = img"
            >
              <img
                :src="chatImageToDataUrl(img)"
                alt=""
                class="h-8 w-auto max-w-[64px] object-cover block"
              />
            </button>
          </div>
        </div>
        <div class="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            class="text-[11px] px-1.5 py-0.5 rounded text-void-fg-2 hover:text-void-fg-1 hover:bg-void-bg-2-alt cursor-pointer"
            :title="`Отправить сейчас (${steerShortcut})`"
            @click="void chatThreadsService.steerQueuedMessage(props.threadId, item.id)"
          >
            Отправить сейчас <span class="opacity-60">{{ steerShortcut }}</span>
          </button>
          <button
            type="button"
            class="p-1 rounded text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2-alt cursor-pointer"
            title="Редактировать"
            @click="
              () => {
                const removed = chatThreadsService.removeQueuedMessage(props.threadId, item.id);
                if (!removed) return;
                onEditQueued({
                  text: removed.text,
                  images: removed.images,
                  selections: removed.selections,
                });
              }
            "
          >
            <Pencil :size="13" />
          </button>
          <button
            type="button"
            class="p-1 rounded text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2-alt cursor-pointer"
            title="Удалить"
            @click="chatThreadsService.removeQueuedMessage(props.threadId, item.id)"
          >
            <Trash2 :size="13" />
          </button>
        </div>
      </div>
    </div>
    <ImageLightbox
      v-if="lightboxImage"
      :image="lightboxImage"
      :onClose="() => { lightboxImage = null; }"
    />
  </div>
</template>

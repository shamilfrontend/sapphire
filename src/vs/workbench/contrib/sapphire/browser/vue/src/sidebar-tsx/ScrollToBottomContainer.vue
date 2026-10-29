<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { onMounted, onUnmounted, onUpdated, ref, useAttrs, type CSSProperties } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import { scrollToBottom } from './sidebarChatShared.js';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  scrollContainerRef: { current: HTMLDivElement | null };
  style?: CSSProperties;
}>();

const attrs = useAttrs();
const isAtBottom = ref(true); // изначально прокрутка вниз
const showJumpButton = ref(false);

let resizeObserver: ResizeObserver | undefined;

const setEl = (el: unknown) => {
  props.scrollContainerRef.current = el instanceof HTMLDivElement ? el : null;
};

const measure = () => {
  const div = props.scrollContainerRef.current;
  if (!div) {
    showJumpButton.value = false;
    return true;
  }
  const distance = div.scrollHeight - div.clientHeight - div.scrollTop;
  const atBottom = distance < 4;
  showJumpButton.value = !atBottom && div.scrollHeight > div.clientHeight + 4;
  return atBottom;
};

const onScroll = () => {
  isAtBottom.value = measure();
};

const jumpToBottom = () => {
  isAtBottom.value = true;
  scrollToBottom(props.scrollContainerRef);
  requestAnimationFrame(() => {
    scrollToBottom(props.scrollContainerRef);
    isAtBottom.value = measure();
  });
};

// первый рендер — в конец ленты
onMounted(() => {
  scrollToBottom(props.scrollContainerRef);
  const div = props.scrollContainerRef.current;
  if (div && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (isAtBottom.value) {
        scrollToBottom(props.scrollContainerRef);
      }
      measure();
    });
    resizeObserver.observe(div);
  }
  measure();
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});

// при новых сообщениях — автоскролл, если пользователь внизу
onUpdated(() => {
  if (isAtBottom.value) {
    scrollToBottom(props.scrollContainerRef);
  }
  measure();
});
</script>

<template>
  <div class="relative flex min-h-0 w-full flex-1 flex-col" :style="style">
    <div :ref="setEl" v-bind="attrs" class="min-h-0 flex-1" @scroll="onScroll">
      <slot />
    </div>
    <button
      v-show="showJumpButton"
      type="button"
      class="absolute bottom-3 right-4 z-20 flex size-8 cursor-pointer items-center justify-center rounded-full border border-void-border-2 bg-void-bg-1 text-void-fg-1 shadow-md hover:bg-void-bg-2-alt hover:text-void-fg-0"
      title="В самый низ"
      aria-label="Прокрутить чат в самый низ"
      @click="jumpToBottom"
    >
      <ChevronDown class="size-4" :stroke-width="2" />
    </button>
  </div>
</template>

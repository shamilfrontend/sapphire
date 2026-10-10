<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { onMounted, onUpdated, ref, type CSSProperties } from 'vue';
import { scrollToBottom } from './sidebarChatShared.js';

const props = defineProps<{
  scrollContainerRef: { current: HTMLDivElement | null };
  style?: CSSProperties;
}>();

const isAtBottom = ref(true); // изначально прокрутка вниз

const setEl = (el: unknown) => {
  props.scrollContainerRef.current = el instanceof HTMLDivElement ? el : null;
};

const onScroll = () => {
  const div = props.scrollContainerRef.current;
  if (!div) return;

  const bottom = Math.abs(div.scrollHeight - div.clientHeight - div.scrollTop) < 4;
  isAtBottom.value = bottom;
};

// первый рендер — в конец ленты
onMounted(() => {
  scrollToBottom(props.scrollContainerRef);
});

// при новых сообщениях — автоскролл, если пользователь внизу
onUpdated(() => {
  if (isAtBottom.value) {
    scrollToBottom(props.scrollContainerRef);
  }
});
</script>

<template>
  <div :ref="setEl" :style="style" @scroll="onScroll">
    <slot />
  </div>
</template>

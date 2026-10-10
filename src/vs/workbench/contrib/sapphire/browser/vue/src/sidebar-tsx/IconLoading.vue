<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { onWatcherCleanup, ref, watch } from 'vue';

defineProps<{ label?: string }>();

const loadingText = ref('.');

watch(
  loadingText,
  () => {
    // анимация точек загрузки
    const toggleLoadingText = () => {
      if (loadingText.value === '...') {
        loadingText.value = '.';
      } else {
        loadingText.value = `${loadingText.value}.`;
      }
    };

    // запуск интервала анимации
    const intervalId = setInterval(toggleLoadingText, 300);

    // снимаем interval при размонтировании
    onWatcherCleanup(() => clearInterval(intervalId));
  },
  { immediate: true },
);
</script>

<template>
  <div>{{ label ? `${label}${loadingText}` : loadingText }}</div>
</template>

<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

defineProps<{ visible: boolean }>();
</script>

<template>
  <div
    v-if="visible"
    class="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-md border-2 border-dashed border-void-border-1 bg-void-bg-1/75"
    aria-hidden="true"
  >
    <span class="px-3 py-1.5 text-sm text-void-fg-1 select-none">Отпустите, чтобы прикрепить</span>
  </div>
</template>

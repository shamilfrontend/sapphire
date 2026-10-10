<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

defineProps<{ size: number }>();
</script>

<template>
  <svg
    stroke="black"
    fill="black"
    stroke-width="0"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2" y="2" width="20" height="20" rx="4" ry="4" />
  </svg>
</template>

<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { REASONING_HINT } from './ChatComposer.js';
</script>

<template>
  <span
    class="text-void-fg-3 text-xs inline-block w-10 pr-1 cursor-help border-b border-dotted border-void-fg-3/40"
    data-tooltip-id="sapphire-tooltip"
    :data-tooltip-content="REASONING_HINT"
    data-tooltip-place="top"
    data-tooltip-class-name="sapphire-max-w-[300px]"
  >
    Думает
  </span>
</template>

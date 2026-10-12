<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import '../styles.css';
import { useIsDark } from '../util/services.js';
import type { SapphireCommandBarProps } from '../../../sapphireCommandBarService.js';
import SapphireCommandBar from './SapphireCommandBar.vue';

const props = defineProps<SapphireCommandBarProps>();
const isDark = useIsDark();
</script>

<template>
  <div class="@@void-scope" :class="{ dark: isDark }">
    <SapphireCommandBar v-bind="props" />
  </div>
</template>

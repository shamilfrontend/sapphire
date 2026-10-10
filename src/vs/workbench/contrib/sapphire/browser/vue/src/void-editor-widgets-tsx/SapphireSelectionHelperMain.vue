<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import '../styles.css';
import { useIsDark } from '../util/services.js';
import type { SapphireSelectionHelperProps } from '../../../sapphireSelectionHelperWidget.js';
import SapphireSelectionHelper from './SapphireSelectionHelper.vue';

const props = defineProps<SapphireSelectionHelperProps>();
const isDark = useIsDark();
</script>

<template>
  <div class="@@void-scope" :class="{ dark: isDark }">
    <SapphireSelectionHelper v-bind="props" />
  </div>
</template>

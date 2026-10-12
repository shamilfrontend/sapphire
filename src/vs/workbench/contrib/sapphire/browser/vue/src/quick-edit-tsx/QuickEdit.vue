<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useIsDark } from '../util/services.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.vue';
import QuickEditChat from './QuickEditChat.vue';
import type { QuickEditPropsType } from '../../../quickEditActions.js';

const props = defineProps<QuickEditPropsType>();
const isDark = useIsDark();
</script>

<template>
  <div class="@@void-scope" :class="{ dark: isDark }">
    <ErrorBoundary>
      <QuickEditChat v-bind="props" />
    </ErrorBoundary>
  </div>
</template>

<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { onErrorCaptured, ref, useSlots } from 'vue';
import WarningBox from '../void-settings-tsx/WarningBox.vue';

defineProps<{
  onDismiss?: () => void;
}>();

const slots = useSlots();
const hasError = ref(false);
const error = ref<Error | null>(null);
const errorInfo = ref<string | null>(null);

onErrorCaptured((err, _instance, info) => {
  hasError.value = true;
  error.value = err instanceof Error ? err : new Error(String(err));
  errorInfo.value = info;
  console.error('[sapphire] ErrorBoundary captured render error', err, info);
  return false;
});
</script>

<template>
  <template v-if="hasError && error">
    <!-- пользовательский fallback вместо стандартного UI -->
    <slot v-if="slots.fallback" name="fallback" />
    <!-- раньше использовался ErrorDisplay -->
    <WarningBox v-else :text="`${error}`" />
    <!--
      <ErrorDisplay
        :message="error + ''"
        :full-error="error"
        :on-dismiss="onDismiss || null"
      />
      errorInfo
    -->
  </template>
  <slot v-else />
</template>

<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref } from 'vue';
import { AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-vue-next';
import { errorDetails } from '../../../../common/sendLLMMessageTypes.js';

const props = defineProps<{
  message: string;
  fullError: Error | null;
  onDismiss: (() => void) | null;
  showDismiss?: boolean;
}>();

const isExpanded = ref(false);

const details = computed(() => errorDetails(props.fullError));
const isExpandable = computed(() => !!details.value);
const messageText = computed(() => `${props.message}`);
</script>

<template>
  <div class="rounded-lg border border-void-danger-border bg-void-danger-muted p-4 overflow-auto text-void-fg-1">
    <!-- Шапка -->
    <div class="flex items-start justify-between">
      <div class="flex gap-3">
        <AlertCircle class="h-5 w-5 text-void-danger mt-0.5 shrink-0" />
        <div class="flex-1">
          <h3 class="font-semibold text-void-fg-1">
            <!-- заголовок «Ошибка» -->
            Ошибка
          </h3>
          <p class="text-void-fg-2 mt-1">
            <!-- текст сообщения об ошибке -->
            {{ messageText }}
          </p>
        </div>
      </div>

      <div class="flex gap-2">
        <button
          v-if="isExpandable"
          class="text-void-danger hover:opacity-80 p-1 rounded"
          @click="isExpanded = !isExpanded"
        >
          <ChevronUp v-if="isExpanded" class="h-5 w-5" />
          <ChevronDown v-else class="h-5 w-5" />
        </button>
        <button
          v-if="showDismiss && onDismiss"
          class="text-void-danger hover:opacity-80 p-1 rounded"
          @click="onDismiss()"
        >
          <X class="h-5 w-5" />
        </button>
      </div>
    </div>

    <!-- Раскрывающиеся детали -->
    <div
      v-if="isExpanded && details"
      class="mt-4 space-y-3 border-t border-void-danger-border pt-3 overflow-auto"
    >
      <div>
        <span class="font-semibold text-void-fg-1">Полная ошибка: </span>
        <pre class="text-void-fg-2">{{ details }}</pre>
      </div>
    </div>
  </div>
</template>

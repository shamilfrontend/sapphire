<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import { useIsDark, useSettingsState } from '../util/services.js';

import '../styles.css';
import SidebarChat from './SidebarChat.vue';
import SidebarChatTabs from './SidebarChatTabs.vue';
import ErrorBoundary from './ErrorBoundary.vue';

defineProps<{ className?: string }>();

const isDark = useIsDark();
const settingsState = useSettingsState();
const layoutMode = computed(() => settingsState.value.globalSettings.layoutMode);
</script>

<template>
  <div
    :class="`@@void-scope ${isDark ? 'dark' : ''}`"
    :style="{ width: '100%', height: '100%' }"
  >
    <div
      class="
				w-full h-full
				bg-void-bg-2
				text-void-fg-1
			"
    >
      <div class="w-full h-full flex flex-col">
        <ErrorBoundary>
          <SidebarChatTabs />
        </ErrorBoundary>
        <div class="min-h-0 flex-1 h-full">
          <!-- В режиме agents чат рисуется в отдельном окне; здесь только вкладки -->
          <ErrorBoundary>
            <SidebarChat v-if="layoutMode !== 'agents'" />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  </div>
</template>

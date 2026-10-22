<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Sapphire — fullscreen Режим Агент (chat-first shell).
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import type { CSSProperties } from 'vue';
import { useIsDark, useSettingsState } from '../util/services.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.vue';
import AgentsWindowShell from './AgentsWindowShell.vue';

const settings = useSettingsState();
const isDark = useIsDark();
const show = computed(
  () =>
    settings.value.globalSettings.isOnboardingComplete &&
    settings.value.globalSettings.layoutMode === 'agents',
);

const shellStyle = { height: '100vh', WebkitAppRegion: 'no-drag' } as CSSProperties;
</script>

<template>
  <div v-if="show" :class="['@@void-scope', isDark ? 'dark' : '']">
    <div
      class="bg-void-bg-3 text-void-fg-1 fixed top-0 right-0 bottom-0 left-0 z-[99990] flex"
      :style="shellStyle"
    >
      <ErrorBoundary>
        <AgentsWindowShell />
      </ErrorBoundary>
    </div>
  </div>
</template>

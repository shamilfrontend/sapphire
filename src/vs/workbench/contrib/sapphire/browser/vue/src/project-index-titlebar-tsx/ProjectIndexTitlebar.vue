<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  PPR Code — статус индекса проекта в titlebar IDE (слева).
 *--------------------------------------------------------------------------------------*/

import '../styles.css';
import { useIsDark } from '../util/services.js';
import ProjectIndexControls from '../sidebar-tsx/ProjectIndexControls.vue';

const isDark = useIsDark();

const noDrag = { WebkitAppRegion: 'no-drag' };
</script>

<template>
  <div class="@@void-scope flex items-center h-full px-1 text-void-fg-3" :class="{ dark: isDark }" :style="noDrag">
    <ProjectIndexControls :showStatusButton="true" popoverPlacement="bottom-start" />
  </div>
</template>

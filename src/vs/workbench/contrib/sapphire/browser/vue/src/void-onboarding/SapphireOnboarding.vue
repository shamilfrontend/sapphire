<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import { useIsDark, useSettingsState } from '../util/services.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.vue';
import OnboardingContent from './OnboardingContent.vue';

const OVERRIDE_VALUE = false;

const sapphireSettingsState = useSettingsState();
const isDark = useIsDark();

const isOnboardingComplete = computed(
  () => sapphireSettingsState.value.globalSettings.isOnboardingComplete || OVERRIDE_VALUE,
);

const overlayStyle = {
  height: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
</script>

<template>
  <div class="@@void-scope" :class="{ dark: isDark }">
    <div
      class="bg-void-bg-3 fixed top-0 right-0 bottom-0 left-0 width-full z-[99999] transition-all duration-1000"
      :class="
        isOnboardingComplete ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
      "
      :style="overlayStyle"
    >
      <ErrorBoundary>
        <OnboardingContent />
      </ErrorBoundary>
    </div>
  </div>
</template>

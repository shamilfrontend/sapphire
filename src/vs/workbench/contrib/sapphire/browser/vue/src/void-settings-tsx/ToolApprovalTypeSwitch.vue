<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import SapphireSwitch from '../util/SapphireSwitch.vue';
import { useAccessor, useSettingsState } from '../util/services.js';
import { ToolApprovalType } from '../../../../common/toolsServiceTypes.js';

const props = defineProps<{
  approvalType: ToolApprovalType;
  size: 'xxs' | 'xs' | 'sm' | 'sm+' | 'md';
  desc: string;
}>();

const accessor = useAccessor();
const sapphireSettingsService = accessor.get('ISapphireSettingsService');
const sapphireSettingsState = useSettingsState();

const onToggleAutoApprove = (approvalType: ToolApprovalType, newValue: boolean) => {
  sapphireSettingsService.setGlobalSetting('autoApprove', {
    ...sapphireSettingsService.state.globalSettings.autoApprove,
    [approvalType]: newValue,
  });
};
</script>

<template>
  <SapphireSwitch
    :size="size"
    :value="sapphireSettingsState.globalSettings.autoApprove[approvalType] ?? false"
    @change="onToggleAutoApprove(props.approvalType, $event)"
  />
  <span class="text-void-fg-3 text-xs">{{ desc }}</span>
</template>

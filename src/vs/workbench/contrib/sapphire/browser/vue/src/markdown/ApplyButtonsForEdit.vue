<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import { Check, Play, Square, X } from 'lucide-vue-next';
import { URI } from '../../../../../../../base/common/uri.js';
import { isFeatureNameDisabled } from '../../../../common/sapphireSettingsTypes.js';
import { useAccessor, useSettingsState } from '../util/services.js';
import { tooltipPropsForApplyBlock, useApplyStreamState } from './ApplyBlockHoverButtons.js';
import IconShell1 from './IconShell1.vue';

const props = defineProps<{
  codeStr: string;
  applyBoxId: string;
  language?: string;
  uri: URI | 'current';
}>();

const accessor = useAccessor();
const editCodeService = accessor.get('IEditCodeService');
const chatThreadService = accessor.get('IChatThreadService');
const notificationService = accessor.get('INotificationService');

const settingsState = useSettingsState();
const isDisabled = computed(
  () => !!isFeatureNameDisabled('Apply', settingsState.value) || !props.applyBoxId,
);

const { currStreamStateRef, setApplying } = useApplyStreamState(() => props.applyBoxId);
const currStreamState = computed(() => currStreamStateRef.current);

const getUriBeingApplied = (applyBoxId: string) =>
  chatThreadService.getApplyBoxUri(applyBoxId) ?? null;

const onClickSubmit = async () => {
  if (currStreamStateRef.current === 'streaming') return;

  await editCodeService.callBeforeApplyOrEdit(props.uri);

  const [newApplyingUri, applyDonePromise] =
    editCodeService.startApplying({
      from: 'ClickApply',
      applyStr: props.codeStr,
      uri: props.uri,
      startBehavior: 'reject-conflicts',
    }) ?? [];
  setApplying(newApplyingUri);

  if (!applyDonePromise) {
    setApplying(undefined);
    notificationService.info(
      `Ошибка Sapphire: не удалось применить изменения. ${props.uri === 'current' ? 'Этот блок хочет изменить текущий файл, но файл может быть не открыт.' : `Этот блок хочет изменить ${props.uri.fsPath}, но файл может не существовать.`}`,
    );
  }

  // при ошибке прерываем стрим применения
  applyDonePromise?.catch((e) => {
    const appliedUri = getUriBeingApplied(props.applyBoxId);
    if (appliedUri) editCodeService.interruptURIStreaming({ uri: appliedUri });
    notificationService.info(`Ошибка Sapphire: проблема при применении изменений: ${e}.`);
  });
};

const onClickStop = () => {
  if (currStreamStateRef.current !== 'streaming') return;
  const appliedUri = getUriBeingApplied(props.applyBoxId);
  if (!appliedUri) return;
  editCodeService.interruptURIStreaming({ uri: appliedUri });
};

const onAccept = () => {
  const appliedUri = getUriBeingApplied(props.applyBoxId);
  if (appliedUri) {
    editCodeService.acceptOrRejectAllDiffAreas({
      uri: appliedUri,
      behavior: 'accept',
      removeCtrlKs: false,
    });
    setApplying(undefined);
  }
};

const onReject = () => {
  const appliedUri = getUriBeingApplied(props.applyBoxId);
  if (appliedUri) {
    editCodeService.acceptOrRejectAllDiffAreas({
      uri: appliedUri,
      behavior: 'reject',
      removeCtrlKs: false,
    });
    setApplying(undefined);
  }
};
</script>

<template>
  <IconShell1
    v-if="currStreamState === 'streaming'"
    :Icon="Square"
    v-bind="tooltipPropsForApplyBlock({ tooltipName: 'Стоп' })"
    @click="onClickStop"
  />
  <template v-else-if="!isDisabled && currStreamState === 'idle-no-changes'">
    <IconShell1
      :Icon="Play"
      v-bind="tooltipPropsForApplyBlock({ tooltipName: 'Применить' })"
      @click="onClickSubmit"
    />
  </template>
  <template v-else-if="!isDisabled && currStreamState === 'idle-has-changes'">
    <IconShell1
      :Icon="X"
      v-bind="tooltipPropsForApplyBlock({ tooltipName: 'Отклонить' })"
      @click="onReject"
    />
    <IconShell1
      :Icon="Check"
      v-bind="tooltipPropsForApplyBlock({ tooltipName: 'Оставить' })"
      @click="onAccept"
    />
  </template>
</template>

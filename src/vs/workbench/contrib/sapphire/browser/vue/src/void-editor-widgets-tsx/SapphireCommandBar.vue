<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref, watch } from 'vue';
import { EllipsisVertical, MoveDown, MoveLeft, MoveRight, MoveUp } from 'lucide-vue-next';
import { useAccessor, useCommandBarState } from '../util/services.js';
import type { SapphireCommandBarProps } from '../../../sapphireCommandBarService.js';
import {
  SAPPHIRE_ACCEPT_ALL_DIFFS_ACTION_ID,
  SAPPHIRE_ACCEPT_FILE_ACTION_ID,
  SAPPHIRE_GOTO_NEXT_DIFF_ACTION_ID,
  SAPPHIRE_GOTO_NEXT_URI_ACTION_ID,
  SAPPHIRE_GOTO_PREV_DIFF_ACTION_ID,
  SAPPHIRE_GOTO_PREV_URI_ACTION_ID,
  SAPPHIRE_REJECT_ALL_DIFFS_ACTION_ID,
  SAPPHIRE_REJECT_FILE_ACTION_ID,
} from '../../../actionIDs.js';
import AcceptAllButtonWrapper from './AcceptAllButtonWrapper.vue';
import RejectAllButtonWrapper from './RejectAllButtonWrapper.vue';

const props = defineProps<SapphireCommandBarProps>();

const accessor = useAccessor();
const editCodeService = accessor.get('IEditCodeService');
const commandBarService = accessor.get('ISapphireCommandBarService');
const keybindingService = accessor.get('IKeybindingService');
const commandBar = useCommandBarState();
const showAcceptRejectAllButtons = ref(false);

const commandBarState = computed(() => commandBar.value.stateOfURI);
const sortedCommandBarURIs = computed(() => commandBar.value.sortedURIs);

// Индекс текущего URI в sortedCommandBarURIs
const currFileIdx = computed(() => {
  const index = sortedCommandBarURIs.value.findIndex((entry) => entry.fsPath === props.uri?.fsPath);
  return index === -1 ? null : index;
});

// При смене файла прокручиваем редактор к текущему diff
watch(
  () => props.uri,
  (uri) => {
    setTimeout(() => {
      // uri может быть undefined
      if (!uri) return;
      const s = commandBarService.stateOfURI[uri.fsPath];
      if (!s) return;
      const { diffIdx } = s;
      commandBarService.goToDiffIdx(diffIdx ?? 0);
    }, 50);
  },
  { immediate: true },
);

const isFileUri = computed(() => props.uri?.scheme === 'file');

const currDiffIdx = computed(() =>
  props.uri ? (commandBarState.value[props.uri.fsPath]?.diffIdx ?? null) : null,
);
const sortedDiffIds = computed(() =>
  props.uri ? (commandBarState.value[props.uri.fsPath]?.sortedDiffIds ?? []) : [],
);

const isADiffInThisFile = computed(() => sortedDiffIds.value.length !== 0);
const isADiffZoneInAnyFile = computed(() => sortedCommandBarURIs.value.length !== 0);

const streamState = computed(() => {
  void commandBar.value;
  return props.uri ? commandBarService.getStreamState(props.uri) : null;
});
const showAcceptRejectAll = computed(() => streamState.value === 'idle-has-changes');

const nextDiffIdx = computed(() => {
  void commandBar.value;
  return commandBarService.getNextDiffIdx(1);
});
const prevDiffIdx = computed(() => {
  void commandBar.value;
  return commandBarService.getNextDiffIdx(-1);
});
const nextURIIdx = computed(() => {
  void commandBar.value;
  return commandBarService.getNextUriIdx(1);
});
const prevURIIdx = computed(() => {
  void commandBar.value;
  return commandBarService.getNextUriIdx(-1);
});

const upDownDisabled = computed(() => prevDiffIdx.value === null || nextDiffIdx.value === null);
const leftRightDisabled = computed(() => prevURIIdx.value === null || nextURIIdx.value === null);

// Принять/отклонить все diff-зоны текущего файла
const onAcceptFile = () => {
  if (!props.uri) return;
  editCodeService.acceptOrRejectAllDiffAreas({
    uri: props.uri,
    behavior: 'accept',
    removeCtrlKs: false,
    _addToHistory: true,
  });
};
const onRejectFile = () => {
  if (!props.uri) return;
  editCodeService.acceptOrRejectAllDiffAreas({
    uri: props.uri,
    behavior: 'reject',
    removeCtrlKs: false,
    _addToHistory: true,
  });
};

const onAcceptAll = () => {
  commandBarService.acceptOrRejectAllFiles({ behavior: 'accept' });
  showAcceptRejectAllButtons.value = false;
};

const onRejectAll = () => {
  commandBarService.acceptOrRejectAllFiles({ behavior: 'reject' });
  showAcceptRejectAllButtons.value = false;
};

const keybindLabel = (id: string, aria: boolean) => {
  const binding = keybindingService.lookupKeybinding(id);
  const raw = (aria ? binding?.getAriaLabel() : binding?.getLabel()) || '';
  return editCodeService.processRawKeybindingText(raw);
};

const upKeybindLabel = computed(() => {
  void commandBar.value;
  return keybindLabel(SAPPHIRE_GOTO_PREV_DIFF_ACTION_ID, false);
});
const downKeybindLabel = computed(() => {
  void commandBar.value;
  return keybindLabel(SAPPHIRE_GOTO_NEXT_DIFF_ACTION_ID, false);
});
const leftKeybindLabel = computed(() => {
  void commandBar.value;
  return keybindLabel(SAPPHIRE_GOTO_PREV_URI_ACTION_ID, false);
});
const rightKeybindLabel = computed(() => {
  void commandBar.value;
  return keybindLabel(SAPPHIRE_GOTO_NEXT_URI_ACTION_ID, false);
});
const acceptFileKeybindLabel = computed(() => {
  void commandBar.value;
  return keybindLabel(SAPPHIRE_ACCEPT_FILE_ACTION_ID, true);
});
const rejectFileKeybindLabel = computed(() => {
  void commandBar.value;
  return keybindLabel(SAPPHIRE_REJECT_FILE_ACTION_ID, true);
});
const acceptAllKeybindLabel = computed(() => {
  void commandBar.value;
  return keybindLabel(SAPPHIRE_ACCEPT_ALL_DIFFS_ACTION_ID, true);
});
const rejectAllKeybindLabel = computed(() => {
  void commandBar.value;
  return keybindLabel(SAPPHIRE_REJECT_ALL_DIFFS_ACTION_ID, true);
});

const upTooltip = computed(() => (upKeybindLabel.value ? `${upKeybindLabel.value}` : ''));
const downTooltip = computed(() => (downKeybindLabel.value ? `${downKeybindLabel.value}` : ''));
const leftTooltip = computed(() => (leftKeybindLabel.value ? `${leftKeybindLabel.value}` : ''));
const rightTooltip = computed(() => (rightKeybindLabel.value ? `${rightKeybindLabel.value}` : ''));

const onActivateKey = (event: KeyboardEvent, run: () => void) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    run();
  }
};

const goToNextUri = () => {
  void commandBarService.goToURIIdx(nextURIIdx.value);
};
const goToPrevUri = () => {
  void commandBarService.goToURIIdx(prevURIIdx.value);
};
const goToPrevDiff = () => {
  commandBarService.goToDiffIdx(prevDiffIdx.value);
};
const goToNextDiff = () => {
  commandBarService.goToDiffIdx(nextDiffIdx.value);
};

const showBar = computed(() => isFileUri.value && isADiffZoneInAnyFile.value);
</script>

<template>
  <!-- Только file: — не встроенные виртуальные редакторы -->
  <div v-if="showBar && currFileIdx === null" class="pointer-events-auto">
    <div
      class="flex items-center bg-void-bg-1 rounded-lg shadow-lg border border-void-border-2 [&>*:first-child]:pl-3 [&>*:last-child]:pr-3 [&>*]:border-r [&>*]:border-void-border-2 [&>*:last-child]:border-r-0 overflow-hidden"
    >
      <div class="flex items-center px-3 py-1.5">
        <span class="text-xs whitespace-nowrap text-void-fg-2">
          {{
            `${sortedCommandBarURIs.length} file${sortedCommandBarURIs.length === 1 ? '' : 's'} changed`
          }}
        </span>
      </div>
      <button
        class="text-xs whitespace-nowrap cursor-pointer flex items-center justify-center gap-1 bg-void-bg-2-hover text-void-fg-1 hover:bg-void-bg-2-alt h-full px-3"
        @click="goToNextUri"
        @keydown="onActivateKey($event, goToNextUri)"
      >
        Next <MoveRight class="size-3 my-1" />
      </button>
    </div>
  </div>

  <div v-else-if="showBar" class="pointer-events-auto">
    <!-- «Принять/отклонить все» — после клика по ⋮ -->
    <div v-if="showAcceptRejectAllButtons && showAcceptRejectAll" class="flex justify-end mb-1">
      <div class="inline-flex bg-void-bg-1 rounded-lg shadow-lg border border-void-border-2 overflow-hidden">
        <div class="flex items-center gap-0.5 p-0.5">
          <!-- text с хоткеем: Accept All + acceptAllKeybindLabel -->
          <AcceptAllButtonWrapper
            text="Принять все"
            data-tooltip-id="sapphire-tooltip"
            :data-tooltip-content="acceptAllKeybindLabel"
            data-tooltip-delay-show="500"
            @click="onAcceptAll"
          />
          <!-- text с хоткеем: Reject All + rejectAllKeybindLabel -->
          <RejectAllButtonWrapper
            text="Отклонить все"
            data-tooltip-id="sapphire-tooltip"
            :data-tooltip-content="rejectAllKeybindLabel"
            data-tooltip-delay-show="500"
            @click="onRejectAll"
          />
        </div>
      </div>
    </div>

    <div
      class="flex items-center bg-void-bg-1 rounded-lg shadow-lg border border-void-border-2 [&>*:first-child]:pl-3 [&>*:last-child]:pr-3 [&>*]:px-3 [&>*]:border-r [&>*]:border-void-border-2 [&>*:last-child]:border-r-0 overflow-hidden"
    >
      <!-- Навигация по diff в файле -->
      <div class="flex items-center py-0.5">
        <button
          class="cursor-pointer"
          :disabled="upDownDisabled"
          data-tooltip-id="sapphire-tooltip"
          :data-tooltip-content="upTooltip"
          data-tooltip-delay-show="500"
          @click="goToPrevDiff"
          @keydown="onActivateKey($event, goToPrevDiff)"
        >
          <MoveUp class="size-3 transition-opacity duration-200 opacity-70 hover:opacity-100" />
        </button>
        <span class="text-xs whitespace-nowrap px-1" :class="{ 'opacity-70': !isADiffInThisFile }">
          <template v-if="isADiffInThisFile">
            Diff {{ (currDiffIdx ?? 0) + 1 }} of {{ sortedDiffIds.length }}
          </template>
          <template v-else-if="streamState === 'streaming'">No changes yet</template>
          <template v-else>No changes</template>
        </span>
        <button
          class="cursor-pointer"
          :disabled="upDownDisabled"
          data-tooltip-id="sapphire-tooltip"
          :data-tooltip-content="downTooltip"
          data-tooltip-delay-show="500"
          @click="goToNextDiff"
          @keydown="onActivateKey($event, goToNextDiff)"
        >
          <MoveDown class="size-3 transition-opacity duration-200 opacity-70 hover:opacity-100" />
        </button>
      </div>

      <!-- Навигация между файлами с правками -->
      <div class="flex items-center py-0.5">
        <button
          class="cursor-pointer"
          :disabled="leftRightDisabled"
          data-tooltip-id="sapphire-tooltip"
          :data-tooltip-content="leftTooltip"
          data-tooltip-delay-show="500"
          @click="goToPrevUri"
          @keydown="onActivateKey($event, goToPrevUri)"
        >
          <MoveLeft class="size-3 transition-opacity duration-200 opacity-70 hover:opacity-100" />
        </button>
        <span class="text-xs whitespace-nowrap px-1 mx-0.5">
          <template v-if="currFileIdx !== null">
            File {{ currFileIdx + 1 }} of {{ sortedCommandBarURIs.length }}
          </template>
          <template v-else>
            {{ sortedCommandBarURIs.length }} file{{ sortedCommandBarURIs.length === 1 ? '' : 's' }}
          </template>
        </span>
        <button
          class="cursor-pointer"
          :disabled="leftRightDisabled"
          data-tooltip-id="sapphire-tooltip"
          :data-tooltip-content="rightTooltip"
          data-tooltip-delay-show="500"
          @click="goToNextUri"
          @keydown="onActivateKey($event, goToNextUri)"
        >
          <MoveRight class="size-3 transition-opacity duration-200 opacity-70 hover:opacity-100" />
        </button>
      </div>

      <!-- Принять/отклонить файл — когда стрим завершён и есть изменения -->
      <div v-if="showAcceptRejectAll" class="flex self-stretch gap-0 !px-0 !py-0">
        <!-- text с хоткеем Accept File -->
        <AcceptAllButtonWrapper
          text="Принять файл"
          data-tooltip-id="sapphire-tooltip"
          :data-tooltip-content="acceptFileKeybindLabel"
          data-tooltip-delay-show="500"
          @click="onAcceptFile"
        />
        <!-- text с хоткеем Reject File -->
        <RejectAllButtonWrapper
          text="Отклонить файл"
          data-tooltip-id="sapphire-tooltip"
          :data-tooltip-content="rejectFileKeybindLabel"
          data-tooltip-delay-show="500"
          @click="onRejectFile"
        />
      </div>
      <!-- Меню ⋮ — показать accept/reject all -->
      <div
        v-if="showAcceptRejectAll"
        class="!px-0 !py-0 self-stretch flex justify-center items-center"
      >
        <div
          class="cursor-pointer px-1 self-stretch flex justify-center items-center"
          @click="showAcceptRejectAllButtons = !showAcceptRejectAllButtons"
        >
          <EllipsisVertical class="size-3" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onWatcherCleanup, ref, watch } from 'vue';
import { File, Folder, Text } from 'lucide-vue-next';
import {
  useAccessor,
  useActiveURI,
  useChatThreadsState,
  useSettingsState,
} from '../util/services.js';
import { StagingSelectionItem } from '../../../../common/chatThreadServiceTypes.js';
import {
  isAttachableActiveFileUri,
  uriAlreadyInSelections,
} from '../../../../common/activeFileAttach.js';
import { getBasename, uniquePathLabels } from '../../../../common/pathLabels.js';
import { getRelative, sapphireOpenFileFn } from './chatFileUtils.js';
import IconX from './IconX.vue';

const AUTO_ACTIVE_FILE_TOOLTIP =
  'Содержимое активного файла уйдёт в контекст сообщения. Нажмите ×, чтобы не прикреплять в этот раз.';

const HEURISTIC_FILE_TOOLTIP =
  'Файл найден автоматически по тексту запроса и добавлен в контекст. Нажмите ×, чтобы не прикреплять его в следующий раз.';

const props = defineProps<
  | {
      type: 'past';
      selections: StagingSelectionItem[];
      messageIdx: number;
    }
  | {
      type: 'staging';
      selections: StagingSelectionItem[];
      messageIdx?: number;
    }
>();

const accessor = useAccessor();
const modelReferenceService = accessor.get('ISapphireModelService');
const chatThreadService = accessor.get('IChatThreadService');
const settingsState = useSettingsState();
// перерисовка при omit и смене состояния треда
const threadsState = useChatThreadsState();
const omitAutoActiveFsPath = computed(() => {
  void threadsState.value;
  return chatThreadService.getOmitAutoActiveFileFsPath();
});

const activeURI = useActiveURI();

// сбрасываем omit при смене активного файла
watch(
  () => [activeURI.uri, props.type, omitAutoActiveFsPath.value] as const,
  () => {
    if (props.type !== 'staging') return;
    const currentURI = activeURI.uri;
    const omit = omitAutoActiveFsPath.value;
    if (omit && currentURI && omit !== currentURI.fsPath) {
      chatThreadService.clearOmitAutoActiveFile();
    }
    if (omit && !currentURI) {
      chatThreadService.clearOmitAutoActiveFile();
    }
  },
  { immediate: true },
);

const autoActiveSelection = ref<StagingSelectionItem | null>(null);

const autoAttachEnabled = computed(
  () => settingsState.value.globalSettings.autoAttachActiveFile !== false,
);
const selections = computed(() => props.selections ?? []);

// Виртуальная «Активный» метка: файл редактора, если autoAttach и не в omit/heuristics.
watch(
  () =>
    [
      props.type,
      autoAttachEnabled.value,
      activeURI.uri,
      props.selections,
      omitAutoActiveFsPath.value,
    ] as const,
  () => {
    let cancelled = false;
    const computeAuto = async () => {
      const currentURI = activeURI.uri;
      if (props.type !== 'staging' || !autoAttachEnabled.value || !isAttachableActiveFileUri(currentURI)) {
        if (!cancelled) autoActiveSelection.value = null;
        return;
      }
      if (uriAlreadyInSelections(selections.value, currentURI.fsPath)) {
        if (!cancelled) autoActiveSelection.value = null;
        return;
      }
      if (omitAutoActiveFsPath.value === currentURI.fsPath) {
        if (!cancelled) autoActiveSelection.value = null;
        return;
      }
      const language =
        (await modelReferenceService.getModelSafe(currentURI)).model?.getLanguageId() ||
        'plaintext';
      if (!cancelled) {
        autoActiveSelection.value = { type: 'File', uri: currentURI, language };
      }
    };
    void computeAuto();
    onWatcherCleanup(() => {
      cancelled = true;
    });
  },
  { immediate: true },
);

const autoList = computed(() => (autoActiveSelection.value ? [autoActiveSelection.value] : []));
const allSelections = computed(() => [...(selections.value ?? []), ...(autoList.value ?? [])]);
const hasSelections = computed(() => (allSelections.value?.length ?? 0) > 0);
const selectionPathLabels = computed(() =>
  uniquePathLabels(allSelections.value.map((s) => getRelative(s.uri, accessor) ?? s.uri.fsPath)),
);
const autoStart = computed(() => selections.value.length);
const autoEnd = computed(() => autoStart.value + autoList.value.length);

const selectionKey = (selection: StagingSelectionItem, i: number) => {
  const isThisSelectionAutoActive = i >= autoStart.value && i < autoEnd.value;
  const isThisSelectionHeuristic =
    !isThisSelectionAutoActive && selection.type === 'File' && !!selection.fromHeuristic;
  if (selection.type === 'CodeSelection') {
    return selection.type + selection.language + selection.range + selection.uri.fsPath;
  }
  if (selection.type === 'File') {
    return (
      (isThisSelectionAutoActive ? 'auto-' : isThisSelectionHeuristic ? 'heur-' : '') +
      selection.type +
      selection.language +
      selection.uri.fsPath
    );
  }
  if (selection.type === 'Folder') {
    return selection.type + selection.uri.fsPath;
  }
  return String(i);
};

const iconFor = (selection: StagingSelectionItem) => {
  if (selection.type === 'File') return File;
  if (selection.type === 'Folder') return Folder;
  if (selection.type === 'CodeSelection') return Text;
  return undefined as never;
};

const openSelection = (selection: StagingSelectionItem) => {
  if (props.type !== 'staging') return;
  if (selection.type === 'File') {
    sapphireOpenFileFn(selection.uri, accessor);
  } else if (selection.type === 'CodeSelection') {
    sapphireOpenFileFn(selection.uri, accessor, selection.range);
  } else if (selection.type === 'Folder') {
    accessor.get('ICommandService').executeCommand('revealInExplorer', selection.uri);
  }
};

const removeSelection = (
  e: MouseEvent,
  selection: StagingSelectionItem,
  i: number,
  isThisSelectionAutoActive: boolean,
  isThisSelectionHeuristic: boolean,
) => {
  e.stopPropagation();
  if (isThisSelectionAutoActive) {
    autoActiveSelection.value = null;
    chatThreadService.omitAutoActiveFileForNextSend(selection.uri.fsPath);
    return;
  }
  if (isThisSelectionHeuristic) {
    chatThreadService.omitHeuristicFileForNextSend(selection.uri.fsPath);
    if (props.type === 'staging') {
      // убираем из staging (индекс в selections)
      chatThreadService.removeStagingSelectionAt(i, props.messageIdx);
    }
    return;
  }
  if (props.type === 'staging') {
    chatThreadService.removeStagingSelectionAt(i, props.messageIdx);
  }
};
</script>

<template>
  <div
    v-if="hasSelections"
    class="flex items-center flex-wrap text-left relative gap-x-0.5 gap-y-1 pb-0.5"
  >
    <div
      v-for="(selection, i) in allSelections"
      :key="selectionKey(selection, i)"
      class="flex flex-col space-y-[1px]"
    >
      <span
        class="truncate overflow-hidden text-ellipsis"
        data-tooltip-id="sapphire-tooltip"
        :data-tooltip-content="
          i >= autoStart && i < autoEnd
            ? AUTO_ACTIVE_FILE_TOOLTIP
            : !(i >= autoStart && i < autoEnd) && selection.type === 'File' && !!selection.fromHeuristic
              ? HEURISTIC_FILE_TOOLTIP
              : getRelative(selection.uri, accessor)
        "
        data-tooltip-place="top"
        :data-tooltip-delay-show="
          (i >= autoStart && i < autoEnd) ||
          (!(i >= autoStart && i < autoEnd) && selection.type === 'File' && !!selection.fromHeuristic)
            ? 0
            : 3000
        "
        :data-tooltip-class-name="
          (i >= autoStart && i < autoEnd) ||
          (!(i >= autoStart && i < autoEnd) && selection.type === 'File' && !!selection.fromHeuristic)
            ? 'sapphire-max-w-[300px]'
            : undefined
        "
      >
        <div
          :class="`
								flex items-center gap-1 relative
								px-1
								w-fit h-fit
								select-none
								text-xs text-nowrap
								border rounded-sm
								${
                  (i >= autoStart && i < autoEnd) ||
                  (!(i >= autoStart && i < autoEnd) &&
                    selection.type === 'File' &&
                    !!selection.fromHeuristic)
                    ? 'bg-void-bg-1 text-void-fg-2 border-void-border-2'
                    : 'bg-void-bg-1 hover:brightness-95 text-void-fg-1 border-void-border-1'
                }
								hover:border-void-border-1
								transition-all duration-150
							`"
          @click="openSelection(selection)"
        >
          <component :is="iconFor(selection)" :size="10" />

          {{
            (selectionPathLabels[i] || getBasename(selection.uri.fsPath)) +
            (selection.type === 'CodeSelection'
              ? ` (${selection.range[0]}-${selection.range[1]})`
              : '')
          }}

          <span
            v-if="i >= autoStart && i < autoEnd"
            class="text-[10px] text-void-fg-3 opacity-90"
          >
            Активный
          </span>
          <span
            v-else-if="selection.type === 'File' && !!selection.fromHeuristic"
            class="text-[10px] text-void-fg-3 opacity-90"
          >
            Найдено
          </span>

          <div
            v-if="
              type === 'staging' ||
              (type === 'past' &&
                !(i >= autoStart && i < autoEnd) &&
                selection.type === 'File' &&
                !!selection.fromHeuristic)
            "
            class="cursor-pointer z-1 self-stretch flex items-center justify-center"
            @click="
              removeSelection(
                $event,
                selection,
                i,
                i >= autoStart && i < autoEnd,
                !(i >= autoStart && i < autoEnd) &&
                  selection.type === 'File' &&
                  !!selection.fromHeuristic,
              )
            "
          >
            <IconX class="stroke-[2]" :size="10" />
          </div>
        </div>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { onMounted, onUnmounted, ref, watch } from 'vue';
import { MoreVertical } from 'lucide-vue-next';
import { useAccessor } from '../util/services.js';
import { SAPPHIRE_CTRL_K_ACTION_ID, SAPPHIRE_CTRL_L_ACTION_ID } from '../../../actionIDs.js';
import { SAPPHIRE_OPEN_SETTINGS_ACTION_ID } from '../../../sapphireSettingsPane.js';
import type { SapphireSelectionHelperProps } from '../../../sapphireSelectionHelperWidget.js';

const props = defineProps<SapphireSelectionHelperProps>();

const accessor = useAccessor();
const keybindingService = accessor.get('IKeybindingService');
const commandService = accessor.get('ICommandService');

const ctrlLKeybind = keybindingService.lookupKeybinding(SAPPHIRE_CTRL_L_ACTION_ID);
const ctrlKKeybind = keybindingService.lookupKeybinding(SAPPHIRE_CTRL_K_ACTION_ID);

const reactRerenderCount = ref(props.rerenderKey);
const clickState = ref<'init' | 'clickedOption' | 'clickedMore'>('init');

let commandDisposable: { dispose: () => void } | undefined;

onMounted(() => {
  commandDisposable = commandService.onWillExecuteCommand((e) => {
    if (e.commandId === SAPPHIRE_CTRL_L_ACTION_ID || e.commandId === SAPPHIRE_CTRL_K_ACTION_ID) {
      clickState.value = 'clickedOption';
    }
  });
});

onUnmounted(() => {
  commandDisposable?.dispose();
});

// Сброс UI при новом rerenderKey с виджета VS Code
watch(
  () => props.rerenderKey,
  (rerenderKey) => {
    if (reactRerenderCount.value !== rerenderKey) {
      reactRerenderCount.value = rerenderKey;
      clickState.value = 'init';
    }
  },
);
// useEffect(() => {
// }, [rerenderKey, reactRerenderCount, setReactRerenderKey, setClickState])

const addToChat = () => {
  void commandService.executeCommand(SAPPHIRE_CTRL_L_ACTION_ID);
  clickState.value = 'clickedOption';
};

const editSelection = () => {
  void commandService.executeCommand(SAPPHIRE_CTRL_K_ACTION_ID);
  clickState.value = 'clickedOption';
};

const openSettings = () => {
  void commandService.executeCommand(SAPPHIRE_OPEN_SETTINGS_ACTION_ID);
  clickState.value = 'clickedOption';
};
</script>

<template>
  <!-- После выбора пункта виджет скрываем -->
  <div
    v-if="clickState !== 'clickedOption'"
    class="pointer-events-auto select-none z-[1000] rounded-sm shadow-md flex flex-nowrap text-nowrap border border-void-border-3 bg-void-bg-2 transition-all duration-200"
  >
    <template v-if="clickState === 'init'">
      <div
        v-if="ctrlLKeybind"
        class="flex items-center px-2 py-1.5 cursor-pointer"
        @click="addToChat"
      >
        <span>Добавить в чат</span>
        <span
          class="ml-1 px-1 rounded bg-[var(--vscode-keybindingLabel-background)] text-[var(--vscode-keybindingLabel-foreground)] border border-[var(--vscode-keybindingLabel-border)]"
        >
          {{ ctrlLKeybind.getLabel() }}
        </span>
      </div>
      <div v-if="ctrlLKeybind && ctrlKKeybind" class="w-[0.5px] bg-void-border-3" />
      <div
        v-if="ctrlKKeybind"
        class="flex items-center px-2 py-1.5 cursor-pointer"
        @click="editSelection"
      >
        <span class="ml-1">Редактировать</span>
        <span
          class="ml-1 px-1 rounded bg-[var(--vscode-keybindingLabel-background)] text-[var(--vscode-keybindingLabel-foreground)] border border-[var(--vscode-keybindingLabel-border)]"
        >
          {{ ctrlKKeybind.getLabel() }}
        </span>
      </div>
      <div class="w-[0.5px] bg-void-border-3" />
      <div class="flex items-center px-0.5 cursor-pointer" @click="clickState = 'clickedMore'">
        <MoreVertical class="w-4" />
      </div>
    </template>
    <template v-else-if="clickState === 'clickedMore'">
      <div class="flex items-center px-2 py-1.5 cursor-pointer" @click="openSettings">
        Отключить подсказки?
      </div>
      <div class="w-[0.5px] bg-void-border-3" />
      <div class="flex items-center px-0.5 cursor-pointer" @click="clickState = 'init'">
        <MoreVertical class="w-4" />
      </div>
    </template>
  </div>
</template>

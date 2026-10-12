<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  PPR Code — fullscreen Режим Агент (chat-first shell).
 *--------------------------------------------------------------------------------------*/

import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';
import { Folder, FolderPlus, PanelLeft, Plus, Search, Settings as SettingsIcon } from 'lucide-vue-next';
import { isMacintosh, isNative } from '../../../../../../../base/common/platform.js';
import { useAccessor, useChatThreadsState, useCommandBarState } from '../util/services.js';
import { threadTitle } from '../util/threadDisplay.js';
import SidebarChat from '../sidebar-tsx/SidebarChat.vue';
import SidebarChatTabs from '../sidebar-tsx/SidebarChatTabs.vue';
import Settings from '../void-settings-tsx/Settings.vue';
import { provideAgentsReview } from './AgentsReviewContext.js';
import { provideAgentsPlan } from './AgentsPlanContext.js';
import { reviewFilesLabel } from './agentsReview.js';
import AgentsReviewPane from './AgentsReviewPane.vue';
import AgentsPlanPane from './AgentsPlanPane.vue';
import AgentsThreadTree from './AgentsThreadTree.vue';

const SIDEBAR_KEY = 'ppr.agentsSidebarCollapsed';
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const workspaceLabel = (workspaceService: {
  getWorkspace: () => { folders: { name: string; uri: { fsPath: string } }[] };
}) => {
  const folders = workspaceService.getWorkspace().folders;
  if (folders.length === 0) return { empty: true, name: '', path: '' };
  return {
    empty: false,
    name: folders.map((folder) => folder.name).join(', '),
    path: folders.map((folder) => folder.uri.fsPath).join('\n'),
  };
};

const readSidebarCollapsed = (): boolean => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
};

const accessor = useAccessor();
const chatThreadsService = accessor.get('IChatThreadService');
const commandService = accessor.get('ICommandService');
const sapphireSettingsService = accessor.get('ISapphireSettingsService');
const workspaceService = accessor.get('IWorkspaceContextService');
const query = ref('');
const sidebarCollapsed = ref(readSidebarCollapsed());
const settingsOpen = ref(false);
const settingsActive = ref(false);
const editingFolderId = ref<string | null>(null);
const threadsState = useChatThreadsState();
const commandBarState = useCommandBarState();
const sortedURIs = computed(() => commandBarState.value.sortedURIs);
const workspace = ref(workspaceLabel(workspaceService));
let workspaceDisposable: { dispose: () => void } | undefined;
const reviewOpen = ref(false);
const planFsPath = ref<string | null>(null);
const selectedFsPath = ref<string | null>(null);

onMounted(() => {
  const update = () => {
    workspace.value = workspaceLabel(workspaceService);
  };
  update();
  workspaceDisposable = workspaceService.onDidChangeWorkspaceFolders(update);
});
onUnmounted(() => {
  workspaceDisposable?.dispose();
});

// Панель review закрыта, пока пользователь не откроет; сбрасываем устаревший выбор при пустом списке.
watch(
  sortedURIs,
  (uris) => {
    if (uris.length === 0) {
      reviewOpen.value = false;
      selectedFsPath.value = null;
      return;
    }
    const current = selectedFsPath.value;
    selectedFsPath.value = current && uris.some((uri) => uri.fsPath === current) ? current : null;
  },
  { immediate: true },
);

const openReview = (fsPath?: string) => {
  planFsPath.value = null;
  reviewOpen.value = true;
  if (fsPath) {
    selectedFsPath.value = fsPath;
  } else {
    selectedFsPath.value = selectedFsPath.value ?? sortedURIs.value[0]?.fsPath ?? null;
  }
};

const openPlan = (fsPath: string) => {
  reviewOpen.value = false;
  planFsPath.value = fsPath;
};

const openFolder = () => {
  void commandService.executeCommand(
    isMacintosh && isNative
      ? 'workbench.action.files.openFileFolder'
      : 'workbench.action.files.openFolder',
  );
};

const headerTitle = computed(() =>
  settingsActive.value
    ? 'Настройки'
    : threadTitle(threadsState.value.allThreads[threadsState.value.currentThreadId]),
);

const toggleSidebar = () => {
  const next = !sidebarCollapsed.value;
  sidebarCollapsed.value = next;
  try {
    localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
  } catch {
    // localStorage недоступен (квота / приватный режим)
  }
};

const openSettingsTab = () => {
  settingsOpen.value = true;
  settingsActive.value = true;
};

const activateSettings = () => {
  settingsActive.value = true;
};

const closeSettingsTab = () => {
  settingsOpen.value = false;
  settingsActive.value = false;
};

const leaveSettings = () => {
  settingsActive.value = false;
};

const showPlan = computed(() => !!planFsPath.value && !settingsActive.value);
const showReview = computed(() => reviewOpen.value && sortedURIs.value.length > 0 && !showPlan.value);
const showSidePane = computed(() => showReview.value || showPlan.value);

const reviewApi = reactive({
  openReview,
  get reviewOpen() {
    return showReview.value;
  },
});
const planApi = reactive({
  openPlan,
  get planOpen() {
    return showPlan.value;
  },
});
provideAgentsReview(reviewApi);
provideAgentsPlan(planApi);

const setIdeMode = () => {
  sapphireSettingsService.setGlobalSetting('layoutMode', 'ide');
};

const createFolder = () => {
  const id = chatThreadsService.createFolder('Новая папка', null);
  editingFolderId.value = id;
};

const openNewChat = () => {
  leaveSettings();
  chatThreadsService.openNewThread();
};

const toggleReview = () => {
  if (showReview.value) {
    reviewOpen.value = false;
  } else {
    openReview();
  }
};
</script>

<template>
  <aside
    v-if="!sidebarCollapsed"
    class="w-[260px] shrink-0 h-full flex flex-col bg-void-bg-2 border-r border-void-border-2"
  >
    <div class="px-3 pt-3 pb-2 flex flex-col gap-2">
      <button
        v-if="workspace.empty"
        type="button"
        class="shrink-0 cursor-pointer rounded-full px-3 py-1 text-sm bg-[#0e639c] text-white hover:bg-[#1177bb]"
        :style="noDrag"
        @click="openFolder"
      >
        Открыть папку
      </button>
      <div v-else class="flex items-center gap-2 min-w-0 px-1" :title="workspace.path">
        <Folder class="w-4 h-4 shrink-0 text-void-fg-3" />
        <span class="truncate text-root font-medium text-void-fg-1">{{ workspace.name }}</span>
      </div>
      <button
        type="button"
        class="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm bg-void-bg-1 hover:bg-void-bg-2-alt text-left cursor-pointer"
        :style="noDrag"
        @click="openNewChat"
      >
        <Plus class="w-4 h-4 shrink-0 pointer-events-none" />
        <span class="flex-1 pointer-events-none">Новый чат</span>
      </button>
      <div class="flex items-center gap-1.5">
        <div
          class="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-md bg-void-bg-1 border border-void-border-2"
        >
          <Search class="w-3.5 h-3.5 shrink-0 text-void-fg-3" />
          <input
            v-model="query"
            placeholder="Поиск чатов"
            spellcheck="false"
            class="w-full bg-transparent text-sm text-void-fg-1 placeholder:text-void-fg-3 focus:outline-none"
          />
        </div>
        <button
          type="button"
          title="Новая папка"
          aria-label="Новая папка"
          class="shrink-0 w-8 h-8 flex items-center justify-center rounded-md border border-void-border-2 bg-void-bg-1 hover:bg-void-bg-2-alt text-void-fg-2"
          @click="createFolder"
        >
          <FolderPlus class="w-4 h-4" />
        </button>
      </div>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
      <AgentsThreadTree
        :filterText="query"
        :editingFolderId="editingFolderId"
        @editingFolderIdChange="editingFolderId = $event"
        @threadOpen="leaveSettings"
      />
    </div>
  </aside>

  <main class="flex-1 min-w-0 h-full flex flex-col bg-[var(--void-content-bg)]">
    <header
      class="h-12 shrink-0 flex items-center gap-2 px-2 border-b border-void-border-2 bg-[var(--void-header-bg)]"
    >
      <button
        type="button"
        :title="sidebarCollapsed ? 'Показать список чатов' : 'Скрыть список чатов'"
        :aria-label="sidebarCollapsed ? 'Показать список чатов' : 'Скрыть список чатов'"
        :aria-pressed="!sidebarCollapsed"
        class="w-8 h-8 shrink-0 flex items-center justify-center rounded-md text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2"
        @click="toggleSidebar"
      >
        <PanelLeft class="w-4 h-4" />
      </button>
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <template v-if="sidebarCollapsed">
          <button
            v-if="workspace.empty"
            type="button"
            class="shrink-0 cursor-pointer rounded-full px-3 py-1 text-sm bg-[#0e639c] text-white hover:bg-[#1177bb]"
            :style="noDrag"
            @click="openFolder"
          >
            Открыть папку
          </button>
          <span
            v-else
            class="shrink-0 max-w-[40%] truncate text-root font-medium text-void-fg-1"
            :title="workspace.path"
          >
            {{ workspace.name }}
          </span>
        </template>
        <span
          class="truncate"
          :class="
            sidebarCollapsed ? 'text-sm text-void-fg-3' : 'text-sm font-medium text-void-fg-1'
          "
          :title="headerTitle"
        >
          {{ headerTitle }}
        </span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button
          v-if="sortedURIs.length > 0"
          type="button"
          title="Изменения"
          aria-label="Изменения"
          :aria-pressed="showReview"
          class="px-2.5 h-8 rounded-md text-sm"
          :class="
            showReview
              ? 'bg-[#0e639c]/20 text-void-fg-1 font-medium'
              : 'text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2'
          "
          @click="toggleReview"
        >
          {{ reviewFilesLabel(sortedURIs.length) }}
        </button>
        <button
          type="button"
          title="Настройки Sapphire"
          aria-label="Настройки Sapphire"
          class="w-8 h-8 flex items-center justify-center rounded-md"
          :class="
            settingsActive
              ? 'text-void-fg-1 bg-[#0e639c]/20'
              : 'text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2'
          "
          @click="openSettingsTab"
        >
          <SettingsIcon class="w-4 h-4" />
        </button>
        <button
          type="button"
          class="px-3 py-1 rounded-full text-sm bg-[#0e639c] text-white hover:bg-[#1177bb]"
          @click="setIdeMode"
        >
          Режим IDE ↗
        </button>
      </div>
    </header>
    <SidebarChatTabs
      variant="agents"
      :showHistoryButton="sidebarCollapsed"
      :settingsTab="{ open: settingsOpen, active: settingsActive }"
      :onActivateSettings="activateSettings"
      :onCloseSettings="closeSettingsTab"
      :onSelectThread="leaveSettings"
    />
    <div class="flex-1 min-h-0 flex">
      <div
        class="h-full"
        :class="showSidePane ? 'min-w-[380px] flex-1 max-w-[800px]' : 'flex-1 min-w-0'"
      >
        <Settings v-if="settingsActive" variant="agents" />
        <SidebarChat v-else variant="agents" />
      </div>
      <AgentsReviewPane
        v-if="showReview"
        :selectedFsPath="selectedFsPath"
        @close="reviewOpen = false"
      />
      <AgentsPlanPane
        v-if="showPlan && planFsPath"
        :fsPath="planFsPath"
        @close="planFsPath = null"
      />
    </div>
  </main>
</template>

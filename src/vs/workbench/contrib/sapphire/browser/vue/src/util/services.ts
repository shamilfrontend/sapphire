/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue';
import { ProviderName } from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsTypes.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import {
  SapphireSettingsState,
  ISapphireSettingsService,
} from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsService.js';
import { ColorScheme } from '../../../../../../../platform/theme/common/theme.js';
import {
  RefreshModelStateOfProvider,
  IRefreshModelService,
} from '../../../../../../../workbench/contrib/sapphire/common/refreshModelService.js';

import { ServicesAccessor } from '../../../../../../../editor/browser/editorExtensions.js';
import { IExplorerService } from '../../../../../../../workbench/contrib/files/browser/files.js';
import { IModelService } from '../../../../../../../editor/common/services/model.js';
import { IClipboardService } from '../../../../../../../platform/clipboard/common/clipboardService.js';
import {
  IContextViewService,
  IContextMenuService,
} from '../../../../../../../platform/contextview/browser/contextView.js';
import { IFileService } from '../../../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../../../platform/hover/browser/hover.js';
import { IThemeService } from '../../../../../../../platform/theme/common/themeService.js';
import { ILLMMessageService } from '../../../../common/sendLLMMessageService.js';

import { IInstantiationService } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditorService } from '../../../../../../../editor/browser/services/codeEditorService.js';
import { ICommandService } from '../../../../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../../../../platform/contextkey/common/contextkey.js';
import { INotificationService } from '../../../../../../../platform/notification/common/notification.js';
import { IAccessibilityService } from '../../../../../../../platform/accessibility/common/accessibility.js';
import { ILanguageConfigurationService } from '../../../../../../../editor/common/languages/languageConfigurationRegistry.js';
import { ILanguageFeaturesService } from '../../../../../../../editor/common/services/languageFeatures.js';
import { ILanguageDetectionService } from '../../../../../../services/languageDetection/common/languageDetectionWorkerService.js';
import { IKeybindingService } from '../../../../../../../platform/keybinding/common/keybinding.js';
import { IEnvironmentService } from '../../../../../../../platform/environment/common/environment.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { IPathService } from '../../../../../../../workbench/services/path/common/pathService.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IChatThreadService, ThreadsState, ThreadStreamState } from '../../../chatThreadService.js';
import { ITerminalToolService } from '../../../terminalToolService.js';
import { ILanguageService } from '../../../../../../../editor/common/languages/language.js';
import { ISapphireModelService } from '../../../../common/sapphireModelService.js';
import { IWorkspaceContextService } from '../../../../../../../platform/workspace/common/workspace.js';
import { ISapphireCommandBarService } from '../../../sapphireCommandBarService.js';
import { INativeHostService } from '../../../../../../../platform/native/common/native.js';
import { IEditCodeService } from '../../../editCodeServiceInterface.js';
import { IToolsService } from '../../../toolsService.js';
import { IConvertToLLMMessageService } from '../../../convertToLLMMessageService.js';
import { ITerminalService } from '../../../../../terminal/browser/terminal.js';
import { ISearchService } from '../../../../../../services/search/common/search.js';
import { IExtensionManagementService } from '../../../../../../../platform/extensionManagement/common/extensionManagement.js';
import { IMCPService } from '../../../../common/mcpService.js';
import { IStorageService } from '../../../../../../../platform/storage/common/storage.js';
import { IEditorService } from '../../../../../../services/editor/common/editorService.js';
import {
  IProjectIndexService,
} from '../../../projectIndexService.js';
import type { ProjectIndexStatus } from '../../../../common/projectIndex/projectIndexTypes.js';
import {
  EMPTY_PROJECT_INDEX_STATUS,
  emptyProjectIndexSteps,
} from '../../../../common/projectIndex/projectIndexTypes.js';

// Глобальные снимки state обновляются синхронно с VS Code-сервисами; Vue подписывается через listeners.

let chatThreadsState: ThreadsState;
const chatThreadsStateListeners: Set<(s: ThreadsState) => void> = new Set();

let chatThreadsStreamState: ThreadStreamState;
const chatThreadsStreamStateListeners: Set<(threadId: string) => void> = new Set();

let settingsState: SapphireSettingsState;
const settingsStateListeners: Set<(s: SapphireSettingsState) => void> = new Set();

let refreshModelState: RefreshModelStateOfProvider;
const refreshModelStateListeners: Set<(s: RefreshModelStateOfProvider) => void> = new Set();
const refreshModelProviderListeners: Set<
  (p: ProviderName, s: RefreshModelStateOfProvider) => void
> = new Set();

let colorThemeState: ColorScheme;
const colorThemeStateListeners: Set<(s: ColorScheme) => void> = new Set();

let projectIndexStatus: ProjectIndexStatus = {
  ...EMPTY_PROJECT_INDEX_STATUS,
  steps: emptyProjectIndexSteps(),
};
const projectIndexStatusListeners: Set<(s: ProjectIndexStatus) => void> = new Set();

const ctrlKZoneStreamingStateListeners: Set<(diffareaid: number, s: boolean) => void> = new Set();
const commandBarURIStateListeners: Set<(uri: URI) => void> = new Set();
const activeURIListeners: Set<(uri: URI | null) => void> = new Set();

const mcpListeners: Set<() => void> = new Set();

// Вызывается один раз при bootstrap Vue до любых composables ниже.
// Здесь единственное место без dispose подписок; в остальном коде onDidChange нужно dispose.
export const _registerServices = (accessor: ServicesAccessor) => {
  const disposables: IDisposable[] = [];

  _registerAccessor(accessor);

  const stateServices = {
    chatThreadsStateService: accessor.get(IChatThreadService),
    settingsStateService: accessor.get(ISapphireSettingsService),
    refreshModelService: accessor.get(IRefreshModelService),
    themeService: accessor.get(IThemeService),
    editCodeService: accessor.get(IEditCodeService),
    sapphireCommandBarService: accessor.get(ISapphireCommandBarService),
    modelService: accessor.get(IModelService),
    mcpService: accessor.get(IMCPService),
    projectIndexService: accessor.get(IProjectIndexService),
  };

  const {
    settingsStateService,
    chatThreadsStateService,
    refreshModelService,
    themeService,
    editCodeService,
    sapphireCommandBarService,
    mcpService,
    projectIndexService,
  } = stateServices;

  chatThreadsState = chatThreadsStateService.state;
  disposables.push(
    chatThreadsStateService.onDidChangeCurrentThread(() => {
      chatThreadsState = chatThreadsStateService.state;
      chatThreadsStateListeners.forEach((l) => l(chatThreadsState));
    }),
  );

  // Тот же IChatThreadService, отдельный streamState
  chatThreadsStreamState = chatThreadsStateService.streamState;
  disposables.push(
    chatThreadsStateService.onDidChangeStreamState(({ threadId }) => {
      chatThreadsStreamState = chatThreadsStateService.streamState;
      chatThreadsStreamStateListeners.forEach((l) => l(threadId));
    }),
  );

  settingsState = settingsStateService.state;
  disposables.push(
    settingsStateService.onDidChangeState(() => {
      settingsState = settingsStateService.state;
      settingsStateListeners.forEach((l) => l(settingsState));
    }),
  );

  refreshModelState = refreshModelService.state;
  disposables.push(
    refreshModelService.onDidChangeState((providerName) => {
      refreshModelState = refreshModelService.state;
      refreshModelStateListeners.forEach((l) => l(refreshModelState));
      refreshModelProviderListeners.forEach((l) => l(providerName, refreshModelState)); // per-provider колбэки
    }),
  );

  colorThemeState = themeService.getColorTheme().type;
  disposables.push(
    themeService.onDidColorThemeChange(({ type }) => {
      colorThemeState = type;
      colorThemeStateListeners.forEach((l) => l(colorThemeState));
    }),
  );

  // Событие без payload state — только diffareaid + флаг streaming
  disposables.push(
    editCodeService.onDidChangeStreamingInCtrlKZone(({ diffareaid }) => {
      const isStreaming = editCodeService.isCtrlKZoneStreaming({ diffareaid });
      ctrlKZoneStreamingStateListeners.forEach((l) => l(diffareaid, isStreaming));
    }),
  );

  disposables.push(
    sapphireCommandBarService.onDidChangeState(({ uri }) => {
      commandBarURIStateListeners.forEach((l) => l(uri));
    }),
  );

  disposables.push(
    sapphireCommandBarService.onDidChangeActiveURI(({ uri }) => {
      activeURIListeners.forEach((l) => l(uri));
    }),
  );

  disposables.push(
    mcpService.onDidChangeState(() => {
      mcpListeners.forEach((l) => l());
    }),
  );

  projectIndexStatus = projectIndexService.getStatus();
  disposables.push(
    projectIndexService.onDidChangeStatus((s) => {
      projectIndexStatus = s;
      projectIndexStatusListeners.forEach((l) => l(projectIndexStatus));
    }),
  );

  return disposables;
};

const getVueAccessor = (accessor: ServicesAccessor) => {
  const vueAccessor = {
    IModelService: accessor.get(IModelService),
    IClipboardService: accessor.get(IClipboardService),
    IContextViewService: accessor.get(IContextViewService),
    IContextMenuService: accessor.get(IContextMenuService),
    IFileService: accessor.get(IFileService),
    IHoverService: accessor.get(IHoverService),
    IThemeService: accessor.get(IThemeService),
    ILLMMessageService: accessor.get(ILLMMessageService),
    IRefreshModelService: accessor.get(IRefreshModelService),
    ISapphireSettingsService: accessor.get(ISapphireSettingsService),
    IEditCodeService: accessor.get(IEditCodeService),
    IChatThreadService: accessor.get(IChatThreadService),

    IInstantiationService: accessor.get(IInstantiationService),
    ICodeEditorService: accessor.get(ICodeEditorService),
    ICommandService: accessor.get(ICommandService),
    IContextKeyService: accessor.get(IContextKeyService),
    INotificationService: accessor.get(INotificationService),
    IAccessibilityService: accessor.get(IAccessibilityService),
    ILanguageConfigurationService: accessor.get(ILanguageConfigurationService),
    ILanguageDetectionService: accessor.get(ILanguageDetectionService),
    ILanguageFeaturesService: accessor.get(ILanguageFeaturesService),
    IKeybindingService: accessor.get(IKeybindingService),
    ISearchService: accessor.get(ISearchService),

    IExplorerService: accessor.get(IExplorerService),
    IEnvironmentService: accessor.get(IEnvironmentService),
    IConfigurationService: accessor.get(IConfigurationService),
    IPathService: accessor.get(IPathService),
    ITerminalToolService: accessor.get(ITerminalToolService),
    ILanguageService: accessor.get(ILanguageService),
    ISapphireModelService: accessor.get(ISapphireModelService),
    IWorkspaceContextService: accessor.get(IWorkspaceContextService),

    ISapphireCommandBarService: accessor.get(ISapphireCommandBarService),
    INativeHostService: accessor.get(INativeHostService),
    IToolsService: accessor.get(IToolsService),
    IConvertToLLMMessageService: accessor.get(IConvertToLLMMessageService),
    ITerminalService: accessor.get(ITerminalService),
    IExtensionManagementService: accessor.get(IExtensionManagementService),
    IMCPService: accessor.get(IMCPService),

    IStorageService: accessor.get(IStorageService),
    IEditorService: accessor.get(IEditorService),
    IProjectIndexService: accessor.get(IProjectIndexService),
  } as const;
  return vueAccessor;
};

type VueAccessor = ReturnType<typeof getVueAccessor>;

let vueAccessor_: VueAccessor | null = null;
const _registerAccessor = (accessor: ServicesAccessor) => {
  vueAccessor_ = getVueAccessor(accessor);
};

// -- доступ к DI-сервисам --
export const useAccessor = () => {
  if (!vueAccessor_) {
    throw new Error(`⚠️ Sapphire useAccessor was called before _registerServices!`);
  }

  return {
    get: <S extends keyof VueAccessor>(service: S): VueAccessor[S] => vueAccessor_![service],
  };
};

const bindListener = (add: () => void, remove: () => void) => {
  onMounted(() => {
    add();
  });
  onUnmounted(() => {
    remove();
  });
};

// -- Vue composables поверх глобальных снимков state --

export const useSettingsState = () => {
  const s = ref(settingsState);
  const listener = (next: SapphireSettingsState) => {
    s.value = next;
  };
  bindListener(
    () => {
      s.value = settingsState;
      settingsStateListeners.add(listener);
    },
    () => {
      settingsStateListeners.delete(listener);
    },
  );
  return s;
};

export const useChatThreadsState = () => {
  const s = ref(chatThreadsState);
  const listener = (next: ThreadsState) => {
    s.value = next;
  };
  bindListener(
    () => {
      s.value = chatThreadsState;
      chatThreadsStateListeners.add(listener);
    },
    () => {
      chatThreadsStateListeners.delete(listener);
    },
  );
  return s;
};

export const useChatThreadsStreamState = (threadId: MaybeRefOrGetter<string>) => {
  // Сброс при смене threadId до paint: иначе onSubmit видит stale isRunning чужого треда.
  const s = ref<ThreadStreamState[string] | undefined>(chatThreadsStreamState[toValue(threadId)]);
  watch(
    () => toValue(threadId),
    (id) => {
      s.value = chatThreadsStreamState[id];
    },
    // До обработчиков клика: «+» не должен оставить isRunning предыдущего чата.
    { flush: 'sync' },
  );
  const listener = (threadId_: string) => {
    const id = toValue(threadId);
    if (threadId_ !== id) return;
    s.value = chatThreadsStreamState[id];
  };
  bindListener(
    () => {
      s.value = chatThreadsStreamState[toValue(threadId)];
      chatThreadsStreamStateListeners.add(listener);
    },
    () => {
      chatThreadsStreamStateListeners.delete(listener);
    },
  );
  return s;
};

export const useChatThreadMessageQueue = (threadId: MaybeRefOrGetter<string>) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');
  const readQueue = (id: string) => chatThreadsService.getMessageQueue(id) ?? [];
  const queue = ref(readQueue(toValue(threadId)));
  watch(
    () => toValue(threadId),
    (id) => {
      queue.value = readQueue(id);
    },
  );
  const listener = (threadId_: string) => {
    const id = toValue(threadId);
    if (threadId_ !== id) return;
    queue.value = [...readQueue(id)];
  };
  bindListener(
    () => {
      queue.value = readQueue(toValue(threadId));
      chatThreadsStreamStateListeners.add(listener);
    },
    () => {
      chatThreadsStreamStateListeners.delete(listener);
    },
  );
  return queue;
};

export const useFullChatThreadsStreamState = () => {
  // Клонируем объект: streamState мутируется in-place, и тот же reference не обновит вкладки
  // — спиннер останется после Stop, хотя isRunning уже false.
  const s = ref({ ...chatThreadsStreamState });
  const listener = () => {
    s.value = { ...chatThreadsStreamState };
  };
  bindListener(
    () => {
      s.value = { ...chatThreadsStreamState };
      chatThreadsStreamStateListeners.add(listener);
    },
    () => {
      chatThreadsStreamStateListeners.delete(listener);
    },
  );
  return s;
};

export const useRefreshModelListener = (
  listener: (providerName: ProviderName, s: RefreshModelStateOfProvider) => void,
) => {
  bindListener(
    () => {
      refreshModelProviderListeners.add(listener);
    },
    () => {
      refreshModelProviderListeners.delete(listener);
    },
  );
};

export const useCtrlKZoneStreamingState = (listener: (diffareaid: number, s: boolean) => void) => {
  bindListener(
    () => {
      ctrlKZoneStreamingStateListeners.add(listener);
    },
    () => {
      ctrlKZoneStreamingStateListeners.delete(listener);
    },
  );
};

export const useIsDark = () => {
  const s = ref(colorThemeState);
  const listener = (next: ColorScheme) => {
    s.value = next;
  };
  bindListener(
    () => {
      s.value = colorThemeState;
      colorThemeStateListeners.add(listener);
    },
    () => {
      colorThemeStateListeners.delete(listener);
    },
  );

  // Возвращаем boolean dark/light, а не сырой ColorScheme
  return computed(() => s.value === ColorScheme.DARK || s.value === ColorScheme.HIGH_CONTRAST_DARK);
};

export const useCommandBarURIListener = (listener: (uri: URI) => void) => {
  bindListener(
    () => {
      commandBarURIStateListeners.add(listener);
    },
    () => {
      commandBarURIStateListeners.delete(listener);
    },
  );
};
export const useCommandBarState = () => {
  const accessor = useAccessor();
  const commandBarService = accessor.get('ISapphireCommandBarService');
  const s = ref({
    stateOfURI: commandBarService.stateOfURI,
    sortedURIs: commandBarService.sortedURIs,
  });
  const listener = () => {
    s.value = { stateOfURI: commandBarService.stateOfURI, sortedURIs: commandBarService.sortedURIs };
  };
  useCommandBarURIListener(listener);

  return s;
};

// Активный URI command bar — для истории недавних файлов с правками
export const useActiveURI = () => {
  const accessor = useAccessor();
  const commandBarService = accessor.get('ISapphireCommandBarService');
  const s = ref(commandBarService.activeURI);
  const listener = () => {
    s.value = commandBarService.activeURI;
  };
  bindListener(
    () => {
      activeURIListeners.add(listener);
    },
    () => {
      activeURIListeners.delete(listener);
    },
  );
  return reactive({
    get uri() {
      return s.value;
    },
  });
};

export const useMCPServiceState = () => {
  const accessor = useAccessor();
  const mcpService = accessor.get('IMCPService');
  const s = ref(mcpService.state);
  const listener = () => {
    s.value = mcpService.state;
  };
  bindListener(
    () => {
      mcpListeners.add(listener);
    },
    () => {
      mcpListeners.delete(listener);
    },
  );
  return s;
};

export const useProjectIndexStatus = () => {
  const s = ref<ProjectIndexStatus>(projectIndexStatus);
  const listener = (next: ProjectIndexStatus) => {
    s.value = next;
  };
  bindListener(
    () => {
      s.value = projectIndexStatus;
      projectIndexStatusListeners.add(listener);
    },
    () => {
      projectIndexStatusListeners.delete(listener);
    },
  );
  return s;
};

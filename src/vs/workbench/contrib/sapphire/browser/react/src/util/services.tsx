/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect, useCallback } from 'react';
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
import { EMPTY_PROJECT_INDEX_STATUS } from '../../../../common/projectIndex/projectIndexTypes.js';

// Обычно подписываются через useEffect + onDidChangeState, но effect монтируется поздно и теряет первые события.

// Глобальные снимки state обновляются синхронно с VS Code-сервисами; React подписывается через listeners.

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

let projectIndexStatus: ProjectIndexStatus = { ...EMPTY_PROJECT_INDEX_STATUS };
const projectIndexStatusListeners: Set<(s: ProjectIndexStatus) => void> = new Set();

const ctrlKZoneStreamingStateListeners: Set<(diffareaid: number, s: boolean) => void> = new Set();
const commandBarURIStateListeners: Set<(uri: URI) => void> = new Set();
const activeURIListeners: Set<(uri: URI | null) => void> = new Set();

const mcpListeners: Set<() => void> = new Set();

// Вызывается один раз при bootstrap React до любых hooks ниже.
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

const getReactAccessor = (accessor: ServicesAccessor) => {
  const reactAccessor = {
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
  return reactAccessor;
};

type ReactAccessor = ReturnType<typeof getReactAccessor>;

let reactAccessor_: ReactAccessor | null = null;
const _registerAccessor = (accessor: ServicesAccessor) => {
  const reactAccessor = getReactAccessor(accessor);
  reactAccessor_ = reactAccessor;
};

// -- доступ к DI-сервисам --
export const useAccessor = () => {
  if (!reactAccessor_) {
    throw new Error(`⚠️ Sapphire useAccessor was called before _registerServices!`);
  }

  return {
    get: <S extends keyof ReactAccessor>(service: S): ReactAccessor[S] => reactAccessor_![service],
  };
};

// -- React-hooks поверх глобальных снимков state --

export const useSettingsState = () => {
  const [s, ss] = useState(settingsState);
  useEffect(() => {
    ss(settingsState);
    settingsStateListeners.add(ss);
    return () => {
      settingsStateListeners.delete(ss);
    };
  }, [ss]);
  return s;
};

export const useChatThreadsState = () => {
  const [s, ss] = useState(chatThreadsState);
  useEffect(() => {
    ss(chatThreadsState);
    chatThreadsStateListeners.add(ss);
    return () => {
      chatThreadsStateListeners.delete(ss);
    };
  }, [ss]);
  return s;
  // Закомментировано: двусторонняя синхронизация threadsState в React
  // const ss: React.Dispatch<React.SetStateAction<ThreadsState>> = (action)=>{
  // 	_ss(action)
  // 	if (typeof action === 'function') {
  // 		const newState = action(chatThreadsState)
  // 		chatThreadsState = newState
  // 	} else {
  // 		chatThreadsState = action
  // 	}
  // }
  // return [s, ss] as const
};

export const useChatThreadsStreamState = (threadId: string) => {
  // Синхронный сброс при смене threadId: useState initializer не перезапускается,
  // а effect срабатывает после paint — иначе onSubmit видит stale isRunning чужого треда.
  const [s, ss] = useState<ThreadStreamState[string] | undefined>(
    () => chatThreadsStreamState[threadId],
  );
  const [seenThreadId, setSeenThreadId] = useState(threadId);
  if (seenThreadId !== threadId) {
    setSeenThreadId(threadId);
    ss(chatThreadsStreamState[threadId]);
  }
  useEffect(() => {
    ss(chatThreadsStreamState[threadId]);
    const listener = (threadId_: string) => {
      if (threadId_ !== threadId) return;
      ss(chatThreadsStreamState[threadId]);
    };
    chatThreadsStreamStateListeners.add(listener);
    return () => {
      chatThreadsStreamStateListeners.delete(listener);
    };
  }, [ss, threadId]);
  return s;
};

export const useChatThreadMessageQueue = (threadId: string) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');
  const [queue, setQueue] = useState(() => chatThreadsService.getMessageQueue(threadId));
  const [seenThreadId, setSeenThreadId] = useState(threadId);
  if (seenThreadId !== threadId) {
    setSeenThreadId(threadId);
    setQueue(chatThreadsService.getMessageQueue(threadId));
  }
  useEffect(() => {
    setQueue(chatThreadsService.getMessageQueue(threadId));
    const listener = (threadId_: string) => {
      if (threadId_ !== threadId) return;
      setQueue([...chatThreadsService.getMessageQueue(threadId)]);
    };
    chatThreadsStreamStateListeners.add(listener);
    return () => {
      chatThreadsStreamStateListeners.delete(listener);
    };
  }, [chatThreadsService, threadId]);
  return queue;
};

export const useFullChatThreadsStreamState = () => {
  // Клонируем объект: streamState мутируется in-place, и React не перерисует вкладки
  // при том же reference — спиннер останется после Stop, хотя isRunning уже false.
  const [s, ss] = useState(() => ({ ...chatThreadsStreamState }));
  useEffect(() => {
    ss({ ...chatThreadsStreamState });
    const listener = () => {
      ss({ ...chatThreadsStreamState });
    };
    chatThreadsStreamStateListeners.add(listener);
    return () => {
      chatThreadsStreamStateListeners.delete(listener);
    };
  }, [ss]);
  return s;
};

export const useRefreshModelListener = (
  listener: (providerName: ProviderName, s: RefreshModelStateOfProvider) => void,
) => {
  useEffect(() => {
    refreshModelProviderListeners.add(listener);
    return () => {
      refreshModelProviderListeners.delete(listener);
    };
  }, [listener, refreshModelProviderListeners]);
};

export const useCtrlKZoneStreamingState = (listener: (diffareaid: number, s: boolean) => void) => {
  useEffect(() => {
    ctrlKZoneStreamingStateListeners.add(listener);
    return () => {
      ctrlKZoneStreamingStateListeners.delete(listener);
    };
  }, [listener, ctrlKZoneStreamingStateListeners]);
};

export const useIsDark = () => {
  const [s, ss] = useState(colorThemeState);
  useEffect(() => {
    ss(colorThemeState);
    colorThemeStateListeners.add(ss);
    return () => {
      colorThemeStateListeners.delete(ss);
    };
  }, [ss]);

  // Возвращаем boolean dark/light, а не сырой ColorScheme
  const isDark = s === ColorScheme.DARK || s === ColorScheme.HIGH_CONTRAST_DARK;
  return isDark;
};

export const useCommandBarURIListener = (listener: (uri: URI) => void) => {
  useEffect(() => {
    commandBarURIStateListeners.add(listener);
    return () => {
      commandBarURIStateListeners.delete(listener);
    };
  }, [listener]);
};
export const useCommandBarState = () => {
  const accessor = useAccessor();
  const commandBarService = accessor.get('ISapphireCommandBarService');
  const [s, ss] = useState({
    stateOfURI: commandBarService.stateOfURI,
    sortedURIs: commandBarService.sortedURIs,
  });
  const listener = useCallback(() => {
    ss({ stateOfURI: commandBarService.stateOfURI, sortedURIs: commandBarService.sortedURIs });
  }, [commandBarService]);
  useCommandBarURIListener(listener);

  return s;
};

// Активный URI command bar — для истории недавних файлов с правками
export const useActiveURI = () => {
  const accessor = useAccessor();
  const commandBarService = accessor.get('ISapphireCommandBarService');
  const [s, ss] = useState(commandBarService.activeURI);
  useEffect(() => {
    const listener = () => {
      ss(commandBarService.activeURI);
    };
    activeURIListeners.add(listener);
    return () => {
      activeURIListeners.delete(listener);
    };
  }, []);
  return { uri: s };
};

export const useMCPServiceState = () => {
  const accessor = useAccessor();
  const mcpService = accessor.get('IMCPService');
  const [s, ss] = useState(mcpService.state);
  useEffect(() => {
    const listener = () => {
      ss(mcpService.state);
    };
    mcpListeners.add(listener);
    return () => {
      mcpListeners.delete(listener);
    };
  }, []);
  return s;
};

export const useProjectIndexStatus = () => {
  const [s, ss] = useState<ProjectIndexStatus>(projectIndexStatus);
  useEffect(() => {
    ss(projectIndexStatus);
    projectIndexStatusListeners.add(ss);
    return () => {
      projectIndexStatusListeners.delete(ss);
    };
  }, [ss]);
  return s;
};

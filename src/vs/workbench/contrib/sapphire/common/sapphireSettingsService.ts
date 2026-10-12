/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { deepClone } from '../../../../base/common/objects.js';
import { IEncryptionService } from '../../../../platform/encryption/common/encryptionService.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
  IStorageService,
  StorageScope,
  StorageTarget,
} from '../../../../platform/storage/common/storage.js';
import {
  defaultProviderSettings,
  getModelCapabilities,
  ModelOverrides,
} from './modelCapabilities.js';
import { SAPPHIRE_SETTINGS_STORAGE_KEY } from './storageKeys.js';
import {
  defaultSettingsOfProvider,
  FeatureName,
  ProviderName,
  ModelSelectionOfFeature,
  SettingsOfProvider,
  SettingName,
  providerNames,
  ModelSelection,
  modelSelectionsEqual,
  featureNames,
  SapphireStatefulModelInfo,
  GlobalSettings,
  GlobalSettingName,
  defaultGlobalSettings,
  ModelSelectionOptions,
  OptionsOfModelSelection,
  ChatMode,
  OverridesOfModel,
  defaultOverridesOfModel,
  MCPUserStateOfName,
  MCPUserState,
  UserRule,
  aiInstructionsFromUserRules,
  skillInstructionsFromUserSkills,
  defaultUserSkills,
  mergeShippedUserSkills,
  normalizeUserSkill,
  LEGACY_FRONTEND_STACK_RULE_ID,
  UserSkill,
} from './sapphireSettingsTypes.js';
import { generateUuid } from '../../../../base/common/uuid.js';

// name — подпись в dropdown
export type ModelOption = { name: string; selection: ModelSelection };

type SetSettingOfProviderFn = <S extends SettingName>(
  providerName: ProviderName,
  settingName: S,
  newVal: SettingsOfProvider[ProviderName][S extends keyof SettingsOfProvider[ProviderName]
    ? S
    : never],
) => Promise<void>;

type SetModelSelectionOfFeatureFn = <K extends FeatureName>(
  featureName: K,
  newVal: ModelSelectionOfFeature[K],
) => Promise<void>;

type SetGlobalSettingFn = <T extends GlobalSettingName>(
  settingName: T,
  newVal: GlobalSettings[T],
) => void;

type SetOptionsOfModelSelection = (
  featureName: FeatureName,
  providerName: ProviderName,
  modelName: string,
  newVal: Partial<ModelSelectionOptions>,
) => void;

export type SapphireSettingsState = {
  readonly settingsOfProvider: SettingsOfProvider; // настройки провайдеров
  readonly modelSelectionOfFeature: ModelSelectionOfFeature; // модель по feature
  readonly optionsOfModelSelection: OptionsOfModelSelection;
  readonly overridesOfModel: OverridesOfModel;
  readonly globalSettings: GlobalSettings;
  readonly mcpUserStateOfName: MCPUserStateOfName; // пользовательское состояние MCP

  readonly _modelOptions: ModelOption[]; // вычисляется из провайдеров и overrides
};

// type RealVoidSettings … EventProp …

export interface ISapphireSettingsService {
  readonly _serviceBrand: undefined;
  readonly state: SapphireSettingsState; // для React меняйте state иммутабельно
  readonly waitForInitState: Promise<void>;

  onDidChangeState: Event<void>;

  setSettingOfProvider: SetSettingOfProviderFn;
  setModelSelectionOfFeature: SetModelSelectionOfFeatureFn;
  setOptionsOfModelSelection: SetOptionsOfModelSelection;
  setGlobalSetting: SetGlobalSettingFn;
  // setMCPServerStates: (newStates: MCPServerStates) => Promise<void>;

  // undefined ОЧИЩАЕТ настройку (исключение):
  setOverridesOfModel(
    providerName: ProviderName,
    modelName: string,
    overrides: Partial<ModelOverrides> | undefined,
  ): Promise<void>;

  dangerousSetState(newState: SapphireSettingsState): Promise<void>;
  resetState(): Promise<void>;

  setAutodetectedModels(providerName: ProviderName, modelNames: string[]): void;
  toggleModelHidden(providerName: ProviderName, modelName: string): void;
  addModel(providerName: ProviderName, modelName: string): void;
  deleteModel(providerName: ProviderName, modelName: string): boolean;

  addMCPUserStateOfNames(userStateOfName: MCPUserStateOfName): Promise<void>;
  removeMCPUserStateOfNames(serverNames: string[]): Promise<void>;
  setMCPServerState(serverName: string, state: MCPUserState): Promise<void>;
}

const _modelsWithSwappedInNewModels = (options: {
  existingModels: SapphireStatefulModelInfo[];
  models: string[];
  type: 'autodetected' | 'default';
}) => {
  const { existingModels, models, type } = options;

  const existingModelsMap: Record<string, SapphireStatefulModelInfo> = {};
  for (const existingModel of existingModels) {
    existingModelsMap[existingModel.modelName] = existingModel;
  }

  const newModelNames = new Set(models);
  const newModelsOfType = models.map((modelName) => ({
    modelName,
    type,
    isHidden: !!existingModelsMap[modelName]?.isHidden,
  }));

  return [
    ...newModelsOfType, // заменить все модели этого typeId новым списком
    ...existingModels.filter(
      (m) =>
        // убрать дубликаты моделей в dropdown
        m.type !== type && !newModelNames.has(m.modelName),
    ),
  ];
};

export const modelFilterOfFeatureName: {
  [featureName in FeatureName]: {
    filter: (
      o: ModelSelection,
      opts: { chatMode: ChatMode; overridesOfModel: OverridesOfModel },
    ) => boolean;
    emptyMessage: null | { message: string; priority: 'always' | 'fallback' };
  };
} = {
  Autocomplete: {
    filter: (o, opts) =>
      getModelCapabilities(o.providerName, o.modelName, opts.overridesOfModel).supportsFIM,
    emptyMessage: { message: 'Нет моделей с поддержкой FIM', priority: 'always' },
  },
  Chat: { filter: (_o) => true, emptyMessage: null },
  'Ctrl+K': { filter: (_o) => true, emptyMessage: null },
  Apply: { filter: (_o) => true, emptyMessage: null },
  SCM: { filter: (_o) => true, emptyMessage: null },
};

const _stateWithMergedDefaultModels = (state: SapphireSettingsState): SapphireSettingsState => {
  let newSettingsOfProvider = state.settingsOfProvider;

  // пересчёт моделей по умолчанию
  for (const providerName of providerNames) {
    const defaultModels = defaultSettingsOfProvider[providerName]?.models ?? [];
    const currentModels = newSettingsOfProvider[providerName]?.models ?? [];
    const defaultModelNames = defaultModels.map((m) => m.modelName);
    const newModels = _modelsWithSwappedInNewModels({
      existingModels: currentModels,
      models: defaultModelNames,
      type: 'default',
    });
    newSettingsOfProvider = {
      ...newSettingsOfProvider,
      [providerName]: {
        ...newSettingsOfProvider[providerName],
        models: newModels,
      },
    };
  }
  return {
    ...state,
    settingsOfProvider: newSettingsOfProvider,
  };
};

const _validatedModelState = (
  state: Omit<SapphireSettingsState, '_modelOptions'>,
): SapphireSettingsState => {
  let newSettingsOfProvider = state.settingsOfProvider;

  // флаг заполненности провайдера
  for (const providerName of providerNames) {
    const settingsAtProvider = newSettingsOfProvider[providerName];

    // endpoint у Bedrock необязателен: пустая строка значит встроенный URL региона.
    const optionalEmpty = providerName === 'awsBedrock' ? ['endpoint'] : [];
    const didFillInProviderSettings = Object.keys(defaultProviderSettings[providerName]).every(
      (key) =>
        optionalEmpty.includes(key) ||
        !!settingsAtProvider[key as keyof typeof settingsAtProvider],
    );

    if (didFillInProviderSettings === settingsAtProvider._didFillInProviderSettings) continue;

    newSettingsOfProvider = {
      ...newSettingsOfProvider,
      [providerName]: {
        ...settingsAtProvider,
        _didFillInProviderSettings: didFillInProviderSettings,
      },
    };
  }

  // optionsOfModel — только настроенные и включённые провайдеры
  let newModelOptions: ModelOption[] = [];
  const seenModelKeys = new Set<string>();
  for (const providerName of providerNames) {
    const providerTitle = providerName; // намеренно без displayInfo — короткое имя
    const settingsAtProvider = newSettingsOfProvider[providerName];
    if (!settingsAtProvider._didFillInProviderSettings) continue; // не настроен — без options
    if (settingsAtProvider.isEnabled === false) continue; // пользователь выключил — без options
    for (const { modelName, isHidden } of settingsAtProvider.models) {
      if (isHidden) continue;
      const key = `${providerName}:${modelName}`;
      if (seenModelKeys.has(key)) continue;
      seenModelKeys.add(key);
      newModelOptions.push({
        name: `${modelName} (${providerTitle})`,
        selection: { providerName, modelName },
      });
    }
  }

  // валидировать modelSelectionOfFeature
  let newModelSelectionOfFeature = state.modelSelectionOfFeature;
  for (const featureName of featureNames) {
    const { filter } = modelFilterOfFeatureName[featureName];
    const filterOpts = {
      chatMode: state.globalSettings.chatMode,
      overridesOfModel: state.overridesOfModel,
    };
    const modelOptionsForThisFeature = newModelOptions.filter((o) =>
      filter(o.selection, filterOpts),
    );

    const modelSelectionAtFeature = newModelSelectionOfFeature[featureName];
    const selnIdx =
      modelSelectionAtFeature === null
        ? -1
        : modelOptionsForThisFeature.findIndex((m) =>
            modelSelectionsEqual(m.selection, modelSelectionAtFeature),
          );

    if (selnIdx !== -1) continue; // модель ещё в списке

    newModelSelectionOfFeature = {
      ...newModelSelectionOfFeature,
      [featureName]:
        modelOptionsForThisFeature.length === 0 ? null : modelOptionsForThisFeature[0].selection,
    };
  }

  const newState = {
    ...state,
    settingsOfProvider: newSettingsOfProvider,
    modelSelectionOfFeature: newModelSelectionOfFeature,
    overridesOfModel: state.overridesOfModel,
    _modelOptions: newModelOptions,
  } satisfies SapphireSettingsState;

  return newState;
};

const defaultState = () => {
  const d: SapphireSettingsState = {
    settingsOfProvider: deepClone(defaultSettingsOfProvider),
    modelSelectionOfFeature: {
      Chat: null,
      'Ctrl+K': null,
      Autocomplete: null,
      Apply: null,
      SCM: null,
    },
    globalSettings: deepClone(defaultGlobalSettings),
    optionsOfModelSelection: { Chat: {}, 'Ctrl+K': {}, Autocomplete: {}, Apply: {}, SCM: {} },
    overridesOfModel: deepClone(defaultOverridesOfModel),
    _modelOptions: [], // заполняется в _updateModelOptions
    mcpUserStateOfName: {},
  };
  return d;
};

export const ISapphireSettingsService = createDecorator<ISapphireSettingsService>('SapphireSettingsService');
class SapphireSettingsService extends Disposable implements ISapphireSettingsService {
  _serviceBrand: undefined;

  private readonly _onDidChangeState = new Emitter<void>();

  readonly onDidChangeState: Event<void> = this._onDidChangeState.event; // для React-подписок на state

  state: SapphireSettingsState;

  private readonly _resolver: () => void;

  waitForInitState: Promise<void>; // await перед первым чтением state

  constructor(
    @IStorageService private readonly _storageService: IStorageService,
    @IEncryptionService private readonly _encryptionService: IEncryptionService,
    // @ISecretStorageService — намеренно не используем
    // @ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
  ) {
    super();

    // до чтения storage — дефолтный state
    this.state = defaultState();
    let resolver: () => void = () => {};
    this.waitForInitState = new Promise((res, _rej) => (resolver = res));
    this._resolver = resolver;

    this.readAndInitializeState();
  }

  dangerousSetState = async (newState: SapphireSettingsState) => {
    this.state = _validatedModelState(newState);
    await this._storeState();
    this._onDidChangeState.fire();
    this._onUpdate_syncApplyToChat();
    this._onUpdate_syncSCMToChat();
  };

  async resetState() {
    await this.dangerousSetState(defaultState());
  }

  async readAndInitializeState() {
    let readS: SapphireSettingsState;
    try {
      readS = await this._readState();

      if (readS.globalSettings.includeToolLintErrors === undefined)
        readS.globalSettings.includeToolLintErrors = defaultGlobalSettings.includeToolLintErrors;

      // PPR AI: подставляем дефолты для незаданных типов (edits on, terminal/MCP off)
      readS.globalSettings.autoApprove = {
        ...defaultGlobalSettings.autoApprove,
        ...((typeof readS.globalSettings.autoApprove === 'object' &&
          readS.globalSettings.autoApprove) ||
          {}),
      };

      // 1.3.5: feature Source Control
      if (readS.modelSelectionOfFeature && !readS.modelSelectionOfFeature.SCM) {
        readS.modelSelectionOfFeature.SCM = deepClone(readS.modelSelectionOfFeature.Chat);
        readS.optionsOfModelSelection.SCM = deepClone(readS.optionsOfModelSelection.Chat);
      }
      // disableSystemMessage
      if (readS.globalSettings.disableSystemMessage === undefined)
        readS.globalSettings.disableSystemMessage = false;

      // autoAcceptLLMChanges
      if (readS.globalSettings.autoAcceptLLMChanges === undefined)
        readS.globalSettings.autoAcceptLLMChanges = false;

      // звук: chat done / approval
      if (readS.globalSettings.playChatNotificationSound === undefined)
        readS.globalSettings.playChatNotificationSound = true;

      // auto-attach редактора в SELECTIONS
      if (readS.globalSettings.autoAttachActiveFile === undefined)
        readS.globalSettings.autoAttachActiveFile = true;

      // эвристический поиск файлов в SELECTIONS
      if (readS.globalSettings.autoRetrieveRelevantFiles === undefined)
        readS.globalSettings.autoRetrieveRelevantFiles = true;

      if (readS.globalSettings.projectIndexEnabled === undefined)
        readS.globalSettings.projectIndexEnabled = true;
      if (readS.globalSettings.projectIndexIncludeOffice === undefined)
        readS.globalSettings.projectIndexIncludeOffice = true;
      if (readS.globalSettings.projectIndexLlmPurpose === undefined)
        readS.globalSettings.projectIndexLlmPurpose = false;

      // layoutShell: unknown → IDE
      if (readS.globalSettings.layoutMode !== 'ide' && readS.globalSettings.layoutMode !== 'agents')
        readS.globalSettings.layoutMode = 'ide';

      // gather → normal
      if ((readS.globalSettings.chatMode as string) === 'gather')
        readS.globalSettings.chatMode = 'normal';

      // userRules из aiInstructions
      if (!Array.isArray(readS.globalSettings.userRules)) {
        readS.globalSettings.userRules = [];
      }
      if (
        readS.globalSettings.userRules.length === 0 &&
        typeof readS.globalSettings.aiInstructions === 'string' &&
        readS.globalSettings.aiInstructions.trim()
      ) {
        const migrated: UserRule = {
          id: generateUuid(),
          name: 'AI Instructions',
          content: readS.globalSettings.aiInstructions,
          enabled: true,
        };
        readS.globalSettings.userRules = [migrated];
      }
      readS.globalSettings.userRules = readS.globalSettings.userRules.filter(
        (r) => r.id !== LEGACY_FRONTEND_STACK_RULE_ID,
      );
      readS.globalSettings.aiInstructions = aiInstructionsFromUserRules(
        readS.globalSettings.userRules,
      );

      // userSkills (+ shipped design skills; удаление → re-seed)
      if (!Array.isArray(readS.globalSettings.userSkills)) {
        readS.globalSettings.userSkills = [];
      }
      readS.globalSettings.userSkills = mergeShippedUserSkills(
        readS.globalSettings.userSkills,
        defaultUserSkills,
      );
      if (typeof readS.globalSettings.skillInstructions !== 'string') {
        readS.globalSettings.skillInstructions = '';
      }
      readS.globalSettings.skillInstructions = skillInstructionsFromUserSkills(
        readS.globalSettings.userSkills,
      );
    } catch (_e) {
      readS = defaultState();
    }

    // миграция устаревшего storage
    try {
      readS = {
        ...defaultState(),
        ...readS,
        // legacy merge — похоже на баг
        // ...defaultSettingsOfProvider,
        // ...readS.settingsOfProvider,
      };

      // только известные провайдеры
      const prunedSettingsOfProvider = {} as typeof readS.settingsOfProvider;
      for (const providerName of providerNames) {
        const merged = {
          ...defaultSettingsOfProvider[providerName],
          ...readS.settingsOfProvider[providerName],
        } as any;
        if (merged.isEnabled === undefined) {
          merged.isEnabled = true;
        }
        prunedSettingsOfProvider[providerName] = merged;
      }
      // убрать overrides удалённых провайдеров
      const prunedOverrides = {} as typeof readS.overridesOfModel;
      for (const providerName of providerNames) {
        prunedOverrides[providerName] = readS.overridesOfModel?.[providerName] ?? {};
      }
      readS = {
        ...readS,
        settingsOfProvider: prunedSettingsOfProvider,
        overridesOfModel: prunedOverrides,
      };
    } catch (_e) {
      readS = defaultState();
    }

    this.state = readS;
    this.state = _stateWithMergedDefaultModels(this.state);
    this.state = _validatedModelState(this.state);

    this._resolver();
    this._onDidChangeState.fire();
  }

  private async _readState(): Promise<SapphireSettingsState> {
    const encryptedState = this._storageService.get(
      SAPPHIRE_SETTINGS_STORAGE_KEY,
      StorageScope.APPLICATION,
    );

    if (!encryptedState) return defaultState();

    const stateStr = await this._encryptionService.decrypt(encryptedState);
    const state = JSON.parse(stateStr);
    return state;
  }

  private async _storeState() {
    const state = this.state;
    const encryptedState = await this._encryptionService.encrypt(JSON.stringify(state));
    this._storageService.store(
      SAPPHIRE_SETTINGS_STORAGE_KEY,
      encryptedState,
      StorageScope.APPLICATION,
      StorageTarget.USER,
    );
  }

  setSettingOfProvider: SetSettingOfProviderFn = async (providerName, settingName, newVal) => {
    const newModelSelectionOfFeature = this.state.modelSelectionOfFeature;

    const newOptionsOfModelSelection = this.state.optionsOfModelSelection;

    const newSettingsOfProvider: SettingsOfProvider = {
      ...this.state.settingsOfProvider,
      [providerName]: {
        ...this.state.settingsOfProvider[providerName],
        [settingName]: newVal,
      },
    };

    const newGlobalSettings = this.state.globalSettings;
    const newOverridesOfModel = this.state.overridesOfModel;
    const newMCPUserStateOfName = this.state.mcpUserStateOfName;

    const newState = {
      modelSelectionOfFeature: newModelSelectionOfFeature,
      optionsOfModelSelection: newOptionsOfModelSelection,
      settingsOfProvider: newSettingsOfProvider,
      globalSettings: newGlobalSettings,
      overridesOfModel: newOverridesOfModel,
      mcpUserStateOfName: newMCPUserStateOfName,
    };

    this.state = _validatedModelState(newState);

    await this._storeState();
    this._onDidChangeState.fire();
  };

  private _onUpdate_syncApplyToChat() {
    // sync modelSelection при Chat/sync
    this.setModelSelectionOfFeature('Apply', deepClone(this.state.modelSelectionOfFeature.Chat));
  }

  private _onUpdate_syncSCMToChat() {
    this.setModelSelectionOfFeature('SCM', deepClone(this.state.modelSelectionOfFeature.Chat));
  }

  setGlobalSetting: SetGlobalSettingFn = async (settingName, newVal) => {
    let globalSettings: GlobalSettings = {
      ...this.state.globalSettings,
      [settingName]: newVal,
    };
    // aiInstructions ↔ skillInstructions
    if (settingName === 'userRules') {
      globalSettings = {
        ...globalSettings,
        aiInstructions: aiInstructionsFromUserRules(globalSettings.userRules),
      };
    }
    if (settingName === 'userSkills') {
      const normalized = (globalSettings.userSkills as UserSkill[]).map((s) =>
        normalizeUserSkill(s),
      );
      globalSettings = {
        ...globalSettings,
        userSkills: normalized,
        skillInstructions: skillInstructionsFromUserSkills(normalized),
      };
    }
    const newState: SapphireSettingsState = {
      ...this.state,
      globalSettings,
    };
    this.state = _validatedModelState(newState);
    await this._storeState();
    this._onDidChangeState.fire();

    // хуки storage
    if (this.state.globalSettings.syncApplyToChat) this._onUpdate_syncApplyToChat();
    if (this.state.globalSettings.syncSCMToChat) this._onUpdate_syncSCMToChat();
  };

  setModelSelectionOfFeature: SetModelSelectionOfFeatureFn = async (featureName, newVal) => {
    const newState: SapphireSettingsState = {
      ...this.state,
      modelSelectionOfFeature: {
        ...this.state.modelSelectionOfFeature,
        [featureName]: newVal,
      },
    };

    this.state = _validatedModelState(newState);

    await this._storeState();
    this._onDidChangeState.fire();

    // хуки storage
    if (featureName === 'Chat') {
      // смена Chat-модели → sync features
      this._onUpdate_syncApplyToChat();
      this._onUpdate_syncSCMToChat();
    }
  };

  setOptionsOfModelSelection = async (
    featureName: FeatureName,
    providerName: ProviderName,
    modelName: string,
    newVal: Partial<ModelSelectionOptions>,
  ) => {
    const newState: SapphireSettingsState = {
      ...this.state,
      optionsOfModelSelection: {
        ...this.state.optionsOfModelSelection,
        [featureName]: {
          ...this.state.optionsOfModelSelection[featureName],
          [providerName]: {
            ...this.state.optionsOfModelSelection[featureName][providerName],
            [modelName]: {
              ...this.state.optionsOfModelSelection[featureName][providerName]?.[modelName],
              ...newVal,
            },
          },
        },
      },
    };
    this.state = _validatedModelState(newState);

    await this._storeState();
    this._onDidChangeState.fire();
  };

  setOverridesOfModel = async (
    providerName: ProviderName,
    modelName: string,
    overrides: Partial<ModelOverrides> | undefined,
  ) => {
    const newState: SapphireSettingsState = {
      ...this.state,
      overridesOfModel: {
        ...this.state.overridesOfModel,
        [providerName]: {
          ...this.state.overridesOfModel[providerName],
          [modelName]:
            overrides === undefined
              ? undefined
              : {
                  ...this.state.overridesOfModel[providerName][modelName],
                  ...overrides,
                },
        },
      },
    };

    this.state = _validatedModelState(newState);
    await this._storeState();
    this._onDidChangeState.fire();
  };

  setAutodetectedModels(providerName: ProviderName, autodetectedModelNames: string[]) {
    const { models } = this.state.settingsOfProvider[providerName];

    const newModels = _modelsWithSwappedInNewModels({
      existingModels: models,
      models: autodetectedModelNames,
      type: 'autodetected',
    });
    this.setSettingOfProvider(providerName, 'models', newModels);
  }

  toggleModelHidden(providerName: ProviderName, modelName: string) {
    const { models } = this.state.settingsOfProvider[providerName];
    const modelIdx = models.findIndex((m) => m.modelName === modelName);
    if (modelIdx === -1) return;
    const newIsHidden = !models[modelIdx].isHidden;
    const newModels: SapphireStatefulModelInfo[] = [
      ...models.slice(0, modelIdx),
      { ...models[modelIdx], isHidden: newIsHidden },
      ...models.slice(modelIdx + 1, Infinity),
    ];
    this.setSettingOfProvider(providerName, 'models', newModels);
  }

  addModel(providerName: ProviderName, modelName: string) {
    const { models } = this.state.settingsOfProvider[providerName];
    const existingIdx = models.findIndex((m) => m.modelName === modelName);
    if (existingIdx !== -1) return; // уже есть — ничего не делаем
    const newModels = [...models, { modelName, type: 'custom', isHidden: false } as const];
    this.setSettingOfProvider(providerName, 'models', newModels);
  }

  deleteModel(providerName: ProviderName, modelName: string): boolean {
    const { models } = this.state.settingsOfProvider[providerName];
    const delIdx = models.findIndex((m) => m.modelName === modelName);
    if (delIdx === -1) return false;
    const newModels = [
      ...models.slice(0, delIdx), // до удаляемого индекса
      ...models.slice(delIdx + 1, Infinity),
    ];
    this.setSettingOfProvider(providerName, 'models', newModels);

    return true;
  }

  // состояние MCP-серверов
  private _setMCPUserStateOfName = async (newStates: MCPUserStateOfName) => {
    const newState: SapphireSettingsState = {
      ...this.state,
      mcpUserStateOfName: {
        ...this.state.mcpUserStateOfName,
        ...newStates,
      },
    };
    this.state = _validatedModelState(newState);
    await this._storeState();
    this._onDidChangeState.fire();
  };

  addMCPUserStateOfNames = async (newMCPStates: MCPUserStateOfName) => {
    const { mcpUserStateOfName: mcpServerStates } = this.state;
    const newMCPServerStates = {
      ...mcpServerStates,
      ...newMCPStates,
    };
    await this._setMCPUserStateOfName(newMCPServerStates);
  };

  removeMCPUserStateOfNames = async (serverNames: string[]) => {
    const { mcpUserStateOfName: mcpServerStates } = this.state;
    const newMCPServerStates = {
      ...mcpServerStates,
    };
    serverNames.forEach((serverName) => {
      if (serverName in newMCPServerStates) {
        delete newMCPServerStates[serverName];
      }
    });
    await this._setMCPUserStateOfName(newMCPServerStates);
  };

  setMCPServerState = async (serverName: string, state: MCPUserState) => {
    const { mcpUserStateOfName } = this.state;
    const newMCPServerStates = {
      ...mcpUserStateOfName,
      [serverName]: state,
    };
    await this._setMCPUserStateOfName(newMCPServerStates);
  };
}

registerSingleton(ISapphireSettingsService, SapphireSettingsService, InstantiationType.Eager);

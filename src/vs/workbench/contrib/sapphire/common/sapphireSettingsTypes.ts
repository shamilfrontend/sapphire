/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DEEPSEEK_USAGE_URL } from './llmProviderConfig.js';
import {
  defaultModelsOfProvider,
  defaultProviderSettings,
  ModelOverrides,
} from './modelCapabilities.js';
import { ToolApprovalType } from './toolsServiceTypes.js';
import { SapphireSettingsState } from './sapphireSettingsService.js';

type UnionOfKeys<T> = T extends T ? keyof T : never;

export type ProviderName = keyof typeof defaultProviderSettings;
export const providerNames = Object.keys(defaultProviderSettings) as ProviderName[];

/** Видимые облачные провайдеры в порядке отображения (DeepSeek первым). */
export const cloudProviderNames = [
  'deepseek',
  'anthropic',
  'openAI',
  'openRouter',
  'gemini',
  'groq',
  'xAI',
  'mistral',
] as const satisfies readonly ProviderName[];

/** Видимые локальные/кастомные endpoint-провайдеры в порядке отображения. */
export const localProviderNames = [
  'ollama',
  'vLLM',
  'lmStudio',
  'openAICompatible',
  'liteLLM',
] as const satisfies readonly ProviderName[];

type CustomSettingName = UnionOfKeys<(typeof defaultProviderSettings)[ProviderName]>;
type CustomProviderSettings<providerName extends ProviderName> = {
  [k in CustomSettingName]: k extends keyof (typeof defaultProviderSettings)[providerName]
    ? string
    : undefined;
};
export const customSettingNamesOfProvider = (providerName: ProviderName) =>
  Object.keys(defaultProviderSettings[providerName]) as CustomSettingName[];

export type SapphireStatefulModelInfo = {
  // <-- с состоянием (ключи API)
  modelName: string;
  type: 'default' | 'autodetected' | 'custom';
  isHidden: boolean; // пользователь скрыл модель (выключена)
};

type CommonProviderSettings = {
  _didFillInProviderSettings: boolean | undefined; // undefined, затем true когда заполнены поля провайдера
  /** Пользовательский opt-in: false — провайдер настроен, но не участвует в выборе моделей. */
  isEnabled: boolean;
  models: SapphireStatefulModelInfo[];
};

type SettingsAtProvider<providerName extends ProviderName> = CustomProviderSettings<providerName> &
  CommonProviderSettings;

// часть state по ProviderName
export type SettingsOfProvider = {
  [providerName in ProviderName]: SettingsAtProvider<providerName>;
};

export type SettingName = keyof SettingsAtProvider<ProviderName>;

/**
 * Провайдер в списке «подключённых» Settings: заполнены поля и есть модели,
 * либо сохранён apiKey (чтобы править/удалять ключ даже при пустом списке моделей).
 * Дефолтный endpoint без моделей (Ollama и т.п.) не считается подключённым.
 */
export const isProviderListedAsConnected = (
  settings: SettingsOfProvider[ProviderName] | undefined,
): boolean => {
  if (!settings?._didFillInProviderSettings) {
    return false;
  }
  if (settings.models.length > 0) {
    return true;
  }
  const apiKey = Object.hasOwn(settings, 'apiKey') ? settings.apiKey : undefined;
  return typeof apiKey === 'string' && apiKey.trim().length > 0;
};

/** Облачные для формы добавления: каталог + Vertex / Azure / Bedrock. */
export const addFormCloudProviderNames = [
  ...cloudProviderNames,
  'googleVertex',
  'microsoftAzure',
  'awsBedrock',
] as const satisfies readonly ProviderName[];

export const addFormLocalProviderNames = localProviderNames;

type DisplayInfoForProviderName = {
  title: string;
  desc?: string;
  /** Ссылка на кабинет ключа / расхода, если она есть у провайдера. */
  usageUrl?: string;
};

export const displayInfoOfProviderName = (
  providerName: ProviderName,
): DisplayInfoForProviderName => {
  switch (providerName) {
    case 'anthropic':
      return { title: 'Anthropic', desc: 'https://api.anthropic.com' };
    case 'openAI':
      return { title: 'OpenAI', desc: 'https://api.openai.com/v1' };
    case 'deepseek':
      return {
        title: 'DeepSeek',
        desc: 'https://api.deepseek.com/v1',
        usageUrl: DEEPSEEK_USAGE_URL,
      };
    case 'ollama':
      return { title: 'Ollama', desc: 'Локальный сервер' };
    case 'vLLM':
      return { title: 'vLLM', desc: 'Локальный OpenAI-совместимый сервер' };
    case 'openRouter':
      return { title: 'OpenRouter', desc: 'https://openrouter.ai/api/v1' };
    case 'openAICompatible':
      return { title: 'OpenAI Compatible', desc: 'Свой base URL, ключ и заголовки' };
    case 'gemini':
      return { title: 'Gemini', desc: 'https://generativelanguage.googleapis.com' };
    case 'groq':
      return { title: 'Groq', desc: 'https://api.groq.com/openai/v1' };
    case 'xAI':
      return { title: 'xAI', desc: 'https://api.x.ai/v1' };
    case 'mistral':
      return { title: 'Mistral', desc: 'https://api.mistral.ai/v1' };
    case 'lmStudio':
      return { title: 'LM Studio', desc: 'Локальный сервер' };
    case 'liteLLM':
      return { title: 'LiteLLM', desc: 'Прокси OpenAI-совместимого API' };
    case 'googleVertex':
      return { title: 'Google Vertex', desc: 'OpenAI-совместимый endpoint Vertex' };
    case 'microsoftAzure':
      return { title: 'Azure OpenAI', desc: 'Ресурс Azure и версия API' };
    case 'awsBedrock':
      return { title: 'AWS Bedrock', desc: 'OpenAI-совместимый endpoint Bedrock' };
    default: {
      const _exhaustive: never = providerName;
      return { title: _exhaustive };
    }
  }
};

type DisplayInfo = {
  title: string;
  placeholder: string;
  isPasswordField?: boolean;
};
export const displayInfoOfSettingName = (
  providerName: ProviderName,
  settingName: SettingName,
): DisplayInfo => {
  if (settingName === 'apiKey') {
    return {
      title: providerName === 'deepseek' ? 'API-ключ DeepSeek' : 'API-ключ',
      placeholder: 'sk-...',
      isPasswordField: true,
    };
  }
  if (settingName === 'endpoint') {
    return { title: 'Base URL', placeholder: 'https://...' };
  }
  if (settingName === 'headersJSON') {
    return { title: 'Доп. заголовки (JSON)', placeholder: '{}' };
  }
  if (settingName === 'region') {
    return { title: 'Регион', placeholder: 'us-east-1' };
  }
  if (settingName === 'project') {
    return {
      title: providerName === 'microsoftAzure' ? 'Ресурс Azure' : 'Проект',
      placeholder: providerName === 'microsoftAzure' ? 'my-resource' : 'project-id',
    };
  }
  if (settingName === 'azureApiVersion') {
    return { title: 'Версия Azure API', placeholder: '2024-05-01-preview' };
  }
  if (settingName === '_didFillInProviderSettings') {
    return {
      title: '(never)',
      placeholder: '(never)',
    };
  }
  if (settingName === 'isEnabled') {
    return {
      title: '(never)',
      placeholder: '(never)',
    };
  }
  if (settingName === 'models') {
    return {
      title: '(never)',
      placeholder: '(never)',
    };
  }

  throw new Error(`displayInfo: Unknown setting name: "${settingName}"`);
};

const defaultCustomSettings: Record<CustomSettingName, undefined> = {
  apiKey: undefined,
  endpoint: undefined,
  headersJSON: undefined,
  region: undefined,
  project: undefined,
  azureApiVersion: undefined,
};

const settingsOf = <P extends ProviderName>(providerName: P): SettingsOfProvider[P] =>
  // Spread по generic-провайдеру не сужается до SettingsOfProvider[P].
  // eslint-disable-next-line local/code-no-dangerous-type-assertions
  ({
    ...defaultCustomSettings,
    ...defaultProviderSettings[providerName],
    ...modelInfoOfDefaultModelNames([...defaultModelsOfProvider[providerName]]),
    _didFillInProviderSettings: undefined,
    isEnabled: true,
  }) as SettingsOfProvider[P];

const modelInfoOfDefaultModelNames = (
  defaultModelNames: string[],
): { models: SapphireStatefulModelInfo[] } => ({
  models: defaultModelNames.map((modelName, _i) => ({
    modelName,
    type: 'default',
    isHidden: defaultModelNames.length >= 10, // много моделей — скрыть, включать вручную
  })),
});

// ожидание / type reference
export const defaultSettingsOfProvider: SettingsOfProvider = {
  anthropic: settingsOf('anthropic'),
  openAI: settingsOf('openAI'),
  deepseek: settingsOf('deepseek'),
  ollama: settingsOf('ollama'),
  vLLM: settingsOf('vLLM'),
  openRouter: settingsOf('openRouter'),
  openAICompatible: settingsOf('openAICompatible'),
  gemini: settingsOf('gemini'),
  groq: settingsOf('groq'),
  xAI: settingsOf('xAI'),
  mistral: settingsOf('mistral'),
  lmStudio: settingsOf('lmStudio'),
  liteLLM: settingsOf('liteLLM'),
  googleVertex: settingsOf('googleVertex'),
  microsoftAzure: settingsOf('microsoftAzure'),
  awsBedrock: settingsOf('awsBedrock'),
};

export type ModelSelection = { providerName: ProviderName; modelName: string };

export const modelSelectionsEqual = (m1: ModelSelection, m2: ModelSelection) =>
  m1.modelName === m2.modelName && m1.providerName === m2.providerName;

// элемент state
export const featureNames = ['Chat', 'Ctrl+K', 'Autocomplete', 'Apply', 'SCM'] as const;
export type ModelSelectionOfFeature = Record<(typeof featureNames)[number], ModelSelection | null>;
export type FeatureName = keyof ModelSelectionOfFeature;

export const displayInfoOfFeatureName = (featureName: FeatureName) => {
  // редактор:
  if (featureName === 'Autocomplete') {return 'Автодополнение';}
  if (featureName === 'Ctrl+K') {return 'Быстрое редактирование';}
  // сайдбар:
  if (featureName === 'Chat') {return 'Чат';}
  if (featureName === 'Apply') {return 'Apply';}
  // SCM:
  if (featureName === 'SCM') {return 'Генератор сообщений коммита';}
  throw new Error(`Feature Name ${featureName} not allowed`);
};

// для isFeatureNameDisabled
export const isProviderNameDisabled = (
  providerName: ProviderName,
  settingsState: SapphireSettingsState,
) => {
  const settingsAtProvider = settingsState.settingsOfProvider[providerName];
  if (settingsAtProvider?.isEnabled === false) {
    return 'providerDisabled' as const;
  }
  // модели ещё не подтянулись или провайдер не настроен
  const models = settingsAtProvider?.models ?? [];
  if (models.length === 0) {
    return 'providerNotAutoDetected' as const;
  }
  return false;
};

export const isFeatureNameDisabled = (
  featureName: FeatureName,
  settingsState: SapphireSettingsState,
) => {
  // выбранный провайдер включён?
  const selectedProvider = settingsState.modelSelectionOfFeature[featureName];

  if (selectedProvider) {
    const { providerName } = selectedProvider;
    return isProviderNameDisabled(providerName, settingsState);
  }

  // есть модели для включения у включённых провайдеров
  const canTurnOnAModel = !!providerNames.find((providerName) => {
    const p = settingsState.settingsOfProvider[providerName];
    if (p?.isEnabled === false) {return false;}
    const models = p?.models ?? [];
    return models.filter((m) => m.isHidden).length !== 0;
  });
  if (canTurnOnAModel) {return 'needToEnableModel';}

  // включённый провайдер есть — добавить модель
  const anyEnabledFilledIn = !!providerNames.find((providerName) => {
    const p = settingsState.settingsOfProvider[providerName];
    return !!p?._didFillInProviderSettings && p.isEnabled !== false;
  });
  if (anyEnabledFilledIn) {return 'addModel';}

  // провайдеры настроены, но все выключены
  const anyFilledIn = !!providerNames.find(
    (providerName) => settingsState.settingsOfProvider[providerName]?._didFillInProviderSettings,
  );
  if (anyFilledIn) {return 'providerDisabled';}

  return 'addProvider';
};

export type ChatMode = 'agent' | 'normal' | 'plan';

const chatModes: readonly ChatMode[] = ['agent', 'normal', 'plan'];

export const isChatMode = (value: unknown): value is ChatMode =>
  typeof value === 'string' && (chatModes as readonly string[]).includes(value);

/** Режим треда, если он сохранён; иначе общий fallback (старые чаты без своего режима). */
export const resolveThreadChatMode = (chatMode: unknown, fallback: ChatMode): ChatMode => {
  // Снятый режим «Отладка» был тем же набором tools, что агент.
  if (chatMode === 'debug') {return 'agent';}
  return isChatMode(chatMode) ? chatMode : fallback;
};

/** Оболочка workbench: режим IDE (классический редактор) или полноэкранный chat-first «Режим Агент». */
export type LayoutMode = 'ide' | 'agents';

export type UserRule = {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
};

export const aiInstructionsFromUserRules = (rules: UserRule[]): string =>
  rules
    .filter((r) => r.enabled && r.content.trim())
    .map((r) => r.content.trim())
    .join('\n\n');

/** Старый id корпоративного FE-правила. При загрузке настроек выкидывается и больше не сеется. */
export const LEGACY_FRONTEND_STACK_RULE_ID = 'ppr-default-frontend-stack';

const defaultUserRules: UserRule[] = [];

export type UserSkill = {
  id: string;
  name: string;
  content: string;
  /**
   * Always-on: тело скилла в SKILLS: на каждый запрос.
   * По умолчанию false у shipped — активация через `/slug` в чате.
   */
  enabled: boolean;
  /** Команда в чате без `/`, напр. `design-landing`. */
  slug: string;
  /** Группа в меню `/`, напр. `design`. */
  category: string;
};

/** Стабильные id shipped UI-скиллов (re-seed при удалении). */
export const SAPPHIRE_DEFAULT_SKILL_LANDING_ID = 'sapphire-default-skill-landing';
export const SAPPHIRE_DEFAULT_SKILL_DASHBOARD_ID = 'sapphire-default-skill-dashboard';

/** Старые id shipped-скиллов из PPR-сборок; remap в mergeShippedUserSkills. */
const LEGACY_PPR_DEFAULT_SKILL_LANDING_ID = 'ppr-default-skill-landing';
const LEGACY_PPR_DEFAULT_SKILL_DASHBOARD_ID = 'ppr-default-skill-dashboard';

const LEGACY_SHIPPED_SKILL_ID_MAP: Readonly<Record<string, string>> = {
  [LEGACY_PPR_DEFAULT_SKILL_LANDING_ID]: SAPPHIRE_DEFAULT_SKILL_LANDING_ID,
  [LEGACY_PPR_DEFAULT_SKILL_DASHBOARD_ID]: SAPPHIRE_DEFAULT_SKILL_DASHBOARD_ID,
};

const LANDING_SKILL_CONTENT = `Когда применять: лендинг, промо, маркетинговая страница, hero, сайт продукта «с улицы».
Когда не применять: админка, кабинет, таблицы, KPI, формы внутри продукта.

Сначала направление и токены (шрифты, цвет, spacing), потом компоненты — не наоборот.

Правила:
- ≤2 шрифта (+ optional mono), ≤5 размеров; своя палитра и характер.
- Один фокус на первом экране, один главный CTA; один визуальный якорь на секцию.
- 8pt spacing; контраст body ≥4.5:1; мобилка = пересборка layout, touch ≥44px.
- Motion: CSS transform/opacity; смысл или вырезать; всегда prefers-reduced-motion.
- Не выдумывать логотипы, цифры, отзывы; плейсхолдеры помечать явно.
- Если в проекте уже есть бренд/токены — следовать им, не навязывать чужой «стиль».

Gotchas (избегать):
- Inter / системный шрифт как единственный display
- фиолетовый градиентный hero, три одинаковые feature-карточки, эмодзи вместо иконок
- собирать лендинг как дашборд (сетка KPI, плотные таблицы)`;

const DASHBOARD_SKILL_CONTENT = `Когда применять: дашборд, админка, кабинет, списки/таблицы, KPI, фильтры, data UI.
Когда не применять: маркетинговый лендинг, промо-hero, award-grade сайт «с улицы».

Плотность и сканируемость важнее маркетингового воздуха.

Правила:
- Шапка страницы → одно главное действие → фильтры → данные.
- KPI — компактные метрики; длинные списки — таблицы, не карточки.
- Состояния empty / loading / error обязательны.
- График — одна мысль, подписи осей, без радужной палитры.
- Если в проекте уже есть дизайн-система — использовать её компоненты и не выдумывать props/API.
- Без hero, огромных display-заголовков и лендинговых градиентов.

Gotchas (избегать):
- три маркетинговые карточки вместо таблицы
- декоративный motion и «воздух» секций как на лендинге
- выдуманные цифры без пометки плейсхолдера`;

export const defaultUserSkills: UserSkill[] = [
  {
    id: SAPPHIRE_DEFAULT_SKILL_LANDING_ID,
    name: 'Лендинг',
    slug: 'design-landing',
    category: 'design',
    content: LANDING_SKILL_CONTENT,
    enabled: false,
  },
  {
    id: SAPPHIRE_DEFAULT_SKILL_DASHBOARD_ID,
    name: 'Дашборд',
    slug: 'design-dashboard',
    category: 'design',
    content: DASHBOARD_SKILL_CONTENT,
    enabled: false,
  },
];

export const skillInstructionsFromUserSkills = (skills: UserSkill[]): string =>
  skills
    .filter((s) => s.enabled && s.content.trim())
    .map((s) => s.content.trim())
    .join('\n\n');

/** Слаг из названия: латиница/цифры/дефисы; пустой → custom. */
export const slugifySkillName = (name: string): string => {
  const raw = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/[а-яё]/gi, '');
  const cleaned = raw.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'custom';
};

export const normalizeUserSkill = (skill: Partial<UserSkill> & Pick<UserSkill, 'id' | 'name' | 'content' | 'enabled'>): UserSkill => {
  const slug =
    typeof skill.slug === 'string' && skill.slug.trim()
      ? skill.slug.trim().toLowerCase().replace(/^\/+/, '')
      : slugifySkillName(skill.name);
  const category =
    typeof skill.category === 'string' && skill.category.trim()
      ? skill.category.trim().toLowerCase()
      : 'custom';
  return {
    id: skill.id,
    name: skill.name,
    content: skill.content,
    enabled: !!skill.enabled,
    slug,
    category,
  };
};

/**
 * Вставляет/обновляет shipped skills: нет id → в начало; есть → name/content/slug/category из shipped, enabled сохраняем.
 * Чужие скиллы не трогаем. Нормализует slug/category у всех.
 */
export const mergeShippedUserSkills = (
  existing: UserSkill[],
  shipped: UserSkill[] = defaultUserSkills,
): UserSkill[] => {
  const remapped = existing.map((s) => {
    const nextId = LEGACY_SHIPPED_SKILL_ID_MAP[s.id];
    return nextId ? { ...s, id: nextId } : s;
  });
  // After remap, collapse duplicate ids (legacy + already-migrated).
  const byId = new Map<string, UserSkill>();
  for (const s of remapped) {
    const prev = byId.get(s.id);
    if (!prev) {
      byId.set(s.id, s);
      continue;
    }
    byId.set(s.id, { ...prev, enabled: prev.enabled || s.enabled });
  }
  const normalized = [...byId.values()].map((s) => normalizeUserSkill(s));
  let next = [...normalized];
  for (const s of shipped) {    const shippedNorm = normalizeUserSkill(s);
    const idx = next.findIndex((x) => x.id === shippedNorm.id);
    if (idx < 0) {
      next = [shippedNorm, ...next];
    } else {
      next[idx] = {
        ...next[idx],
        name: shippedNorm.name,
        content: shippedNorm.content,
        slug: shippedNorm.slug,
        category: shippedNorm.category,
      };
    }
  }
  return next;
};

/** Токены `/slug` в тексте сообщения (латиница, цифры, дефисы). */
const SLASH_SKILL_TOKEN_RE = /(?:^|[\s([{])\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\b/gi;

export const parseSlashSkillSlugs = (text: string): string[] => {
  if (!text) {return [];}
  const slugs: string[] = [];
  const seen = new Set<string>();
  SLASH_SKILL_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SLASH_SKILL_TOKEN_RE.exec(text)) !== null) {
    const slug = m[1].toLowerCase();
    if (seen.has(slug)) {continue;}
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
};

/** Тела скиллов по slug; неизвестные игнорируются. Category-slug → все скиллы категории. */
export const resolveSkillContentsBySlugs = (skills: UserSkill[], slugs: string[]): string => {
  if (!slugs.length) {return '';}
  const parts: string[] = [];
  const usedIds = new Set<string>();
  for (const slug of slugs) {
    const exact = skills.filter((s) => s.slug === slug && s.content.trim());
    if (exact.length) {
      for (const s of exact) {
        if (usedIds.has(s.id)) {continue;}
        usedIds.add(s.id);
        parts.push(s.content.trim());
      }
      continue;
    }
    const byCategory = skills.filter((s) => s.category === slug && s.content.trim());
    for (const s of byCategory) {
      if (usedIds.has(s.id)) {continue;}
      usedIds.add(s.id);
      parts.push(s.content.trim());
    }
  }
  return parts.join('\n\n');
};

const combineSkillInstructionParts = (...parts: Array<string | undefined | null>): string =>
  parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join('\n\n');

export const skillInstructionsForUserText = (
  skills: UserSkill[],
  alwaysOnInstructions: string,
  userText: string,
): string => {
  const fromSlash = resolveSkillContentsBySlugs(skills, parseSlashSkillSlugs(userText));
  return combineSkillInstructionParts(alwaysOnInstructions, fromSlash);
};

export type GlobalSettings = {
  autoRefreshModels: boolean;
  aiInstructions: string;
  userRules: UserRule[];
  skillInstructions: string;
  userSkills: UserSkill[];
  enableAutocomplete: boolean;
  syncApplyToChat: boolean;
  syncSCMToChat: boolean;
  enableFastApply: boolean;
  chatMode: ChatMode;
  autoApprove: { [approvalType in ToolApprovalType]?: boolean };
  showInlineSuggestions: boolean;
  includeToolLintErrors: boolean;
  isOnboardingComplete: boolean;
  /** `ide` — Режим IDE (редактор + чат). `agents` — fullscreen Режим Агент. */
  layoutMode: LayoutMode;
  disableSystemMessage: boolean;
  autoAcceptLLMChanges: boolean;
  playChatNotificationSound: boolean;
  /** При true содержимое активного редактора в SELECTIONS при отправке. */
  autoAttachActiveFile: boolean;
  /**
   * При true эвристический поиск по workspace прикрепляет несколько файлов в SELECTIONS
   * при отправке.
   */
  autoRetrieveRelevantFiles: boolean;
  /** Фоновый индекс проекта в `.sapphire/index/`. */
  projectIndexEnabled: boolean;
  /** Индексировать xlsx/docx/pptx/pdf. */
  projectIndexIncludeOffice: boolean;
  /** Разрешить LLM-описания файлов индекса (запуск только вручную из окна индекса). */
  projectIndexLlmPurpose: boolean;
  /**
   * Elevated: разрешить agent tools вне корней workspace.
   * По умолчанию false — path sandbox (см. agentSecurityPolicy.ts).
   */
  allowAgentPathsOutsideWorkspace: boolean;
};

export const defaultGlobalSettings: GlobalSettings = {
  autoRefreshModels: true,
  aiInstructions: aiInstructionsFromUserRules(defaultUserRules),
  userRules: defaultUserRules,
  skillInstructions: skillInstructionsFromUserSkills(defaultUserSkills),
  userSkills: defaultUserSkills,
  // Privacy-by-default: FIM/агент/авто-attach выключены, пока пользователь не включит.
  enableAutocomplete: false,
  syncApplyToChat: true,
  syncSCMToChat: true,
  enableFastApply: true,
  chatMode: 'normal',
  // Правки / terminal / MCP / network / browser — только с подтверждением (безопасный default).
  autoApprove: {
    edits: false,
    terminal: false,
    'MCP tools': false,
    network: false,
    browser: false,
  },
  showInlineSuggestions: true,
  includeToolLintErrors: true,
  isOnboardingComplete: false,
  layoutMode: 'ide',
  disableSystemMessage: false,
  autoAcceptLLMChanges: false,
  playChatNotificationSound: true,
  autoAttachActiveFile: false,
  autoRetrieveRelevantFiles: false,
  projectIndexEnabled: true,
  projectIndexIncludeOffice: true,
  projectIndexLlmPurpose: false,
  allowAgentPathsOutsideWorkspace: false,
};

export type GlobalSettingName = keyof GlobalSettings;

export type ModelSelectionOptions = {
  reasoningEnabled?: boolean;
  reasoningBudget?: number;
  reasoningEffort?: string;
};

export type OptionsOfModelSelection = {
  [featureName in FeatureName]: Partial<{
    [providerName in ProviderName]: {
      [modelName: string]: ModelSelectionOptions | undefined;
    };
  }>;
};

export type OverridesOfModel = {
  [providerName in ProviderName]: {
    [modelName: string]: Partial<ModelOverrides> | undefined;
  };
};

const overridesOfModel: Partial<OverridesOfModel> = {};
for (const providerName of providerNames) {
  overridesOfModel[providerName] = {};
}
export const defaultOverridesOfModel = overridesOfModel as OverridesOfModel;

export interface MCPUserStateOfName {
  [serverName: string]: MCPUserState | undefined;
}

export interface MCPUserState {
  isOn: boolean;
}

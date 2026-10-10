/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Check, Asterisk, Settings as SettingsIcon } from 'lucide-react';
import {
  ProviderName,
  SettingName,
  displayInfoOfSettingName,
  SapphireStatefulModelInfo,
  customSettingNamesOfProvider,
  displayInfoOfProviderName,
  isProviderNameDisabled,
  providerNames,
} from '../../../../common/sapphireSettingsTypes.js';
import { LLM_IDE_TITLE } from '../../../../common/llmProviderConfig.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';
import { SapphireButtonBgDarken, SapphireSimpleInputBox, SapphireSwitch } from '../util/inputs.js';
import { useAccessor, useSettingsState } from '../util/services.js';
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js';
import { WarningBox } from './WarningBox.js';
import {
  getModelCapabilities,
  modelOverrideKeys,
  ModelOverrides,
} from '../../../../common/modelCapabilities.js';

// ---------------- Упрощённый диалог настроек модели ------------------

// Ключи ModelOverrides, которые пользователь может переопределить.

// Вместо громоздкой формы — одно поле JSON с переопределениями.
const SimpleModelSettingsDialog = ({
  isOpen,
  onClose,
  modelInfo,
}: {
  isOpen: boolean;
  onClose: () => void;
  modelInfo: {
    modelName: string;
    providerName: ProviderName;
    type: 'autodetected' | 'custom' | 'default';
  } | null;
}) => {
  if (!isOpen || !modelInfo) return null;

  const { modelName, providerName, type } = modelInfo;
  const accessor = useAccessor();
  const settingsState = useSettingsState();
  const mouseDownInsideModal = useRef(false); // mousedown начался внутри модалки (не закрывать по mouseup снаружи)
  const settingsStateService = accessor.get('ISapphireSettingsService');

  // Текущие переопределения и значения по умолчанию
  const defaultModelCapabilities = getModelCapabilities(providerName, modelName, undefined);
  const currentOverrides = settingsState.overridesOfModel?.[providerName]?.[modelName] ?? undefined;
  const { recognizedModelName, isUnrecognizedModel } = defaultModelCapabilities;

  // Placeholder — JSON с дефолтами только по разрешённым ключам
  const partialDefaults: Partial<ModelOverrides> = {};
  for (const k of modelOverrideKeys) {
    if (defaultModelCapabilities[k]) partialDefaults[k] = defaultModelCapabilities[k] as any;
  }
  const placeholder = JSON.stringify(partialDefaults, null, 2);

  const [overrideEnabled, setOverrideEnabled] = useState<boolean>(() => !!currentOverrides);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  // Сброс состояния при открытии/закрытии диалога
  useEffect(() => {
    if (!isOpen) return;
    const cur = settingsState.overridesOfModel?.[providerName]?.[modelName];
    setOverrideEnabled(!!cur);
    setErrorMsg(null);
  }, [isOpen, providerName, modelName, settingsState.overridesOfModel, placeholder]);

  const onSave = async () => {
    // Переопределение выключено — сбрасываем overrides
    if (!overrideEnabled) {
      await settingsStateService.setOverridesOfModel(providerName, modelName, undefined);
      onClose();
      return;
    }

    // Переопределение включено — парсим JSON
    let parsedInput: Record<string, unknown>;

    if (textAreaRef.current?.value) {
      try {
        parsedInput = JSON.parse(textAreaRef.current.value);
      } catch (_e) {
        setErrorMsg('Некорректный JSON');
        return;
      }
    } else {
      setErrorMsg('Некорректный JSON');
      return;
    }

    // Оставляем только разрешённые ключи
    const cleaned: Partial<ModelOverrides> = {};
    for (const k of modelOverrideKeys) {
      if (!(k in parsedInput)) continue;
      const isEmpty =
        parsedInput[k] === '' || parsedInput[k] === null || parsedInput[k] === undefined;
      if (!isEmpty) {
        cleaned[k] = parsedInput[k] as any;
      }
    }
    await settingsStateService.setOverridesOfModel(providerName, modelName, cleaned);
    onClose();
  };

  const sourcecodeOverridesLink = `https://github.com/voideditor/void/blob/2e5ecb291d33afbe4565921664fb7e183189c1c5/src/vs/workbench/contrib/sapphire/common/modelCapabilities.ts#L146-L172`;

  return (
    <div // Затемнение фона
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999999]"
      onMouseDown={() => {
        mouseDownInsideModal.current = false;
      }}
      onMouseUp={() => {
        if (!mouseDownInsideModal.current) {
          onClose();
        }
        mouseDownInsideModal.current = false;
      }}
    >
      {/* Модальное окно */}
      <div
        className="bg-void-bg-1 rounded-md p-4 max-w-xl w-full shadow-xl overflow-y-auto max-h-[90vh]"
        onClick={(e) => e.stopPropagation()} // Клик внутри не закрывает backdrop
        onMouseDown={(e) => {
          mouseDownInsideModal.current = true;
          e.stopPropagation();
        }}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">
            Параметры модели {modelName} ({displayInfoOfProviderName(providerName).title})
          </h3>
          <button onClick={onClose} className="text-void-fg-3 hover:text-void-fg-1">
            <X className="size-5" />
          </button>
        </div>

        {/* Статус распознавания модели шлюзом */}
        <div className="text-sm text-void-fg-3 mb-4">
          {type === 'default'
            ? `${modelName} уже есть в списке ${LLM_IDE_TITLE} — менять эти параметры обычно не нужно.`
            : isUnrecognizedModel
              ? `Модель не распознана.`
              : `${LLM_IDE_TITLE} распознаёт ${modelName} («${recognizedModelName}»).`}
        </div>

        {/* Переключатель переопределения */}
        <div className="flex items-center gap-2 mb-4">
          <SapphireSwitch size="xs" value={overrideEnabled} onChange={setOverrideEnabled} />
          <span className="text-void-fg-3 text-sm">Переопределить параметры по умолчанию</span>
        </div>

        {/* Ссылка на справочник по формату JSON */}
        {overrideEnabled && (
          <div className="text-sm text-void-fg-3 mb-4">
            <ChatMarkdownRender
              string={`См. [исходный код](${sourcecodeOverridesLink}) — справочник по формату JSON (для продвинутых).`}
              chatMessageLocation={undefined}
            />
          </div>
        )}

        <textarea
          key={`${overrideEnabled}`}
          ref={textAreaRef}
          className={`w-full min-h-[200px] p-2 rounded-sm border border-void-border-2 bg-void-bg-2 resize-none font-mono text-sm ${!overrideEnabled ? 'text-void-fg-3' : ''}`}
          defaultValue={
            overrideEnabled && currentOverrides
              ? JSON.stringify(currentOverrides, null, 2)
              : placeholder
          }
          placeholder={placeholder}
          readOnly={!overrideEnabled}
        />
        {errorMsg && <div className="text-red-500 mt-2 text-sm">{errorMsg}</div>}

        <div className="flex justify-end gap-2 mt-4">
          <SapphireButtonBgDarken onClick={onClose} className="px-3 py-1">
            Отмена
          </SapphireButtonBgDarken>
          <SapphireButtonBgDarken
            onClick={onSave}
            className="px-3 py-1 bg-[#00b0cc] text-white hover:bg-[#0097b2]"
          >
            Сохранить
          </SapphireButtonBgDarken>
        </div>
      </div>
    </div>
  );
};

export const ModelDump = () => {
  const accessor = useAccessor();
  const settingsStateService = accessor.get('ISapphireSettingsService');
  const settingsState = useSettingsState();

  // Какая модель открыта в диалоге расширенных настроек
  const [openSettingsModel, setOpenSettingsModel] = useState<{
    modelName: string;
    providerName: ProviderName;
    type: 'autodetected' | 'custom' | 'default';
  } | null>(null);

  // Плоский список моделей всех провайдеров с флагом доступности
  const modelDump: (SapphireStatefulModelInfo & {
    providerName: ProviderName;
    providerEnabled: boolean;
  })[] = [];

  for (const providerName of providerNames) {
    const providerSettings = settingsState.settingsOfProvider[providerName];
    modelDump.push(
      ...providerSettings.models.map((model) => ({
        ...model,
        providerName,
        providerEnabled: !!providerSettings._didFillInProviderSettings,
      })),
    );
  }

  // Сначала модели от подключённых провайдеров
  modelDump.sort((a, b) => Number(b.providerEnabled) - Number(a.providerEnabled));

  return (
    <div>
      {modelDump.map((m, i) => {
        const { isHidden, type, modelName, providerName, providerEnabled } = m;

        const isNewProviderName =
          (i > 0 ? modelDump[i - 1] : undefined)?.providerName !== providerName;

        const providerTitle = displayInfoOfProviderName(providerName).title;

        const disabled = !providerEnabled;
        const value = disabled ? false : !isHidden;

        const tooltipName = disabled
          ? `Подключите ${providerTitle}, чтобы включить`
          : value === true
            ? 'Показывать в списке'
            : 'Скрыть из списка';

        const detailAboutModel =
          type === 'autodetected' ? (
            <Asterisk
              size={14}
              className="inline-block align-text-top brightness-115 stroke-[2] text-[#00b0cc]"
              data-tooltip-id="sapphire-tooltip"
              data-tooltip-place="right"
              data-tooltip-content="Обнаружена автоматически"
            />
          ) : type === 'custom' ? (
            <Asterisk
              size={14}
              className="inline-block align-text-top brightness-115 stroke-[2] text-[#00b0cc]"
              data-tooltip-id="sapphire-tooltip"
              data-tooltip-place="right"
              data-tooltip-content="Пользовательская модель"
            />
          ) : undefined;

        const hasOverrides = !!settingsState.overridesOfModel?.[providerName]?.[modelName];

        return (
          <div key={`${modelName}${providerName}`}>
            {isNewProviderName && (
              <div className="text-sm text-void-fg-3 px-3 pt-4 pb-1">{providerTitle}</div>
            )}
            <div
              className={`flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-gray-300/10 py-1 px-3 rounded-sm overflow-hidden cursor-default truncate group
				`}
            >
              {/* Левая часть — имя модели, flex-grow */}
              <div className="flex flex-grow items-center gap-4 min-w-0">
                <span className="w-fit max-w-[400px] truncate">{modelName}</span>
              </div>

              {/* Правая часть — иконки и переключатель */}
              <div className="flex items-center gap-2 w-fit">
                {/* Шестерёнка: скрыта, если провайдер не настроен */}
                {disabled ? null : (
                  <div className="w-5 flex items-center justify-center">
                    <button
                      onClick={() => {
                        setOpenSettingsModel({ modelName, providerName, type });
                      }}
                      data-tooltip-id="sapphire-tooltip"
                      data-tooltip-place="right"
                      data-tooltip-content="Расширенные настройки"
                      className={`${hasOverrides ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
                    >
                      <SettingsIcon size={14} className="text-void-fg-3 opacity-70" />
                    </button>
                  </div>
                )}

                {/* Маркер autodetected / custom */}
                {detailAboutModel}

                {/* Показать/скрыть в списках выбора модели */}
                <SapphireSwitch
                  value={value}
                  onChange={() => {
                    settingsStateService.toggleModelHidden(providerName, modelName);
                  }}
                  disabled={disabled}
                  size="sm"
                  data-tooltip-id="sapphire-tooltip"
                  data-tooltip-place="right"
                  data-tooltip-content={tooltipName}
                />
              </div>
            </div>
          </div>
        );
      })}

      {/* Диалог переопределений модели */}
      <SimpleModelSettingsDialog
        isOpen={openSettingsModel !== null}
        onClose={() => setOpenSettingsModel(null)}
        modelInfo={openSettingsModel}
      />
    </div>
  );
};

// Поля настроек провайдера

const ProviderSetting = ({
  providerName,
  settingName,
}: {
  providerName: ProviderName;
  settingName: SettingName;
}) => {
  const {
    title: settingTitle,
    placeholder,
    isPasswordField,
  } = displayInfoOfSettingName(providerName, settingName);

  const accessor = useAccessor();
  const sapphireSettingsService = accessor.get('ISapphireSettingsService');
  const settingsState = useSettingsState();

  const rawSettingValue = settingsState.settingsOfProvider[providerName][settingName];
  const settingValue = typeof rawSettingValue === 'string' ? rawSettingValue : '';

  // Токен (apiKey): сохраняем только по кнопке, чтобы было ясно, что значение записано.
  const saveOnButton = settingName === 'apiKey';
  const [draftValue, setDraftValue] = useState(settingValue);
  const [justSaved, setJustSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const savedFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraftValue(settingValue);
    if (!settingValue) setConfirmDelete(false);
  }, [settingValue]);

  useEffect(
    () => () => {
      if (savedFeedbackTimerRef.current) clearTimeout(savedFeedbackTimerRef.current);
    },
    [],
  );

  const handleChangeValue = useCallback(
    (newVal: string) => {
      if (saveOnButton) {
        setDraftValue(newVal);
        setJustSaved(false);
        return;
      }
      sapphireSettingsService.setSettingOfProvider(providerName, settingName, newVal);
    },
    [sapphireSettingsService, providerName, settingName, saveOnButton],
  );

  const handleSave = useCallback(() => {
    const trimmed = draftValue.trim();
    sapphireSettingsService.setSettingOfProvider(providerName, settingName, trimmed);
    setDraftValue(trimmed);
    setJustSaved(true);
    setConfirmDelete(false);
    if (savedFeedbackTimerRef.current) clearTimeout(savedFeedbackTimerRef.current);
    savedFeedbackTimerRef.current = setTimeout(() => setJustSaved(false), 2000);
  }, [sapphireSettingsService, providerName, settingName, draftValue]);

  const handleDelete = useCallback(async () => {
    setConfirmDelete(false);
    setDraftValue('');
    setJustSaved(false);
    if (savedFeedbackTimerRef.current) clearTimeout(savedFeedbackTimerRef.current);
    await sapphireSettingsService.setSettingOfProvider(providerName, settingName, '');
    await sapphireSettingsService.setGlobalSetting('isOnboardingComplete', false);
  }, [sapphireSettingsService, providerName, settingName]);

  if (typeof rawSettingValue !== 'string') {
    console.log('Error: Provider setting had a non-string value.');
    return null;
  }

  const isDirty = saveOnButton && draftValue !== settingValue;

  return (
    <ErrorBoundary>
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <SapphireSimpleInputBox
              value={saveOnButton ? draftValue : settingValue}
              onChangeValue={handleChangeValue}
              placeholder={`${settingTitle} (${placeholder})`}
              passwordBlur={isPasswordField}
              compact
              onKeyDown={
                saveOnButton
                  ? (e) => {
                      if (e.key === 'Enter' && isDirty) handleSave();
                    }
                  : undefined
              }
            />
          </div>
          {saveOnButton &&
            (confirmDelete ? (
              <>
                <span className="text-sm text-void-fg-2 whitespace-nowrap shrink-0">
                  Удалить токен?
                </span>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-4 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors shrink-0 bg-rose-600 text-white hover:bg-rose-500"
                >
                  Удалить
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-4 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors shrink-0 text-void-fg-2 hover:text-void-fg-1"
                >
                  Отмена
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!isDirty}
                  onClick={handleSave}
                  className={`px-4 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors shrink-0
								${
                  !isDirty
                    ? 'bg-void-bg-3 text-void-fg-3 cursor-not-allowed'
                    : 'bg-[#00b0cc] text-white hover:bg-[#0097b2]'
                }`}
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  disabled={!settingValue}
                  onClick={() => setConfirmDelete(true)}
                  className={`px-4 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors shrink-0
								${
                  !settingValue
                    ? 'bg-void-bg-3 text-void-fg-3 cursor-not-allowed'
                    : 'bg-void-bg-3 text-void-fg-1 hover:bg-void-bg-2'
                }`}
                >
                  Удалить
                </button>
                {justSaved && (
                  <span className="flex items-center gap-1 text-emerald-500 text-sm whitespace-nowrap shrink-0">
                    <Check className="w-4 h-4" />
                    Сохранено
                  </span>
                )}
              </>
            ))}
        </div>
      </div>
    </ErrorBoundary>
  );
};

export const SettingsForProvider = ({
  providerName,
  showProviderTitle,
  showProviderSuggestions,
}: {
  providerName: ProviderName;
  showProviderTitle: boolean;
  showProviderSuggestions: boolean;
}) => {
  const sapphireSettingsState = useSettingsState();

  const needsModel =
    isProviderNameDisabled(providerName, sapphireSettingsState) === 'providerNotAutoDetected';

  const settingNames = customSettingNamesOfProvider(providerName);

  const { title: providerTitle, desc, usageUrl } = displayInfoOfProviderName(providerName);

  return (
    <div>
      <div className="flex items-center w-full gap-4">
        {showProviderTitle && <h3 className="text-xl truncate">{providerTitle}</h3>}
      </div>
      {showProviderTitle && (desc || usageUrl) ? (
        <div className="text-void-fg-3 text-xs mb-2 flex flex-col gap-1">
          {desc ? <span>{desc}</span> : null}
          {usageUrl ? (
            <a href={usageUrl} target="_blank" rel="noreferrer" className="underline w-fit">
              Ключ и расход
            </a>
          ) : null}
        </div>
      ) : null}

      <div>
        {/* Настройки провайдера кроме списка моделей (например apiKey) */}
        {settingNames.map((settingName) => (
          <ProviderSetting
            key={settingName}
            providerName={providerName}
            settingName={settingName}
          />
        ))}

        {showProviderSuggestions && needsModel ? (
          <WarningBox
            className="pl-2 mb-4"
            text={`Нет доступных моделей для ${providerTitle}. Обновите список моделей.`}
          />
        ) : null}
      </div>
    </div>
  );
};

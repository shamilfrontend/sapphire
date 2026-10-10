/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, {
  ButtonHTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/react';
import { Bot, Bug, ListTodo, MessageSquare, Paperclip } from 'lucide-react';
import { useAccessor, useSettingsState } from '../util/services.js';
import { SapphireCustomDropdownBox, SapphireSlider, SapphireSwitch } from '../util/inputs.js';
import { ModelDropdown } from '../void-settings-tsx/ModelDropdown.js';
import {
  ChatMode,
  FeatureName,
  ModelSelection,
} from '../../../../../../../workbench/contrib/sapphire/common/sapphireSettingsTypes.js';
import {
  getIsReasoningEnabledState,
  getModelCapabilities,
} from '../../../../common/modelCapabilities.js';
import {
  ChatImageAttachment,
  ChatMessage,
  StagingSelectionItem,
} from '../../../../common/chatThreadServiceTypes.js';
import type { ChatContextUsage } from '../../../convertToLLMMessageService.js';
import { IconArrowUp, IconSquare, IconX } from './chatIcons.js';
import { SelectedFiles, SelectedImages } from './ChatAttachments.js';
import { ProjectIndexControls } from './ProjectIndexControls.js';

export const formatTokenCount = (n: number): string => {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(n);
};

export const useChatContextUsage = (
  chatMessages: ChatMessage[],
  chatMode: ChatMode,
  modelSelection: ModelSelection | null,
  draftText: string,
  draftImages: ChatImageAttachment[],
  allowUpdatePlan?: boolean,
  enabledMcpServerNames?: readonly string[],
): ChatContextUsage | null => {
  const accessor = useAccessor();
  const convertService = accessor.get('IConvertToLLMMessageService');
  const [usage, setUsage] = useState<ChatContextUsage | null>(null);

  // Debounce: оценка токенов дорогая — пересчитываем после паузы в наборе.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void convertService
        .estimateChatContextUsage({
          chatMessages,
          chatMode,
          modelSelection,
          draftText,
          draftImages,
          allowUpdatePlan,
          enabledMcpServerNames,
        })
        .then((result) => {
          if (!cancelled) setUsage(result);
        })
        .catch(() => {
          if (!cancelled) setUsage(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    chatMessages,
    chatMode,
    modelSelection,
    draftText,
    draftImages,
    allowUpdatePlan,
    enabledMcpServerNames,
    convertService,
  ]);

  return usage;
};

const RESERVE_COLOR = '#38BDF8';

const ContextUsageIndicator = ({ usage }: { usage: ChatContextUsage | null }) => {
  const [open, setOpen] = useState(false);
  const ringSize = 16;
  const stroke = 2;
  const r = (ringSize - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  const { x, y, strategy, refs } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top-end',
    middleware: [
      offset(8),
      flip({
        padding: 8,
        fallbackPlacements: ['bottom-end', 'top-start', 'bottom-start'],
      }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableWidth, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            width: `${Math.min(280, availableWidth)}px`,
            maxHeight: `${availableHeight}px`,
            overflowY: 'auto',
          });
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
    strategy: 'fixed',
  });

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const floating = refs.floating.current;
      const reference = refs.reference.current;
      const isReferenceHTMLElement = reference && 'contains' in reference;
      if (
        floating &&
        (!isReferenceHTMLElement || !reference.contains(target)) &&
        !floating.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, refs.floating, refs.reference]);

  const pct = usage?.percentFull ?? 0;
  const dashOffset = circumference - (Math.min(100, Math.max(0, pct)) / 100) * circumference;
  const ringColor =
    pct >= 95
      ? 'var(--vscode-charts-red, #f87171)'
      : pct >= 80
        ? 'var(--vscode-charts-yellow, #fbbf24)'
        : 'currentColor';

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        ref={refs.setReference}
        className="rounded-full flex-shrink-0 flex items-center justify-center size-[26px] text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2 cursor-pointer"
        title="Использование в контексте"
        aria-label="Использование в контексте"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (usage) setOpen((v) => !v);
        }}
      >
        <svg
          width={ringSize}
          height={ringSize}
          viewBox={`0 0 ${ringSize} ${ringSize}`}
          className="block"
        >
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            opacity={0.25}
          />
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
          />
        </svg>
      </button>

      {open && usage && (
        <div
          ref={refs.setFloating}
          className="z-[100] rounded-lg border border-void-border-2 bg-void-bg-1 shadow-lg p-3 text-left"
          style={{
            position: strategy,
            top: y ?? 0,
            left: x ?? 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-sm font-medium text-void-fg-1 mb-2">Использование в контексте</div>
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <span className="text-xs text-void-fg-2">{pct}% заполнено</span>
            <span className="text-xs text-void-fg-3">
              ~{formatTokenCount(usage.usedTokens)} / {formatTokenCount(usage.contextWindow)}{' '}
              токенов
            </span>
          </div>

          <div className="relative h-1.5 w-full rounded-full overflow-hidden bg-void-bg-2 mb-3">
            <div
              className="absolute inset-y-0 left-0 flex"
              style={{
                width: `${
                  usage.contextWindow > 0
                    ? Math.min(100, (usage.usedTokens / usage.contextWindow) * 100)
                    : 0
                }%`,
              }}
            >
              {usage.categories.map((cat) => {
                const widthPct = usage.usedTokens > 0 ? (cat.tokens / usage.usedTokens) * 100 : 0;
                return (
                  <div
                    key={cat.id}
                    style={{ width: `${widthPct}%`, backgroundColor: cat.color }}
                    title={`${cat.label}: ${formatTokenCount(cat.tokens)}`}
                  />
                );
              })}
            </div>
            {usage.reservedTokens > 0 && (
              <div
                className="absolute inset-y-0 right-0"
                style={{
                  width: `${
                    usage.contextWindow > 0
                      ? Math.min(100, (usage.reservedTokens / usage.contextWindow) * 100)
                      : 0
                  }%`,
                  backgroundColor: RESERVE_COLOR,
                }}
                title={`Резерв для ответа модели: ${formatTokenCount(usage.reservedTokens)}`}
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            {usage.categories.map((cat) => (
              <div key={cat.id} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="size-2 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="text-void-fg-2 truncate">{cat.label}</span>
                </div>
                <span className="text-void-fg-3 flex-shrink-0 tabular-nums">
                  {formatTokenCount(cat.tokens)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 text-xs mt-1.5 pt-1.5 border-t border-void-border-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="size-2 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: RESERVE_COLOR }}
                />
                <span className="text-void-fg-2 truncate">Резерв для ответа модели</span>
              </div>
              <span className="text-void-fg-3 flex-shrink-0 tabular-nums">
                {formatTokenCount(usage.reservedTokens)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
const REASONING_HINT =
  'Режим рассуждений: модель сначала продумывает ответ, затем отвечает. Чем выше уровень — тем тщательнее анализ, но медленнее и больше токенов. Можно выключить.';

const ReasoningLabel = () => (
  <span
    className="text-void-fg-3 text-xs inline-block w-10 pr-1 cursor-help border-b border-dotted border-void-fg-3/40"
    data-tooltip-id="sapphire-tooltip"
    data-tooltip-content={REASONING_HINT}
    data-tooltip-place="top"
    data-tooltip-class-name="sapphire-max-w-[300px]"
  >
    Думает
  </span>
);

// только слайдер (без отдельного переключателя):
const ReasoningOptionSlider = ({ featureName }: { featureName: FeatureName }) => {
  const accessor = useAccessor();

  const sapphireSettingsService = accessor.get('ISapphireSettingsService');
  const sapphireSettingsState = useSettingsState();

  const modelSelection = sapphireSettingsState.modelSelectionOfFeature[featureName];
  const overridesOfModel = sapphireSettingsState.overridesOfModel;

  if (!modelSelection) return null;

  const { modelName, providerName } = modelSelection;
  const { reasoningCapabilities } = getModelCapabilities(providerName, modelName, overridesOfModel);
  const { canTurnOffReasoning, reasoningSlider: reasoningBudgetSlider } =
    reasoningCapabilities || {};

  const modelSelectionOptions =
    sapphireSettingsState.optionsOfModelSelection[featureName][providerName]?.[modelName];
  const isReasoningEnabled = getIsReasoningEnabledState(
    featureName,
    providerName,
    modelName,
    modelSelectionOptions,
    overridesOfModel,
  );

  if (canTurnOffReasoning && !reasoningBudgetSlider) {
    // простой вкл/выкл без слайдера «усилия»
    return (
      <div className="flex items-center gap-x-2 min-w-0 overflow-hidden">
        <ReasoningLabel />
        <SapphireSwitch
          size="xxs"
          value={isReasoningEnabled}
          onChange={(newVal) => {
            const isOff = canTurnOffReasoning && !newVal;
            sapphireSettingsService.setOptionsOfModelSelection(
              featureName,
              modelSelection.providerName,
              modelSelection.modelName,
              { reasoningEnabled: !isOff },
            );
          }}
        />
      </div>
    );
  }

  if (reasoningBudgetSlider?.type === 'budget_slider' && canTurnOffReasoning) {
    return (
      <div className="flex items-center gap-x-2 min-w-0 overflow-hidden">
        <ReasoningLabel />
        <SapphireSwitch
          size="xxs"
          value={isReasoningEnabled}
          onChange={(newVal) => {
            sapphireSettingsService.setOptionsOfModelSelection(
              featureName,
              modelSelection.providerName,
              modelSelection.modelName,
              { reasoningEnabled: newVal },
            );
          }}
        />
      </div>
    );
  }

  if (reasoningBudgetSlider?.type === 'effort_slider') {
    const { values, default: defaultVal } = reasoningBudgetSlider;

    const min = canTurnOffReasoning ? -1 : 0;
    const max = values.length - 1;

    const currentEffort =
      sapphireSettingsState.optionsOfModelSelection[featureName][modelSelection.providerName]?.[
        modelSelection.modelName
      ]?.reasoningEffort ?? defaultVal;
    const valueIfOff = -1;
    const value = isReasoningEnabled && currentEffort ? values.indexOf(currentEffort) : valueIfOff;

    const effortLabelRu: Record<string, string> = {
      low: 'Низкий',
      medium: 'Средний',
      high: 'Высокий',
    };
    const currentEffortLabel =
      effortLabelRu[currentEffort.toLowerCase()] ??
      currentEffort.charAt(0).toUpperCase() + currentEffort.slice(1);

    return (
      <div className="flex items-center gap-x-2 min-w-0 overflow-hidden">
        <ReasoningLabel />
        <SapphireSlider
          width={72}
          size="sm"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(newVal) => {
            const isOff = canTurnOffReasoning && newVal === valueIfOff;
            sapphireSettingsService.setOptionsOfModelSelection(
              featureName,
              modelSelection.providerName,
              modelSelection.modelName,
              { reasoningEnabled: !isOff, reasoningEffort: values[newVal] ?? undefined },
            );
          }}
        />
        <span className="text-void-fg-3 text-xs pointer-events-none truncate min-w-0">
          {isReasoningEnabled ? currentEffortLabel : 'Выкл.'}
        </span>
      </div>
    );
  }

  return null;
};

const nameOfChatMode = {
  normal: 'Чат',
  plan: 'Планирование',
  agent: 'Агент',
  debug: 'Отладка',
};

const detailOfChatMode = {
  normal: 'Обычный чат',
  plan: 'Сначала план, без правок',
  agent: 'Редактирует файлы и использует инструменты',
  debug: 'Систематически ищет и чинит баги по runtime-трейсам',
};

const accentOfChatMode: Record<ChatMode, { fg: string; bg: string }> = {
  normal: { fg: '#89d185', bg: 'rgba(137, 209, 133, 0.12)' },
  plan: { fg: '#cca700', bg: 'rgba(204, 167, 0, 0.12)' },
  agent: { fg: '#179fff', bg: 'rgba(23, 159, 255, 0.12)' },
  debug: { fg: '#f14c4c', bg: 'rgba(241, 76, 76, 0.12)' },
};

const iconOfChatMode: Record<ChatMode, React.ReactNode> = {
  normal: <MessageSquare size={14} className="stroke-[2]" />,
  plan: <ListTodo size={14} className="stroke-[2]" />,
  agent: <Bot size={14} className="stroke-[2]" />,
  debug: <Bug size={14} className="stroke-[2]" />,
};

const ChatModeDropdown = ({ iconOnly }: { iconOnly: boolean }) => {
  const accessor = useAccessor();

  const sapphireSettingsService = accessor.get('ISapphireSettingsService');
  const settingsState = useSettingsState();
  const chatMode = settingsState.globalSettings.chatMode;
  const accent = accentOfChatMode[chatMode];

  const options: ChatMode[] = useMemo(() => ['agent', 'plan', 'debug', 'normal'], []);

  const onChangeOption = useCallback(
    (newVal: ChatMode) => {
      sapphireSettingsService.setGlobalSetting('chatMode', newVal);
    },
    [sapphireSettingsService],
  );

  return (
    <SapphireCustomDropdownBox
      className={`text-xs rounded-md py-0.5 border border-void-border-2 shrink-0 ${iconOnly ? 'px-1.5' : 'px-2'}`}
      iconOnly={iconOnly}
      style={{
        color: accent.fg,
      }}
      options={options}
      selectedOption={chatMode}
      onChangeOption={onChangeOption}
      getOptionDisplayName={(val) => nameOfChatMode[val]}
      getOptionDropdownName={(val) => nameOfChatMode[val]}
      getOptionDropdownDetail={(val) => detailOfChatMode[val]}
      getOptionDropdownAccent={(val) => accentOfChatMode[val]}
      getOptionDropdownIcon={(val) => iconOfChatMode[val]}
      getOptionsEqual={(a, b) => a === b}
      detailAsTooltip
      selectedCheckOnRight
      accentFillSelected={false}
    />
  );
};

interface SapphireChatAreaProps {
  // Обязательные
  children: React.ReactNode; // поле ввода (children)

  // Обработчики формы
  onSubmit: () => void;
  onAbort: () => void;
  isStreaming: boolean;
  isDisabled?: boolean;
  divRef?: React.RefObject<HTMLDivElement | null>;

  // Настройка UI
  className?: string;
  showModelDropdown?: boolean;
  showSelections?: boolean;
  loadingIcon?: React.ReactNode;

  selections?: StagingSelectionItem[];
  setSelections?: (s: StagingSelectionItem[]) => void;

  images?: ChatImageAttachment[];
  setImages?: (imgs: ChatImageAttachment[]) => void;
  onPickFiles?: () => void;

  onClickAnywhere?: () => void;
  // Опциональная кнопка закрытия
  onClose?: () => void;

  featureName: FeatureName;

  /** Индикатор заполнения контекстного окна (только Chat). */
  contextUsage?: ChatContextUsage | null;

  /**
   * Статус индекса в футере композера.
   * В IDE (`layoutMode === 'ide'`) статус только в titlebar — здесь не показываем.
   */
  showProjectIndexStatus?: boolean;
}

export const SapphireChatArea: React.FC<SapphireChatAreaProps> = ({
  children,
  onSubmit,
  onAbort,
  onClose,
  onClickAnywhere,
  divRef,
  isStreaming = false,
  isDisabled = false,
  className = '',
  showModelDropdown = true,
  showSelections = false,
  selections,
  setSelections,
  images,
  setImages,
  onPickFiles,
  featureName,
  loadingIcon,
  contextUsage,
  showProjectIndexStatus = true,
}) => {
  const settingsState = useSettingsState();
  const chatModeAccent =
    featureName === 'Chat' ? accentOfChatMode[settingsState.globalSettings.chatMode] : undefined;
  const showIndexStatus =
    settingsState.globalSettings.layoutMode !== 'ide' && showProjectIndexStatus;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [compactMode, setCompactMode] = useState(false);

  // Узкий композер: режим чата только с иконкой (без подписи).
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || featureName !== 'Chat') return;
    const update = () => {
      const width = toolbar.clientWidth;
      setCompactMode((prev) => {
        if (width < 300) return true;
        if (width >= 360) return false;
        return prev;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [featureName]);

  return (
    <div
      ref={divRef}
      className={`
				gap-x-1
                flex flex-col p-3 relative input text-left shrink-0 min-w-0
                rounded-2xl
                ${featureName === 'Chat' ? 'bg-[var(--void-chat-field-bg)]' : 'bg-void-bg-1'}
				transition-all duration-200
				border border-void-border-3 focus-within:border-void-border-2 hover:border-void-border-2
				max-h-[80vh] overflow-y-auto
                ${className}
            `}
      onClick={(_e) => {
        onClickAnywhere?.();
      }}
    >
      {/* Прикреплённые файлы */}
      {showSelections && selections && setSelections && (
        <SelectedFiles type="staging" selections={selections} />
      )}

      {images && images.length > 0 && setImages && (
        <SelectedImages type="staging" images={images} setImages={setImages} />
      )}

      {/* Поле ввода */}
      <div className="relative w-full">
        {children}

        {/* Кнопка закрытия (X) */}
        {onClose && (
          <div className="absolute -top-1 -right-1 cursor-pointer z-1">
            <IconX
              size={12}
              className="stroke-[2] opacity-80 text-void-fg-3 hover:brightness-95"
              onClick={onClose}
            />
          </div>
        )}
      </div>

      {/* Нижняя панель: модель, индекс, отправка */}
      <div ref={toolbarRef} className="flex flex-row flex-nowrap items-center gap-1 mt-1 min-w-0">
        {showModelDropdown && (
          <div className="flex flex-col gap-y-1 min-w-0 flex-1">
            <ReasoningOptionSlider featureName={featureName} />

            <div className="flex items-center flex-nowrap gap-x-2 min-w-0">
              {featureName === 'Chat' && <ChatModeDropdown iconOnly={compactMode} />}
              <div className="min-w-0 flex-1">
                <ModelDropdown
                  featureName={featureName}
                  className="text-xs text-void-fg-3 rounded"
                  fillWidth
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {featureName === 'Chat' && contextUsage !== undefined && (
            <ContextUsageIndicator usage={contextUsage} />
          )}
          {featureName === 'Chat' && (
            <ProjectIndexControls showStatusButton={showIndexStatus} />
          )}
          {onPickFiles && (
            <button
              type="button"
              className="rounded-full flex-shrink-0 flex items-center justify-center size-[26px] text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2 cursor-pointer"
              title="Прикрепить файл"
              onClick={(e) => {
                e.stopPropagation();
                onPickFiles();
              }}
            >
              <Paperclip size={14} className="stroke-[2]" />
            </button>
          )}

          {isStreaming && loadingIcon}

          {isStreaming ? (
            <>
              {!isDisabled && (
                <ButtonSubmit
                  onClick={onSubmit}
                  disabled={isDisabled}
                  accentColor={chatModeAccent?.fg}
                />
              )}
              <ButtonStop onClick={onAbort} accentColor={chatModeAccent?.fg} />
            </>
          ) : (
            <ButtonSubmit
              onClick={onSubmit}
              disabled={isDisabled}
              accentColor={chatModeAccent?.fg}
            />
          )}
        </div>
      </div>
    </div>
  );
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;
const DEFAULT_BUTTON_SIZE = 26;
export const ButtonSubmit = ({
  className,
  disabled,
  accentColor,
  style,
  ...props
}: ButtonProps & Required<Pick<ButtonProps, 'disabled'>> & { accentColor?: string }) => (
  <button
    type="button"
    className={`rounded-full flex-shrink-0 flex-grow-0 flex items-center justify-center size-[26px]
			${disabled ? 'bg-vscode-disabled-fg cursor-default' : accentColor ? 'cursor-pointer hover:opacity-90' : 'bg-void-fg-1 cursor-pointer hover:opacity-90'}
			${className}
		`}
    // data-tooltip-id='sapphire-tooltip'
    // data-tooltip-content={'Отправить'}
    // data-tooltip-place='left'
    {...props}
    style={{
      ...style,
      ...(!disabled && accentColor ? { backgroundColor: accentColor } : {}),
    }}
  >
    <IconArrowUp
      size={DEFAULT_BUTTON_SIZE}
      className={`stroke-[2] p-[5px] ${disabled ? 'text-void-bg-2' : accentColor ? 'text-void-bg-2' : 'text-void-bg-3'}`}
    />
  </button>
);

export const ButtonStop = ({
  className,
  accentColor,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { accentColor?: string }) => (
  <button
    className={`rounded-full flex-shrink-0 flex-grow-0 cursor-pointer flex items-center justify-center size-[26px] hover:opacity-90
			${accentColor ? '' : 'bg-void-fg-1'}
			${className}
		`}
    type="button"
    {...props}
    style={{
      ...style,
      ...(accentColor ? { backgroundColor: accentColor } : {}),
    }}
  >
    <IconSquare
      size={DEFAULT_BUTTON_SIZE}
      className={`stroke-[3] p-[8px] ${accentColor ? 'text-void-bg-2' : 'text-void-bg-3'}`}
    />
  </button>
);

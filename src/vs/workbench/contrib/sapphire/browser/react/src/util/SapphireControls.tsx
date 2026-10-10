/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react';
import { useFloating, autoUpdate, offset, flip, shift, size } from '@floating-ui/react';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';

// type guard: ctor — класс или фабрика
const isConstructor = (f: any): f is { new (...params: any[]): any } =>
  !!f.prototype && f.prototype.constructor === f;

export const WidgetComponent = <CtorParams extends any[], Instance>({
  ctor,
  propsFn,
  dispose,
  onCreateInstance,
  children,
  className,
}: {
  ctor: { new (...params: CtorParams): Instance } | ((container: HTMLDivElement) => Instance);
  propsFn: (container: HTMLDivElement) => CtorParams; // не используется, если ctor — функция
  onCreateInstance: (instance: Instance) => IDisposable[];
  dispose: (instance: Instance) => void;
  children?: React.ReactNode;
  className?: string;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const instance = isConstructor(ctor)
      ? new ctor(...propsFn(containerRef.current!))
      : ctor(containerRef.current!);
    const disposables = onCreateInstance(instance);
    return () => {
      disposables.forEach((d) => d.dispose());
      dispose(instance);
    };
  }, [ctor, propsFn, dispose, onCreateInstance, containerRef]);

  return (
    <div ref={containerRef} className={className === undefined ? `w-full` : className}>
      {children}
    </div>
  );
};

export const SapphireSlider = ({
  value,
  onChange,
  size = 'md',
  disabled = false,
  min = 0,
  max = 7,
  step = 1,
  className = '',
  width = 200,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  size?: 'xxs' | 'xs' | 'sm' | 'sm+' | 'md';
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  width?: number;
}) => {
  // Позиция бегунка в процентах
  const percentage = ((value - min) / (max - min)) * 100;

  // Клик по дорожке — скачок к значению
  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickPosition = e.clientX - rect.left;
    const trackWidth = rect.width;

    // Новое значение по позиции клика
    const newPercentage = Math.max(0, Math.min(1, clickPosition / trackWidth));
    const rawValue = min + newPercentage * (max - min);

    // У края дорожки всегда можно выставить max (из‑за step)
    if (rawValue >= max - step / 2) {
      onChange(max);
      return;
    }

    // Квантование по step
    const steppedValue = Math.round((rawValue - min) / step) * step + min;
    const clampedValue = Math.max(min, Math.min(max, steppedValue));

    onChange(clampedValue);
  };

  // Перетаскивание бегунка с тем же step/max, что и клик
  const handleThumbDrag = (moveEvent: MouseEvent, track: Element) => {
    if (!track) return;

    const rect = (track as HTMLElement).getBoundingClientRect();
    const movePosition = moveEvent.clientX - rect.left;
    const trackWidth = rect.width;

    // Новое значение по позиции мыши
    const newPercentage = Math.max(0, Math.min(1, movePosition / trackWidth));
    const rawValue = min + newPercentage * (max - min);

    if (rawValue >= max - step / 2) {
      onChange(max);
      return;
    }

    const steppedValue = Math.round((rawValue - min) / step) * step + min;
    const clampedValue = Math.max(min, Math.min(max, steppedValue));

    onChange(clampedValue);
  };

  return (
    <div className={`inline-flex items-center flex-shrink-0 ${className}`}>
      {/* Внешний контейнер: запас под выступ бегунка */}
      <div
        className={`relative flex-shrink-0 ${disabled ? 'opacity-25' : ''}`}
        style={{
          width,
          // paddingLeft/Right = половина ширины бегунка (закомментировано)
          // paddingLeft: thumbSizePx / 2,
          // paddingRight: thumbSizePx / 2
        }}
      >
        {/* Дорожка слайдера */}
        <div className="relative w-full">
          {/* Невидимая зона клика шире дорожки */}
          <div
            className="absolute w-full cursor-pointer"
            style={{
              height: '16px',
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 1,
            }}
            onClick={handleTrackClick}
          />

          {/* Видимая дорожка */}
          <div
            className={`relative ${
              size === 'xxs'
                ? 'h-0.5'
                : size === 'xs'
                  ? 'h-1'
                  : size === 'sm'
                    ? 'h-1.5'
                    : size === 'sm+'
                      ? 'h-2'
                      : 'h-2.5'
            } bg-void-bg-2 rounded-full cursor-pointer`}
            onClick={handleTrackClick}
          >
            {/* Заполненная часть до текущего value */}
            <div
              className={`absolute left-0 ${
                size === 'xxs'
                  ? 'h-0.5'
                  : size === 'xs'
                    ? 'h-1'
                    : size === 'sm'
                      ? 'h-1.5'
                      : size === 'sm+'
                        ? 'h-2'
                        : 'h-2.5'
              } bg-void-fg-1 rounded-full`}
              style={{ width: `${percentage}%` }}
            />
          </div>

          {/* Бегунок */}
          <div
            className={`absolute top-1/2 transform -translate-x-1/2 -translate-y-1/2
							${
                size === 'xxs'
                  ? 'h-2 w-2'
                  : size === 'xs'
                    ? 'h-2.5 w-2.5'
                    : size === 'sm'
                      ? 'h-3 w-3'
                      : size === 'sm+'
                        ? 'h-3.5 w-3.5'
                        : 'h-4 w-4'
              }
							bg-void-fg-1 rounded-full shadow-md ${disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}
							border border-void-fg-1`}
            style={{ left: `${percentage}%`, zIndex: 2 }} // Бегунок выше невидимой зоны клика
            onMouseDown={(e) => {
              if (disabled) return;

              const track = e.currentTarget.previousElementSibling;

              const handleMouseMove = (moveEvent: MouseEvent) => {
                handleThumbDrag(moveEvent, track as Element);
              };

              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
              };

              document.body.style.userSelect = 'none';
              document.body.style.cursor = 'grabbing';
              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);

              e.preventDefault();
            }}
          />
        </div>
      </div>
    </div>
  );
};

export const SapphireSwitch = ({
  value,
  onChange,
  size = 'md',
  disabled = false,
  ...props
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  size?: 'xxs' | 'xs' | 'sm' | 'sm+' | 'md';
}) => (
  <label className="inline-flex items-center" {...props}>
    <div
      onClick={() => !disabled && onChange(!value)}
      className={`
			cursor-pointer
			relative inline-flex items-center rounded-full transition-colors duration-200 ease-in-out
			${value ? 'bg-zinc-900 dark:bg-white' : 'bg-white dark:bg-zinc-600'}
			${disabled ? 'opacity-25' : ''}
			${size === 'xxs' ? 'h-3 w-5' : ''}
			${size === 'xs' ? 'h-4 w-7' : ''}
			${size === 'sm' ? 'h-5 w-9' : ''}
			${size === 'sm+' ? 'h-5 w-10' : ''}
			${size === 'md' ? 'h-6 w-11' : ''}
		  `}
    >
      <span
        className={`
			  inline-block transform rounded-full bg-white dark:bg-zinc-900 shadow transition-transform duration-200 ease-in-out
			  ${size === 'xxs' ? 'h-2 w-2' : ''}
			  ${size === 'xs' ? 'h-2.5 w-2.5' : ''}
			  ${size === 'sm' ? 'h-3 w-3' : ''}
			  ${size === 'sm+' ? 'h-3.5 w-3.5' : ''}
			  ${size === 'md' ? 'h-4 w-4' : ''}
			  ${size === 'xxs' ? (value ? 'translate-x-2.5' : 'translate-x-0.5') : ''}
			  ${size === 'xs' ? (value ? 'translate-x-3.5' : 'translate-x-0.5') : ''}
			  ${size === 'sm' ? (value ? 'translate-x-5' : 'translate-x-1') : ''}
			  ${size === 'sm+' ? (value ? 'translate-x-6' : 'translate-x-1') : ''}
			  ${size === 'md' ? (value ? 'translate-x-6' : 'translate-x-1') : ''}
			`}
      />
    </div>
  </label>
);

export const SapphireCustomDropdownBox = <T extends NonNullable<any>>({
  options,
  selectedOption,
  onChangeOption,
  getOptionDropdownName,
  getOptionDropdownDetail,
  getOptionDisplayName,
  getOptionsEqual,
  getOptionDropdownAccent,
  getOptionDropdownIcon,
  className,
  style,
  arrowTouchesText = true,
  matchInputWidth = false,
  detailAsTooltip = false,
  selectedCheckOnRight = false,
  accentFillSelected = true,
  iconOnly = false,
  fillWidth = false,
  gapPx = 0,
  offsetPx = -6,
}: {
  options: T[];
  selectedOption: T | undefined;
  onChangeOption: (newValue: T) => void;
  getOptionDropdownName: (option: T) => string;
  getOptionDropdownDetail?: (option: T) => string;
  getOptionDisplayName: (option: T) => string;
  getOptionsEqual: (a: T, b: T) => boolean;
  getOptionDropdownAccent?: (option: T) => { fg: string; bg: string } | undefined;
  getOptionDropdownIcon?: (option: T) => React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  arrowTouchesText?: boolean;
  matchInputWidth?: boolean;
  /** true — detail опции в tooltip, а не справа от названия. */
  detailAsTooltip?: boolean;
  /** true — галочка выбранного пункта справа. */
  selectedCheckOnRight?: boolean;
  /** false — акцент только цветом текста, без заливки фона. */
  accentFillSelected?: boolean;
  /** Триггер: иконка + chevron; полное имя — в title. */
  iconOnly?: boolean;
  /** Корень на всю ширину родителя для truncate подписи. */
  fillWidth?: boolean;
  gapPx?: number;
  offsetPx?: number;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const measureRef = useRef<HTMLDivElement>(null);

  // Позиционирование выпадающего списка через @floating-ui/react
  const { x, y, strategy, refs } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-start',

    middleware: [
      offset({ mainAxis: gapPx, crossAxis: offsetPx }),
      flip({
        boundary: document.body,
        padding: 8,
      }),
      shift({
        boundary: document.body,
        padding: 8,
      }),
      size({
        apply({ availableHeight, elements, rects }) {
          const maxHeight = Math.min(availableHeight);

          Object.assign(elements.floating.style, {
            maxHeight: `${maxHeight}px`,
            overflowY: 'auto',
            // Ширина списка не уже триггера и скрытого measure-блока
            width: `${Math.max(rects.reference.width, measureRef.current?.offsetWidth ?? 0)}px`,
          });
        },
        padding: 8,
        // Граница — body, чтобы overflow родителя не обрезал меню
        boundary: document.body,
      }),
    ],
    whileElementsMounted: autoUpdate,
    strategy: 'fixed',
  });

  // undefined selected — выбираем первую опцию по умолчанию
  useEffect(() => {
    if (options.length === 0) return;
    if (selectedOption !== undefined) return;
    onChangeOption(options[0]);
  }, [selectedOption, onChangeOption, options]);

  // Закрытие по клику вне меню
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const floating = refs.floating.current;
      const reference = refs.reference.current;

      // refs.reference может быть VirtualElement — проверяем contains
      const isReferenceHTMLElement = reference && 'contains' in reference;

      if (
        floating &&
        (!isReferenceHTMLElement || !reference.contains(target)) &&
        !floating.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, refs.floating, refs.reference]);

  if (selectedOption === undefined) return null;

  const selectedIcon = getOptionDropdownIcon?.(selectedOption);
  const displayName = getOptionDisplayName(selectedOption);

  return (
    <div
      className={`${fillWidth ? 'block w-full min-w-0 max-w-full' : 'inline-block'} relative ${className}`}
      style={style}
    >
      {/* Скрытый блок для расчёта ширины пунктов (fallback без Tailwind) */}
      <div
        ref={measureRef}
        className="opacity-0 pointer-events-none absolute -left-[999999px] -top-[999999px] flex flex-col"
        style={{
          position: 'absolute',
          left: -999999,
          top: -999999,
          opacity: 0,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        {options.map((option) => {
          const optionName = getOptionDropdownName(option);
          const optionDetail = getOptionDropdownDetail?.(option) || '';
          const optionIcon = getOptionDropdownIcon?.(option);

          return (
            <div
              key={optionName + optionDetail}
              className="flex items-center whitespace-nowrap gap-x-1.5 px-2"
            >
              {!selectedCheckOnRight && <div className="w-4" />}
              {optionIcon && <span className="size-3.5 flex-shrink-0">{optionIcon}</span>}
              {detailAsTooltip ? (
                <span className="pr-1">{optionName}</span>
              ) : (
                <span className="flex justify-between w-full">
                  <span>{optionName}</span>
                  <span>{optionDetail}</span>
                  <span>______</span>
                </span>
              )}
              {selectedCheckOnRight && <div className="w-4" />}
            </div>
          );
        })}
      </div>

      {/* Кнопка-триггер */}
      <button
        type="button"
        ref={refs.setReference}
        className="flex items-center h-4 bg-transparent whitespace-nowrap hover:brightness-90 w-full min-w-0"
        style={{ background: 'transparent' }}
        title={iconOnly || fillWidth ? displayName : undefined}
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedIcon && (
          <span className="size-3.5 flex-shrink-0 mr-1 flex items-center justify-center">
            {selectedIcon}
          </span>
        )}
        {!iconOnly && (
          <span className={`truncate min-w-0 ${arrowTouchesText ? 'mr-1' : ''}`}>
            {displayName}
          </span>
        )}
        <svg
          className={`size-3 flex-shrink-0 ${iconOnly || arrowTouchesText ? '' : 'ml-auto'}`}
          width={12}
          height={12}
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M2.5 4.5L6 8L9.5 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Выпадающий список */}
      {isOpen && (
        <div
          ref={refs.setFloating}
          className="z-[100] bg-void-bg-1 border-void-border-3 border rounded shadow-lg"
          style={{
            position: strategy,
            top: y ?? 0,
            left: x ?? 0,
            width: matchInputWidth
              ? refs.reference.current instanceof HTMLElement
                ? refs.reference.current.offsetWidth
                : 0
              : Math.max(
                  refs.reference.current instanceof HTMLElement
                    ? refs.reference.current.offsetWidth
                    : 0,
                  measureRef.current instanceof HTMLElement ? measureRef.current.offsetWidth : 0,
                ),
          }}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="overflow-auto max-h-80">
            {options.map((option) => {
              const thisOptionIsSelected = getOptionsEqual(option, selectedOption);
              const optionName = getOptionDropdownName(option);
              const optionDetail = getOptionDropdownDetail?.(option) || '';
              const optionAccent = getOptionDropdownAccent?.(option);
              const optionIcon = getOptionDropdownIcon?.(option);
              const useAccentColorOnly = !!optionAccent && !accentFillSelected;

              const checkmark = thisOptionIsSelected ? (
                <svg className="size-3" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M10 3L4.5 8.5L2 6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null;

              return (
                <div
                  key={optionName}
                  className={`flex items-center px-2 py-1 cursor-pointer whitespace-nowrap gap-x-1.5
									transition-all duration-100
									${
                    thisOptionIsSelected
                      ? optionAccent
                        ? useAccentColorOnly
                          ? 'hover:bg-void-bg-2'
                          : 'text-white/90'
                        : 'bg-blue-500 text-white/80'
                      : optionAccent
                        ? useAccentColorOnly
                          ? 'hover:bg-void-bg-2 text-void-fg-1'
                          : 'hover:brightness-125'
                        : 'hover:bg-blue-500 hover:text-white/80'
                  }
								`}
                  style={
                    optionAccent
                      ? useAccentColorOnly
                        ? {
                            color: thisOptionIsSelected ? optionAccent.fg : undefined,
                          }
                        : {
                            color: thisOptionIsSelected ? 'rgba(255,255,255,0.9)' : optionAccent.fg,
                            backgroundColor: thisOptionIsSelected ? optionAccent.fg : undefined,
                          }
                      : undefined
                  }
                  {...(detailAsTooltip && optionDetail
                    ? {
                        'data-tooltip-id': 'sapphire-tooltip',
                        'data-tooltip-content': optionDetail,
                        'data-tooltip-place': 'left' as const,
                      }
                    : {})}
                  onMouseEnter={
                    optionAccent && !thisOptionIsSelected && accentFillSelected
                      ? (e) => {
                          e.currentTarget.style.backgroundColor = optionAccent.bg;
                        }
                      : undefined
                  }
                  onMouseLeave={
                    optionAccent && !thisOptionIsSelected && accentFillSelected
                      ? (e) => {
                          e.currentTarget.style.backgroundColor = '';
                        }
                      : undefined
                  }
                  onClick={() => {
                    onChangeOption(option);
                    setIsOpen(false);
                  }}
                >
                  {!selectedCheckOnRight && (
                    <div className="w-4 flex justify-center flex-shrink-0">{checkmark}</div>
                  )}
                  {optionIcon && (
                    <span className="size-3.5 flex-shrink-0 flex items-center justify-center">
                      {optionIcon}
                    </span>
                  )}
                  {detailAsTooltip ? (
                    <span className="flex-1">{optionName}</span>
                  ) : (
                    <span className="flex justify-between items-center w-full gap-x-1 flex-1">
                      <span>{optionName}</span>
                      <span className="opacity-60">{optionDetail}</span>
                    </span>
                  )}
                  {selectedCheckOnRight && (
                    <div className="w-4 flex justify-center flex-shrink-0 ml-1">{checkmark}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export const SapphireButtonBgDarken = ({
  children,
  disabled,
  onClick,
  className,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) => (
  <button
    disabled={disabled}
    className={`px-3 py-1 bg-black/10 dark:bg-white/10 rounded-sm overflow-hidden whitespace-nowrap flex items-center justify-center ${className || ''}`}
    onClick={onClick}
  >
    {children}
  </button>
);

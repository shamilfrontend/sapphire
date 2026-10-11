<script setup lang="ts" generic="T extends string | number | boolean | object">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onWatcherCleanup, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/vue';
import { dropdownIconView, type DropdownAccent, type DropdownIcon } from './SapphireControls.js';

const props = withDefaults(
  defineProps<{
    options: T[];
    selectedOption: T | undefined;
    onChangeOption?: (newValue: T) => void;
    getOptionDropdownName: (option: T) => string;
    getOptionDropdownDetail?: (option: T) => string;
    getOptionDisplayName: (option: T) => string;
    getOptionsEqual: (a: T, b: T) => boolean;
    getOptionDropdownAccent?: (option: T) => DropdownAccent | undefined;
    getOptionDropdownIcon?: (option: T) => DropdownIcon | undefined;
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
  }>(),
  {
    arrowTouchesText: true,
    matchInputWidth: false,
    detailAsTooltip: false,
    selectedCheckOnRight: false,
    accentFillSelected: true,
    iconOnly: false,
    fillWidth: false,
    gapPx: 0,
    offsetPx: -6,
  },
);

const emit = defineEmits<{
  changeOption: [value: T];
}>();

const isOpen = ref(false);
const measureRef = ref<HTMLDivElement | null>(null);
const referenceRef = ref<HTMLElement | null>(null);
const floatingRef = ref<HTMLElement | null>(null);

const changeOption = (option: T) => {
  props.onChangeOption?.(option);
  emit('changeOption', option);
};

// Позиционирование выпадающего списка через @floating-ui/vue
const { x, y, strategy } = useFloating(referenceRef, floatingRef, {
  open: () => isOpen.value,
  placement: 'bottom-start',
  strategy: 'fixed',
  transform: false,
  middleware: [
    offset(() => ({ mainAxis: props.gapPx, crossAxis: props.offsetPx })),
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
          width: `${Math.max(rects.reference.width, measureRef.value?.offsetWidth ?? 0)}px`,
        });
      },
      padding: 8,
      // Граница — body, чтобы overflow родителя не обрезал меню
      boundary: document.body,
    }),
  ],
  whileElementsMounted: autoUpdate,
});

// undefined selected — выбираем первую опцию по умолчанию
watch(
  () => [props.selectedOption, props.options] as const,
  () => {
    if (props.options.length === 0) return;
    if (props.selectedOption !== undefined) return;
    changeOption(props.options[0]);
  },
  { immediate: true, flush: 'post' },
);

const hasContains = (el: unknown): el is { contains: (node: Node) => boolean } =>
  !!el && typeof el === 'object' && 'contains' in el && typeof el.contains === 'function';

// Закрытие по клику вне меню
watch(isOpen, (open) => {
  if (!open) return;
  const handleClickOutside = (event: MouseEvent) => {
    const node = event.target instanceof Node ? event.target : null;
    const floating = floatingRef.value;
    const reference = referenceRef.value;
    const isReferenceHTMLElement = hasContains(reference);
    if (
      floating &&
      (!isReferenceHTMLElement || !node || !reference.contains(node)) &&
      (!node || !floating.contains(node))
    ) {
      isOpen.value = false;
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  onWatcherCleanup(() => {
    document.removeEventListener('mousedown', handleClickOutside);
  });
});

const selectedIcon = computed(() =>
  props.selectedOption === undefined
    ? undefined
    : props.getOptionDropdownIcon?.(props.selectedOption),
);
const displayName = computed(() =>
  props.selectedOption === undefined ? '' : props.getOptionDisplayName(props.selectedOption),
);

const triggerColor = computed(() => {
  const selected = props.selectedOption;
  if (selected === undefined) return undefined;
  return props.getOptionDropdownAccent?.(selected)?.fg;
});

const floatingStyle = computed(() => {
  void x.value;
  void y.value;
  const reference = referenceRef.value;
  const referenceWidth = reference instanceof HTMLElement ? reference.offsetWidth : 0;
  const measureWidth = measureRef.value instanceof HTMLElement ? measureRef.value.offsetWidth : 0;
  const width = props.matchInputWidth ? referenceWidth : Math.max(referenceWidth, measureWidth);
  return {
    position: strategy.value,
    top: `${y.value ?? 0}px`,
    left: `${x.value ?? 0}px`,
    width: `${width}px`,
  };
});

const optionRowClass = (option: T, selected: boolean): string => {
  const optionAccent = props.getOptionDropdownAccent?.(option);
  const useAccentColorOnly = !!optionAccent && !props.accentFillSelected;
  let stateClass = '';
  if (selected) {
    if (optionAccent) {
      stateClass = useAccentColorOnly ? 'hover:bg-void-bg-2' : 'text-white/90';
    } else {
      stateClass = 'bg-blue-500 text-white/80';
    }
  } else if (optionAccent) {
    stateClass = useAccentColorOnly ? 'hover:bg-void-bg-2' : 'hover:brightness-125';
  } else {
    stateClass = 'hover:bg-blue-500 hover:text-white/80';
  }
  return `flex items-center px-2 py-1 cursor-pointer whitespace-nowrap gap-x-1.5 transition-all duration-100 ${stateClass}`;
};

const optionStyle = (option: T, selected: boolean): CSSProperties | undefined => {
  const optionAccent = props.getOptionDropdownAccent?.(option);
  if (!optionAccent) return undefined;
  const useAccentColorOnly = !props.accentFillSelected;
  if (useAccentColorOnly) {
    return { color: optionAccent.fg };
  }
  return {
    color: selected ? 'rgba(255,255,255,0.9)' : optionAccent.fg,
    backgroundColor: selected ? optionAccent.fg : undefined,
  };
};

const onOptionEnter = (option: T, selected: boolean, event: MouseEvent) => {
  if (!props.accentFillSelected || selected) return;
  const accent = props.getOptionDropdownAccent?.(option);
  if (!accent) return;
  const el = event.currentTarget;
  if (el instanceof HTMLElement) el.style.backgroundColor = accent.bg;
};

const onOptionLeave = (option: T, selected: boolean, event: MouseEvent) => {
  if (!props.accentFillSelected || selected) return;
  const accent = props.getOptionDropdownAccent?.(option);
  if (!accent) return;
  const el = event.currentTarget;
  if (el instanceof HTMLElement) el.style.backgroundColor = '';
};

const equalsSelected = (option: T): boolean => {
  const selected = props.selectedOption;
  if (selected === undefined) return false;
  return props.getOptionsEqual(option, selected);
};

const selectOption = (option: T) => {
  changeOption(option);
  isOpen.value = false;
};
</script>

<template>
  <div
    v-if="selectedOption !== undefined"
    :class="[fillWidth ? 'block w-full min-w-0 max-w-full' : 'inline-block', 'relative']"
  >
    <!-- Скрытый блок для расчёта ширины пунктов (fallback без Tailwind) -->
    <div
      ref="measureRef"
      class="opacity-0 pointer-events-none absolute -left-[999999px] -top-[999999px] flex flex-col"
      :style="{
        position: 'absolute',
        left: '-999999px',
        top: '-999999px',
        opacity: 0,
        pointerEvents: 'none',
      }"
      aria-hidden="true"
    >
      <div
        v-for="option in options"
        :key="`${getOptionDropdownName(option)}${getOptionDropdownDetail?.(option) || ''}`"
        class="flex items-center whitespace-nowrap gap-x-1.5 px-2"
      >
        <div v-if="!selectedCheckOnRight" class="w-4" />
        <span
          v-if="getOptionDropdownIcon?.(option)"
          class="size-3.5 flex-shrink-0"
        >
          <component :is="dropdownIconView(getOptionDropdownIcon(option)!)" />
        </span>
        <span v-if="detailAsTooltip" class="pr-1">{{ getOptionDropdownName(option) }}</span>
        <span v-else class="flex justify-between w-full">
          <span>{{ getOptionDropdownName(option) }}</span>
          <span>{{ getOptionDropdownDetail?.(option) || '' }}</span>
          <span>______</span>
        </span>
        <div v-if="selectedCheckOnRight" class="w-4" />
      </div>
    </div>

    <!-- Кнопка-триггер -->
    <button
      ref="referenceRef"
      type="button"
      class="flex items-center h-4 bg-transparent whitespace-nowrap hover:brightness-90 w-full min-w-0"
      :style="{ background: 'transparent', color: triggerColor }"
      :title="iconOnly || fillWidth ? displayName : undefined"
      @click="isOpen = !isOpen"
    >
      <span
        v-if="selectedIcon"
        class="size-3.5 flex-shrink-0 mr-1 flex items-center justify-center"
      >
        <component :is="dropdownIconView(selectedIcon)" />
      </span>
      <span v-if="!iconOnly" :class="`truncate min-w-0 ${arrowTouchesText ? 'mr-1' : ''}`">
        {{ displayName }}
      </span>
      <svg
        :class="`size-3 flex-shrink-0 ${iconOnly || arrowTouchesText ? '' : 'ml-auto'}`"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path
          d="M2.5 4.5L6 8L9.5 4.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <!-- Выпадающий список -->
    <div
      v-if="isOpen"
      ref="floatingRef"
      class="z-[100] bg-void-bg-1 border-void-border-3 border rounded shadow-lg"
      :style="floatingStyle"
      @wheel.stop
    >
      <div class="overflow-auto max-h-80">
        <div
          v-for="option in options"
          :key="getOptionDropdownName(option)"
          :class="optionRowClass(option, equalsSelected(option))"
          :style="optionStyle(option, equalsSelected(option))"
          :data-tooltip-id="
            detailAsTooltip && (getOptionDropdownDetail?.(option) || '')
              ? 'sapphire-tooltip'
              : undefined
          "
          :data-tooltip-content="
            detailAsTooltip && (getOptionDropdownDetail?.(option) || '')
              ? getOptionDropdownDetail?.(option) || ''
              : undefined
          "
          :data-tooltip-place="
            detailAsTooltip && (getOptionDropdownDetail?.(option) || '') ? 'left' : undefined
          "
          @mouseenter="onOptionEnter(option, equalsSelected(option), $event)"
          @mouseleave="onOptionLeave(option, equalsSelected(option), $event)"
          @click="selectOption(option)"
        >
          <div v-if="!selectedCheckOnRight" class="w-4 flex justify-center flex-shrink-0">
            <svg
              v-if="equalsSelected(option)"
              class="size-3"
              viewBox="0 0 12 12"
              fill="none"
            >
              <path
                d="M10 3L4.5 8.5L2 6"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <span
            v-if="getOptionDropdownIcon?.(option)"
            class="size-3.5 flex-shrink-0 flex items-center justify-center"
          >
            <component :is="dropdownIconView(getOptionDropdownIcon(option)!)" />
          </span>
          <span v-if="detailAsTooltip" class="flex-1">{{ getOptionDropdownName(option) }}</span>
          <span v-else class="flex justify-between items-center w-full gap-x-1 flex-1">
            <span>{{ getOptionDropdownName(option) }}</span>
            <span class="opacity-60">{{ getOptionDropdownDetail?.(option) || '' }}</span>
          </span>
          <div
            v-if="selectedCheckOnRight"
            class="w-4 flex justify-center flex-shrink-0 ml-1"
          >
            <svg
              v-if="equalsSelected(option)"
              class="size-3"
              viewBox="0 0 12 12"
              fill="none"
            >
              <path
                d="M10 3L4.5 8.5L2 6"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

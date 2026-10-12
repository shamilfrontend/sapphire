<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed } from 'vue';
import type { ControlSize } from './SapphireControls.js';

const props = withDefaults(
  defineProps<{
    value: number;
    disabled?: boolean;
    size?: ControlSize;
    min?: number;
    max?: number;
    step?: number;
    width?: number;
    onChange?: (value: number) => void;
  }>(),
  {
    size: 'md',
    disabled: false,
    min: 0,
    max: 7,
    step: 1,
    width: 200,
  },
);

const emit = defineEmits<{
  change: [value: number];
}>();

const percentage = computed(() => ((props.value - props.min) / (props.max - props.min)) * 100);

const trackHeightClass = computed(() => {
  if (props.size === 'xxs') return 'h-0.5';
  if (props.size === 'xs') return 'h-1';
  if (props.size === 'sm') return 'h-1.5';
  if (props.size === 'sm+') return 'h-2';
  return 'h-2.5';
});

const thumbSizeClass = computed(() => {
  if (props.size === 'xxs') return 'h-2 w-2';
  if (props.size === 'xs') return 'h-2.5 w-2.5';
  if (props.size === 'sm') return 'h-3 w-3';
  if (props.size === 'sm+') return 'h-3.5 w-3.5';
  return 'h-4 w-4';
});

const publish = (next: number) => {
  props.onChange?.(next);
  emit('change', next);
};

const valueFromClientX = (clientX: number, track: HTMLElement) => {
  const rect = track.getBoundingClientRect();
  const clickPosition = clientX - rect.left;
  const trackWidth = rect.width;
  const newPercentage = Math.max(0, Math.min(1, clickPosition / trackWidth));
  const rawValue = props.min + newPercentage * (props.max - props.min);
  // У края дорожки всегда можно выставить max (из‑за step)
  if (rawValue >= props.max - props.step / 2) {
    publish(props.max);
    return;
  }
  // Квантование по step
  const steppedValue = Math.round((rawValue - props.min) / props.step) * props.step + props.min;
  const clampedValue = Math.max(props.min, Math.min(props.max, steppedValue));
  publish(clampedValue);
};

const handleTrackClick = (e: MouseEvent) => {
  if (props.disabled) return;
  const track = e.currentTarget;
  if (!(track instanceof HTMLElement)) return;
  valueFromClientX(e.clientX, track);
};

const onThumbMouseDown = (e: MouseEvent) => {
  if (props.disabled) return;
  const thumb = e.currentTarget;
  if (!(thumb instanceof HTMLElement)) return;
  const track = thumb.previousElementSibling;
  if (!(track instanceof HTMLElement)) return;

  const handleMouseMove = (moveEvent: MouseEvent) => {
    valueFromClientX(moveEvent.clientX, track);
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
};
</script>

<template>
  <div class="inline-flex items-center flex-shrink-0">
    <!-- Внешний контейнер: запас под выступ бегунка -->
    <div class="relative flex-shrink-0" :class="disabled ? 'opacity-25' : ''" :style="{ width }">
      <!-- Дорожка слайдера -->
      <div class="relative w-full">
        <!-- Невидимая зона клика шире дорожки -->
        <div
          class="absolute w-full cursor-pointer"
          :style="{
            height: '16px',
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 1,
          }"
          @click="handleTrackClick"
        />

        <!-- Видимая дорожка -->
        <div
          :class="`relative ${trackHeightClass} bg-void-bg-2 rounded-full cursor-pointer`"
          @click="handleTrackClick"
        >
          <!-- Заполненная часть до текущего value -->
          <div
            :class="`absolute left-0 ${trackHeightClass} bg-void-fg-1 rounded-full`"
            :style="{ width: `${percentage}%` }"
          />
        </div>

        <!-- Бегунок -->
        <div
          :class="`absolute top-1/2 transform -translate-x-1/2 -translate-y-1/2 ${thumbSizeClass} bg-void-fg-1 rounded-full shadow-md ${disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} border border-void-fg-1`"
          :style="{ left: `${percentage}%`, zIndex: 2 }"
          @mousedown="onThumbMouseDown"
        />
      </div>
    </div>
  </div>
</template>

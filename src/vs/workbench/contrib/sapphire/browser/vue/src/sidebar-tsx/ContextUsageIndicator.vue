<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { onWatcherCleanup, ref, watch } from 'vue';
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/vue';
import type { ChatContextUsage } from '../../../convertToLLMMessageService.js';
import { formatTokenCount, RESERVE_COLOR } from './ChatComposer.js';

const props = defineProps<{ usage: ChatContextUsage | null }>();

const open = ref(false);
const ringSize = 16;
const stroke = 2;
const r = (ringSize - stroke) / 2;
const circumference = 2 * Math.PI * r;

const reference = ref<HTMLElement | null>(null);
const floating = ref<HTMLElement | null>(null);
const { x, y, strategy } = useFloating(reference, floating, {
  open: () => open.value,
  placement: 'top-end',
  strategy: 'fixed',
  transform: false,
  middleware: [
    offset(8),
    flip({
      boundary: document.body,
      padding: 8,
      fallbackPlacements: ['bottom-end', 'top-start', 'bottom-start'],
    }),
    shift({
      boundary: document.body,
      padding: 8,
    }),
    size({
      padding: 8,
      boundary: document.body,
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
});

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const floatingEl = floating.value;
      const referenceEl = reference.value;
      const isReferenceHTMLElement = referenceEl && 'contains' in referenceEl;
      if (
        floatingEl &&
        (!isReferenceHTMLElement || !referenceEl.contains(target)) &&
        !floatingEl.contains(target)
      ) {
        open.value = false;
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open.value = false;
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    onWatcherCleanup(() => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    });
  },
  { immediate: true },
);

const pctOf = (usage: ChatContextUsage | null) => usage?.percentFull ?? 0;
const dashOffsetOf = (usage: ChatContextUsage | null) => {
  const pct = pctOf(usage);
  return circumference - (Math.min(100, Math.max(0, pct)) / 100) * circumference;
};
const ringColorOf = (usage: ChatContextUsage | null) => {
  const pct = pctOf(usage);
  return pct >= 95
    ? 'var(--vscode-charts-red, #f87171)'
    : pct >= 80
      ? 'var(--vscode-charts-yellow, #fbbf24)'
      : 'currentColor';
};
</script>

<template>
  <div class="relative flex-shrink-0">
    <button
      type="button"
      ref="reference"
      class="rounded-full flex-shrink-0 flex items-center justify-center size-[26px] text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2 cursor-pointer"
      title="Использование в контексте"
      aria-label="Использование в контексте"
      :aria-expanded="open"
      @click.stop="usage ? (open = !open) : undefined"
    >
      <svg :width="ringSize" :height="ringSize" :viewBox="`0 0 ${ringSize} ${ringSize}`" class="block">
        <circle
          :cx="ringSize / 2"
          :cy="ringSize / 2"
          :r="r"
          fill="none"
          stroke="currentColor"
          :stroke-width="stroke"
          opacity="0.25"
        />
        <circle
          :cx="ringSize / 2"
          :cy="ringSize / 2"
          :r="r"
          fill="none"
          :stroke="ringColorOf(usage)"
          :stroke-width="stroke"
          stroke-linecap="round"
          :stroke-dasharray="circumference"
          :stroke-dashoffset="dashOffsetOf(usage)"
          :transform="`rotate(-90 ${ringSize / 2} ${ringSize / 2})`"
        />
      </svg>
    </button>

    <div
      v-if="open && usage"
      ref="floating"
      class="z-[100] rounded-lg border border-void-border-2 bg-void-bg-1 shadow-lg p-3 text-left"
      :style="{
        position: strategy,
        top: `${y ?? 0}px`,
        left: `${x ?? 0}px`,
      }"
      @click.stop
    >
      <div class="text-sm font-medium text-void-fg-1 mb-2">Использование в контексте</div>
      <div class="flex items-baseline justify-between gap-2 mb-2">
        <span class="text-xs text-void-fg-2">{{ pctOf(usage) }}% заполнено</span>
        <span class="text-xs text-void-fg-3">
          ~{{ formatTokenCount(usage.usedTokens) }} / {{ formatTokenCount(usage.contextWindow) }}
          токенов
        </span>
      </div>

      <div class="relative h-1.5 w-full rounded-full overflow-hidden bg-void-bg-2 mb-3">
        <div
          class="absolute inset-y-0 left-0 flex"
          :style="{
            width: `${
              usage.contextWindow > 0
                ? Math.min(100, (usage.usedTokens / usage.contextWindow) * 100)
                : 0
            }%`,
          }"
        >
          <div
            v-for="cat in usage.categories"
            :key="cat.id"
            :style="{
              width: `${usage.usedTokens > 0 ? (cat.tokens / usage.usedTokens) * 100 : 0}%`,
              backgroundColor: cat.color,
            }"
            :title="`${cat.label}: ${formatTokenCount(cat.tokens)}`"
          />
        </div>
        <div
          v-if="usage.reservedTokens > 0"
          class="absolute inset-y-0 right-0"
          :style="{
            width: `${
              usage.contextWindow > 0
                ? Math.min(100, (usage.reservedTokens / usage.contextWindow) * 100)
                : 0
            }%`,
            backgroundColor: RESERVE_COLOR,
          }"
          :title="`Резерв для ответа модели: ${formatTokenCount(usage.reservedTokens)}`"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <div
          v-for="cat in usage.categories"
          :key="cat.id"
          class="flex items-center justify-between gap-2 text-xs"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span class="size-2 rounded-sm flex-shrink-0" :style="{ backgroundColor: cat.color }" />
            <span class="text-void-fg-2 truncate">{{ cat.label }}</span>
          </div>
          <span class="text-void-fg-3 flex-shrink-0 tabular-nums">
            {{ formatTokenCount(cat.tokens) }}
          </span>
        </div>
        <div
          class="flex items-center justify-between gap-2 text-xs mt-1.5 pt-1.5 border-t border-void-border-2"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="size-2 rounded-sm flex-shrink-0"
              :style="{ backgroundColor: RESERVE_COLOR }"
            />
            <span class="text-void-fg-2 truncate">Резерв для ответа модели</span>
          </div>
          <span class="text-void-fg-3 flex-shrink-0 tabular-nums">
            {{ formatTokenCount(usage.reservedTokens) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

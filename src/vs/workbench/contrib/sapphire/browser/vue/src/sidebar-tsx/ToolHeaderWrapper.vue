<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref, useSlots, type VNodeChild } from 'vue';
import { AlertTriangle, Ban, ChevronRight, CircleEllipsis } from 'lucide-vue-next';

const props = defineProps<{
  icon?: VNodeChild;
  title?: VNodeChild;
  desc1?: VNodeChild;
  desc1OnClick?: () => void;
  desc2?: VNodeChild;
  isError?: boolean;
  info?: string;
  desc1Info?: string;
  isRejected?: boolean;
  numResults?: number;
  hasNextPage?: boolean;
  onClick?: () => void;
  desc2OnClick?: () => void;
  isOpen?: boolean;
  className?: string;
  bottomChildren?: VNodeChild;
}>();

const slots = useSlots();
const isOpen_ = ref(false);
const isExpanded = computed(() => (props.isOpen !== undefined ? props.isOpen : isOpen_.value));
const isDropdown = computed(() => slots.default !== undefined); // null — допустимое значение: включает dropdown
const isClickable = computed(() => !!(isDropdown.value || props.onClick));
const isDesc1Clickable = computed(() => !!props.desc1OnClick);

const onHeaderClick = () => {
  if (isDropdown.value) {
    isOpen_.value = !isOpen_.value;
  }
  if (props.onClick) {
    props.onClick();
  }
};

const resultsLabel = computed(() => {
  const numResults = props.numResults;
  if (numResults === undefined) return '';
  return `${numResults}${props.hasNextPage ? '+' : ''} ${numResults === 1 ? 'результат' : numResults > 1 && numResults < 5 ? 'результата' : 'результатов'}`;
});

const Render = (p: { node?: VNodeChild }) => p.node ?? null;
</script>

<template>
  <div>
    <div
      :class="`w-full border border-void-border-3 rounded-lg px-2.5 py-1.5 bg-void-bg-3 overflow-hidden ${className}`"
    >
      <!-- Заголовок карточки -->
      <div class="select-none flex items-center min-h-[24px]">
        <div
          :class="`flex items-center w-full gap-x-2 overflow-hidden justify-between ${isRejected ? 'line-through' : ''}`"
        >
          <!-- Левая часть заголовка -->
          <div class="ml-1 flex items-center overflow-hidden">
            <!-- Заголовок, напр. «> Edited File» -->
            <div
              :class="`
							flex items-center min-w-0 overflow-hidden grow
							${isClickable ? 'cursor-pointer hover:brightness-125 transition-all duration-150' : ''}
						`"
              @click="onHeaderClick"
            >
              <ChevronRight
                v-if="isDropdown"
                :class="`
								text-void-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]
								${isExpanded ? 'rotate-90' : ''}
							`"
              />
              <span class="text-void-fg-3 flex-shrink-0">
                <slot name="title"><Render :node="title" /></slot>
              </span>

              <span
                v-if="!isDesc1Clickable"
                :class="`text-void-fg-4 text-xs italic truncate ml-2`"
                :data-tooltip-id="desc1Info ? 'sapphire-tooltip' : undefined"
                :data-tooltip-content="desc1Info"
                :data-tooltip-place="desc1Info ? 'top' : undefined"
                :data-tooltip-delay-show="desc1Info ? 1000 : undefined"
              >
                <slot name="desc1"><Render :node="desc1" /></slot>
              </span>
            </div>
            <span
              v-if="isDesc1Clickable"
              :class="`text-void-fg-4 text-xs italic truncate ml-2 cursor-pointer hover:brightness-125 transition-all duration-150`"
              :data-tooltip-id="desc1Info ? 'sapphire-tooltip' : undefined"
              :data-tooltip-content="desc1Info"
              :data-tooltip-place="desc1Info ? 'top' : undefined"
              :data-tooltip-delay-show="desc1Info ? 1000 : undefined"
              @click="desc1OnClick?.()"
            >
              <slot name="desc1"><Render :node="desc1" /></slot>
            </span>
          </div>

          <!-- Правая часть заголовка -->
          <div class="flex items-center gap-x-2 flex-shrink-0">
            <CircleEllipsis
              v-if="info"
              class="ml-2 text-void-fg-4 opacity-60 flex-shrink-0"
              :size="14"
              data-tooltip-id="sapphire-tooltip"
              :data-tooltip-content="info"
              data-tooltip-place="top-end"
            />

            <AlertTriangle
              v-if="isError"
              class="text-void-warning opacity-90 flex-shrink-0"
              :size="14"
              data-tooltip-id="sapphire-tooltip"
              data-tooltip-content="Ошибка выполнения инструмента"
              data-tooltip-place="top"
            />
            <Ban
              v-if="isRejected"
              class="text-void-fg-4 opacity-90 flex-shrink-0"
              :size="14"
              data-tooltip-id="sapphire-tooltip"
              data-tooltip-content="Отменено"
              data-tooltip-place="top"
            />
            <span v-if="desc2 || slots.desc2" class="text-void-fg-4 text-xs" @click="desc2OnClick?.()">
              <slot name="desc2"><Render :node="desc2" /></slot>
            </span>
            <span v-if="numResults !== undefined" class="text-void-fg-4 text-xs ml-auto mr-1">
              {{ resultsLabel }}
            </span>
          </div>
        </div>
      </div>
      <!-- Тело карточки -->
      <div
        :class="`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'opacity-100 py-1' : 'max-h-0 opacity-0'}
					text-void-fg-4 rounded-sm overflow-x-auto
				  `"
      >
        <slot />
      </div>
    </div>
    <slot name="bottom">
      <Render v-if="bottomChildren" :node="bottomChildren" />
    </slot>
  </div>
</template>

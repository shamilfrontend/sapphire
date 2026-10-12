<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { onUnmounted, ref, watch } from 'vue';
import { Minus, Plus, X } from 'lucide-vue-next';
import { ChatImageAttachment } from '../../../../common/chatThreadServiceTypes.js';
import { chatImageToDataUrl } from '../../../../common/chatImageUtils.js';

const props = defineProps<{
  image: ChatImageAttachment;
  onClose: () => void;
}>();

const zoom = ref(1);
const offset = ref({ x: 0, y: 0 });
let dragging: {
  startX: number;
  startY: number;
  origX: number;
  origY: number;
} | null = null;
const mouseDownInsideModal = ref(false);

watch(
  () => props.image.id,
  () => {
    zoom.value = 1;
    offset.value = { x: 0, y: 0 };
  },
);

const clampZoom = (z: number) => Math.min(5, Math.max(1, z));

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') props.onClose();
  if (e.key === '+' || e.key === '=') zoom.value = Math.min(5, zoom.value + 0.25);
  if (e.key === '-') zoom.value = Math.max(1, zoom.value - 0.25);
};

window.addEventListener('keydown', onKey);
onUnmounted(() => window.removeEventListener('keydown', onKey));

const onBackdropMouseUp = () => {
  if (!mouseDownInsideModal.value) props.onClose();
  mouseDownInsideModal.value = false;
};

const onWheel = (e: WheelEvent) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.15 : 0.15;
  const next = clampZoom(zoom.value + delta);
  if (next <= 1) offset.value = { x: 0, y: 0 };
  zoom.value = next;
};

const imageStyle = () => ({
  transform: `translate(${offset.value.x}px, ${offset.value.y}px) scale(${zoom.value})`,
  cursor: zoom.value > 1 ? 'grab' : 'default',
  transition: dragging ? 'none' : 'transform 0.05s ease-out',
});

const onImageMouseDown = (e: MouseEvent) => {
  if (zoom.value <= 1) return;
  e.preventDefault();
  dragging = {
    startX: e.clientX,
    startY: e.clientY,
    origX: offset.value.x,
    origY: offset.value.y,
  };
  const onMove = (ev: MouseEvent) => {
    if (!dragging) return;
    offset.value = {
      x: dragging.origX + (ev.clientX - dragging.startX),
      y: dragging.origY + (ev.clientY - dragging.startY),
    };
  };
  const onUp = () => {
    dragging = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};
</script>

<template>
  <!-- Закрытие по клику на затемнение: mousedown/up снаружи модалки, не внутри. -->
  <div
    class="fixed inset-0 bg-black/70 flex flex-col items-center justify-center z-[9999999]"
    @mousedown="mouseDownInsideModal = false"
    @mouseup="onBackdropMouseUp"
  >
    <div
      class="relative flex flex-col items-center gap-3 max-w-[95vw] max-h-[95vh]"
      @mousedown.stop="mouseDownInsideModal = true"
      @mouseup.stop
    >
      <div class="flex items-center gap-2 self-end">
        <button
          type="button"
          class="rounded-full size-8 flex items-center justify-center bg-black/50 text-white hover:bg-black/70 cursor-pointer"
          title="Уменьшить"
          @click="zoom = clampZoom(zoom - 0.25)"
        >
          <Minus :size="16" />
        </button>
        <span class="text-white text-xs tabular-nums w-12 text-center">
          {{ Math.round(zoom * 100) }}%
        </span>
        <button
          type="button"
          class="rounded-full size-8 flex items-center justify-center bg-black/50 text-white hover:bg-black/70 cursor-pointer"
          title="Увеличить"
          @click="zoom = clampZoom(zoom + 0.25)"
        >
          <Plus :size="16" />
        </button>
        <button
          type="button"
          class="rounded-full size-8 flex items-center justify-center bg-black/50 text-white hover:bg-black/70 cursor-pointer"
          title="Закрыть"
          @click="onClose()"
        >
          <X :size="16" />
        </button>
      </div>
      <div
        class="overflow-hidden max-w-[90vw] max-h-[80vh] flex items-center justify-center"
        @wheel="onWheel"
      >
        <img
          :src="chatImageToDataUrl(image)"
          alt=""
          :draggable="false"
          class="max-w-[90vw] max-h-[80vh] object-contain select-none"
          :style="imageStyle()"
          @mousedown="onImageMouseDown"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { onMounted, onUnmounted, ref, watch } from 'vue';
import { autoUpdate, computePosition, flip, offset, shift, type Placement, type VirtualElement } from '@floating-ui/vue';
import 'floating-vue/dist/style.css';
import '../styles.css';

/**
 * Глобальные тултипы. Тултип смонтирован один раз на workbench и слушает документ,
 * поэтому data-атрибуты работают во всех Vue-приложениях Sapphire.
 * На элементе: data-tooltip-id и data-tooltip-content.
 * Необязательно: data-tooltip-place, data-tooltip-delay-show.
 */

const open = ref(false);
const text = ref('');
const tooltipId = ref('sapphire-tooltip');
const floatingEl = ref<HTMLElement | null>(null);

let anchor: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let stopAutoUpdate: (() => void) | undefined;

const placementOf = (el: HTMLElement): Placement => {
  const place = el.getAttribute('data-tooltip-place');
  if (
    place === 'top' ||
    place === 'top-start' ||
    place === 'top-end' ||
    place === 'bottom' ||
    place === 'bottom-start' ||
    place === 'bottom-end' ||
    place === 'left' ||
    place === 'left-start' ||
    place === 'left-end' ||
    place === 'right' ||
    place === 'right-start' ||
    place === 'right-end'
  ) {
    return place;
  }
  return 'top';
};

const delayOf = (el: HTMLElement) => {
  const raw = el.getAttribute('data-tooltip-delay-show');
  const parsed = raw ? Number(raw) : 50;
  return Number.isFinite(parsed) ? parsed : 50;
};

const hide = () => {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = undefined;
  }
  stopAutoUpdate?.();
  stopAutoUpdate = undefined;
  open.value = false;
  anchor = null;
};

const position = async () => {
  const floating = floatingEl.value;
  if (!anchor || !floating) {
    return;
  }
  const virtual: VirtualElement = {
    getBoundingClientRect: () => anchor!.getBoundingClientRect(),
  };
  const { x, y, strategy } = await computePosition(virtual, floating, {
    strategy: 'fixed',
    placement: placementOf(anchor),
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });
  Object.assign(floating.style, {
    position: strategy,
    left: `${x}px`,
    top: `${y}px`,
  });
};

const show = (el: HTMLElement) => {
  const content = el.getAttribute('data-tooltip-content');
  const id = el.getAttribute('data-tooltip-id');
  if (!content || !id) {
    return;
  }
  if (anchor === el && open.value) {
    return;
  }
  hide();
  anchor = el;
  text.value = content;
  tooltipId.value = id;
  showTimer = setTimeout(() => {
    open.value = true;
  }, delayOf(el));
};

watch(open, async (isOpen) => {
  stopAutoUpdate?.();
  stopAutoUpdate = undefined;
  if (!isOpen || !anchor) {
    return;
  }
  await Promise.resolve();
  const floating = floatingEl.value;
  if (!floating || !anchor) {
    return;
  }
  await position();
  const currentAnchor = anchor;
  stopAutoUpdate = autoUpdate(currentAnchor, floating, () => {
    void position();
  });
});

const onOver = (event: MouseEvent) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const el = target.closest('[data-tooltip-id]');
  if (!(el instanceof HTMLElement)) {
    return;
  }
  show(el);
};

const onOut = (event: MouseEvent) => {
  if (!anchor) {
    return;
  }
  const related = event.relatedTarget;
  if (related instanceof Node && anchor.contains(related)) {
    return;
  }
  const from = event.target;
  if (from instanceof Node && !anchor.contains(from) && from !== anchor) {
    return;
  }
  hide();
};

const tooltipCss = `
#sapphire-tooltip,
#sapphire-tooltip-orange,
#sapphire-tooltip-green,
#sapphire-tooltip-provider-info {
  font-size: 12px;
  line-height: 16px;
  padding: 4px 8px;
  border-radius: 6px;
  z-index: 999999;
  max-width: 300px;
  word-wrap: break-word;
  border: 1px solid rgba(100, 100, 100, 0.2);
  box-shadow: 0 2px 8px var(--vscode-widget-shadow);
  opacity: 1;
}
#sapphire-tooltip,
#sapphire-tooltip-provider-info {
  background-color: var(--vscode-editor-background);
  color: var(--vscode-input-foreground);
}
#sapphire-tooltip-orange {
  background-color: #f6762a;
  color: white;
  border-color: rgba(200, 200, 200, 0.3);
}
#sapphire-tooltip-green {
  background-color: #228b22;
  color: white;
  border-color: rgba(200, 200, 200, 0.3);
}
#sapphire-tooltip-provider-info {
  pointer-events: all;
  user-select: text;
  font-size: 11px;
  max-width: 280px;
  padding-top: 8px;
  padding-bottom: 8px;
}
`;

let styleEl: HTMLStyleElement | undefined;

onMounted(() => {
  styleEl = document.createElement('style');
  styleEl.textContent = tooltipCss;
  document.head.appendChild(styleEl);
  document.addEventListener('mouseover', onOver);
  document.addEventListener('mouseout', onOut);
});

onUnmounted(() => {
  hide();
  styleEl?.remove();
  document.removeEventListener('mouseover', onOver);
  document.removeEventListener('mouseout', onOut);
});
</script>

<template>
  <div
    v-if="open"
    :id="tooltipId"
    ref="floatingEl"
    class="sapphire-vue-tooltip"
    role="tooltip"
  >
    {{ text }}
  </div>
</template>

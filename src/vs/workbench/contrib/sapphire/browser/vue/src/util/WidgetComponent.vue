<script setup lang="ts" generic="Instance">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onUnmounted, ref, useAttrs, watch } from 'vue';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  ctor: { new (...params: never[]): Instance } | ((container: HTMLDivElement) => Instance);
  propsFn: (container: HTMLDivElement) => unknown[];
  onCreateInstance: (instance: Instance) => IDisposable[];
  dispose: (instance: Instance) => void;
}>();

const attrs = useAttrs();
const containerRef = ref<HTMLDivElement | null>(null);

const rootClass = computed(() => (attrs.class === undefined ? 'w-full' : attrs.class));

const passthrough = computed(() => {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') continue;
    rest[key] = value;
  }
  return rest;
});

// type guard: ctor — класс или фабрика
const isConstructor = (f: unknown): f is { new (...params: never[]): Instance } => {
  if (typeof f !== 'function') return false;
  const proto: unknown = f.prototype;
  if (!proto || typeof proto !== 'object') return false;
  return (proto as { constructor?: unknown }).constructor === f;
};

const createInstance = (container: HTMLDivElement): Instance => {
  if (isConstructor(props.ctor)) {
    const Ctor = props.ctor as new (...params: unknown[]) => Instance;
    return new Ctor(...props.propsFn(container));
  }
  return props.ctor(container);
};

let disposeInstance: (() => void) | undefined;

const mount = () => {
  disposeInstance?.();
  disposeInstance = undefined;
  const container = containerRef.value;
  if (!container) return;
  const instance = createInstance(container);
  const disposables = props.onCreateInstance(instance);
  const dispose = props.dispose;
  disposeInstance = () => {
    disposables.forEach((d) => d.dispose());
    dispose(instance);
  };
};

watch(
  () => [props.ctor, props.propsFn, props.dispose, props.onCreateInstance] as const,
  () => {
    mount();
  },
  { immediate: true, flush: 'post' },
);

onUnmounted(() => {
  disposeInstance?.();
  disposeInstance = undefined;
});
</script>

<template>
  <div ref="containerRef" v-bind="passthrough" :class="rootClass">
    <slot />
  </div>
</template>

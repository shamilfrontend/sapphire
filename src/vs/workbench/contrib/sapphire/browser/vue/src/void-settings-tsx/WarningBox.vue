<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import IconWarning from '../sidebar-tsx/IconWarning.vue';

// return <SapphireSelectBox
// 	options={[{ text: 'Please add a model!', value: null }]}
// 	onChangeSelection={() => { }}
// />

defineProps<{
  text: string;
}>();

const attrs = useAttrs();
const clickable = computed(() => typeof attrs.onClick === 'function');
</script>

<template>
  <div
    class="text-void-warning brightness-90 opacity-90 w-fit text-xs text-ellipsis flex items-center flex-nowrap"
    :class="clickable ? 'hover:brightness-75 transition-all duration-200 cursor-pointer' : ''"
  >
    <IconWarning :size="14" class="mr-1 flex-shrink-0" />
    <span>{{ text }}</span>
  </div>
</template>

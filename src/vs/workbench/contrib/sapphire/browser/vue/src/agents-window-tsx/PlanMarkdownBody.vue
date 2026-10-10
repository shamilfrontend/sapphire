<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  PPR Code — plan preview beside the chat in Режим Агент.
 *--------------------------------------------------------------------------------------*/

defineProps<{
  value: string;
}>();

const emit = defineEmits<{
  input: [value: string];
  keydown: [event: KeyboardEvent];
}>();

const onInput = (event: Event) => {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) return;
  emit('input', target.value);
};

const onKeyDown = (event: KeyboardEvent) => {
  emit('keydown', event);
};
</script>

<template>
  <textarea
    :value="value"
    spellcheck="false"
    aria-label="Markdown плана"
    class="w-full h-full resize-none bg-void-bg-1 text-void-fg-1 font-mono text-[13px] leading-relaxed p-4 focus:outline-none"
    @input="onInput"
    @keydown="onKeyDown"
  />
</template>

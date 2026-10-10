<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, inject, ref, watch } from 'vue';
import { URI } from '../../../../../../../base/common/uri.js';
import { getBasename } from '../../../../common/pathLabels.js';
import { isPlanFilePath } from '../../../../common/prompt/planFileHelpers.js';
import { useAgentsPlan } from '../agents-window-tsx/AgentsPlanContext.js';
import { getRelative, sapphireOpenFileFn } from '../sidebar-tsx/chatFileUtils.js';
import { useAccessor } from '../util/services.js';
import Codespan from './Codespan.vue';
import { isValidUri, shortenedPathKey, type ChatMessageLocation } from './ChatMarkdownRender.js';

const props = defineProps<{
  text: string;
  rawText: string;
  chatMessageLocation: ChatMessageLocation;
}>();

const accessor = useAccessor();
const agentsPlan = useAgentsPlan();
const shortenedRef = inject(shortenedPathKey, null);
const chatThreadService = accessor.get('IChatThreadService');

const didCompute = ref(0);

watch(
  () =>
    [
      props.text,
      props.rawText,
      props.chatMessageLocation.messageIdx,
      props.chatMessageLocation.threadId,
    ] as const,
  () => {
    if (!props.rawText.endsWith('`')) return;
    const { messageIdx, threadId } = props.chatMessageLocation;
    const text = props.text;
    const existing = chatThreadService.getCodespanLink({ codespanStr: text, messageIdx, threadId });
    if (existing !== undefined) return;
    // асинхронно резолвим путь и кладём в кэш
    void chatThreadService.generateCodespanLink({ codespanStr: text, threadId }).then((link) => {
      chatThreadService.addCodespanLink({
        newLinkText: text,
        newLinkLocation: link,
        messageIdx,
        threadId,
      });
      didCompute.value += 1; // перерисовка после resolve
    });
  },
  { immediate: true },
);

const view = computed(() => {
  void didCompute.value;
  const shortenedByOriginal = shortenedRef?.value ?? {};
  const { messageIdx, threadId } = props.chatMessageLocation;
  let link = undefined as ReturnType<typeof chatThreadService.getCodespanLink>;
  let tooltip: string | undefined;
  let displayText = shortenedByOriginal[props.text] ?? props.text;

  if (props.rawText.endsWith('`')) {
    // ссылка на файл из кэша треда
    link = chatThreadService.getCodespanLink({
      codespanStr: props.text,
      messageIdx,
      threadId,
    });

    if (link?.displayText) {
      displayText =
        shortenedByOriginal[link.displayText] ?? shortenedByOriginal[props.text] ?? link.displayText;
      if (isValidUri(link.displayText)) {
        tooltip = getRelative(URI.file(link.displayText), accessor);
      }
    } else if (isValidUri(props.text)) {
      tooltip = getRelative(URI.file(props.text), accessor); // полный путь во всплывающей подсказке
      displayText = shortenedByOriginal[props.text] ?? getBasename(props.text);
    }
  }

  return { link, tooltip, displayText };
});

const onClick = () => {
  const link = view.value.link;
  if (!link) return;
  if (agentsPlan && isPlanFilePath(link.uri.fsPath)) {
    agentsPlan.openPlan(link.uri.fsPath);
    return;
  }
  if (link.selection)
    sapphireOpenFileFn(link.uri, accessor, [
      link.selection.startLineNumber,
      link.selection.endLineNumber,
    ]);
  else sapphireOpenFileFn(link.uri, accessor);
};
</script>

<template>
  <Codespan
    :text="view.displayText"
    :onClick="onClick"
    :extraClass="
      view.link ? 'underline hover:brightness-90 transition-all duration-200 cursor-pointer' : ''
    "
    :tooltip="view.tooltip || undefined"
  />
</template>

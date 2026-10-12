/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ref, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { URI } from '../../../../../../../base/common/uri.js';
import { useRefState } from '../util/helpers.js';
import { useAccessor, useCommandBarURIListener } from '../util/services.js';

export enum CopyButtonText {
  Idle = 'Копировать',
  Copied = 'Скопировано!',
  Error = 'Не удалось скопировать',
}

export const COPY_FEEDBACK_TIMEOUT = 1500; // длительность надписи «Скопировано!»

export type IndicatorColor = 'green' | 'orange' | 'dark' | 'yellow' | null;

export type TooltipPlace =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'right'
  | 'right-start'
  | 'right-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end';

export const tooltipPropsForApplyBlock = ({
  tooltipName,
  color = undefined,
  position = 'top',
  offset = undefined,
}: {
  tooltipName: string;
  color?: IndicatorColor;
  position?: TooltipPlace;
  offset?: number;
}) => ({
  'data-tooltip-id':
    color === 'orange'
      ? `void-tooltip-orange`
      : color === 'green'
        ? 'sapphire-tooltip-green'
        : 'sapphire-tooltip',
  'data-tooltip-place': position,
  'data-tooltip-content': `${tooltipName}`,
  'data-tooltip-offset': offset,
});

// applyBoxId → URI хранится в thread.state.applyBoxState (сохраняется между сессиями)
const getUriBeingApplied = (
  chatThreadService: { getApplyBoxUri(applyBoxId: string): URI | undefined },
  applyBoxId: string,
) => chatThreadService.getApplyBoxUri(applyBoxId) ?? null;

export const useApplyStreamState = (applyBoxId: MaybeRefOrGetter<string>) => {
  const accessor = useAccessor();
  const sapphireCommandBarService = accessor.get('ISapphireCommandBarService');
  const chatThreadService = accessor.get('IChatThreadService');

  const getStreamState = () => {
    const uri = getUriBeingApplied(chatThreadService, toValue(applyBoxId));
    if (!uri) return 'idle-no-changes' as const;
    return sapphireCommandBarService.getStreamState(uri);
  };

  const [currStreamStateRef, setStreamState] = useRefState(getStreamState());

  const setApplying = (uri: URI | undefined) => {
    chatThreadService.setApplyBoxUri(toValue(applyBoxId), uri);
    setStreamState(getStreamState());
  };

  // подписка на обновления стрима Apply для этого блока
  useCommandBarURIListener((uri_) => {
    const uri = getUriBeingApplied(chatThreadService, toValue(applyBoxId));
    if (uri?.fsPath === uri_.fsPath) {
      setStreamState(getStreamState());
    }
  });

  return { currStreamStateRef, setApplying };
};

export const useEditToolStreamState = ({
  uri,
}: {
  applyBoxId: MaybeRefOrGetter<string>;
  uri: MaybeRefOrGetter<URI>;
}) => {
  const accessor = useAccessor();
  const sapphireCommandBarService = accessor.get('ISapphireCommandBarService');
  const streamState = ref(sapphireCommandBarService.getStreamState(toValue(uri)));
  // подписка на обновления стрима Apply для этого блока
  useCommandBarURIListener((uri_) => {
    const current = toValue(uri);
    const shouldUpdate = current.fsPath === uri_.fsPath;
    if (shouldUpdate) {
      streamState.value = sapphireCommandBarService.getStreamState(current);
    }
  });
  watch(
    () => toValue(uri),
    (next) => {
      streamState.value = sapphireCommandBarService.getStreamState(next);
    },
  );
  return { streamState };
};

export const terminalLanguages = new Set([
  'bash',
  'shellscript',
  'shell',
  'powershell',
  'bat',
  'zsh',
  'sh',
  'fish',
  'nushell',
  'ksh',
  'xonsh',
  'elvish',
]);

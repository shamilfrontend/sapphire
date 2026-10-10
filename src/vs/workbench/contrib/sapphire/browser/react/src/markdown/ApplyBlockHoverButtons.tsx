/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { FileSymlink, LucideIcon, Check, X, Square, Copy, Play } from 'lucide-react';
import { PlacesType } from 'react-tooltip';
import {
  useAccessor,
  useChatThreadsStreamState,
  useCommandBarURIListener,
  useSettingsState,
} from '../util/services.js';
import { useRefState } from '../util/helpers.js';
import { isFeatureNameDisabled } from '../../../../common/sapphireSettingsTypes.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { getBasename } from '../../../../common/pathLabels.js';
import { sapphireOpenFileFn } from '../sidebar-tsx/chatFileUtils.js';
import { ListableToolItem, ToolChildrenWrapper } from '../sidebar-tsx/ChatToolPrimitives.js';

enum CopyButtonText {
  Idle = 'Копировать',
  Copied = 'Скопировано!',
  Error = 'Не удалось скопировать',
}

type IconButtonProps = {
  Icon: LucideIcon;
};

export const IconShell1 = ({
  onClick,
  Icon,
  disabled,
  className,
  ...props
}: IconButtonProps & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    disabled={disabled}
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick?.(e);
    }}
    // закомментированный border
    className={`
		size-[18px]
		p-[2px]
		flex items-center justify-center
		text-sm text-void-fg-3
		hover:brightness-110
		disabled:opacity-50 disabled:cursor-not-allowed
		${className}
        `}
    {...props}
  >
    <Icon />
  </button>
);

const COPY_FEEDBACK_TIMEOUT = 1500; // длительность надписи «Скопировано!»

export const CopyButton = ({
  codeStr,
  toolTipName,
}: {
  codeStr: string | (() => Promise<string> | string);
  toolTipName: string;
}) => {
  const accessor = useAccessor();

  const clipboardService = accessor.get('IClipboardService');
  const [copyButtonText, setCopyButtonText] = useState(CopyButtonText.Idle);

  useEffect(() => {
    if (copyButtonText === CopyButtonText.Idle) return;
    setTimeout(() => {
      setCopyButtonText(CopyButtonText.Idle);
    }, COPY_FEEDBACK_TIMEOUT);
  }, [copyButtonText]);

  const onCopy = useCallback(async () => {
    clipboardService
      .writeText(typeof codeStr === 'string' ? codeStr : await codeStr())
      .then(() => {
        setCopyButtonText(CopyButtonText.Copied);
      })
      .catch(() => {
        setCopyButtonText(CopyButtonText.Error);
      });
  }, [clipboardService, codeStr, setCopyButtonText]);

  return (
    <IconShell1
      Icon={
        copyButtonText === CopyButtonText.Copied
          ? Check
          : copyButtonText === CopyButtonText.Error
            ? X
            : Copy
      }
      onClick={onCopy}
      {...tooltipPropsForApplyBlock({ tooltipName: toolTipName })}
    />
  );
};

const JumpToFileButton = ({
  uri,
  ...props
}: { uri: URI | 'current' } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  const accessor = useAccessor();

  const jumpToFileButton = uri !== 'current' && (
    <IconShell1
      Icon={FileSymlink}
      onClick={() => {
        sapphireOpenFileFn(uri, accessor);
      }}
      {...tooltipPropsForApplyBlock({ tooltipName: 'Перейти к файлу' })}
      {...props}
    />
  );
  return jumpToFileButton;
};

// applyBoxId → URI хранится в thread.state.applyBoxState (сохраняется между сессиями)
const getUriBeingApplied = (
  chatThreadService: { getApplyBoxUri(applyBoxId: string): URI | undefined },
  applyBoxId: string,
) => chatThreadService.getApplyBoxUri(applyBoxId) ?? null;

const useApplyStreamState = ({ applyBoxId }: { applyBoxId: string }) => {
  const accessor = useAccessor();
  const sapphireCommandBarService = accessor.get('ISapphireCommandBarService');
  const chatThreadService = accessor.get('IChatThreadService');

  const getStreamState = useCallback(() => {
    const uri = getUriBeingApplied(chatThreadService, applyBoxId);
    if (!uri) return 'idle-no-changes';
    return sapphireCommandBarService.getStreamState(uri);
  }, [sapphireCommandBarService, chatThreadService, applyBoxId]);

  const [currStreamStateRef, setStreamState] = useRefState(getStreamState());

  const setApplying = useCallback(
    (uri: URI | undefined) => {
      chatThreadService.setApplyBoxUri(applyBoxId, uri);
      setStreamState(getStreamState());
    },
    [setStreamState, getStreamState, applyBoxId, chatThreadService],
  );

  // подписка на обновления стрима Apply для этого блока
  useCommandBarURIListener(
    useCallback(
      (uri_) => {
        const uri = getUriBeingApplied(chatThreadService, applyBoxId);
        if (uri?.fsPath === uri_.fsPath) {
          setStreamState(getStreamState());
        }
      },
      [setStreamState, applyBoxId, getStreamState, chatThreadService],
    ),
  );

  return { currStreamStateRef, setApplying };
};

type IndicatorColor = 'green' | 'orange' | 'dark' | 'yellow' | null;
const StatusIndicator = ({
  indicatorColor,
  title,
  className,
  ...props
}: {
  indicatorColor: IndicatorColor;
  title?: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`flex flex-row text-void-fg-3 text-xs items-center gap-1.5 ${className}`}
    {...props}
  >
    {title && <span className="opacity-80">{title}</span>}
    <div
      className={` size-1.5 rounded-full border
					${
            indicatorColor === 'dark'
              ? 'bg-[rgba(0,0,0,0)] border-void-border-1'
              : indicatorColor === 'orange'
                ? 'bg-orange-500 border-orange-500 shadow-[0_0_4px_0px_rgba(234,88,12,0.6)]'
                : indicatorColor === 'green'
                  ? 'bg-green-500 border-green-500 shadow-[0_0_4px_0px_rgba(22,163,74,0.6)]'
                  : indicatorColor === 'yellow'
                    ? 'bg-yellow-500 border-yellow-500 shadow-[0_0_4px_0px_rgba(22,163,74,0.6)]'
                    : 'bg-void-border-1 border-void-border-1'
          }
				`}
    />
  </div>
);

const tooltipPropsForApplyBlock = ({
  tooltipName,
  color = undefined,
  position = 'top',
  offset = undefined,
}: {
  tooltipName: string;
  color?: IndicatorColor;
  position?: PlacesType;
  offset?: number;
}) => ({
  'data-tooltip-id':
    color === 'orange'
      ? `void-tooltip-orange`
      : color === 'green'
        ? 'sapphire-tooltip-green'
        : 'sapphire-tooltip',
  'data-tooltip-place': position as PlacesType,
  'data-tooltip-content': `${tooltipName}`,
  'data-tooltip-offset': offset,
});

export const useEditToolStreamState = ({ applyBoxId, uri }: { applyBoxId: string; uri: URI }) => {
  const accessor = useAccessor();
  const sapphireCommandBarService = accessor.get('ISapphireCommandBarService');
  const [streamState, setStreamState] = useState(sapphireCommandBarService.getStreamState(uri));
  // подписка на обновления стрима Apply для этого блока
  useCommandBarURIListener(
    useCallback(
      (uri_) => {
        const shouldUpdate = uri.fsPath === uri_.fsPath;
        if (shouldUpdate) {
          setStreamState(sapphireCommandBarService.getStreamState(uri));
        }
      },
      [sapphireCommandBarService, applyBoxId, uri],
    ),
  );

  return { streamState };
};

const StatusIndicatorForApplyButton = ({
  applyBoxId,
  _uri,
}: { applyBoxId: string; uri: URI | 'current' } & React.HTMLAttributes<HTMLDivElement>) => {
  const { currStreamStateRef } = useApplyStreamState({ applyBoxId });
  const currStreamState = currStreamStateRef.current;

  const color =
    currStreamState === 'idle-no-changes'
      ? 'dark'
      : currStreamState === 'streaming'
        ? 'orange'
        : currStreamState === 'idle-has-changes'
          ? 'green'
          : null;

  const tooltipName =
    currStreamState === 'idle-no-changes'
      ? 'Готово'
      : currStreamState === 'streaming'
        ? 'Применение'
        : currStreamState === 'idle-has-changes'
          ? 'Готово' // «Applied» в UI смотрелось хуже
          : '';

  const statusIndicatorHTML = (
    <StatusIndicator
      key={currStreamState}
      className="mx-2"
      indicatorColor={color}
      {...tooltipPropsForApplyBlock({ tooltipName, color, position: 'top', offset: 12 })}
    />
  );
  return statusIndicatorHTML;
};

const terminalLanguages = new Set([
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

const ApplyButtonsForTerminal = ({
  codeStr,
  applyBoxId,
  uri,
  _language,
}: {
  codeStr: string;
  applyBoxId: string;
  language?: string;
  uri: URI | 'current';
}) => {
  const accessor = useAccessor();
  const terminalToolService = accessor.get('ITerminalToolService');

  const [isShellRunning, setIsShellRunning] = useState<boolean>(false);
  const interruptToolRef = useRef<(() => void) | null>(null);
  const isDisabled = isShellRunning;

  const onClickSubmit = useCallback(async () => {
    if (isShellRunning) return;
    try {
      setIsShellRunning(true);
      const terminalId = await terminalToolService.createPersistentTerminal({ cwd: null });
      const { interrupt } = await terminalToolService.runCommand(codeStr, {
        type: 'persistent',
        persistentTerminalId: terminalId,
      });
      interruptToolRef.current = interrupt;
    } catch (e) {
      setIsShellRunning(false);
      console.error('Failed to execute in terminal:', e);
    }
  }, [codeStr, uri, applyBoxId, terminalToolService, isShellRunning]);

  if (isShellRunning) {
    return (
      <IconShell1
        Icon={X}
        onClick={() => {
          interruptToolRef.current?.();
          setIsShellRunning(false);
        }}
        {...tooltipPropsForApplyBlock({ tooltipName: 'Стоп' })}
      />
    );
  }
  if (isDisabled) {
    return null;
  }
  return (
    <IconShell1
      Icon={Play}
      onClick={onClickSubmit}
      {...tooltipPropsForApplyBlock({ tooltipName: 'Применить' })}
    />
  );
};

const ApplyButtonsForEdit = ({
  codeStr,
  applyBoxId,
  uri,
  _language,
}: {
  codeStr: string;
  applyBoxId: string;
  language?: string;
  uri: URI | 'current';
}) => {
  const accessor = useAccessor();
  const editCodeService = accessor.get('IEditCodeService');
  const chatThreadService = accessor.get('IChatThreadService');
  const notificationService = accessor.get('INotificationService');

  const settingsState = useSettingsState();
  const isDisabled = !!isFeatureNameDisabled('Apply', settingsState) || !applyBoxId;

  const { currStreamStateRef, setApplying } = useApplyStreamState({ applyBoxId });

  const onClickSubmit = useCallback(async () => {
    if (currStreamStateRef.current === 'streaming') return;

    await editCodeService.callBeforeApplyOrEdit(uri);

    const [newApplyingUri, applyDonePromise] =
      editCodeService.startApplying({
        from: 'ClickApply',
        applyStr: codeStr,
        uri,
        startBehavior: 'reject-conflicts',
      }) ?? [];
    setApplying(newApplyingUri);

    if (!applyDonePromise) {
      setApplying(undefined);
      notificationService.info(
        `Ошибка Sapphire: не удалось применить изменения. ${uri === 'current' ? 'Этот блок хочет изменить текущий файл, но файл может быть не открыт.' : `Этот блок хочет изменить ${uri.fsPath}, но файл может не существовать.`}`,
      );
    }

    // при ошибке прерываем стрим применения
    applyDonePromise?.catch((e) => {
      const appliedUri = getUriBeingApplied(chatThreadService, applyBoxId);
      if (appliedUri) editCodeService.interruptURIStreaming({ uri: appliedUri });
      notificationService.info(`Ошибка Sapphire: проблема при применении изменений: ${e}.`);
    });
  }, [
    setApplying,
    currStreamStateRef,
    editCodeService,
    chatThreadService,
    codeStr,
    uri,
    applyBoxId,
    notificationService,
  ]);

  const onClickStop = useCallback(() => {
    if (currStreamStateRef.current !== 'streaming') return;
    const appliedUri = getUriBeingApplied(chatThreadService, applyBoxId);
    if (!appliedUri) return;

    editCodeService.interruptURIStreaming({ uri: appliedUri });
  }, [currStreamStateRef, applyBoxId, editCodeService, chatThreadService]);

  const onAccept = useCallback(() => {
    const appliedUri = getUriBeingApplied(chatThreadService, applyBoxId);
    if (appliedUri) {
      editCodeService.acceptOrRejectAllDiffAreas({
        uri: appliedUri,
        behavior: 'accept',
        removeCtrlKs: false,
      });
      setApplying(undefined);
    }
  }, [applyBoxId, editCodeService, chatThreadService, setApplying]);

  const onReject = useCallback(() => {
    const appliedUri = getUriBeingApplied(chatThreadService, applyBoxId);
    if (appliedUri) {
      editCodeService.acceptOrRejectAllDiffAreas({
        uri: appliedUri,
        behavior: 'reject',
        removeCtrlKs: false,
      });
      setApplying(undefined);
    }
  }, [applyBoxId, editCodeService, chatThreadService, setApplying]);

  const currStreamState = currStreamStateRef.current;
  if (currStreamState === 'streaming') {
    return (
      <IconShell1
        Icon={Square}
        onClick={onClickStop}
        {...tooltipPropsForApplyBlock({ tooltipName: 'Стоп' })}
      />
    );
  }
  if (isDisabled) {
    return null;
  }
  if (currStreamState === 'idle-no-changes') {
    return (
      <IconShell1
        Icon={Play}
        onClick={onClickSubmit}
        {...tooltipPropsForApplyBlock({ tooltipName: 'Применить' })}
      />
    );
  }
  if (currStreamState === 'idle-has-changes') {
    return (
      <>
        <IconShell1
          Icon={X}
          onClick={onReject}
          {...tooltipPropsForApplyBlock({ tooltipName: 'Отклонить' })}
        />
        <IconShell1
          Icon={Check}
          onClick={onAccept}
          {...tooltipPropsForApplyBlock({ tooltipName: 'Оставить' })}
        />
      </>
    );
  }
};

const ApplyButtonsHTML = (params: {
  codeStr: string;
  applyBoxId: string;
  language?: string;
  uri: URI | 'current';
}) => {
  const { language } = params;
  const isShellLanguage = !!language && terminalLanguages.has(language);

  if (isShellLanguage) {
    return <ApplyButtonsForTerminal {...params} />;
  }
  return <ApplyButtonsForEdit {...params} />;
};

export const EditToolAcceptRejectButtonsHTML = ({
  applyBoxId,
  uri,
  threadId,
}: {
  codeStr: string;
  applyBoxId: string;
} & {
  uri: URI;
  type: 'edit_file' | 'rewrite_file';
  threadId: string;
}) => {
  const accessor = useAccessor();
  const editCodeService = accessor.get('IEditCodeService');

  const { streamState } = useEditToolStreamState({ applyBoxId, uri });
  const settingsState = useSettingsState();

  const chatThreadsStreamState = useChatThreadsStreamState(threadId);
  const isRunning = chatThreadsStreamState?.isRunning;

  const isDisabled = !!isFeatureNameDisabled('Chat', settingsState) || !applyBoxId;

  const onAccept = useCallback(() => {
    editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'accept', removeCtrlKs: false });
  }, [uri, applyBoxId, editCodeService]);

  const onReject = useCallback(() => {
    editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false });
  }, [uri, applyBoxId, editCodeService]);

  if (isDisabled) return null;

  if (streamState === 'idle-no-changes') {
    return null;
  }

  if (streamState === 'idle-has-changes') {
    if (isRunning === 'LLM' || isRunning === 'tool' || isRunning === 'preparing') return null;

    return (
      <>
        <IconShell1
          Icon={X}
          onClick={onReject}
          {...tooltipPropsForApplyBlock({ tooltipName: 'Отклонить' })}
        />
        <IconShell1
          Icon={Check}
          onClick={onAccept}
          {...tooltipPropsForApplyBlock({ tooltipName: 'Оставить' })}
        />
      </>
    );
  }
};

export const BlockCodeApplyWrapper = ({
  children,
  codeStr,
  applyBoxId,
  language,
  canApply,
  uri,
}: {
  codeStr: string;
  children: React.ReactNode;
  applyBoxId: string;
  canApply: boolean;
  language: string;
  uri: URI | 'current';
}) => {
  const accessor = useAccessor();
  const { currStreamStateRef } = useApplyStreamState({ applyBoxId });
  const currStreamState = currStreamStateRef.current;

  const name =
    uri !== 'current' ? (
      <ListableToolItem
        name={<span className="not-italic">{getBasename(uri.fsPath)}</span>}
        isSmall
        showDot={false}
        onClick={() => {
          sapphireOpenFileFn(uri, accessor);
        }}
      />
    ) : (
      <span>{language}</span>
    );

  return (
    <div className="border border-void-border-3 rounded overflow-hidden bg-void-bg-3 my-1">
      {/* Заголовок карточки */}
      <div className=" select-none flex justify-between items-center py-1 px-2 border-b border-void-border-3 cursor-default">
        <div className="flex items-center">
          <StatusIndicatorForApplyButton uri={uri} applyBoxId={applyBoxId} />
          <span className="text-[13px] font-light text-void-fg-3">{name}</span>
        </div>
        <div className={`${canApply ? '' : 'hidden'} flex items-center gap-1`}>
          <JumpToFileButton uri={uri} />
          {currStreamState === 'idle-no-changes' && (
            <CopyButton codeStr={codeStr} toolTipName="Копировать" />
          )}
          <ApplyButtonsHTML
            uri={uri}
            applyBoxId={applyBoxId}
            codeStr={codeStr}
            language={language}
          />
        </div>
      </div>

      {/* Содержимое блока Apply */}
      <ToolChildrenWrapper>{children}</ToolChildrenWrapper>
    </div>
  );
};

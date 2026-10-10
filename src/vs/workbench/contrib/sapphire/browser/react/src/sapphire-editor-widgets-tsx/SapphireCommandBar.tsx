/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useAccessor, useCommandBarState, useIsDark } from '../util/services.js';

import '../styles.css';
import { useEffect, useState } from 'react';
import {
  acceptAllBg,
  buttonFontSize,
  buttonTextColor,
  rejectAllBg,
} from '../../../../common/helpers/colors.js';
import { SapphireCommandBarProps } from '../../../sapphireCommandBarService.js';
import { Check, EllipsisVertical, MoveDown, MoveLeft, MoveRight, MoveUp, X } from 'lucide-react';
import {
  SAPPHIRE_GOTO_NEXT_DIFF_ACTION_ID,
  SAPPHIRE_GOTO_PREV_DIFF_ACTION_ID,
  SAPPHIRE_GOTO_NEXT_URI_ACTION_ID,
  SAPPHIRE_GOTO_PREV_URI_ACTION_ID,
  SAPPHIRE_ACCEPT_FILE_ACTION_ID,
  SAPPHIRE_REJECT_FILE_ACTION_ID,
  SAPPHIRE_ACCEPT_ALL_DIFFS_ACTION_ID,
  SAPPHIRE_REJECT_ALL_DIFFS_ACTION_ID,
} from '../../../actionIDs.js';

export const SapphireCommandBarMain = ({ uri, editor }: SapphireCommandBarProps) => {
  const isDark = useIsDark();

  return (
    <div className={`@@void-scope ${isDark ? 'dark' : ''}`}>
      <SapphireCommandBar uri={uri} editor={editor} />
    </div>
  );
};

export const AcceptAllButtonWrapper = ({
  text,
  onClick,
  className,
  ...props
}: {
  text: string;
  onClick: () => void;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={`
			px-2 py-0.5
			flex items-center gap-1
			text-white text-[11px] text-nowrap
			h-full rounded-sm
			cursor-pointer hover:opacity-90
			${className}
		`}
    style={{
      backgroundColor: acceptAllBg,
      color: buttonTextColor,
      border: 'none',
      fontSize: buttonFontSize,
    }}
    type="button"
    onClick={onClick}
    {...props}
  >
    {text ? <span>{text}</span> : <Check size={16} />}
  </button>
);

export const RejectAllButtonWrapper = ({
  text,
  onClick,
  className,
  ...props
}: {
  text: string;
  onClick: () => void;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={`
			px-2 py-0.5
			flex items-center gap-1
			text-white text-[11px] text-nowrap
			h-full rounded-sm
			cursor-pointer hover:opacity-90
			${className}
		`}
    style={{
      backgroundColor: rejectAllBg,
      color: buttonTextColor,
      border: 'none',
      fontSize: buttonFontSize,
    }}
    type="button"
    onClick={onClick}
    {...props}
  >
    {text ? <span>{text}</span> : <X size={16} />}
  </button>
);

export const SapphireCommandBar = ({ uri }: SapphireCommandBarProps) => {
  const accessor = useAccessor();
  const editCodeService = accessor.get('IEditCodeService');
  const commandBarService = accessor.get('ISapphireCommandBarService');
  const keybindingService = accessor.get('IKeybindingService');
  const { stateOfURI: commandBarState, sortedURIs: sortedCommandBarURIs } = useCommandBarState();
  const [showAcceptRejectAllButtons, setShowAcceptRejectAllButtons] = useState(false);

  // Индекс текущего URI в sortedCommandBarURIs
  const i_ = sortedCommandBarURIs.findIndex((e) => e.fsPath === uri?.fsPath);
  const currFileIdx = i_ === -1 ? null : i_;

  // При смене файла прокручиваем редактор к текущему diff
  useEffect(() => {
    setTimeout(() => {
      // uri может быть undefined
      if (!uri) return;
      const s = commandBarService.stateOfURI[uri.fsPath];
      if (!s) return;
      const { diffIdx } = s;
      commandBarService.goToDiffIdx(diffIdx ?? 0);
    }, 50);
  }, [uri, commandBarService]);

  if (uri?.scheme !== 'file') return null; // Только file: — не встроенные виртуальные редакторы

  // Навигация и accept/reject через ISapphireCommandBarService / IEditCodeService

  const currDiffIdx = uri ? (commandBarState[uri.fsPath]?.diffIdx ?? null) : null;
  const sortedDiffIds = uri ? (commandBarState[uri.fsPath]?.sortedDiffIds ?? []) : [];

  const isADiffInThisFile = sortedDiffIds.length !== 0;
  const isADiffZoneInAnyFile = sortedCommandBarURIs.length !== 0;

  const streamState = uri ? commandBarService.getStreamState(uri) : null;
  const showAcceptRejectAll = streamState === 'idle-has-changes';

  const nextDiffIdx = commandBarService.getNextDiffIdx(1);
  const prevDiffIdx = commandBarService.getNextDiffIdx(-1);
  const nextURIIdx = commandBarService.getNextUriIdx(1);
  const prevURIIdx = commandBarService.getNextUriIdx(-1);

  const upDownDisabled = prevDiffIdx === null || nextDiffIdx === null;
  const leftRightDisabled = prevURIIdx === null || nextURIIdx === null;

  // Принять/отклонить все diff-зоны текущего файла
  const onAcceptFile = () => {
    if (!uri) return;
    editCodeService.acceptOrRejectAllDiffAreas({
      uri,
      behavior: 'accept',
      removeCtrlKs: false,
      _addToHistory: true,
    });
  };
  const onRejectFile = () => {
    if (!uri) return;
    editCodeService.acceptOrRejectAllDiffAreas({
      uri,
      behavior: 'reject',
      removeCtrlKs: false,
      _addToHistory: true,
    });
  };

  const onAcceptAll = () => {
    commandBarService.acceptOrRejectAllFiles({ behavior: 'accept' });
    setShowAcceptRejectAllButtons(false);
  };

  const onRejectAll = () => {
    commandBarService.acceptOrRejectAllFiles({ behavior: 'reject' });
    setShowAcceptRejectAllButtons(false);
  };

  const _upKeybinding = keybindingService.lookupKeybinding(SAPPHIRE_GOTO_PREV_DIFF_ACTION_ID);
  const _downKeybinding = keybindingService.lookupKeybinding(SAPPHIRE_GOTO_NEXT_DIFF_ACTION_ID);
  const _leftKeybinding = keybindingService.lookupKeybinding(SAPPHIRE_GOTO_PREV_URI_ACTION_ID);
  const _rightKeybinding = keybindingService.lookupKeybinding(SAPPHIRE_GOTO_NEXT_URI_ACTION_ID);
  const _acceptFileKeybinding = keybindingService.lookupKeybinding(SAPPHIRE_ACCEPT_FILE_ACTION_ID);
  const _rejectFileKeybinding = keybindingService.lookupKeybinding(SAPPHIRE_REJECT_FILE_ACTION_ID);
  const _acceptAllKeybinding = keybindingService.lookupKeybinding(SAPPHIRE_ACCEPT_ALL_DIFFS_ACTION_ID);
  const _rejectAllKeybinding = keybindingService.lookupKeybinding(SAPPHIRE_REJECT_ALL_DIFFS_ACTION_ID);

  const upKeybindLabel = editCodeService.processRawKeybindingText(_upKeybinding?.getLabel() || '');
  const downKeybindLabel = editCodeService.processRawKeybindingText(
    _downKeybinding?.getLabel() || '',
  );
  const leftKeybindLabel = editCodeService.processRawKeybindingText(
    _leftKeybinding?.getLabel() || '',
  );
  const rightKeybindLabel = editCodeService.processRawKeybindingText(
    _rightKeybinding?.getLabel() || '',
  );
  const acceptFileKeybindLabel = editCodeService.processRawKeybindingText(
    _acceptFileKeybinding?.getAriaLabel() || '',
  );
  const rejectFileKeybindLabel = editCodeService.processRawKeybindingText(
    _rejectFileKeybinding?.getAriaLabel() || '',
  );
  const acceptAllKeybindLabel = editCodeService.processRawKeybindingText(
    _acceptAllKeybinding?.getAriaLabel() || '',
  );
  const rejectAllKeybindLabel = editCodeService.processRawKeybindingText(
    _rejectAllKeybinding?.getAriaLabel() || '',
  );

  if (!isADiffZoneInAnyFile) return null;

  // URI не в списке pending — упрощённая панель «N файлов / Далее»
  if (currFileIdx === null) {
    return (
      <div className="pointer-events-auto">
        <div className="flex items-center bg-void-bg-1 rounded-lg shadow-lg border border-void-border-2 [&>*:first-child]:pl-3 [&>*:last-child]:pr-3 [&>*]:border-r [&>*]:border-void-border-2 [&>*:last-child]:border-r-0 overflow-hidden">
          <div className="flex items-center px-3 py-1.5">
            <span className="text-xs whitespace-nowrap text-void-fg-2">
              {`${sortedCommandBarURIs.length} file${sortedCommandBarURIs.length === 1 ? '' : 's'} changed`}
            </span>
          </div>
          <button
            className="text-xs whitespace-nowrap cursor-pointer flex items-center justify-center gap-1 bg-void-bg-2-hover text-void-fg-1 hover:bg-void-bg-2-alt h-full px-3"
            onClick={() => commandBarService.goToURIIdx(nextURIIdx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                commandBarService.goToURIIdx(nextURIIdx);
              }
            }}
          >
            Next <MoveRight className="size-3 my-1" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto">
      {/* «Принять/отклонить все» — после клика по ⋮ */}
      {showAcceptRejectAllButtons && showAcceptRejectAll && (
        <div className="flex justify-end mb-1">
          <div className="inline-flex bg-void-bg-1 rounded-lg shadow-lg border border-void-border-2 overflow-hidden">
            <div className="flex items-center gap-0.5 p-0.5">
              <AcceptAllButtonWrapper
                // text с хоткеем: Accept All + acceptAllKeybindLabel
                text="Принять все"
                data-tooltip-id="sapphire-tooltip"
                data-tooltip-content={acceptAllKeybindLabel}
                data-tooltip-delay-show={500}
                onClick={onAcceptAll}
              />
              <RejectAllButtonWrapper
                // text с хоткеем: Reject All + rejectAllKeybindLabel
                text="Отклонить все"
                data-tooltip-id="sapphire-tooltip"
                data-tooltip-content={rejectAllKeybindLabel}
                data-tooltip-delay-show={500}
                onClick={onRejectAll}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center bg-void-bg-1 rounded-lg shadow-lg border border-void-border-2 [&>*:first-child]:pl-3 [&>*:last-child]:pr-3 [&>*]:px-3 [&>*]:border-r [&>*]:border-void-border-2 [&>*:last-child]:border-r-0 overflow-hidden">
        {/* Навигация по diff в файле */}
        <div className="flex items-center py-0.5">
          <button
            className="cursor-pointer"
            disabled={upDownDisabled}
            onClick={() => commandBarService.goToDiffIdx(prevDiffIdx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                commandBarService.goToDiffIdx(prevDiffIdx);
              }
            }}
            data-tooltip-id="sapphire-tooltip"
            data-tooltip-content={`${upKeybindLabel ? `${upKeybindLabel}` : ''}`}
            data-tooltip-delay-show={500}
          >
            <MoveUp className="size-3 transition-opacity duration-200 opacity-70 hover:opacity-100" />
          </button>
          <span
            className={`text-xs whitespace-nowrap px-1 ${!isADiffInThisFile ? 'opacity-70' : ''}`}
          >
            {isADiffInThisFile
              ? `Diff ${(currDiffIdx ?? 0) + 1} of ${sortedDiffIds.length}`
              : streamState === 'streaming'
                ? 'No changes yet'
                : 'No changes'}
          </span>
          <button
            className="cursor-pointer"
            disabled={upDownDisabled}
            onClick={() => commandBarService.goToDiffIdx(nextDiffIdx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                commandBarService.goToDiffIdx(nextDiffIdx);
              }
            }}
            data-tooltip-id="sapphire-tooltip"
            data-tooltip-content={`${downKeybindLabel ? `${downKeybindLabel}` : ''}`}
            data-tooltip-delay-show={500}
          >
            <MoveDown className="size-3 transition-opacity duration-200 opacity-70 hover:opacity-100" />
          </button>
        </div>

        {/* Навигация между файлами с правками */}
        <div className="flex items-center py-0.5">
          <button
            className="cursor-pointer"
            disabled={leftRightDisabled}
            onClick={() => commandBarService.goToURIIdx(prevURIIdx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                commandBarService.goToURIIdx(prevURIIdx);
              }
            }}
            data-tooltip-id="sapphire-tooltip"
            data-tooltip-content={`${leftKeybindLabel ? `${leftKeybindLabel}` : ''}`}
            data-tooltip-delay-show={500}
          >
            <MoveLeft className="size-3 transition-opacity duration-200 opacity-70 hover:opacity-100" />
          </button>
          <span className="text-xs whitespace-nowrap px-1 mx-0.5">
            {currFileIdx !== null
              ? `File ${currFileIdx + 1} of ${sortedCommandBarURIs.length}`
              : `${sortedCommandBarURIs.length} file${sortedCommandBarURIs.length === 1 ? '' : 's'}`}
          </span>
          <button
            className="cursor-pointer"
            disabled={leftRightDisabled}
            onClick={() => commandBarService.goToURIIdx(nextURIIdx)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                commandBarService.goToURIIdx(nextURIIdx);
              }
            }}
            data-tooltip-id="sapphire-tooltip"
            data-tooltip-content={`${rightKeybindLabel ? `${rightKeybindLabel}` : ''}`}
            data-tooltip-delay-show={500}
          >
            <MoveRight className="size-3 transition-opacity duration-200 opacity-70 hover:opacity-100" />
          </button>
        </div>

        {/* Принять/отклонить файл — когда стрим завершён и есть изменения */}
        {showAcceptRejectAll && (
          <div className="flex self-stretch gap-0 !px-0 !py-0">
            <AcceptAllButtonWrapper
              // text с хоткеем Accept File
              text="Принять файл"
              data-tooltip-id="sapphire-tooltip"
              data-tooltip-content={acceptFileKeybindLabel}
              data-tooltip-delay-show={500}
              onClick={onAcceptFile}
            />
            <RejectAllButtonWrapper
              // text с хоткеем Reject File
              text="Отклонить файл"
              data-tooltip-id="sapphire-tooltip"
              data-tooltip-content={rejectFileKeybindLabel}
              data-tooltip-delay-show={500}
              onClick={onRejectFile}
            />
          </div>
        )}
        {/* Меню ⋮ — показать accept/reject all */}
        {showAcceptRejectAll && (
          <div className="!px-0 !py-0 self-stretch flex justify-center items-center">
            <div
              className="cursor-pointer px-1 self-stretch flex justify-center items-center"
              onClick={() => setShowAcceptRejectAllButtons(!showAcceptRejectAllButtons)}
            >
              <EllipsisVertical className="size-3" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

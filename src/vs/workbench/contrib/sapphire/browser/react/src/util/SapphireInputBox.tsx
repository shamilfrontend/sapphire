/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFloating, autoUpdate, offset, flip, shift, size } from '@floating-ui/react';
import { ChevronRight } from 'lucide-react';
import { useAccessor, useSettingsState } from './services.js';
import { asCssVariable } from '../../../../../../../platform/theme/common/colorUtils.js';
import {
  inputBackground,
  inputForeground,
} from '../../../../../../../platform/theme/common/colorRegistry.js';
import { StagingSelectionItem } from '../../../../common/chatThreadServiceTypes.js';
import { getOptionsAtPath, type Option } from './mentionOptions.js';
import { getSkillOptionsAtPath, type SkillMenuOption } from './skillOptions.js';

type MenuKind = 'mention' | 'skill';
type MenuOption = Option | SkillMenuOption;

const isSkillOption = (o: MenuOption): o is SkillMenuOption => 'kind' in o;

const menuOptionHasChildren = (o: MenuOption): boolean => {
  if (isSkillOption(o)) {
    return o.kind === 'category';
  }
  return !!(o.nextOptions || o.generateNextOptions);
};

export type TextAreaFns = {
  setValue: (v: string) => void;
  enable: () => void;
  disable: () => void;
};
type InputBox2Props = {
  initValue?: string | null;
  placeholder: string;
  multiline: boolean;
  enableAtToMention?: boolean;
  fnsRef?: { current: null | TextAreaFns };
  className?: string;
  onChangeText?: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  onChangeHeight?: (newHeight: number) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
};
export const SapphireInputBox2 = forwardRef<HTMLTextAreaElement, InputBox2Props>(
  (
    {
      initValue,
      placeholder,
      multiline,
      enableAtToMention,
      fnsRef,
      className,
      onKeyDown,
      onFocus,
      onBlur,
      onChangeText,
      onPaste,
    },
    ref,
  ) => {
    // Синхронизация с ref.current для controlled/uncontrolled
    const accessor = useAccessor();

    const chatThreadService = accessor.get('IChatThreadService');
    const languageService = accessor.get('ILanguageService');

    const settingsState = useSettingsState();
    const userSkills = settingsState.globalSettings.userSkills ?? [];

    const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
    const selectedOptionRef = useRef<HTMLDivElement>(null);
    const [isMenuOpen, _setIsMenuOpen] = useState(false); // выпадающее меню @ или /
    const [menuKind, setMenuKind] = useState<MenuKind | null>(null);
    const setIsMenuOpen: typeof _setIsMenuOpen = (value) => {
      if (!enableAtToMention) {
        return;
      } // @ / skills отключены в props
      _setIsMenuOpen(value);
      if (!value) {
        setMenuKind(null);
      }
    };

    // --- меню @-mentions и /skills ---
    const [optionPath, setOptionPath] = useState<string[]>([]);
    const [optionIdx, setOptionIdx] = useState<number>(0);
    const [options, setOptions] = useState<MenuOption[]>([]);
    const [optionText, setOptionText] = useState<string>('');
    const [_didLoadInitialOptions, setDidLoadInitialOptions] = useState(false);

    const currentPathRef = useRef<string>(JSON.stringify([]));
    const menuKindRef = useRef<MenuKind | null>(null);
    menuKindRef.current = menuKind;

    // Хлебные крошки скрываем на корне, пока пользователь не ввёл фильтр
    const isTypingEnabled = true;
    const isBreadcrumbsShowing = !(optionPath.length === 0 && !optionText);

    const loadMenuOptions = useCallback(
      async (kind: MenuKind, path: string[], filter: string): Promise<MenuOption[]> => {
        if (kind === 'skill') {
          return getSkillOptionsAtPath(userSkills, path, filter);
        }
        return (await getOptionsAtPath(accessor, path, filter)) || [];
      },
      [accessor, userSkills],
    );

    /** Убрать триггер (@ или /) перед курсором. */
    const removeTriggerCharAtCursor = () => {
      const textarea = textAreaRef.current;
      if (!textarea) return { textBefore: '', textAfter: '', startPos: 0 };
      const startPos = textarea.selectionStart;
      const endPos = textarea.selectionEnd;
      return {
        textBefore: textarea.value.substring(0, Math.max(0, startPos - 1)),
        textAfter: textarea.value.substring(endPos),
        startPos,
      };
    };

    const insertTextAtCursor = (_text: string) => {
      const textarea = textAreaRef.current;
      if (!textarea) return;

      textarea.focus();
      const { textBefore, textAfter } = removeTriggerCharAtCursor();
      textarea.value = textBefore + textAfter;
      const newCursorPos = textBefore.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);

      if (onChangeText) {
        onChangeText(textarea.value);
      }
      adjustHeight();
    };

    const insertSkillSlugAtCursor = (slug: string) => {
      const textarea = textAreaRef.current;
      if (!textarea) return;

      textarea.focus();
      const { textBefore, textAfter } = removeTriggerCharAtCursor();
      const insertion = `/${slug} `;
      textarea.value = textBefore + insertion + textAfter;
      const newCursorPos = textBefore.length + insertion.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);

      if (onChangeText) {
        onChangeText(textarea.value);
      }
      adjustHeight();
    };

    const onSelectOption = async () => {
      if (!options.length || !menuKind) {
        return;
      }

      const option = options[optionIdx];
      setDidLoadInitialOptions(false);

      if (isSkillOption(option)) {
        if (option.kind === 'skill') {
          setIsMenuOpen(false);
          insertSkillSlugAtCursor(option.slug);
          return;
        }
        const newPath = [...optionPath, option.category];
        currentPathRef.current = JSON.stringify(newPath);
        const newOpts = await loadMenuOptions('skill', newPath, '');
        if (currentPathRef.current !== JSON.stringify(newPath)) {
          return;
        }
        setOptionPath(newPath);
        setOptionText('');
        setOptionIdx(0);
        setOptions(newOpts);
        setDidLoadInitialOptions(true);
        return;
      }

      const newPath = [...optionPath, option.fullName];
      const isLastOption = !menuOptionHasChildren(option);
      if (isLastOption) {
        setIsMenuOpen(false);
        insertTextAtCursor(option.abbreviatedName);

        let newSelection: StagingSelectionItem;
        if (option.leafNodeType === 'File')
          newSelection = {
            type: 'File',
            uri: option.uri,
            language: languageService.guessLanguageIdByFilepathOrFirstLine(option.uri) || '',
          };
        else if (option.leafNodeType === 'Folder')
          newSelection = {
            type: 'Folder',
            uri: option.uri,
          };
        else throw new Error(`Unexpected leafNodeType ${option.leafNodeType}`);

        chatThreadService.addNewStagingSelection(newSelection);
      } else {
        currentPathRef.current = JSON.stringify(newPath);
        const newOpts = await loadMenuOptions('mention', newPath, '');
        if (currentPathRef.current !== JSON.stringify(newPath)) {
          return;
        }
        setOptionPath(newPath);
        setOptionText('');
        setOptionIdx(0);
        setOptions(newOpts);
        setDidLoadInitialOptions(true);
      }
    };

    const onRemoveOption = async () => {
      if (!menuKind) return;
      const newPath = [...optionPath.slice(0, optionPath.length - 1)];
      currentPathRef.current = JSON.stringify(newPath);
      const newOpts = await loadMenuOptions(menuKind, newPath, '');
      if (currentPathRef.current !== JSON.stringify(newPath)) {
        return;
      }
      setOptionPath(newPath);
      setOptionText('');
      setOptionIdx(0);
      setOptions(newOpts);
    };

    const onOpenOptionMenu = async (kind: MenuKind) => {
      if (!enableAtToMention) {
        return;
      }
      const newPath: string[] = [];
      currentPathRef.current = JSON.stringify([]);
      const newOpts = await loadMenuOptions(kind, [], '');
      if (currentPathRef.current !== JSON.stringify([])) {
        return;
      }
      setMenuKind(kind);
      setOptionPath(newPath);
      setOptionText('');
      setIsMenuOpen(true);
      setOptionIdx(0);
      setOptions(newOpts);
    };
    const onCloseOptionMenu = () => {
      setIsMenuOpen(false);
    };

    const onNavigateUp = (step = 1, periodic = true) => {
      if (options.length === 0) return;
      setOptionIdx((prevIdx) => {
        const newIdx = prevIdx - step;
        return periodic ? (newIdx + options.length) % options.length : Math.max(0, newIdx);
      });
    };
    const onNavigateDown = (step = 1, periodic = true) => {
      if (options.length === 0) return;
      setOptionIdx((prevIdx) => {
        const newIdx = prevIdx + step;
        return periodic ? newIdx % options.length : Math.min(options.length - 1, newIdx);
      });
    };

    const onNavigateToTop = () => {
      if (options.length === 0) return;
      setOptionIdx(0);
    };
    const onNavigateToBottom = () => {
      if (options.length === 0) return;
      setOptionIdx(options.length - 1);
    };

    const debounceTimerRef = useRef<number | null>(null);

    useEffect(
      () =>
        // Отмена debounce при размонтировании
        () => {
          if (debounceTimerRef.current !== null) {
            window.clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
          }
        },
      [],
    );

    // Debounce загрузки options; пустой фильтр — сразу
    const onPathTextChange = useCallback(
      (newStr: string) => {
        setOptionText(newStr);

        if (debounceTimerRef.current !== null) {
          window.clearTimeout(debounceTimerRef.current);
        }

        currentPathRef.current = JSON.stringify(optionPath);
        const kind = menuKindRef.current;

        const fetchOptions = async () => {
          if (!kind) return;
          const newOpts = await loadMenuOptions(kind, optionPath, newStr);
          if (currentPathRef.current !== JSON.stringify(optionPath)) {
            return;
          }
          setOptions(newOpts);
          setOptionIdx(0);
          debounceTimerRef.current = null;
        };

        // Пустой фильтр — без задержки
        if (newStr.trim() === '') {
          fetchOptions();
        } else {
          // Иначе отложенный запрос options
          debounceTimerRef.current = window.setTimeout(fetchOptions, 300);
        }
      },
      [optionPath, loadMenuOptions],
    );

    const onMenuKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isCommandKeyPressed = e.altKey || e.ctrlKey || e.metaKey;

      if (e.key === 'ArrowUp') {
        if (isCommandKeyPressed) {
          onNavigateToTop();
        } else if (e.altKey) {
          onNavigateUp(10, false);
        } else {
          onNavigateUp();
        }
      } else if (e.key === 'ArrowDown') {
        if (isCommandKeyPressed) {
          onNavigateToBottom();
        } else if (e.altKey) {
          onNavigateDown(10, false);
        } else {
          onNavigateDown();
        }
      } else if (e.key === 'ArrowLeft') {
        onRemoveOption();
      } else if (e.key === 'ArrowRight') {
        onSelectOption();
      } else if (e.key === 'Enter') {
        onSelectOption();
      } else if (e.key === 'Escape') {
        onCloseOptionMenu();
      } else if (e.key === 'Backspace') {
        if (!optionText) {
          // Текст пуст — сброс mention-меню
          if (optionPath.length === 0) {
            onCloseOptionMenu();
            return; // не preventDefault — пусть Backspace удалит символ @
          }
          onRemoveOption();
        } else if (isCommandKeyPressed) {
          // Ctrl+Backspace
          onPathTextChange('');
        } else {
          // Backspace
          onPathTextChange(optionText.slice(0, -1));
        }
      } else if (e.key.length === 1) {
        if (isCommandKeyPressed) {
          // Ctrl+буква
          // не перехватываем
        } else {
          // буква — фильтр меню
          if (isTypingEnabled) {
            onPathTextChange(optionText + e.key);
          }
        }
      }

      e.preventDefault();
      e.stopPropagation();
    };

    // Прокрутка списка к выделенному optionIdx
    useEffect(() => {
      if (isMenuOpen && selectedOptionRef.current) {
        selectedOptionRef.current.scrollIntoView({
          behavior: 'instant',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    }, [optionIdx, isMenuOpen, optionText, selectedOptionRef]);

    const measureRef = useRef<HTMLDivElement>(null);
    const gapPx = 2;
    const offsetPx = 2;
    const { x, y, strategy, refs } = useFloating({
      open: isMenuOpen,
      onOpenChange: setIsMenuOpen,
      placement: 'bottom',

      middleware: [
        offset({ mainAxis: gapPx, crossAxis: offsetPx }),
        flip({
          boundary: document.body,
          padding: 8,
        }),
        shift({
          boundary: document.body,
          padding: 8,
        }),
        size({
          apply({ elements, rects }) {
            // Ширина floating; скролл внутри списка
            Object.assign(elements.floating.style, {
              width: `${Math.max(rects.reference.width, measureRef.current?.offsetWidth ?? 0)}px`,
            });
          },
          padding: 8,
          // boundary: viewport, чтобы меню не обрезало overflow
          boundary: document.body,
        }),
      ],
      whileElementsMounted: autoUpdate,
      strategy: 'fixed',
    });
    useEffect(() => {
      if (!isMenuOpen) return;

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        const floating = refs.floating.current;
        const reference = refs.reference.current;

        // reference может быть не HTMLElement
        const isReferenceHTMLElement = reference && 'contains' in reference;

        if (
          floating &&
          (!isReferenceHTMLElement || !reference.contains(target)) &&
          !floating.contains(target)
        ) {
          setIsMenuOpen(false);
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isMenuOpen, refs.floating, refs.reference]);
    // --- конец блока @-mentions ---

    const [isEnabled, setEnabled] = useState(true);

    const adjustHeight = useCallback(() => {
      const r = textAreaRef.current;
      if (!r) return;

      r.style.height = 'auto'; // сброс высоты перед пересчётом scrollHeight

      if (r.scrollHeight === 0) return requestAnimationFrame(adjustHeight);
      const h = r.scrollHeight;
      const newHeight = Math.min(h + 1, 500); // +1 px, чтобы не мигал вертикальный скролл
      r.style.height = `${newHeight}px`;
    }, []);

    const fns: TextAreaFns = useMemo(
      () => ({
        setValue: (val) => {
          const r = textAreaRef.current;
          if (!r) return;
          r.value = val;
          onChangeText?.(r.value);
          adjustHeight();
        },
        enable: () => {
          setEnabled(true);
        },
        disable: () => {
          setEnabled(false);
        },
      }),
      [onChangeText, adjustHeight],
    );

    useEffect(() => {
      if (initValue) fns.setValue(initValue);
    }, [initValue]);

    return (
      <>
        <textarea
          autoFocus={false}
          ref={useCallback(
            (r: HTMLTextAreaElement | null) => {
              if (fnsRef) fnsRef.current = fns;

              refs.setReference(r);

              textAreaRef.current = r;
              if (typeof ref === 'function') ref(r);
              else if (ref) ref.current = r;
              adjustHeight();
            },
            [fnsRef, fns, setEnabled, adjustHeight, ref, refs],
          )}

          onFocus={onFocus}
          onBlur={onBlur}
          onPaste={onPaste}

          disabled={!isEnabled}

          className={`w-full resize-none max-h-[500px] overflow-y-auto text-void-fg-1 placeholder:text-void-fg-3 ${className}`}
          style={{
            // defaultInputBoxStyles VS Code
            background: asCssVariable(inputBackground),
            color: asCssVariable(inputForeground),
            // inputBorder: asCssVariable(inputBorder),
          }}

          onInput={useCallback(
            (event: React.FormEvent<HTMLTextAreaElement>) => {
              const latestChange = (event.nativeEvent as InputEvent).data;

              if (latestChange === '@') {
                void onOpenOptionMenu('mention');
              } else if (latestChange === '/') {
                // только в начале токена (не в путях вроде src/foo)
                const r = textAreaRef.current;
                const before = r?.value.substring(0, Math.max(0, (r.selectionStart ?? 1) - 1)) ?? '';
                if (before === '' || /[\s([{]$/.test(before)) {
                  void onOpenOptionMenu('skill');
                }
              }
            },
            [onOpenOptionMenu],
          )}

          onChange={useCallback(
            (_e: React.ChangeEvent<HTMLTextAreaElement>) => {
              const r = textAreaRef.current;
              if (!r) return;
              onChangeText?.(r.value);
              adjustHeight();
            },
            [onChangeText, adjustHeight],
          )}

          onKeyDown={useCallback(
            (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (isMenuOpen) {
                onMenuKeyDown(e);
                return;
              }

              if (e.key === 'Backspace') {
                if (
                  !e.currentTarget.value ||
                  (e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0)
                ) {
                  // Backspace на пустом/в начале — снять последний staging-чип
                  if (e.metaKey || e.ctrlKey) {
                    // Ctrl+Backspace — очистить все selections
                    chatThreadService.popStagingSelections(Number.MAX_SAFE_INTEGER);
                  } else {
                    // Backspace — снять последний чип
                    chatThreadService.popStagingSelections(1);
                  }
                  return;
                }
              }
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                if (
                  !e.currentTarget.value ||
                  (e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0)
                ) {
                  if (chatThreadService.undoStagingPop()) {
                    e.preventDefault();
                  }
                  return;
                }
              }
              if (e.key === 'Enter') {
                // Shift+Enter в multiline — новая строка
                const shouldAddNewline = e.shiftKey && multiline;
                if (!shouldAddNewline) e.preventDefault(); // Enter без Shift — submit, не newline
              }
              onKeyDown?.(e);
            },
            [onKeyDown, onMenuKeyDown, multiline, chatThreadService],
          )}

          rows={1}
          placeholder={placeholder}
        />
        {/* <div>{`idx ${optionIdx}`}</div> */}
        {isMenuOpen && (
          <div
            ref={refs.setFloating}
            className="z-[100] border-void-border-3 bg-void-bg-2-alt border rounded shadow-lg flex flex-col overflow-hidden"
            style={{
              position: strategy,
              top: y ?? 0,
              left: x ?? 0,
              width:
                refs.reference.current instanceof HTMLElement
                  ? refs.reference.current.offsetWidth
                  : 0,
            }}
            onWheel={(e) => e.stopPropagation()}
          >
            {/* Хлебные крошки пути в дереве @ */}
            {isBreadcrumbsShowing && (
              <div className="px-2 py-1 text-void-fg-1 bg-void-bg-2-alt border-b border-void-border-3 sticky top-0 bg-void-bg-1 z-10 select-none pointer-events-none">
                {optionText ? (
                  <div className="flex items-center">
                    {/* {optionPath.map((path, index) => (
								<React.Fragment key={index}>
									<span>{path}</span>
									<ChevronRight size={12} className="mx-1" />
								</React.Fragment>
							))} */}
                    <span>{optionText}</span>
                  </div>
                ) : (
                  <div className="opacity-50">Enter text to filter...</div>
                )}
              </div>
            )}

            {/* Список пунктов mention */}
            <div className="max-h-[400px] w-full max-w-full overflow-y-auto overflow-x-auto">
              <div className="w-max min-w-full flex flex-col gap-0 text-nowrap flex-nowrap">
                {options.length === 0 ? (
                  <div className="text-void-fg-3 px-3 py-0.5">No results found</div>
                ) : (
                  options.map((o, oIdx) => (
                    // Пункт меню
                    <div
                      ref={oIdx === optionIdx ? selectedOptionRef : null}
                      key={o.fullName}
                      className={`
											flex items-center gap-2
											px-3 py-1 cursor-pointer
											${oIdx === optionIdx ? 'bg-blue-500 text-white/80' : 'bg-void-bg-2-alt text-void-fg-1'}
										`}
                      onClick={() => {
                        onSelectOption();
                      }}
                      onMouseMove={() => {
                        setOptionIdx(oIdx);
                      }}
                    >
                      <o.iconInMenu size={12} />

                      <span>{o.abbreviatedName}</span>

                      {o.fullName && o.fullName !== o.abbreviatedName && (
                        <span className="opacity-60 text-sm">{o.fullName}</span>
                      )}

                      {menuOptionHasChildren(o) ? <ChevronRight size={12} /> : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </>
    );
  },
);

export const SapphireSimpleInputBox = ({
  value,
  onChangeValue,
  placeholder,
  className,
  disabled,
  passwordBlur,
  compact,
  ...inputProps
}: {
  value: string;
  onChangeValue: (value: string) => void;
  placeholder: string;
  className?: string;
  disabled?: boolean;
  compact?: boolean;
  passwordBlur?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) => {
  // Один DOM textarea между рендерами (SapphireInputBox2)
  const inputRef = useRef<HTMLInputElement>(null);

  // Восстановление selection после programmatic setValue
  const selectionRef = useRef<{ start: number | null; end: number | null }>({
    start: null,
    end: null,
  });

  // Обновление value без remount textarea
  useEffect(() => {
    const input = inputRef.current;
    if (input && input.value !== value) {
      // Запоминаем selectionStart/End
      selectionRef.current.start = input.selectionStart;
      selectionRef.current.end = input.selectionEnd;

      // Новое значение в DOM
      input.value = value;

      // Возвращаем каретку
      if (selectionRef.current.start !== null && selectionRef.current.end !== null) {
        input.setSelectionRange(selectionRef.current.start, selectionRef.current.end);
      }
    }
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChangeValue(e.target.value);
    },
    [onChangeValue],
  );

  return (
    <input
      ref={inputRef}
      defaultValue={value} // defaultValue — не remount input при каждом value из родителя
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full resize-none bg-void-bg-1 text-void-fg-1 placeholder:text-void-fg-3 border border-void-border-2 focus:border-void-border-1
				${compact ? 'py-1 px-2' : 'py-2 px-4 '}
				rounded
				${disabled ? 'opacity-50 cursor-not-allowed' : ''}
				${className}`}
      style={{
        ...(passwordBlur && { WebkitTextSecurity: 'disc' }),
        background: asCssVariable(inputBackground),
        color: asCssVariable(inputForeground),
      }}
      {...inputProps}
      type={undefined} // явный type ломает paste в webview VS Code
    />
  );
};

<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, onUnmounted, onWatcherCleanup, ref, useAttrs, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/vue';
import { ChevronRight } from 'lucide-vue-next';
import { useAccessor, useSettingsState } from './services.js';
import { asCssVariable } from '../../../../../../../platform/theme/common/colorUtils.js';
import {
  inputBackground,
  inputForeground,
} from '../../../../../../../platform/theme/common/colorRegistry.js';
import { StagingSelectionItem } from '../../../../common/chatThreadServiceTypes.js';
import { getOptionsAtPath, type Option } from './mentionOptions.js';
import { getSkillOptionsAtPath, type SkillMenuOption } from './skillOptions.js';
import { type TextAreaFns, type TextAreaFnsRef } from './SapphireInputBox.js';

type MenuKind = 'mention' | 'skill';
type MenuOption = Option | SkillMenuOption;

const isSkillOption = (o: MenuOption): o is SkillMenuOption => 'kind' in o;

const menuOptionHasChildren = (o: MenuOption): boolean => {
  if (isSkillOption(o)) {
    return o.kind === 'category';
  }
  return !!(o.nextOptions || o.generateNextOptions);
};

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    initValue?: string | null;
    placeholder: string;
    multiline: boolean;
    enableAtToMention?: boolean;
    fnsRef?: TextAreaFnsRef;
    /** Внешний mutable-ref на textarea (SidebarChat / edit). */
    textAreaRef?: { current: HTMLTextAreaElement | null };
    onChangeText?: (value: string) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    onFocus?: (e: FocusEvent) => void;
    onBlur?: (e: FocusEvent) => void;
    onPaste?: (e: ClipboardEvent) => void;
  }>(),
  {
    multiline: false,
  },
);

const emit = defineEmits<{
  changeText: [value: string];
  keydown: [e: KeyboardEvent];
  focus: [e: FocusEvent];
  blur: [e: FocusEvent];
  paste: [e: ClipboardEvent];
}>();

const attrs = useAttrs();

const accessor = useAccessor();
const chatThreadService = accessor.get('IChatThreadService');
const languageService = accessor.get('ILanguageService');

const settingsState = useSettingsState();
const userSkills = computed(() => settingsState.value.globalSettings.userSkills ?? []);

const textAreaRef = ref<HTMLTextAreaElement | null>(null);
const selectedOptionRef = ref<HTMLDivElement | null>(null);
const isMenuOpen = ref(false);
const menuKind = ref<MenuKind | null>(null);

const setIsMenuOpen = (value: boolean) => {
  if (!props.enableAtToMention) {
    return;
  } // @ / skills отключены в props
  isMenuOpen.value = value;
  if (!value) {
    menuKind.value = null;
  }
};

// --- меню @-mentions и /skills ---
const optionPath = ref<string[]>([]);
const optionIdx = ref(0);
const options = ref<MenuOption[]>([]);
const optionText = ref('');
const didLoadInitialOptions = ref(false);

const currentPathRef = ref(JSON.stringify([]));
const menuKindRef = ref<MenuKind | null>(null);
watch(menuKind, (kind) => {
  menuKindRef.value = kind;
});

// Хлебные крошки скрываем на корне, пока пользователь не ввёл фильтр
const isTypingEnabled = true;
const isBreadcrumbsShowing = computed(() => !(optionPath.value.length === 0 && !optionText.value));

const loadMenuOptions = async (
  kind: MenuKind,
  path: string[],
  filter: string,
): Promise<MenuOption[]> => {
  if (kind === 'skill') {
    return getSkillOptionsAtPath(userSkills.value, path, filter);
  }
  return (await getOptionsAtPath(accessor, path, filter)) || [];
};

const notifyChangeText = (value: string) => {
  props.onChangeText?.(value);
  emit('changeText', value);
};

const adjustHeight = () => {
  const r = textAreaRef.value;
  if (!r) return;

  r.style.height = 'auto'; // сброс высоты перед пересчётом scrollHeight

  if (r.scrollHeight === 0) {
    requestAnimationFrame(adjustHeight);
    return;
  }
  const h = r.scrollHeight;
  const newHeight = Math.min(h + 1, 500); // +1 px, чтобы не мигал вертикальный скролл
  r.style.height = `${newHeight}px`;
};

/** Убрать триггер (@ или /) перед курсором. */
const removeTriggerCharAtCursor = () => {
  const textarea = textAreaRef.value;
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
  const textarea = textAreaRef.value;
  if (!textarea) return;

  textarea.focus();
  const { textBefore, textAfter } = removeTriggerCharAtCursor();
  textarea.value = textBefore + textAfter;
  const newCursorPos = textBefore.length;
  textarea.setSelectionRange(newCursorPos, newCursorPos);

  notifyChangeText(textarea.value);
  adjustHeight();
};

const insertSkillSlugAtCursor = (slug: string) => {
  const textarea = textAreaRef.value;
  if (!textarea) return;

  textarea.focus();
  const { textBefore, textAfter } = removeTriggerCharAtCursor();
  const insertion = `/${slug} `;
  textarea.value = textBefore + insertion + textAfter;
  const newCursorPos = textBefore.length + insertion.length;
  textarea.setSelectionRange(newCursorPos, newCursorPos);

  notifyChangeText(textarea.value);
  adjustHeight();
};

const onSelectOption = async () => {
  if (!options.value.length || !menuKind.value) {
    return;
  }

  const option = options.value[optionIdx.value];
  didLoadInitialOptions.value = false;

  if (isSkillOption(option)) {
    if (option.kind === 'skill') {
      setIsMenuOpen(false);
      insertSkillSlugAtCursor(option.slug);
      return;
    }
    const newPath = [...optionPath.value, option.category];
    currentPathRef.value = JSON.stringify(newPath);
    const newOpts = await loadMenuOptions('skill', newPath, '');
    if (currentPathRef.value !== JSON.stringify(newPath)) {
      return;
    }
    optionPath.value = newPath;
    optionText.value = '';
    optionIdx.value = 0;
    options.value = newOpts;
    didLoadInitialOptions.value = true;
    return;
  }

  const newPath = [...optionPath.value, option.fullName];
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
    currentPathRef.value = JSON.stringify(newPath);
    const newOpts = await loadMenuOptions('mention', newPath, '');
    if (currentPathRef.value !== JSON.stringify(newPath)) {
      return;
    }
    optionPath.value = newPath;
    optionText.value = '';
    optionIdx.value = 0;
    options.value = newOpts;
    didLoadInitialOptions.value = true;
  }
};

const onRemoveOption = async () => {
  if (!menuKind.value) return;
  const newPath = [...optionPath.value.slice(0, optionPath.value.length - 1)];
  currentPathRef.value = JSON.stringify(newPath);
  const newOpts = await loadMenuOptions(menuKind.value, newPath, '');
  if (currentPathRef.value !== JSON.stringify(newPath)) {
    return;
  }
  optionPath.value = newPath;
  optionText.value = '';
  optionIdx.value = 0;
  options.value = newOpts;
};

const onOpenOptionMenu = async (kind: MenuKind) => {
  if (!props.enableAtToMention) {
    return;
  }
  const newPath: string[] = [];
  currentPathRef.value = JSON.stringify([]);
  const newOpts = await loadMenuOptions(kind, [], '');
  if (currentPathRef.value !== JSON.stringify([])) {
    return;
  }
  menuKind.value = kind;
  optionPath.value = newPath;
  optionText.value = '';
  setIsMenuOpen(true);
  optionIdx.value = 0;
  options.value = newOpts;
};

const onCloseOptionMenu = () => {
  setIsMenuOpen(false);
};

const onNavigateUp = (step = 1, periodic = true) => {
  if (options.value.length === 0) return;
  const prevIdx = optionIdx.value;
  const newIdx = prevIdx - step;
  optionIdx.value = periodic
    ? (newIdx + options.value.length) % options.value.length
    : Math.max(0, newIdx);
};
const onNavigateDown = (step = 1, periodic = true) => {
  if (options.value.length === 0) return;
  const prevIdx = optionIdx.value;
  const newIdx = prevIdx + step;
  optionIdx.value = periodic ? newIdx % options.value.length : Math.min(options.value.length - 1, newIdx);
};

const onNavigateToTop = () => {
  if (options.value.length === 0) return;
  optionIdx.value = 0;
};
const onNavigateToBottom = () => {
  if (options.value.length === 0) return;
  optionIdx.value = options.value.length - 1;
};

const debounceTimerRef = ref<number | null>(null);

onUnmounted(() => {
  // Отмена debounce при размонтировании
  if (debounceTimerRef.value !== null) {
    window.clearTimeout(debounceTimerRef.value);
    debounceTimerRef.value = null;
  }
});

// Debounce загрузки options; пустой фильтр — сразу
const onPathTextChange = (newStr: string) => {
  optionText.value = newStr;

  if (debounceTimerRef.value !== null) {
    window.clearTimeout(debounceTimerRef.value);
  }

  const path = optionPath.value.slice();
  currentPathRef.value = JSON.stringify(path);
  const kind = menuKindRef.value;

  const fetchOptions = async () => {
    if (!kind) return;
    const newOpts = await loadMenuOptions(kind, path, newStr);
    if (currentPathRef.value !== JSON.stringify(path)) {
      return;
    }
    options.value = newOpts;
    optionIdx.value = 0;
    debounceTimerRef.value = null;
  };

  // Пустой фильтр — без задержки
  if (newStr.trim() === '') {
    void fetchOptions();
  } else {
    // Иначе отложенный запрос options
    debounceTimerRef.value = window.setTimeout(() => {
      void fetchOptions();
    }, 300);
  }
};

const onMenuKeyDown = (e: KeyboardEvent) => {
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
    void onRemoveOption();
  } else if (e.key === 'ArrowRight') {
    void onSelectOption();
  } else if (e.key === 'Enter') {
    void onSelectOption();
  } else if (e.key === 'Escape') {
    onCloseOptionMenu();
  } else if (e.key === 'Backspace') {
    if (!optionText.value) {
      // Текст пуст — сброс mention-меню
      if (optionPath.value.length === 0) {
        onCloseOptionMenu();
        return; // не preventDefault — пусть Backspace удалит символ @
      }
      void onRemoveOption();
    } else if (isCommandKeyPressed) {
      // Ctrl+Backspace
      onPathTextChange('');
    } else {
      // Backspace
      onPathTextChange(optionText.value.slice(0, -1));
    }
  } else if (e.key.length === 1) {
    if (isCommandKeyPressed) {
      // Ctrl+буква
      // не перехватываем
    } else {
      // буква — фильтр меню
      if (isTypingEnabled) {
        onPathTextChange(optionText.value + e.key);
      }
    }
  }

  e.preventDefault();
  e.stopPropagation();
};

const bindOptionRef = (oIdx: number, el: Element | ComponentPublicInstance | null) => {
  if (oIdx !== optionIdx.value) return;
  selectedOptionRef.value = el instanceof HTMLDivElement ? el : null;
};

// Прокрутка списка к выделенному optionIdx
watch(
  [optionIdx, isMenuOpen, optionText],
  () => {
    if (isMenuOpen.value && selectedOptionRef.value) {
      selectedOptionRef.value.scrollIntoView({
        behavior: 'instant' as ScrollBehavior,
        block: 'nearest',
        inline: 'nearest',
      });
    }
  },
  { flush: 'post' },
);

const gapPx = 2;
const offsetPx = 2;
const floatingRef = ref<HTMLElement | null>(null);
// measureRef в исходнике никуда не вешался — ширина берётся у textarea
const measureRef = ref<HTMLDivElement | null>(null);
const { x, y, strategy } = useFloating(textAreaRef, floatingRef, {
  open: () => isMenuOpen.value,
  placement: 'bottom',
  strategy: 'fixed',
  transform: false,
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
          width: `${Math.max(rects.reference.width, measureRef.value?.offsetWidth ?? 0)}px`,
        });
      },
      padding: 8,
      // boundary: viewport, чтобы меню не обрезало overflow
      boundary: document.body,
    }),
  ],
  whileElementsMounted: autoUpdate,
});

const menuWidth = computed(() => {
  void x.value;
  void y.value;
  const reference = textAreaRef.value;
  return reference instanceof HTMLElement ? reference.offsetWidth : 0;
});

const hasContains = (el: unknown): el is { contains: (node: Node) => boolean } =>
  !!el && typeof el === 'object' && 'contains' in el && typeof el.contains === 'function';

watch(isMenuOpen, (open) => {
  if (!open) return;
  const handleClickOutside = (event: MouseEvent) => {
    const node = event.target instanceof Node ? event.target : null;
    const floating = floatingRef.value;
    const reference = textAreaRef.value;
    const isReferenceHTMLElement = hasContains(reference);
    if (
      floating &&
      (!isReferenceHTMLElement || !node || !reference.contains(node)) &&
      (!node || !floating.contains(node))
    ) {
      setIsMenuOpen(false);
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  onWatcherCleanup(() => {
    document.removeEventListener('mousedown', handleClickOutside);
  });
});
// --- конец блока @-mentions ---

const isEnabled = ref(true);

/** Подставить initValue в DOM. silent — без onChangeText (hydrate при mount/смене треда). */
const applyInitValue = (initValue: string | null | undefined, silent: boolean) => {
  const r = textAreaRef.value;
  if (!r) return;
  const val = initValue ?? '';
  r.value = val;
  if (!silent) {
    notifyChangeText(val);
  }
  adjustHeight();
};

const fns: TextAreaFns = {
  setValue: (val) => {
    applyInitValue(val, false);
  },
  enable: () => {
    isEnabled.value = true;
  },
  disable: () => {
    isEnabled.value = false;
  },
};

watch(
  () => props.fnsRef,
  (fnsRef) => {
    if (fnsRef) fnsRef.current = fns;
  },
  { immediate: true },
);

let ownedTextArea: HTMLTextAreaElement | null = null;

const syncExternalTextAreaRef = (el: HTMLTextAreaElement | null) => {
  ownedTextArea = el;
  if (props.textAreaRef) props.textAreaRef.current = el;
};

watch(
  textAreaRef,
  (el) => {
    if (props.fnsRef) props.fnsRef.current = fns;
    syncExternalTextAreaRef(el);
    // hydrate после mount: immediate watch initValue раньше бежал до появления ref
    if (el) {
      applyInitValue(props.initValue, true);
    } else {
      adjustHeight();
    }
  },
  { flush: 'post' },
);

onUnmounted(() => {
  if (ownedTextArea && props.textAreaRef?.current === ownedTextArea) {
    props.textAreaRef.current = null;
  }
});

// смена initValue после mount (без immediate — Vue игнорирует flush:'post' на первом вызове)
watch(
  () => props.initValue,
  (initValue) => {
    applyInitValue(initValue, true);
  },
  { flush: 'post' },
);

defineExpose({
  setValue: fns.setValue,
  enable: fns.enable,
  disable: fns.disable,
  textarea: textAreaRef,
});

const onTextAreaInput = (event: Event) => {
  const latestChange = event instanceof InputEvent ? event.data : null;

  if (latestChange === '@') {
    void onOpenOptionMenu('mention');
  } else if (latestChange === '/') {
    // только в начале токена (не в путях вроде src/foo)
    const r = textAreaRef.value;
    const before = r?.value.substring(0, Math.max(0, (r.selectionStart ?? 1) - 1)) ?? '';
    if (before === '' || /[\s([{]$/.test(before)) {
      void onOpenOptionMenu('skill');
    }
  }

  const r = textAreaRef.value;
  if (!r) return;
  notifyChangeText(r.value);
  adjustHeight();
};

const notifyKeyDown = (e: KeyboardEvent) => {
  props.onKeyDown?.(e);
  emit('keydown', e);
};

const onTextAreaKeyDown = (e: KeyboardEvent) => {
  if (isMenuOpen.value) {
    onMenuKeyDown(e);
    return;
  }

  const currentTarget = e.currentTarget;
  if (!(currentTarget instanceof HTMLTextAreaElement)) return;

  if (e.key === 'Backspace') {
    if (
      !currentTarget.value ||
      (currentTarget.selectionStart === 0 && currentTarget.selectionEnd === 0)
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
      !currentTarget.value ||
      (currentTarget.selectionStart === 0 && currentTarget.selectionEnd === 0)
    ) {
      if (chatThreadService.undoStagingPop()) {
        e.preventDefault();
      }
      return;
    }
  }
  if (e.key === 'Enter') {
    // Shift+Enter в multiline — новая строка
    const shouldAddNewline = e.shiftKey && props.multiline;
    if (!shouldAddNewline) e.preventDefault(); // Enter без Shift — submit, не newline
  }
  notifyKeyDown(e);
};

const onTextAreaFocus = (e: FocusEvent) => {
  props.onFocus?.(e);
  emit('focus', e);
};
const onTextAreaBlur = (e: FocusEvent) => {
  props.onBlur?.(e);
  emit('blur', e);
};
const onTextAreaPaste = (e: ClipboardEvent) => {
  props.onPaste?.(e);
  emit('paste', e);
};

const textAreaStyle = {
  // defaultInputBoxStyles VS Code
  background: asCssVariable(inputBackground),
  color: asCssVariable(inputForeground),
};
</script>

<template>
  <textarea
    ref="textAreaRef"
    :autofocus="false"
    :disabled="!isEnabled"
    :class="[
      'w-full resize-none max-h-[500px] overflow-y-auto text-void-fg-1 placeholder:text-void-fg-3',
      attrs.class,
    ]"
    :style="textAreaStyle"
    rows="1"
    :placeholder="placeholder"
    @focus="onTextAreaFocus"
    @blur="onTextAreaBlur"
    @paste="onTextAreaPaste"
    @input="onTextAreaInput"
    @keydown="onTextAreaKeyDown"
  />
  <div
    v-if="isMenuOpen"
    ref="floatingRef"
    class="z-[100] border-void-border-3 bg-void-bg-2-alt border rounded shadow-lg flex flex-col overflow-hidden"
    :style="{
      position: strategy,
      top: `${y ?? 0}px`,
      left: `${x ?? 0}px`,
      width: `${menuWidth}px`,
    }"
    @wheel.stop
  >
    <!-- Хлебные крошки пути в дереве @ -->
    <div
      v-if="isBreadcrumbsShowing"
      class="px-2 py-1 text-void-fg-1 bg-void-bg-2-alt border-b border-void-border-3 sticky top-0 bg-void-bg-1 z-10 select-none pointer-events-none"
    >
      <div v-if="optionText" class="flex items-center">
        <span>{{ optionText }}</span>
      </div>
      <div v-else class="opacity-50">Enter text to filter...</div>
    </div>

    <!-- Список пунктов mention -->
    <div class="max-h-[400px] w-full max-w-full overflow-y-auto overflow-x-auto">
      <div class="w-max min-w-full flex flex-col gap-0 text-nowrap flex-nowrap">
        <div v-if="options.length === 0" class="text-void-fg-3 px-3 py-0.5">No results found</div>
        <template v-else>
          <div
            v-for="(o, oIdx) in options"
            :key="o.fullName"
            :ref="(el) => bindOptionRef(oIdx, el)"
            :class="`
											flex items-center gap-2
											px-3 py-1 cursor-pointer
											${oIdx === optionIdx ? 'bg-blue-500 text-white/80' : 'bg-void-bg-2-alt text-void-fg-1'}
										`"
            @click="onSelectOption"
            @mousemove="optionIdx = oIdx"
          >
            <component :is="o.iconInMenu" :size="12" />
            <span>{{ o.abbreviatedName }}</span>
            <span v-if="o.fullName && o.fullName !== o.abbreviatedName" class="opacity-60 text-sm">
              {{ o.fullName }}
            </span>
            <ChevronRight v-if="menuOptionHasChildren(o)" :size="12" />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

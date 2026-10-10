<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref } from 'vue';
import { Plus, List, Ellipsis, Pencil, Trash2 } from 'lucide-vue-next';
import { UserRule } from '../../../../common/sapphireSettingsTypes.js';
import SapphireButtonBgDarken from '../util/SapphireButtonBgDarken.vue';
import SapphireInputBox2 from '../util/SapphireInputBox2.vue';
import SapphireSimpleInputBox from '../util/SapphireSimpleInputBox.vue';
import SapphireSwitch from '../util/SapphireSwitch.vue';
import { useAccessor, useSettingsState } from '../util/services.js';
import { generateUuid } from '../../../../../../../base/common/uuid.js';
import { UserRuleDraft } from './userRules.js';

const accessor = useAccessor();
const sapphireSettingsService = accessor.get('ISapphireSettingsService');
const settingsState = useSettingsState();
const userRules = computed(() => settingsState.value.globalSettings.userRules ?? []);

const draft = ref<UserRuleDraft | null>(null);
const menuOpenId = ref<string | null>(null);

const persistRules = (next: UserRule[]) => {
  sapphireSettingsService.setGlobalSetting('userRules', next);
};

const startCreate = () => {
  menuOpenId.value = null;
  draft.value = { id: null, name: '', content: '', enabled: true };
};

const startEdit = (rule: UserRule) => {
  menuOpenId.value = null;
  draft.value = {
    id: rule.id,
    name: rule.name,
    content: rule.content,
    enabled: rule.enabled,
  };
};

const saveDraft = () => {
  const current = draft.value;
  if (!current) return;
  const name = current.name.trim() || 'Без названия';
  const content = current.content;
  const rules = userRules.value;
  if (current.id === null) {
    const created: UserRule = {
      id: generateUuid(),
      name,
      content,
      enabled: current.enabled,
    };
    persistRules([...rules, created]);
  } else {
    persistRules(
      rules.map((r) =>
        r.id === current.id ? { ...r, name, content, enabled: current.enabled } : r,
      ),
    );
  }
  draft.value = null;
};

const deleteRule = (id: string) => {
  menuOpenId.value = null;
  if (draft.value?.id === id) draft.value = null;
  persistRules(userRules.value.filter((r) => r.id !== id));
};

const patchDraft = (next: Partial<UserRuleDraft>) => {
  if (!draft.value) return;
  draft.value = { ...draft.value, ...next };
};

const toggleMenu = (id: string) => {
  menuOpenId.value = menuOpenId.value === id ? null : id;
};
</script>

<template>
  <div
    v-if="draft"
    class="flex flex-col gap-3 p-3 rounded border border-void-border-1 bg-void-bg-1"
  >
    <div>
      <div class="text-void-fg-3 text-xs mb-1">Название</div>
      <SapphireSimpleInputBox
        :value="draft.name"
        class="w-full"
        placeholder="Например: Go style"
        @changeValue="patchDraft({ name: $event })"
      />
    </div>
    <div>
      <div class="text-void-fg-3 text-xs mb-1">Правило</div>
      <SapphireInputBox2
        :key="draft.id ?? 'new'"
        class="min-h-[120px] p-3 rounded-sm"
        :initValue="draft.content"
        placeholder="Всегда отвечай по-русски. Для Go используй стандартный layout проекта..."
        :multiline="true"
        @changeText="patchDraft({ content: $event })"
      />
    </div>
    <div class="flex items-center gap-x-2">
      <SapphireSwitch size="xs" :value="draft.enabled" @change="patchDraft({ enabled: $event })" />
      <span class="text-void-fg-3 text-xs pointer-events-none">Включено</span>
    </div>
    <div class="flex gap-2">
      <SapphireButtonBgDarken class="px-3 py-1" @click="saveDraft">Сохранить</SapphireButtonBgDarken>
      <SapphireButtonBgDarken class="px-3 py-1" @click="draft = null">Отмена</SapphireButtonBgDarken>
    </div>
  </div>

  <div v-else class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-lg text-void-fg-1">Личные правила</h3>
      <SapphireButtonBgDarken class="px-3 py-1 flex items-center gap-1" @click="startCreate">
        <Plus class="size-3.5" />
        New
      </SapphireButtonBgDarken>
    </div>
    <div class="text-void-fg-3 text-xs">
      Ваши правила добавляются ко всем AI-запросам (например, стиль Go или язык ответов).
    </div>
    <div v-if="userRules.length === 0" class="text-void-fg-3 text-sm py-3">
      Пока нет личных правил. Нажмите New, чтобы добавить.
    </div>
    <div v-else class="flex flex-col gap-1">
      <div
        v-for="rule in userRules"
        :key="rule.id"
        class="flex items-center gap-3 px-3 py-2.5 rounded border border-void-border-1 bg-void-bg-1 hover:brightness-110 cursor-pointer group"
        @click="startEdit(rule)"
      >
        <List class="size-4 text-void-fg-3 shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-sm text-void-fg-1 truncate">
            {{ rule.name || 'Без названия' }}
            <span v-if="!rule.enabled" class="ml-2 text-void-fg-3 text-xs">(выкл.)</span>
          </div>
          <div class="text-xs text-void-fg-3">User Rule</div>
        </div>
        <div class="relative shrink-0" @click.stop>
          <button
            type="button"
            class="p-1 rounded text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2"
            aria-label="Действия"
            @click="toggleMenu(rule.id)"
          >
            <Ellipsis class="size-4" />
          </button>
          <div
            v-if="menuOpenId === rule.id"
            class="absolute right-0 top-full mt-1 z-10 min-w-[140px] rounded border border-void-border-1 bg-void-bg-2 shadow-md py-1"
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-void-fg-1 hover:bg-void-bg-1 text-left"
              @click="startEdit(rule)"
            >
              <Pencil class="size-3.5" />
              Редактировать
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-void-fg-1 hover:bg-void-bg-1 text-left"
              @click="deleteRule(rule.id)"
            >
              <Trash2 class="size-3.5" />
              Удалить
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

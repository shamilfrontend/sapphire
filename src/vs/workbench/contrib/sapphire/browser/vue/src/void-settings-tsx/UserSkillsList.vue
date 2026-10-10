<script setup lang="ts">
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { computed, ref } from 'vue';
import { Plus, List, Ellipsis, Pencil, Trash2 } from 'lucide-vue-next';
import {
  normalizeUserSkill,
  slugifySkillName,
  UserSkill,
} from '../../../../common/sapphireSettingsTypes.js';
import SapphireButtonBgDarken from '../util/SapphireButtonBgDarken.vue';
import SapphireInputBox2 from '../util/SapphireInputBox2.vue';
import SapphireSimpleInputBox from '../util/SapphireSimpleInputBox.vue';
import SapphireSwitch from '../util/SapphireSwitch.vue';
import { useAccessor, useSettingsState } from '../util/services.js';
import { generateUuid } from '../../../../../../../base/common/uuid.js';
import { UserSkillDraft } from './userSkills.js';

const accessor = useAccessor();
const sapphireSettingsService = accessor.get('ISapphireSettingsService');
const settingsState = useSettingsState();
const userSkills = computed(() => settingsState.value.globalSettings.userSkills ?? []);

const draft = ref<UserSkillDraft | null>(null);
const menuOpenId = ref<string | null>(null);

const persistSkills = (next: UserSkill[]) => {
  sapphireSettingsService.setGlobalSetting(
    'userSkills',
    next.map((s) => normalizeUserSkill(s)),
  );
};

const startCreate = () => {
  menuOpenId.value = null;
  draft.value = {
    id: null,
    name: '',
    content: '',
    enabled: false,
    slug: '',
    category: 'custom',
  };
};

const startEdit = (skill: UserSkill) => {
  menuOpenId.value = null;
  const n = normalizeUserSkill(skill);
  draft.value = {
    id: n.id,
    name: n.name,
    content: n.content,
    enabled: n.enabled,
    slug: n.slug,
    category: n.category,
  };
};

const saveDraft = () => {
  const current = draft.value;
  if (!current) return;
  const name = current.name.trim() || 'Без названия';
  const content = current.content;
  const base = normalizeUserSkill({
    id: current.id ?? generateUuid(),
    name,
    content,
    enabled: current.enabled,
    slug: current.slug || slugifySkillName(name),
    category: current.category || 'custom',
  });
  const skills = userSkills.value;
  if (current.id === null) {
    persistSkills([...skills, base]);
  } else {
    persistSkills(skills.map((s) => (s.id === current.id ? base : s)));
  }
  draft.value = null;
};

const deleteSkill = (id: string) => {
  menuOpenId.value = null;
  if (draft.value?.id === id) draft.value = null;
  persistSkills(userSkills.value.filter((s) => s.id !== id));
};

const patchDraft = (next: Partial<UserSkillDraft>) => {
  if (!draft.value) return;
  draft.value = { ...draft.value, ...next };
};

const onNameChange = (name: string) => {
  const current = draft.value;
  if (!current) return;
  draft.value = {
    ...current,
    name,
    slug: current.id === null ? slugifySkillName(name) : current.slug,
  };
};

const onSlugChange = (slug: string) => {
  patchDraft({
    slug: slug.trim().toLowerCase().replace(/^\/+/, '').replace(/\s+/g, '-'),
  });
};

const onCategoryChange = (category: string) => {
  patchDraft({
    category: category.trim().toLowerCase() || 'custom',
  });
};

const toggleMenu = (id: string) => {
  menuOpenId.value = menuOpenId.value === id ? null : id;
};

const normalizedSkills = computed(() => userSkills.value.map((skill) => normalizeUserSkill(skill)));
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
        placeholder="Например: Лендинг"
        @changeValue="onNameChange"
      />
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <div class="text-void-fg-3 text-xs mb-1">Команда (/slug)</div>
        <SapphireSimpleInputBox
          :value="draft.slug"
          class="w-full"
          placeholder="design-landing"
          @changeValue="onSlugChange"
        />
      </div>
      <div>
        <div class="text-void-fg-3 text-xs mb-1">Категория</div>
        <SapphireSimpleInputBox
          :value="draft.category"
          class="w-full"
          placeholder="design"
          @changeValue="onCategoryChange"
        />
      </div>
    </div>
    <div>
      <div class="text-void-fg-3 text-xs mb-1">Скилл</div>
      <SapphireInputBox2
        :key="draft.id ?? 'new'"
        class="min-h-[120px] p-3 rounded-sm"
        :initValue="draft.content"
        placeholder="Пошаговая инструкция: как делать code review, какие проверки запускать..."
        :multiline="true"
        @changeText="patchDraft({ content: $event })"
      />
    </div>
    <div class="flex items-center gap-x-2">
      <SapphireSwitch
        size="xs"
        :value="draft.enabled"
        @change="patchDraft({ enabled: $event })"
      />
      <span class="text-void-fg-3 text-xs pointer-events-none">Always on (в каждый запрос)</span>
    </div>
    <div class="flex gap-2">
      <SapphireButtonBgDarken class="px-3 py-1" @click="saveDraft">Сохранить</SapphireButtonBgDarken>
      <SapphireButtonBgDarken class="px-3 py-1" @click="draft = null">Отмена</SapphireButtonBgDarken>
    </div>
  </div>

  <div v-else class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-lg text-void-fg-1">Скиллы</h3>
      <SapphireButtonBgDarken class="px-3 py-1 flex items-center gap-1" @click="startCreate">
        <Plus class="size-3.5" />
        New
      </SapphireButtonBgDarken>
    </div>
    <div class="text-void-fg-3 text-xs">
      В чате введите <code class="text-void-fg-2">/</code>, чтобы выбрать скилл (например
      <code class="text-void-fg-2">/design-landing</code>). Always on — добавлять скилл ко всем
      запросам без слэша.
    </div>
    <div v-if="userSkills.length === 0" class="text-void-fg-3 text-sm py-3">
      Пока нет скиллов. Нажмите New, чтобы добавить.
    </div>
    <div v-else class="flex flex-col gap-1">
      <div
        v-for="n in normalizedSkills"
        :key="n.id"
        class="flex items-center gap-3 px-3 py-2.5 rounded border border-void-border-1 bg-void-bg-1 hover:brightness-110 cursor-pointer group"
        @click="startEdit(n)"
      >
        <List class="size-4 text-void-fg-3 shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-sm text-void-fg-1 truncate">
            {{ n.name || 'Без названия' }}
            <span v-if="n.enabled" class="ml-2 text-void-fg-3 text-xs">always on</span>
            <span v-else class="ml-2 text-void-fg-3 text-xs">только /</span>
          </div>
          <div class="text-xs text-void-fg-3 truncate">
            /{{ n.slug }}<template v-if="n.category"> · {{ n.category }}</template>
          </div>
        </div>
        <div class="relative shrink-0" @click.stop>
          <button
            type="button"
            class="p-1 rounded text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2"
            aria-label="Действия"
            @click="toggleMenu(n.id)"
          >
            <Ellipsis class="size-4" />
          </button>
          <div
            v-if="menuOpenId === n.id"
            class="absolute right-0 top-full mt-1 z-10 min-w-[140px] rounded border border-void-border-1 bg-void-bg-2 shadow-md py-1"
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-void-fg-1 hover:bg-void-bg-1 text-left"
              @click="startEdit(n)"
            >
              <Pencil class="size-3.5" />
              Редактировать
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-void-fg-1 hover:bg-void-bg-1 text-left"
              @click="deleteSkill(n.id)"
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

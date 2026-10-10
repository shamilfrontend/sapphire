/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useState } from 'react';
import { Plus, List, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import {
  normalizeUserSkill,
  slugifySkillName,
  UserSkill,
} from '../../../../common/sapphireSettingsTypes.js';
import {
  SapphireButtonBgDarken,
  SapphireInputBox2,
  SapphireSimpleInputBox,
  SapphireSwitch,
} from '../util/inputs.js';
import { useAccessor, useSettingsState } from '../util/services.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../../base/common/buffer.js';
import { generateUuid } from '../../../../../../../base/common/uuid.js';
import Severity from '../../../../../../../base/common/severity.js';

type UserSkillDraft = {
  id: string | null; // null — создание нового скилла, не редактирование
  name: string;
  content: string;
  enabled: boolean;
  slug: string;
  category: string;
};

const UserSkillEditor = ({
  draft,
  onChangeDraft,
  onSave,
  onCancel,
}: {
  draft: UserSkillDraft;
  onChangeDraft: (next: UserSkillDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) => {
  return (
    <div className="flex flex-col gap-3 p-3 rounded border border-void-border-1 bg-void-bg-1">
      <div>
        <div className="text-void-fg-3 text-xs mb-1">Название</div>
        <SapphireSimpleInputBox
          value={draft.name}
          onChangeValue={(name) =>
            onChangeDraft({
              ...draft,
              name,
              slug: draft.id === null ? slugifySkillName(name) : draft.slug,
            })
          }
          placeholder="Например: Лендинг"
          className="w-full"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-void-fg-3 text-xs mb-1">Команда (/slug)</div>
          <SapphireSimpleInputBox
            value={draft.slug}
            onChangeValue={(slug) =>
              onChangeDraft({
                ...draft,
                slug: slug.trim().toLowerCase().replace(/^\/+/, '').replace(/\s+/g, '-'),
              })
            }
            placeholder="design-landing"
            className="w-full"
          />
        </div>
        <div>
          <div className="text-void-fg-3 text-xs mb-1">Категория</div>
          <SapphireSimpleInputBox
            value={draft.category}
            onChangeValue={(category) =>
              onChangeDraft({
                ...draft,
                category: category.trim().toLowerCase() || 'custom',
              })
            }
            placeholder="design"
            className="w-full"
          />
        </div>
      </div>
      <div>
        <div className="text-void-fg-3 text-xs mb-1">Скилл</div>
        <SapphireInputBox2
          key={draft.id ?? 'new'}
          className="min-h-[120px] p-3 rounded-sm"
          initValue={draft.content}
          placeholder="Пошаговая инструкция: как делать code review, какие проверки запускать..."
          multiline
          onChangeText={(content) => onChangeDraft({ ...draft, content })}
        />
      </div>
      <div className="flex items-center gap-x-2">
        <SapphireSwitch
          size="xs"
          value={draft.enabled}
          onChange={(enabled) => onChangeDraft({ ...draft, enabled })}
        />
        <span className="text-void-fg-3 text-xs pointer-events-none">
          Always on (в каждый запрос)
        </span>
      </div>
      <div className="flex gap-2">
        <SapphireButtonBgDarken className="px-3 py-1" onClick={onSave}>
          Сохранить
        </SapphireButtonBgDarken>
        <SapphireButtonBgDarken className="px-3 py-1" onClick={onCancel}>
          Отмена
        </SapphireButtonBgDarken>
      </div>
    </div>
  );
};

export const UserSkillsList = () => {
  const accessor = useAccessor();
  const sapphireSettingsService = accessor.get('ISapphireSettingsService');
  const settingsState = useSettingsState();
  const userSkills = settingsState.globalSettings.userSkills ?? [];

  const [draft, setDraft] = useState<UserSkillDraft | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const persistSkills = useCallback(
    (next: UserSkill[]) => {
      sapphireSettingsService.setGlobalSetting(
        'userSkills',
        next.map((s) => normalizeUserSkill(s)),
      );
    },
    [sapphireSettingsService],
  );

  const startCreate = () => {
    setMenuOpenId(null);
    setDraft({
      id: null,
      name: '',
      content: '',
      enabled: false,
      slug: '',
      category: 'custom',
    });
  };

  const startEdit = (skill: UserSkill) => {
    setMenuOpenId(null);
    const n = normalizeUserSkill(skill);
    setDraft({
      id: n.id,
      name: n.name,
      content: n.content,
      enabled: n.enabled,
      slug: n.slug,
      category: n.category,
    });
  };

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim() || 'Без названия';
    const content = draft.content;
    const base = normalizeUserSkill({
      id: draft.id ?? generateUuid(),
      name,
      content,
      enabled: draft.enabled,
      slug: draft.slug || slugifySkillName(name),
      category: draft.category || 'custom',
    });
    if (draft.id === null) {
      persistSkills([...userSkills, base]);
    } else {
      persistSkills(userSkills.map((s) => (s.id === draft.id ? base : s)));
    }
    setDraft(null);
  };

  const deleteSkill = (id: string) => {
    setMenuOpenId(null);
    if (draft?.id === id) setDraft(null);
    persistSkills(userSkills.filter((s) => s.id !== id));
  };

  if (draft) {
    return (
      <UserSkillEditor
        draft={draft}
        onChangeDraft={setDraft}
        onSave={saveDraft}
        onCancel={() => setDraft(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg text-void-fg-1">Скиллы</h3>
        <SapphireButtonBgDarken className="px-3 py-1 flex items-center gap-1" onClick={startCreate}>
          <Plus className="size-3.5" />
          New
        </SapphireButtonBgDarken>
      </div>
      <div className="text-void-fg-3 text-xs">
        В чате введите <code className="text-void-fg-2">/</code>, чтобы выбрать скилл (например{' '}
        <code className="text-void-fg-2">/design-landing</code>). Always on — добавлять скилл ко
        всем запросам без слэша.
      </div>
      {userSkills.length === 0 ? (
        <div className="text-void-fg-3 text-sm py-3">
          Пока нет скиллов. Нажмите New, чтобы добавить.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {userSkills.map((skill) => {
            const n = normalizeUserSkill(skill);
            return (
              <div
                key={n.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded border border-void-border-1 bg-void-bg-1 hover:brightness-110 cursor-pointer group"
                onClick={() => startEdit(n)}
              >
                <List className="size-4 text-void-fg-3 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-void-fg-1 truncate">
                    {n.name || 'Без названия'}
                    {n.enabled ? (
                      <span className="ml-2 text-void-fg-3 text-xs">always on</span>
                    ) : (
                      <span className="ml-2 text-void-fg-3 text-xs">только /</span>
                    )}
                  </div>
                  <div className="text-xs text-void-fg-3 truncate">
                    /{n.slug}
                    {n.category ? ` · ${n.category}` : ''}
                  </div>
                </div>
                <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="p-1 rounded text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2"
                    onClick={() => setMenuOpenId(menuOpenId === n.id ? null : n.id)}
                    aria-label="Действия"
                  >
                    <Ellipsis className="size-4" />
                  </button>
                  {menuOpenId === n.id ? (
                    <div className="absolute right-0 top-full mt-1 z-10 min-w-[140px] rounded border border-void-border-1 bg-void-bg-2 shadow-md py-1">
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-void-fg-1 hover:bg-void-bg-1 text-left"
                        onClick={() => startEdit(n)}
                      >
                        <Pencil className="size-3.5" />
                        Редактировать
                      </button>
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-void-fg-1 hover:bg-void-bg-1 text-left"
                        onClick={() => deleteSkill(n.id)}
                      >
                        <Trash2 className="size-3.5" />
                        Удалить
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const revealSapphireSkillsFile = async (accessor: ReturnType<typeof useAccessor>) => {
  const workspaceContextService = accessor.get('IWorkspaceContextService');
  const fileService = accessor.get('IFileService');
  const commandService = accessor.get('ICommandService');
  const notificationService = accessor.get('INotificationService');
  const sapphireModelService = accessor.get('ISapphireModelService');

  const folders = workspaceContextService.getWorkspace().folders;
  if (folders.length === 0) {
    notificationService.notify({
      severity: Severity.Warning,
      message: 'Откройте папку workspace, чтобы создать или редактировать .skills.',
    });
    return;
  }

  const uri = URI.joinPath(folders[0].uri, '.skills');
  const legacyUri = URI.joinPath(folders[0].uri, '.voidskills');
  try {
    const exists = await fileService.exists(uri);
    if (!exists) {
      if (await fileService.exists(legacyUri)) {
        await fileService.move(legacyUri, uri);
      } else {
        await fileService.writeFile(uri, VSBuffer.fromString(''));
      }
    }
  } catch (e) {
    console.error('Error ensuring .skills exists:', e);
  }
  await sapphireModelService.initializeModel(uri);
  await commandService.executeCommand('vscode.open', uri);
};

/** @deprecated use revealSapphireSkillsFile */
export const revealVoidSkillsFile = revealSapphireSkillsFile;

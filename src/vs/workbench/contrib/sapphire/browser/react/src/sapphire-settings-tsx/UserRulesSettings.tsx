/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useState } from 'react';
import { Plus, List, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { UserRule } from '../../../../common/sapphireSettingsTypes.js';
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

type UserRuleDraft = {
  id: string | null; // null — создание нового правила, не редактирование
  name: string;
  content: string;
  enabled: boolean;
};

const UserRuleEditor = ({
  draft,
  onChangeDraft,
  onSave,
  onCancel,
}: {
  draft: UserRuleDraft;
  onChangeDraft: (next: UserRuleDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) => {
  return (
    <div className="flex flex-col gap-3 p-3 rounded border border-void-border-1 bg-void-bg-1">
      <div>
        <div className="text-void-fg-3 text-xs mb-1">Название</div>
        <SapphireSimpleInputBox
          value={draft.name}
          onChangeValue={(name) => onChangeDraft({ ...draft, name })}
          placeholder="Например: Go style"
          className="w-full"
        />
      </div>
      <div>
        <div className="text-void-fg-3 text-xs mb-1">Правило</div>
        <SapphireInputBox2
          key={draft.id ?? 'new'}
          className="min-h-[120px] p-3 rounded-sm"
          initValue={draft.content}
          placeholder="Всегда отвечай по-русски. Для Go используй стандартный layout проекта..."
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
        <span className="text-void-fg-3 text-xs pointer-events-none">Включено</span>
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

export const UserRulesList = () => {
  const accessor = useAccessor();
  const sapphireSettingsService = accessor.get('ISapphireSettingsService');
  const settingsState = useSettingsState();
  const userRules = settingsState.globalSettings.userRules ?? [];

  const [draft, setDraft] = useState<UserRuleDraft | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const persistRules = useCallback(
    (next: UserRule[]) => {
      sapphireSettingsService.setGlobalSetting('userRules', next);
    },
    [sapphireSettingsService],
  );

  const startCreate = () => {
    setMenuOpenId(null);
    setDraft({ id: null, name: '', content: '', enabled: true });
  };

  const startEdit = (rule: UserRule) => {
    setMenuOpenId(null);
    setDraft({
      id: rule.id,
      name: rule.name,
      content: rule.content,
      enabled: rule.enabled,
    });
  };

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim() || 'Без названия';
    const content = draft.content;
    if (draft.id === null) {
      const created: UserRule = {
        id: generateUuid(),
        name,
        content,
        enabled: draft.enabled,
      };
      persistRules([...userRules, created]);
    } else {
      persistRules(
        userRules.map((r) =>
          r.id === draft.id ? { ...r, name, content, enabled: draft.enabled } : r,
        ),
      );
    }
    setDraft(null);
  };

  const deleteRule = (id: string) => {
    setMenuOpenId(null);
    if (draft?.id === id) setDraft(null);
    persistRules(userRules.filter((r) => r.id !== id));
  };

  if (draft) {
    return (
      <UserRuleEditor
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
        <h3 className="text-lg text-void-fg-1">Личные правила</h3>
        <SapphireButtonBgDarken className="px-3 py-1 flex items-center gap-1" onClick={startCreate}>
          <Plus className="size-3.5" />
          New
        </SapphireButtonBgDarken>
      </div>
      <div className="text-void-fg-3 text-xs">
        Ваши правила добавляются ко всем AI-запросам (например, стиль Go или язык ответов).
      </div>
      {userRules.length === 0 ? (
        <div className="text-void-fg-3 text-sm py-3">
          Пока нет личных правил. Нажмите New, чтобы добавить.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {userRules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded border border-void-border-1 bg-void-bg-1 hover:brightness-110 cursor-pointer group"
              onClick={() => startEdit(rule)}
            >
              <List className="size-4 text-void-fg-3 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-void-fg-1 truncate">
                  {rule.name || 'Без названия'}
                  {!rule.enabled ? (
                    <span className="ml-2 text-void-fg-3 text-xs">(выкл.)</span>
                  ) : null}
                </div>
                <div className="text-xs text-void-fg-3">User Rule</div>
              </div>
              <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="p-1 rounded text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2"
                  onClick={() => setMenuOpenId(menuOpenId === rule.id ? null : rule.id)}
                  aria-label="Действия"
                >
                  <Ellipsis className="size-4" />
                </button>
                {menuOpenId === rule.id ? (
                  <div className="absolute right-0 top-full mt-1 z-10 min-w-[140px] rounded border border-void-border-1 bg-void-bg-2 shadow-md py-1">
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-void-fg-1 hover:bg-void-bg-1 text-left"
                      onClick={() => startEdit(rule)}
                    >
                      <Pencil className="size-3.5" />
                      Редактировать
                    </button>
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-void-fg-1 hover:bg-void-bg-1 text-left"
                      onClick={() => deleteRule(rule.id)}
                    >
                      <Trash2 className="size-3.5" />
                      Удалить
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const revealSapphireRulesFile = async (accessor: ReturnType<typeof useAccessor>) => {
  const workspaceContextService = accessor.get('IWorkspaceContextService');
  const fileService = accessor.get('IFileService');
  const commandService = accessor.get('ICommandService');
  const notificationService = accessor.get('INotificationService');
  const sapphireModelService = accessor.get('ISapphireModelService');

  const folders = workspaceContextService.getWorkspace().folders;
  if (folders.length === 0) {
    notificationService.notify({
      severity: Severity.Warning,
      message: 'Откройте папку workspace, чтобы создать или редактировать .rules.',
    });
    return;
  }

  const uri = URI.joinPath(folders[0].uri, '.rules');
  const legacyUri = URI.joinPath(folders[0].uri, '.voidrules');
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
    console.error('Error ensuring .rules exists:', e);
  }
  await sapphireModelService.initializeModel(uri);
  await commandService.executeCommand('vscode.open', uri);
};

/** @deprecated use revealSapphireRulesFile */
export const revealVoidRulesFile = revealSapphireRulesFile;

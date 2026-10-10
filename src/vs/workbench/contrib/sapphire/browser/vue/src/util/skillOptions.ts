/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { LucideIcon } from 'lucide-vue-next';
import { Folder, Sparkles } from 'lucide-vue-next';
import { UserSkill } from '../../../../common/sapphireSettingsTypes.js';

type Icon = LucideIcon;

export type SkillMenuOption = {
  fullName: string;
  abbreviatedName: string;
  iconInMenu: Icon;
} & (
  | { kind: 'category'; category: string; nextOptions: SkillMenuOption[] }
  | { kind: 'skill'; slug: string }
);

const isSubsequence = (text: string, pattern: string): boolean => {
  text = text.toLowerCase();
  pattern = pattern.toLowerCase();
  if (pattern === '') return true;
  if (text === '') return false;
  let ti = 0;
  for (let pi = 0; pi < pattern.length; pi++) {
    while (ti < text.length && text[ti] !== pattern[pi]) ti++;
    if (ti >= text.length) return false;
    ti++;
  }
  return true;
};

const categoryLabel = (category: string): string => {
  if (category === 'design') return 'Design';
  if (category === 'office') return 'Office';
  if (category === 'custom') return 'Custom';
  return category.charAt(0).toUpperCase() + category.slice(1);
};

/** Корневые категории → скиллы; фильтр по slug/name/category. */
export const getSkillOptionsAtPath = (
  skills: UserSkill[],
  path: string[],
  optionText: string,
): SkillMenuOption[] => {
  const usable = skills.filter((s) => s.slug?.trim() && s.content?.trim());
  if (!usable.length) return [];

  const byCategory = new Map<string, UserSkill[]>();
  for (const s of usable) {
    const cat = (s.category || 'custom').toLowerCase();
    const list = byCategory.get(cat) ?? [];
    list.push(s);
    byCategory.set(cat, list);
  }

  const skillLeaf = (s: UserSkill): SkillMenuOption => ({
    kind: 'skill',
    slug: s.slug,
    fullName: `${s.slug} ${s.name}`,
    abbreviatedName: `/${s.slug}`,
    iconInMenu: Sparkles,
  });

  const filter = optionText.trim().toLowerCase();

  // Корень: при фильтре — плоский список скиллов (+ категории по имени)
  if (path.length === 0) {
    if (filter) {
      const flat: SkillMenuOption[] = [];
      for (const s of usable) {
        const hay = `${s.slug} ${s.name} ${s.category}`.toLowerCase();
        if (isSubsequence(hay, filter) || hay.includes(filter)) {
          flat.push(skillLeaf(s));
        }
      }
      // точное совпадение категории → все её скиллы
      if (byCategory.has(filter)) {
        for (const s of byCategory.get(filter)!) {
          if (!flat.some((o) => o.kind === 'skill' && o.slug === s.slug)) {
            flat.push(skillLeaf(s));
          }
        }
      }
      return flat;
    }

    return [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, list]) => ({
        kind: 'category' as const,
        category,
        fullName: category,
        abbreviatedName: `/${category}`,
        iconInMenu: Folder,
        nextOptions: list.map(skillLeaf),
      }));
  }

  // Внутри категории
  const category = path[0]?.toLowerCase();
  const list = byCategory.get(category) ?? [];
  return list
    .map(skillLeaf)
    .filter((o) => {
      if (!filter) return true;
      return isSubsequence(o.fullName.toLowerCase(), filter) || o.fullName.toLowerCase().includes(filter);
    });
};

export const skillCategoryBreadcrumb = (category: string): string => categoryLabel(category);

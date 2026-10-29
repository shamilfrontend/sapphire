/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
  defaultUserSkills,
  mergeShippedUserSkills,
  normalizeUserSkill,
  parseSlashSkillSlugs,
  SAPPHIRE_DEFAULT_SKILL_DASHBOARD_ID,
  SAPPHIRE_DEFAULT_SKILL_LANDING_ID,
  resolveSkillContentsBySlugs,
  skillInstructionsForUserText,
  skillInstructionsFromUserSkills,
  UserSkill,
} from '../../common/sapphireSettingsTypes.js';

suite('UserSkills', () => {
  ensureNoDisposablesAreLeakedInTestSuite();

  const sampleCustom = (): UserSkill =>
    normalizeUserSkill({
      id: 'custom-1',
      name: 'My Review',
      content: 'review carefully',
      enabled: true,
      slug: 'my-review',
      category: 'custom',
    });

  test('mergeShippedUserSkills seeds into empty list', () => {
    const next = mergeShippedUserSkills([]);
    assert.strictEqual(next.length, defaultUserSkills.length);
    assert.ok(next.some((s) => s.id === SAPPHIRE_DEFAULT_SKILL_LANDING_ID));
    assert.ok(next.some((s) => s.id === SAPPHIRE_DEFAULT_SKILL_DASHBOARD_ID));
    assert.strictEqual(next.find((s) => s.id === SAPPHIRE_DEFAULT_SKILL_LANDING_ID)?.enabled, false);
  });

  test('mergeShippedUserSkills re-seeds deleted shipped skill', () => {
    const onlyCustom = [sampleCustom()];
    const next = mergeShippedUserSkills(onlyCustom);
    assert.ok(next.some((s) => s.id === SAPPHIRE_DEFAULT_SKILL_LANDING_ID));
    assert.ok(next.some((s) => s.id === 'custom-1'));
    assert.strictEqual(next[0].id, SAPPHIRE_DEFAULT_SKILL_LANDING_ID);
  });

  test('mergeShippedUserSkills keeps enabled, refreshes content', () => {
    const existing: UserSkill[] = [
      {
        id: SAPPHIRE_DEFAULT_SKILL_LANDING_ID,
        name: 'Old',
        content: 'stale',
        enabled: true,
        slug: 'wrong',
        category: 'x',
      },
    ];
    const next = mergeShippedUserSkills(existing);
    const landing = next.find((s) => s.id === SAPPHIRE_DEFAULT_SKILL_LANDING_ID)!;
    assert.strictEqual(landing.enabled, true);
    assert.strictEqual(landing.slug, 'design-landing');
    assert.strictEqual(landing.category, 'design');
    assert.ok(landing.content.includes('Когда применять'));
    assert.notStrictEqual(landing.content, 'stale');
  });

  test('mergeShippedUserSkills remaps legacy PPR skill ids and keeps enabled', () => {
    const existing: UserSkill[] = [
      {
        id: 'ppr-default-skill-landing',
        name: 'Old',
        content: 'stale',
        enabled: true,
        slug: 'wrong',
        category: 'x',
      },
      {
        id: 'ppr-default-skill-dashboard',
        name: 'Old Dash',
        content: 'stale',
        enabled: false,
        slug: 'wrong',
        category: 'x',
      },
    ];
    const next = mergeShippedUserSkills(existing);
    assert.ok(!next.some((s) => s.id.startsWith('ppr-default-skill-')));
    const landing = next.find((s) => s.id === SAPPHIRE_DEFAULT_SKILL_LANDING_ID)!;
    const dashboard = next.find((s) => s.id === SAPPHIRE_DEFAULT_SKILL_DASHBOARD_ID)!;
    assert.strictEqual(landing.enabled, true);
    assert.strictEqual(dashboard.enabled, false);
    assert.strictEqual(landing.slug, 'design-landing');
    assert.strictEqual(dashboard.slug, 'design-dashboard');
  });

  test('mergeShippedUserSkills preserves unrelated skills', () => {
    const custom = sampleCustom();
    const next = mergeShippedUserSkills([custom]);
    assert.ok(next.some((s) => s.id === 'custom-1' && s.content === 'review carefully'));
  });

  test('normalizeUserSkill fills slug/category for legacy skills', () => {
    const n = normalizeUserSkill({
      id: 'legacy',
      name: 'Hello World',
      content: 'x',
      enabled: false,
    } as UserSkill);
    assert.ok(n.slug.length > 0);
    assert.strictEqual(n.category, 'custom');
  });

  test('parseSlashSkillSlugs extracts unique slugs', () => {
    assert.deepStrictEqual(parseSlashSkillSlugs('/design-landing сделай hero'), [
      'design-landing',
    ]);
    assert.deepStrictEqual(
      parseSlashSkillSlugs('/design-landing and /design-dashboard /design-landing'),
      ['design-landing', 'design-dashboard'],
    );
    assert.deepStrictEqual(parseSlashSkillSlugs('path/to/file and http://x'), []);
    assert.deepStrictEqual(parseSlashSkillSlugs('see (/design-landing)'), ['design-landing']);
  });

  test('resolveSkillContentsBySlugs ignores unknown and resolves category', () => {
    const skills = mergeShippedUserSkills([]);
    assert.strictEqual(resolveSkillContentsBySlugs(skills, ['nope']), '');
    const bySlug = resolveSkillContentsBySlugs(skills, ['design-landing']);
    assert.ok(bySlug.includes('Когда применять'));
    assert.ok(bySlug.includes('лендинг') || bySlug.includes('Лендинг') || bySlug.includes('hero'));
    const byCategory = resolveSkillContentsBySlugs(skills, ['design']);
    assert.ok(byCategory.length > bySlug.length);
    assert.ok(byCategory.includes('KPI'));
  });

  test('skillInstructionsFromUserSkills only always-on', () => {
    const skills = mergeShippedUserSkills([]);
    assert.strictEqual(skillInstructionsFromUserSkills(skills), '');
    const withOn = skills.map((s) =>
      s.id === SAPPHIRE_DEFAULT_SKILL_LANDING_ID ? { ...s, enabled: true } : s,
    );
    const text = skillInstructionsFromUserSkills(withOn);
    assert.ok(text.includes('Когда применять'));
    assert.ok(!text.includes('KPI'));
  });

  test('skillInstructionsForUserText merges always-on and slash', () => {
    const skills = mergeShippedUserSkills([]);
    const alwaysOn = skillInstructionsFromUserSkills(
      skills.map((s) => (s.id === SAPPHIRE_DEFAULT_SKILL_DASHBOARD_ID ? { ...s, enabled: true } : s)),
    );
    assert.ok(alwaysOn.includes('KPI'));
    const combined = skillInstructionsForUserText(skills, alwaysOn, '/design-landing hero');
    assert.ok(combined.includes('KPI'));
    assert.ok(combined.includes('hero') || combined.includes('CTA') || combined.includes('лендинг'));
  });
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Слаг legacy-файла `.skills` / `.voidskills` в корне workspace. */
export const WORKSPACE_SKILLS_FILE_SLUG = 'workspace-skills';

/** Короткий `.skills` остаётся always-on; длинный — только каталог + `/workspace-skills`. */
export const WORKSPACE_SKILLS_ALWAYS_ON_MAX_CHARS = 1_500;

export type AgentSkillEntry = {
	slug: string;
	name: string;
	description: string;
	body: string;
	/** claude | agents | skills-file */
	source: string;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Парсит Agent Skills `SKILL.md` (YAML frontmatter name/description + тело). */
export function parseSkillMarkdown(raw: string, fallbackSlug: string): AgentSkillEntry | undefined {
	const trimmed = raw.replace(/^\uFEFF/, '');
	if (!trimmed.trim()) {
		return undefined;
	}
	const match = FRONTMATTER_RE.exec(trimmed);
	let name = fallbackSlug;
	let description = '';
	let body = trimmed.trim();
	if (match) {
		const yaml = match[1];
		body = match[2].trim();
		const nameLine = yaml.match(/^\s*name\s*:\s*(.+)\s*$/m);
		const descLine = yaml.match(/^\s*description\s*:\s*(.+)\s*$/m);
		if (nameLine) {
			name = stripYamlScalar(nameLine[1]);
		}
		if (descLine) {
			description = stripYamlScalar(descLine[1]);
		}
	}
	const slug = slugifyAgentSkill(name) || slugifyAgentSkill(fallbackSlug) || 'skill';
	if (!description) {
		description = firstMeaningfulLine(body) || name;
	}
	return {
		slug,
		name,
		description: description.slice(0, 240),
		body,
		source: 'skill-md',
	};
}

export function slugifyAgentSkill(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
}

function stripYamlScalar(value: string): string {
	const t = value.trim();
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
		return t.slice(1, -1).trim();
	}
	return t;
}

function firstMeaningfulLine(body: string): string {
	for (const line of body.split(/\r?\n/)) {
		const t = line.trim().replace(/^#+\s*/, '');
		if (t) {
			return t.slice(0, 240);
		}
	}
	return '';
}

/** Каталог для system message: модель видит имена, тело — только после `/slug`. */
export function formatAgentSkillsCatalog(entries: readonly Pick<AgentSkillEntry, 'slug' | 'description'>[]): string {
	if (!entries.length) {
		return '';
	}
	const lines = entries.map((e) => `- /${e.slug}: ${e.description}`);
	return [
		'Available skills (progressive disclosure). To load full instructions, the user or you should mention the slash token in the latest user message:',
		...lines,
	].join('\n');
}

export function resolveAgentSkillBodies(
	entries: readonly AgentSkillEntry[],
	slugs: readonly string[],
): string {
	if (!slugs.length || !entries.length) {
		return '';
	}
	const wanted = new Set(slugs.map((s) => s.toLowerCase()));
	const parts: string[] = [];
	const used = new Set<string>();
	for (const entry of entries) {
		if (!wanted.has(entry.slug) || used.has(entry.slug) || !entry.body.trim()) {
			continue;
		}
		used.add(entry.slug);
		parts.push(entry.body.trim());
	}
	return parts.join('\n\n');
}

export function workspaceSkillsFileEntry(content: string): AgentSkillEntry | undefined {
	const body = content.trim();
	if (!body) {
		return undefined;
	}
	return {
		slug: WORKSPACE_SKILLS_FILE_SLUG,
		name: 'Workspace skills',
		description: 'Legacy shared skills from the workspace .skills file',
		body,
		source: 'skills-file',
	};
}

/** Короткие legacy-файлы остаются always-on; длинные — только через каталог. */
export function workspaceSkillsAlwaysOnBody(content: string): string {
	const body = content.trim();
	if (!body || body.length > WORKSPACE_SKILLS_ALWAYS_ON_MAX_CHARS) {
		return '';
	}
	return body;
}

export function combineSkillInstructionBlocks(...parts: Array<string | undefined | null>): string {
	return parts
		.map((p) => (p ?? '').trim())
		.filter(Boolean)
		.join('\n\n');
}

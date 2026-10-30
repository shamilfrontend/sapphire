/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const LOCAL_REVIEW_DIFF_MAX_CHARS = 60_000;

export type GitReviewKind = 'working-tree' | 'branch' | 'empty';

export type GitReviewPacket = {
	kind: GitReviewKind;
	branch: string;
	base: string | null;
	stat: string;
	diff: string;
	truncated: boolean;
};

export function clipReviewText(text: string, maxChars: number = LOCAL_REVIEW_DIFF_MAX_CHARS): { text: string; truncated: boolean } {
	if (text.length <= maxChars) {
		return { text, truncated: false };
	}
	return {
		text: `${text.slice(0, maxChars)}\n…[truncated]`,
		truncated: true,
	};
}

export function buildLocalReviewPrompt(packet: GitReviewPacket): string {
	const scope = packet.kind === 'working-tree'
		? 'незакоммиченные изменения (staged + unstaged относительно HEAD)'
		: `коммиты ветки, которых нет в ${packet.base ?? 'base'} (локальный аналог PR-diff до push)`;
	const truncation = packet.truncated
		? '\nDiff обрезан по размеру. Разбери видимую часть и явно напиши, чего не хватило.'
		: '';
	return `Проверь локальные изменения git. Не правь файлы и не вызывай инструменты: это review, не реализация.
Область: ${scope}
Ветка: ${packet.branch || '(detached)'}
База: ${packet.base ?? '(нет)'}

Опирайся на GUIDELINES и уже загруженные SKILLS. Если в каталоге есть подходящий /slug, назови его, но не выдумывай тело скилла.

## stat
${packet.stat || '(пусто)'}

## diff
${packet.diff || '(пусто)'}
${truncation}

Ответ по-русски:
1. Замечания по убыванию важности (баг, риск, пропущенный тест; стиль — только если прячет ошибку).
2. Для каждого: файл, что не так, почему важно, как исправить словами.
3. Если diff выглядит безопасным — так и скажи и отметь остаточный риск.`;
}

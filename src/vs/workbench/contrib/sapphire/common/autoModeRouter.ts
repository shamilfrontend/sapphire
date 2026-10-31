/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getModelCapabilities, getModelDisplayName } from './modelCapabilities.js';
import {
	ChatMode,
	isAutoModelSelection,
	ModelSelection,
	OverridesOfModel,
} from './sapphireSettingsTypes.js';

export {
	isAutoModelSelection,
	SAPPHIRE_AUTO_MODEL_NAME,
	SAPPHIRE_AUTO_PROVIDER_NAME,
	SAPPHIRE_AUTO_SELECTION,
} from './sapphireSettingsTypes.js';

/** contextWindow ≥ порога → strong (1M-класс); иначе simple/mid. */
export const STRONG_CONTEXT_THRESHOLD = 512_000;

export const AUTO_ROUTER_TIMEOUT_MS = 8_000;

export type AutoModelPoolEntry = ModelSelection & {
	readonly contextWindow: number;
	readonly displayName: string;
	readonly supportsVision: boolean;
	readonly supportsReasoning: boolean;
	readonly canTurnOffReasoning: boolean;
};

export const enrichPoolEntry = (
	selection: ModelSelection,
	overridesOfModel: OverridesOfModel | undefined,
): AutoModelPoolEntry => {
	const caps = getModelCapabilities(selection.providerName, selection.modelName, overridesOfModel);
	const reasoning = caps.reasoningCapabilities;
	return {
		...selection,
		contextWindow: caps.contextWindow,
		displayName: getModelDisplayName(selection.providerName, selection.modelName, overridesOfModel),
		supportsVision: !!caps.supportsVision,
		supportsReasoning: !!(reasoning && reasoning.supportsReasoning),
		canTurnOffReasoning: !!(reasoning && reasoning.canTurnOffReasoning),
	};
};

export const partitionModels = (
	pool: readonly AutoModelPoolEntry[],
): { strong: AutoModelPoolEntry[]; simple: AutoModelPoolEntry[] } => {
	const strong: AutoModelPoolEntry[] = [];
	const simple: AutoModelPoolEntry[] = [];
	for (const entry of pool) {
		if (entry.contextWindow >= STRONG_CONTEXT_THRESHOLD) {
			strong.push(entry);
		} else {
			simple.push(entry);
		}
	}
	return { strong, simple };
};

const highspeedScore = (modelName: string): number =>
	/highspeed|flash|fast|mini|nano/i.test(modelName) ? 1 : 0;

const compareRouterCandidates = (a: AutoModelPoolEntry, b: AutoModelPoolEntry): number => {
	if (a.contextWindow !== b.contextWindow) {
		return b.contextWindow - a.contextWindow;
	}
	const speedDiff = highspeedScore(b.modelName) - highspeedScore(a.modelName);
	if (speedDiff !== 0) {
		return speedDiff;
	}
	const byProvider = a.providerName.localeCompare(b.providerName);
	if (byProvider !== 0) {
		return byProvider;
	}
	return a.modelName.localeCompare(b.modelName);
};

/** Сильная (или лучшая доступная) модель для вызова роутера. */
export const pickRouterModel = (
	pool: readonly AutoModelPoolEntry[],
): AutoModelPoolEntry | undefined => {
	if (pool.length === 0) {
		return undefined;
	}
	const { strong } = partitionModels(pool);
	const candidates = strong.length > 0 ? strong : [...pool];
	return [...candidates].sort(compareRouterCandidates)[0];
};

/** Лучшая strong для fallback после сбоя роутера; иначе лучшая из пула. */
export const pickFallbackModel = (
	pool: readonly AutoModelPoolEntry[],
): AutoModelPoolEntry | undefined => pickRouterModel(pool);

const selectionKey = (selection: ModelSelection): string =>
	`${selection.providerName}/${selection.modelName}`;

export const findInPool = (
	pool: readonly ModelSelection[],
	providerName: string,
	modelName: string,
): ModelSelection | undefined => {
	const provider = providerName.trim().toLowerCase();
	const model = modelName.trim().toLowerCase();
	return pool.find(
		(entry) =>
			entry.providerName.toLowerCase() === provider && entry.modelName.toLowerCase() === model,
	);
};

/** Достаёт JSON `{ providerName, modelName }` из ответа роутера и сверяет с пулом. */
export const parseRouterChoice = (
	text: string,
	pool: readonly ModelSelection[],
): ModelSelection | undefined => {
	if (!text.trim() || pool.length === 0) {
		return undefined;
	}
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const raw = (fenced?.[1] ?? text).trim();
	const objectMatch = raw.match(/\{[\s\S]*\}/);
	if (!objectMatch) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(objectMatch[0]) as {
			providerName?: unknown;
			modelName?: unknown;
			provider?: unknown;
			model?: unknown;
		};
		const providerName = String(parsed.providerName ?? parsed.provider ?? '').trim();
		const modelName = String(parsed.modelName ?? parsed.model ?? '').trim();
		if (!providerName || !modelName) {
			return undefined;
		}
		return findInPool(pool, providerName, modelName);
	} catch {
		return undefined;
	}
};

export const buildAutoRouterSystemPrompt = (pool: readonly AutoModelPoolEntry[]): string => {
	const lines = pool.map((entry) => {
		const flags = [
			`contextWindow=${entry.contextWindow}`,
			entry.supportsVision ? 'vision' : undefined,
			entry.supportsReasoning ? 'reasoning' : undefined,
		]
			.filter(Boolean)
			.join(', ');
		return `- ${selectionKey(entry)} | ${entry.displayName} (${flags})`;
	});
	return [
		'Ты роутер моделей Sapphire. Выбери одну модель из списка под задачу пользователя.',
		'Правила:',
		'- Простые/короткие вопросы, пояснения, мелкие правки → модели с меньшим contextWindow.',
		'- Сложные задачи (агент, рефакторинг, архитектура, большой контекст, много файлов) → модели с большим contextWindow (strong).',
		'- Если нужен vision, выбирай модель с vision.',
		'- Ответь ТОЛЬКО JSON без Markdown и пояснений: {"providerName":"...","modelName":"..."}.',
		'- providerName и modelName строго из списка ниже.',
		'',
		'Кандидаты:',
		...lines,
	].join('\n');
};

export const buildAutoRouterUserPrompt = (opts: {
	chatMode: ChatMode;
	userPromptPreview: string;
	hasImages?: boolean;
	attachmentHint?: string;
}): string => {
	const preview = opts.userPromptPreview.trim().slice(0, 4_000);
	return [
		`chatMode: ${opts.chatMode}`,
		opts.hasImages ? 'hasImages: true' : 'hasImages: false',
		opts.attachmentHint ? `attachments: ${opts.attachmentHint}` : undefined,
		'',
		'Задача пользователя:',
		preview || '(пусто)',
	]
		.filter((line) => line !== undefined)
		.join('\n');
};

export type ResolveAutoPoolResult =
	| { readonly kind: 'empty' }
	| { readonly kind: 'single'; readonly selection: ModelSelection }
	| {
			readonly kind: 'multi';
			readonly pool: AutoModelPoolEntry[];
			readonly router: AutoModelPoolEntry;
	  };

/** Синхронная подготовка пула до вызова LLM-роутера. */
export const prepareAutoPool = (
	selections: readonly ModelSelection[],
	overridesOfModel: OverridesOfModel | undefined,
): ResolveAutoPoolResult => {
	const real = selections.filter((selection) => !isAutoModelSelection(selection));
	if (real.length === 0) {
		return { kind: 'empty' };
	}
	if (real.length === 1) {
		return { kind: 'single', selection: real[0] };
	}
	const pool = real.map((selection) => enrichPoolEntry(selection, overridesOfModel));
	const router = pickRouterModel(pool);
	if (!router) {
		return { kind: 'empty' };
	}
	return { kind: 'multi', pool, router };
};

/**
 * Модель для окна/резерва в UI при пикере Auto (без LLM-роутера).
 * single → единственная; multi → router (= fallback); empty → undefined.
 */
export const resolveAutoContextEstimateSelection = (
	selections: readonly ModelSelection[],
	overridesOfModel: OverridesOfModel | undefined,
): ModelSelection | undefined => {
	const prepared = prepareAutoPool(selections, overridesOfModel);
	if (prepared.kind === 'single') {
		return prepared.selection;
	}
	if (prepared.kind === 'multi') {
		return {
			providerName: prepared.router.providerName,
			modelName: prepared.router.modelName,
		};
	}
	return undefined;
};

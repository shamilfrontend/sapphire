/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { ProviderName } from './sapphireSettingsTypes.js';

/** Кабинет ключа и расхода DeepSeek. Чат ходит на api.deepseek.com, не на эту страницу. */
export const DEEPSEEK_USAGE_URL = 'https://platform.deepseek.com/usage';

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

export const LLM_IDE_TITLE = 'Sapphire';

/** Дефолтный max_tokens для FIM, если у модели не задан fimMaxTokens. */
export const LLM_FIM_DEFAULT_MAX_TOKENS = 300;

export const LLM_ERROR_HINTS = {
	unauthorized: (providerTitle: string) =>
		`Ключ отклонён провайдером ${providerTitle} (401). Обновите его в настройках.`,
	queueTimeout: `Провайдер не успел обработать запрос (408). Попробуйте позже.`,
	rateLimited: `Достигнут лимит запросов (429). Подождите и повторите.`,
	unreachable: (providerTitle: string) =>
		`Не удалось достучаться до ${providerTitle}. Проверьте сеть и адрес API.`,
	tlsCertificate: (providerTitle: string) =>
		`Не удалось проверить TLS-сертификат ${providerTitle}.`,
	streamIdleTimeout: `Стрим завис без ответа (таймаут 90 с). Попробуйте ещё раз.`,
	connectTimeout: `Провайдер не ответил на подключение за 90 с. Проверьте сеть и попробуйте ещё раз.`,
} as const;

export type ProviderConnectionSettings = {
	apiKey?: string;
	endpoint?: string;
	headersJSON?: string;
	region?: string;
	project?: string;
	azureApiVersion?: string;
};

const FIXED_OPENAI_BASE: Partial<Record<ProviderName, string>> = {
	openAI: 'https://api.openai.com/v1',
	deepseek: DEEPSEEK_API_BASE,
	openRouter: 'https://openrouter.ai/api/v1',
	groq: 'https://api.groq.com/openai/v1',
	xAI: 'https://api.x.ai/v1',
	mistral: 'https://api.mistral.ai/v1',
};

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

const withV1 = (endpoint: string): string => {
	const base = trimSlash(endpoint.trim());
	if (!base) return base;
	if (/\/v1$/i.test(base)) return base;
	return `${base}/v1`;
};

/**
 * OpenAI-совместимый base URL. Для Azure chat URL включает deployment (имя модели).
 * `purpose: 'list'` — каталог моделей, без deployment в пути.
 */
export const resolveOpenAICompatibleBaseURL = (
	providerName: ProviderName,
	settings: ProviderConnectionSettings,
	modelName?: string,
	purpose: 'chat' | 'list' = 'chat',
): string => {
	const fixed = FIXED_OPENAI_BASE[providerName];
	if (fixed) return fixed;

	const endpoint = (settings.endpoint ?? '').trim();
	const region = (settings.region ?? '').trim() || (providerName === 'googleVertex' ? 'us-west2' : 'us-east-1');
	const project = (settings.project ?? '').trim();

	if (
		providerName === 'ollama' ||
		providerName === 'vLLM' ||
		providerName === 'lmStudio' ||
		providerName === 'liteLLM' ||
		providerName === 'openAICompatible'
	) {
		return withV1(endpoint);
	}

	if (providerName === 'microsoftAzure') {
		if (purpose === 'list') {
			return `https://${project}.openai.azure.com/openai`;
		}
		const deployment = modelName || 'chat';
		return `https://${project}.openai.azure.com/openai/deployments/${deployment}`;
	}

	if (providerName === 'googleVertex') {
		return `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/endpoints/openapi`;
	}

	if (providerName === 'awsBedrock') {
		if (endpoint) return withV1(endpoint);
		return `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`;
	}

	return '';
};

export const parseExtraHeaders = (headersJSON: string | undefined): Record<string, string> => {
	if (!headersJSON?.trim()) return {};
	try {
		const parsed: unknown = JSON.parse(headersJSON);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === 'string') out[key] = value;
		}
		return out;
	} catch {
		return {};
	}
};

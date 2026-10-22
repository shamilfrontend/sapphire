/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { GoogleGenerativeAI, SchemaType, type Content, type Part, type Tool } from '@google/generative-ai';
import { getModelCapabilities, getReservedOutputTokenSpace, getSendableReasoningInfo } from '../../common/modelCapabilities.js';
import { LLM_ERROR_HINTS, type ProviderConnectionSettings } from '../../common/llmProviderConfig.js';
import { SAPPHIRE_LLM_CONNECT_TIMEOUT_MS, SAPPHIRE_LLM_STREAM_IDLE_MS } from '../../common/llmRetryStatus.js';
import { availableTools, type InternalToolInfo } from '../../common/prompt/prompts.js';
import {
	type GatewayChatContentPart,
	type GatewayModelResponse,
	type LLMChatMessage,
	type LLMUsage,
	type ModelListParams,
	type OnError,
	type OnFinalMessage,
	type OnText,
	type RawToolCallObj,
	type RawToolParamsObj,
} from '../../common/sendLLMMessageTypes.js';
import { displayInfoOfProviderName, type ChatMode, type SettingsOfProvider } from '../../common/sapphireSettingsTypes.js';

type GeminiChatParams = {
	messages: LLMChatMessage[];
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	settingsOfProvider: SettingsOfProvider;
	modelSelectionOptions: import('../../common/sapphireSettingsTypes.js').ModelSelectionOptions | undefined;
	overridesOfModel: import('../../common/sapphireSettingsTypes.js').OverridesOfModel | undefined;
	modelName: string;
	_setAborter: (aborter: () => void) => void;
	chatMode: ChatMode | null;
	mcpTools: InternalToolInfo[] | undefined;
	allowUpdatePlan?: boolean;
	enabledMcpServerNames?: readonly string[];
	excludedToolNames?: readonly string[];
	allowedToolNames?: readonly string[];
	disableAllTools?: boolean;
	separateSystemMessage?: string;
};

const providerTitle = () => displayInfoOfProviderName('gemini').title;

const parseDataUrl = (url: string): { mime: string; data: string } | null => {
	const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(url);
	if (!match) return null;
	return { mime: match[1], data: match[2] };
};

const userParts = (content: string | GatewayChatContentPart[]): Part[] => {
	if (typeof content === 'string') return [{ text: content || ' ' }];
	const parts: Part[] = [];
	for (const part of content) {
		if (part.type === 'text') {
			parts.push({ text: part.text || ' ' });
			continue;
		}
		const image = parseDataUrl(part.image_url.url);
		if (image) parts.push({ inlineData: { mimeType: image.mime, data: image.data } });
	}
	return parts.length ? parts : [{ text: ' ' }];
};

const toGeminiContents = (messages: LLMChatMessage[], separateSystemMessage: string | undefined): { system: string; contents: Content[] } => {
	const systemParts: string[] = [];
	if (separateSystemMessage?.trim()) systemParts.push(separateSystemMessage.trim());
	const toolNameById = new Map<string, string>();
	const contents: Content[] = [];

	const push = (role: 'user' | 'model', parts: Part[]) => {
		const prev = contents[contents.length - 1];
		if (prev && prev.role === role) {
			prev.parts.push(...parts);
			return;
		}
		contents.push({ role, parts });
	};

	for (const message of messages) {
		if (message.role === 'system') {
			systemParts.push(message.content);
			continue;
		}
		if (message.role === 'user') {
			push('user', userParts(message.content));
			continue;
		}
		if (message.role === 'assistant') {
			const parts: Part[] = [];
			const text = typeof message.content === 'string'
				? message.content
				: message.content.map((part) => part.text).join('');
			if (text) parts.push({ text });
			for (const toolCall of message.tool_calls ?? []) {
				toolNameById.set(toolCall.id, toolCall.function.name);
				let args: Record<string, unknown> = {};
				try {
					const parsed: unknown = JSON.parse(toolCall.function.arguments || '{}');
					if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
				} catch {
					args = {};
				}
				parts.push({ functionCall: { name: toolCall.function.name, args } });
			}
			push('model', parts.length ? parts : [{ text: ' ' }]);
			continue;
		}
		const name = toolNameById.get(message.tool_call_id) || 'tool';
		push('user', [{ functionResponse: { name, response: { result: message.content } } }]);
	}

	if (contents.length === 0 || contents[0].role !== 'user') {
		contents.unshift({ role: 'user', parts: [{ text: ' ' }] });
	}
	return { system: systemParts.filter(Boolean).join('\n\n'), contents };
};

const geminiTools = (params: GeminiChatParams): Tool[] | undefined => {
	const tools = availableTools(params.chatMode, params.mcpTools, {
		allowUpdatePlan: params.allowUpdatePlan,
		enabledMcpServerNames: params.enabledMcpServerNames,
		excludedToolNames: params.excludedToolNames,
		allowedToolNames: params.allowedToolNames,
		disableAllTools: params.disableAllTools,
	});
	if (!tools?.length) return undefined;
	return [{
		functionDeclarations: tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: {
				type: SchemaType.OBJECT,
				properties: Object.fromEntries(
					Object.entries(tool.params).map(([key, value]) => [
						key,
						{ type: SchemaType.STRING, description: value.description },
					]),
				),
			},
		})),
	}];
};

export const sendGeminiChat = async (params: GeminiChatParams): Promise<void> => {
	const settings = params.settingsOfProvider.gemini as ProviderConnectionSettings;
	const apiKey = settings.apiKey?.trim() ?? '';
	if (!apiKey) {
		params.onError({ message: LLM_ERROR_HINTS.unauthorized(providerTitle()), fullError: null });
		return;
	}

	const caps = getModelCapabilities('gemini', params.modelName, params.overridesOfModel);
	const reasoning = getSendableReasoningInfo(
		'Chat',
		'gemini',
		params.modelName,
		params.modelSelectionOptions,
		params.overridesOfModel,
	);
	const reserved = getReservedOutputTokenSpace('gemini', params.modelName, {
		isReasoningEnabled: !!reasoning,
		overridesOfModel: params.overridesOfModel,
	}) ?? caps.reservedOutputTokenSpace ?? 4_096;
	const budget = reasoning?.type === 'budget_slider_value' ? reasoning.reasoningBudget : 0;
	const { system, contents } = toGeminiContents(params.messages, params.separateSystemMessage);
	const tools = geminiTools(params);

	const client = new GoogleGenerativeAI(apiKey);
	const model = client.getGenerativeModel({
		model: caps.modelName,
		...(system ? { systemInstruction: system } : {}),
		...(tools ? { tools } : {}),
		generationConfig: {
			maxOutputTokens: Math.max(reserved, budget + 256),
			...(budget > 0 ? { thinkingConfig: { thinkingBudget: budget } } : {}),
		} as never,
	});

	const abort = new AbortController();
	let connectTimedOut = false;
	let idleTimedOut = false;
	const connectTimer = setTimeout(() => {
		connectTimedOut = true;
		abort.abort();
	}, SAPPHIRE_LLM_CONNECT_TIMEOUT_MS);
	params._setAborter(() => {
		clearTimeout(connectTimer);
		abort.abort();
	});

	try {
		const result = await model.generateContentStream({ contents }, { signal: abort.signal });
		let fullText = '';
		let fullReasoning = '';
		const toolCalls: RawToolCallObj[] = [];
		let sawChunk = false;
		let idleTimer: ReturnType<typeof setTimeout> | null = null;
		const clearIdle = () => {
			if (idleTimer !== null) {
				clearTimeout(idleTimer);
				idleTimer = null;
			}
		};
		const pokeIdle = () => {
			clearIdle();
			idleTimer = setTimeout(() => {
				idleTimedOut = true;
				abort.abort();
			}, SAPPHIRE_LLM_STREAM_IDLE_MS);
		};

		let usage: LLMUsage | undefined;
		for await (const chunk of result.stream) {
			if (!sawChunk) {
				sawChunk = true;
				clearTimeout(connectTimer);
			}
			pokeIdle();
			const meta = chunk.usageMetadata;
			if (meta) {
				const prompt = meta.promptTokenCount ?? 0;
				const completion = meta.candidatesTokenCount ?? 0;
				usage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: meta.totalTokenCount ?? prompt + completion };
			}
			const parts = chunk.candidates?.[0]?.content?.parts ?? [];
			for (const part of parts) {
				const thought = (part as { thought?: boolean }).thought;
				if (part.text) {
					if (thought) fullReasoning += part.text;
					else fullText += part.text;
				}
				if (part.functionCall?.name) {
					const args = part.functionCall.args ?? {};
					const rawParams = args as RawToolParamsObj;
					toolCalls.push({
						name: part.functionCall.name as RawToolCallObj['name'],
						rawParams,
						doneParams: Object.keys(rawParams),
						id: `gemini_${toolCalls.length}_${part.functionCall.name}`,
						isDone: true,
					});
				}
			}
			params.onText({ fullText, fullReasoning, ...(toolCalls.length ? { toolCalls } : {}) });
		}
		clearIdle();
		if (idleTimedOut) {
			params.onError({ message: LLM_ERROR_HINTS.streamIdleTimeout, fullError: null });
			return;
		}
		if (!fullText && !fullReasoning && toolCalls.length === 0) {
			params.onError({ message: 'Ответ модели пуст.', fullError: null });
			return;
		}
		params.onFinalMessage({
			fullText,
			fullReasoning,
			...(toolCalls.length ? { toolCalls } : {}),
			...(usage ? { usage } : {}),
		});
	} catch (error) {
		if (abort.signal.aborted && !connectTimedOut && !idleTimedOut) return;
		if (connectTimedOut) {
			params.onError({ message: LLM_ERROR_HINTS.connectTimeout, fullError: error instanceof Error ? error : null });
			return;
		}
		if (idleTimedOut) {
			params.onError({ message: LLM_ERROR_HINTS.streamIdleTimeout, fullError: null });
			return;
		}
		const message = `${error}`;
		if (/API_KEY_INVALID|401|permission denied/i.test(message)) {
			params.onError({ message: LLM_ERROR_HINTS.unauthorized(providerTitle()), fullError: error instanceof Error ? error : null });
			return;
		}
		params.onError({ message, fullError: error instanceof Error ? error : null });
	}
};

export const listGeminiModels = async ({
	onSuccess,
	onError,
	settingsOfProvider,
}: ModelListParams<GatewayModelResponse>): Promise<void> => {
	const apiKey = (settingsOfProvider.gemini as ProviderConnectionSettings).apiKey?.trim() ?? '';
	if (!apiKey) {
		onError({ error: LLM_ERROR_HINTS.unauthorized(providerTitle()) });
		return;
	}
	try {
		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
		);
		if (!response.ok) {
			onError({ error: response.status === 400 || response.status === 401 || response.status === 403
				? LLM_ERROR_HINTS.unauthorized(providerTitle())
				: `Gemini models: ${response.status}` });
			return;
		}
		const body = await response.json() as { models?: { name?: string }[] };
		const models: GatewayModelResponse[] = (body.models ?? [])
			.map((item) => (item.name ?? '').replace(/^models\//, ''))
			.filter((id) => id.startsWith('gemini'))
			.map((id) => ({ id, created: 0, object: 'model' as const, owned_by: 'google' }));
		onSuccess({ models });
	} catch (error) {
		onError({ error: `${error}` });
	}
};

/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import { getModelCapabilities, getReservedOutputTokenSpace, getSendableReasoningInfo } from '../../common/modelCapabilities.js';
import { LLM_ERROR_HINTS, type ProviderConnectionSettings } from '../../common/llmProviderConfig.js';
import { SAPPHIRE_LLM_CONNECT_TIMEOUT_MS, SAPPHIRE_LLM_STREAM_IDLE_MS } from '../../common/llmRetryStatus.js';
import { availableTools, type InternalToolInfo } from '../../common/prompt/prompts.js';
import {
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

type AnthropicChatParams = {
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

const providerTitle = () => displayInfoOfProviderName('anthropic').title;

const parseDataUrl = (
	url: string,
): { mime: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } | null => {
	const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/i.exec(url);
	if (!match) return null;
	return { mime: match[1].toLowerCase() as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: match[2] };
};

const textOfUserContent = (content: LLMChatMessage & { role: 'user' }): Anthropic.ContentBlockParam[] => {
	if (typeof content.content === 'string') {
		return [{ type: 'text', text: content.content || ' ' }];
	}
	const blocks: Anthropic.ContentBlockParam[] = [];
	for (const part of content.content) {
		if (part.type === 'text') {
			blocks.push({ type: 'text', text: part.text || ' ' });
			continue;
		}
		const image = parseDataUrl(part.image_url.url);
		if (image) {
			blocks.push({ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } });
		}
	}
	return blocks.length ? blocks : [{ type: 'text', text: ' ' }];
};

const toAnthropicMessages = (
	messages: LLMChatMessage[],
	separateSystemMessage: string | undefined,
): { system: string; messages: Anthropic.MessageParam[] } => {
	const systemParts: string[] = [];
	if (separateSystemMessage?.trim()) systemParts.push(separateSystemMessage.trim());
	const out: Anthropic.MessageParam[] = [];

	const push = (role: 'user' | 'assistant', content: string | Anthropic.ContentBlockParam[]) => {
		const prev = out[out.length - 1];
		if (prev && prev.role === role && typeof prev.content === 'string' && typeof content === 'string') {
			prev.content = `${prev.content}\n\n${content}`;
			return;
		}
		if (prev && prev.role === role && Array.isArray(prev.content) && Array.isArray(content)) {
			prev.content.push(...content);
			return;
		}
		out.push({ role, content });
	};

	for (const message of messages) {
		if (message.role === 'system') {
			systemParts.push(message.content);
			continue;
		}
		if (message.role === 'user') {
			push('user', textOfUserContent(message));
			continue;
		}
		if (message.role === 'assistant') {
			const blocks: Anthropic.ContentBlockParam[] = [];
			const text = typeof message.content === 'string'
				? message.content
				: message.content.map((part) => part.text).join('');
			if (text) blocks.push({ type: 'text', text });
			for (const toolCall of message.tool_calls ?? []) {
				let input: Record<string, unknown> = {};
				try {
					const parsed: unknown = JSON.parse(toolCall.function.arguments || '{}');
					if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
				} catch {
					input = {};
				}
				blocks.push({ type: 'tool_use', id: toolCall.id, name: toolCall.function.name, input });
			}
			push('assistant', blocks.length ? blocks : text || ' ');
			continue;
		}
		push('user', [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content }]);
	}

	if (out.length === 0) {
		out.push({ role: 'user', content: ' ' });
	}
	if (out[0].role !== 'user') {
		out.unshift({ role: 'user', content: ' ' });
	}
	return { system: systemParts.filter(Boolean).join('\n\n'), messages: out };
};

const anthropicTools = (params: AnthropicChatParams): Anthropic.Tool[] | undefined => {
	const tools = availableTools(params.chatMode, params.mcpTools, {
		allowUpdatePlan: params.allowUpdatePlan,
		enabledMcpServerNames: params.enabledMcpServerNames,
		excludedToolNames: params.excludedToolNames,
		allowedToolNames: params.allowedToolNames,
		disableAllTools: params.disableAllTools,
	});
	if (!tools?.length) return undefined;
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: {
			type: 'object' as const,
			properties: Object.fromEntries(
				Object.entries(tool.params).map(([key, value]) => [key, { type: 'string', description: value.description }]),
			),
		},
	}));
};

const rawToolOf = (name: string, paramsStr: string, id: string): RawToolCallObj | null => {
	let input: unknown;
	try {
		input = JSON.parse(paramsStr || '{}');
	} catch {
		return null;
	}
	if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
	const rawParams = input as RawToolParamsObj;
	return { id, name: name as RawToolCallObj['name'], rawParams, doneParams: Object.keys(rawParams), isDone: true };
};

export const sendAnthropicChat = async (params: AnthropicChatParams): Promise<void> => {
	const settings = params.settingsOfProvider.anthropic as ProviderConnectionSettings;
	const apiKey = settings.apiKey?.trim() ?? '';
	if (!apiKey) {
		params.onError({ message: LLM_ERROR_HINTS.unauthorized(providerTitle()), fullError: null });
		return;
	}

	const caps = getModelCapabilities('anthropic', params.modelName, params.overridesOfModel);
	const reasoning = getSendableReasoningInfo(
		'Chat',
		'anthropic',
		params.modelName,
		params.modelSelectionOptions,
		params.overridesOfModel,
	);
	const reasoningOn = getReservedOutputTokenSpace('anthropic', params.modelName, {
		isReasoningEnabled: !!reasoning,
		overridesOfModel: params.overridesOfModel,
	});
	const budget = reasoning?.type === 'budget_slider_value' ? reasoning.reasoningBudget : 0;
	const maxTokens = Math.max((reasoningOn ?? caps.reservedOutputTokenSpace ?? 4_096), budget + 1_024);

	const { system, messages } = toAnthropicMessages(params.messages, params.separateSystemMessage);
	const tools = anthropicTools(params);
	const client = new Anthropic({ apiKey });
	const abort = new AbortController();
	let connectTimedOut = false;
	const connectTimer = setTimeout(() => {
		connectTimedOut = true;
		abort.abort();
	}, SAPPHIRE_LLM_CONNECT_TIMEOUT_MS);
	params._setAborter(() => {
		clearTimeout(connectTimer);
		abort.abort();
	});

	try {
		const stream = client.messages.stream(
			{
				model: caps.modelName,
				max_tokens: maxTokens,
				messages,
				...(system ? { system } : {}),
				...(tools ? { tools } : {}),
				...(budget > 0 ? { thinking: { type: 'enabled' as const, budget_tokens: budget } } : {}),
			},
			{ signal: abort.signal },
		);

		let fullText = '';
		let fullReasoning = '';
		const toolBuckets = new Map<number, { name: string; id: string; paramsStr: string }>();
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
			idleTimer = setTimeout(() => abort.abort(), SAPPHIRE_LLM_STREAM_IDLE_MS);
		};

		let inputTokens = 0;
		let outputTokens = 0;

		for await (const event of stream) {
			if (!sawChunk) {
				sawChunk = true;
				clearTimeout(connectTimer);
				pokeIdle();
			} else {
				pokeIdle();
			}
			if (event.type === 'message_start') {
				inputTokens = event.message.usage?.input_tokens ?? inputTokens;
			}
			if (event.type === 'message_delta') {
				outputTokens = event.usage?.output_tokens ?? outputTokens;
			}
			if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
				toolBuckets.set(event.index, { name: event.content_block.name, id: event.content_block.id, paramsStr: '' });
			}
			if (event.type === 'content_block_delta') {
				if (event.delta.type === 'text_delta') fullText += event.delta.text;
				if (event.delta.type === 'thinking_delta') fullReasoning += event.delta.thinking;
				if (event.delta.type === 'input_json_delta') {
					const bucket = toolBuckets.get(event.index);
					if (bucket) bucket.paramsStr += event.delta.partial_json;
				}
			}
			params.onText({
				fullText,
				fullReasoning,
				toolCalls: toolBuckets.size
					? [...toolBuckets.entries()].sort(([a], [b]) => a - b).map(([, bucket]) => ({
						name: bucket.name as RawToolCallObj['name'],
						rawParams: {},
						doneParams: [],
						id: bucket.id,
						isDone: false,
					}))
					: undefined,
			});
		}
		clearIdle();

		const truncatedToolNames: string[] = [];
		const toolCalls = [...toolBuckets.values()]
			.map((bucket) => {
				const parsed = rawToolOf(bucket.name, bucket.paramsStr, bucket.id);
				if (parsed) return parsed;
				if (bucket.name) truncatedToolNames.push(bucket.name);
				return null;
			})
			.filter((tool): tool is RawToolCallObj => !!tool?.name);

		if (!fullText && !fullReasoning && toolCalls.length === 0) {
			params.onError({ message: 'Ответ модели пуст.', fullError: null });
			return;
		}
		const usage: LLMUsage | undefined = inputTokens || outputTokens
			? { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens }
			: undefined;
		params.onFinalMessage({
			fullText,
			fullReasoning,
			...(toolCalls.length ? { toolCalls } : {}),
			...(usage ? { usage } : {}),
			...(truncatedToolNames.length ? { truncatedToolNames } : {}),
		});
	} catch (error) {
		if (abort.signal.aborted && !connectTimedOut) return;
		const status = error instanceof Anthropic.APIError ? error.status : undefined;
		if (connectTimedOut) {
			params.onError({ message: LLM_ERROR_HINTS.connectTimeout, fullError: error instanceof Error ? error : null });
			return;
		}
		if (status === 401) {
			params.onError({ message: LLM_ERROR_HINTS.unauthorized(providerTitle()), fullError: error instanceof Error ? error : null });
			return;
		}
		if (status === 429) {
			params.onError({ message: LLM_ERROR_HINTS.rateLimited, fullError: error instanceof Error ? error : null, gatewayRetryExhausted: true });
			return;
		}
		params.onError({
			message: status != null ? `${error} (код ${status})` : `${error}`,
			fullError: error instanceof Error ? error : null,
		});
	}
};

export const listAnthropicModels = async ({
	onSuccess,
	onError,
	settingsOfProvider,
}: ModelListParams<GatewayModelResponse>): Promise<void> => {
	const apiKey = (settingsOfProvider.anthropic as ProviderConnectionSettings).apiKey?.trim() ?? '';
	if (!apiKey) {
		onError({ error: LLM_ERROR_HINTS.unauthorized(providerTitle()) });
		return;
	}
	try {
		const response = await fetch('https://api.anthropic.com/v1/models', {
			headers: {
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
			},
		});
		if (!response.ok) {
			onError({ error: response.status === 401 ? LLM_ERROR_HINTS.unauthorized(providerTitle()) : `Anthropic /v1/models: ${response.status}` });
			return;
		}
		const body = await response.json() as { data?: { id?: string }[] };
		const models: GatewayModelResponse[] = (body.data ?? [])
			.filter((item) => !!item.id)
			.map((item) => ({ id: item.id as string, created: 0, object: 'model', owned_by: 'anthropic' }));
		onSuccess({ models });
	} catch (error) {
		onError({ error: `${error}` });
	}
};

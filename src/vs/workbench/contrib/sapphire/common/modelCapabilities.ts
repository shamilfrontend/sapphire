/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	FeatureName,
	ModelSelectionOptions,
	OverridesOfModel,
	ProviderName,
} from './sapphireSettingsTypes.js';

export const defaultProviderSettings = {
	anthropic: {
		apiKey: '',
	},
	openAI: {
		apiKey: '',
	},
	deepseek: {
		apiKey: '',
	},
	ollama: {
		endpoint: 'http://127.0.0.1:11434',
	},
	vLLM: {
		endpoint: 'http://localhost:8000',
	},
	openRouter: {
		apiKey: '',
	},
	openAICompatible: {
		endpoint: '',
		apiKey: '',
		headersJSON: '{}',
	},
	gemini: {
		apiKey: '',
	},
	groq: {
		apiKey: '',
	},
	xAI: {
		apiKey: '',
	},
	mistral: {
		apiKey: '',
	},
	lmStudio: {
		endpoint: 'http://localhost:1234',
	},
	liteLLM: {
		endpoint: '',
	},
	googleVertex: {
		region: 'us-west2',
		project: '',
	},
	microsoftAzure: {
		project: '',
		apiKey: '',
		azureApiVersion: '2024-05-01-preview',
	},
	awsBedrock: {
		apiKey: '',
		region: 'us-east-1',
		endpoint: '',
	},
} as const;

export const defaultModelsOfProvider = {
	openAI: [
		'gpt-4.1',
		'gpt-4.1-mini',
		'gpt-4.1-nano',
		'o3',
		'o4-mini',
	],
	anthropic: [
		'claude-opus-4-0',
		'claude-sonnet-4-0',
		'claude-3-7-sonnet-latest',
		'claude-3-5-sonnet-latest',
		'claude-3-5-haiku-latest',
		'claude-3-opus-latest',
	],
	xAI: ['grok-2', 'grok-3', 'grok-3-mini', 'grok-3-fast', 'grok-3-mini-fast'],
	gemini: [
		'gemini-2.5-pro-exp-03-25',
		'gemini-2.5-flash-preview-04-17',
		'gemini-2.0-flash',
		'gemini-2.0-flash-lite',
		'gemini-2.5-pro-preview-05-06',
	],
	deepseek: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
	ollama: [],
	vLLM: [],
	lmStudio: [],
	openRouter: [
		'anthropic/claude-opus-4',
		'anthropic/claude-sonnet-4',
		'qwen/qwen3-235b-a22b',
		'anthropic/claude-3.7-sonnet',
		'anthropic/claude-3.5-sonnet',
		'deepseek/deepseek-r1',
		'deepseek/deepseek-r1-zero:free',
		'mistralai/devstral-small:free',
	],
	groq: ['qwen-qwq-32b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
	mistral: [
		'codestral-latest',
		'devstral-small-latest',
		'mistral-large-latest',
		'mistral-medium-latest',
		'ministral-3b-latest',
		'ministral-8b-latest',
	],
	openAICompatible: [],
	googleVertex: [],
	microsoftAzure: [],
	awsBedrock: [],
	liteLLM: [],
} as const satisfies Record<ProviderName, readonly string[]>;

type SapphireStaticModelInfo = {
	contextWindow: number;
	reservedOutputTokenSpace: number | null;

	supportsSystemMessage: false | 'system-role';
	supportsFIM: boolean;

	/** Макс. completion-токенов для FIM/autocomplete. */
	fimMaxTokens?: number | null;

	/** Chat Completions может включать image_url. */
	supportsVision?: boolean;

	/** Человекочитаемое имя с версией в UI; в API уходит model id. */
	displayName?: string;

	/** Доп. поля, мержатся в body OpenAI-совместимого запроса. */
	additionalGatewayPayload?: { [key: string]: string };

	reasoningCapabilities:
		| false
		| {
				readonly supportsReasoning: true;
				readonly canTurnOffReasoning: boolean;
				readonly canIOReasoning: boolean;
				readonly reasoningReservedOutputTokenSpace?: number;
				readonly reasoningSlider?:
					| undefined
					| { type: 'budget_slider'; min: number; max: number; default: number }
					| { type: 'effort_slider'; values: string[]; default: string };
		  };
};

export const modelOverrideKeys = [
	'contextWindow',
	'reservedOutputTokenSpace',
	'supportsSystemMessage',
	'supportsFIM',
	'fimMaxTokens',
	'supportsVision',
	'reasoningCapabilities',
	'additionalGatewayPayload',
] as const;

export type ModelOverrides = Pick<SapphireStaticModelInfo, (typeof modelOverrideKeys)[number]>;

type SendableReasoningInfo =
	| {
			type: 'effort_slider_value';
			isReasoningEnabled: true;
			reasoningEffort: string;
	  }
	| {
			type: 'budget_slider_value';
			isReasoningEnabled: true;
			reasoningBudget: number;
	  }
	| null;

type ProviderReasoningIOSettings = {
	input?: {
		includeInPayload?: (reasoningState: SendableReasoningInfo) => null | { [key: string]: unknown };
	};
	output?: { nameOfFieldInDelta?: string };
};

type SapphireStaticProviderInfo = {
	providerReasoningIOSettings?: ProviderReasoningIOSettings;
	modelOptions: { [key: string]: SapphireStaticModelInfo };
	modelOptionsFallback: (
		modelName: string,
		fallbackKnownValues?: Partial<SapphireStaticModelInfo>,
	) => (SapphireStaticModelInfo & { modelName: string; recognizedModelName: string }) | null;
};

const defaultModelOptions = {
	contextWindow: 4_096,
	reservedOutputTokenSpace: 4_096,
	supportsSystemMessage: false,
	supportsFIM: false,
	supportsVision: false,
	reasoningCapabilities: false,
} as const satisfies SapphireStaticModelInfo;

const model = (
	partial: Partial<SapphireStaticModelInfo> & Pick<SapphireStaticModelInfo, 'contextWindow'>,
): SapphireStaticModelInfo => ({
	...defaultModelOptions,
	reservedOutputTokenSpace: 4_096,
	supportsSystemMessage: 'system-role',
	...partial,
});

const effortSlider = (defaultValue: string) =>
	({
		type: 'effort_slider' as const,
		values: ['low', 'medium', 'high'],
		default: defaultValue,
	});

const budgetSlider = (min: number, max: number, defaultValue: number) =>
	({
		type: 'budget_slider' as const,
		min,
		max,
		default: defaultValue,
	});

type ReasoningCapabilitiesOn = Extract<
	SapphireStaticModelInfo['reasoningCapabilities'],
	{ supportsReasoning: true }
>;

const reasoningOn = (
	opts: {
		canTurnOff?: boolean;
		reserved?: number;
		slider?: ReasoningCapabilitiesOn['reasoningSlider'];
	} = {},
): ReasoningCapabilitiesOn => ({
	supportsReasoning: true,
	canTurnOffReasoning: opts.canTurnOff ?? true,
	canIOReasoning: true,
	...((opts.reserved !== null && opts.reserved !== undefined) ? { reasoningReservedOutputTokenSpace: opts.reserved } : {}),
	...(opts.slider ? { reasoningSlider: opts.slider } : {}),
});

const openAIModelOptions = {
	'gpt-4.1': model({
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		supportsVision: true,
	}),
	'gpt-4.1-mini': model({
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		supportsVision: true,
	}),
	'gpt-4.1-nano': model({
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		supportsVision: true,
	}),
	'gpt-4o': model({
		contextWindow: 128_000,
		reservedOutputTokenSpace: 16_384,
		supportsVision: true,
	}),
	'gpt-4o-mini': model({
		contextWindow: 128_000,
		reservedOutputTokenSpace: 16_384,
		supportsVision: true,
	}),
	o3: model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 100_000,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({ canTurnOff: false, reserved: 100_000, slider: effortSlider('medium') }),
	}),
	'o3-mini': model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 100_000,
		reasoningCapabilities: reasoningOn({ canTurnOff: false, reserved: 100_000, slider: effortSlider('medium') }),
	}),
	'o4-mini': model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 100_000,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({ canTurnOff: false, reserved: 100_000, slider: effortSlider('medium') }),
	}),
	o1: model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 100_000,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({ canTurnOff: false, reserved: 100_000, slider: effortSlider('medium') }),
	}),
	'o1-mini': model({
		contextWindow: 128_000,
		reservedOutputTokenSpace: 65_536,
		reasoningCapabilities: reasoningOn({ canTurnOff: false, reserved: 65_536, slider: effortSlider('medium') }),
	}),
} as const satisfies { [s: string]: SapphireStaticModelInfo };

const anthropicModelOptions = {
	'claude-opus-4-0': model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({ reserved: 8_192, slider: budgetSlider(1024, 8192, 1024) }),
	}),
	'claude-sonnet-4-0': model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({ reserved: 8_192, slider: budgetSlider(1024, 8192, 1024) }),
	}),
	'claude-3-7-sonnet-latest': model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({ reserved: 8_192, slider: budgetSlider(1024, 8192, 1024) }),
	}),
	'claude-3-5-sonnet-latest': model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		supportsVision: true,
	}),
	'claude-3-5-haiku-latest': model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		supportsVision: true,
	}),
	'claude-3-opus-latest': model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 4_096,
		supportsVision: true,
	}),
	'claude-opus-4-20250514': model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({ reserved: 8_192, slider: budgetSlider(1024, 8192, 1024) }),
	}),
	'claude-sonnet-4-20250514': model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({ reserved: 8_192, slider: budgetSlider(1024, 8192, 1024) }),
	}),
	'claude-3-7-sonnet-20250219': model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({ reserved: 8_192, slider: budgetSlider(1024, 8192, 1024) }),
	}),
	'claude-3-5-sonnet-20241022': model({
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		supportsVision: true,
	}),
} as const satisfies { [s: string]: SapphireStaticModelInfo };

const geminiModelOptions = {
	'gemini-2.5-pro-exp-03-25': model({
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 65_536,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({ reserved: 16_384, slider: budgetSlider(1024, 16_384, 1024) }),
	}),
	'gemini-2.5-pro-preview-05-06': model({
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 65_536,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({ reserved: 16_384, slider: budgetSlider(1024, 16_384, 1024) }),
	}),
	'gemini-2.5-flash-preview-04-17': model({
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 65_536,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({ canTurnOff: true, reserved: 8_192, slider: budgetSlider(0, 8_192, 0) }),
	}),
	'gemini-2.0-flash': model({
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 8_192,
		supportsVision: true,
	}),
	'gemini-2.0-flash-lite': model({
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 8_192,
		supportsVision: true,
	}),
} as const satisfies { [s: string]: SapphireStaticModelInfo };

const xAIModelOptions = {
	'grok-2': model({ contextWindow: 128_000, reservedOutputTokenSpace: 8_192 }),
	'grok-3': model({
		contextWindow: 131_072,
		reservedOutputTokenSpace: 8_192,
		supportsVision: true,
	}),
	'grok-3-mini': model({
		contextWindow: 131_072,
		reservedOutputTokenSpace: 8_192,
		reasoningCapabilities: reasoningOn({ canTurnOff: false, slider: effortSlider('low') }),
	}),
	'grok-3-fast': model({ contextWindow: 131_072, reservedOutputTokenSpace: 8_192, supportsVision: true }),
	'grok-3-mini-fast': model({
		contextWindow: 131_072,
		reservedOutputTokenSpace: 8_192,
		reasoningCapabilities: reasoningOn({ canTurnOff: false, slider: effortSlider('low') }),
	}),
} as const satisfies { [s: string]: SapphireStaticModelInfo };

const deepseekFlashDisplayName = 'DeepSeek V4.1 Flash 1017';
const deepseekFlashCapabilities = {
	displayName: deepseekFlashDisplayName,
	contextWindow: 1_048_576,
	reservedOutputTokenSpace: 32_768,
	supportsVision: true,
	reasoningCapabilities: reasoningOn({
		canTurnOff: true,
		reserved: 32_768,
		slider: { type: 'effort_slider' as const, values: ['low', 'high', 'max'], default: 'high' },
	}),
} satisfies Partial<SapphireStaticModelInfo> & Pick<SapphireStaticModelInfo, 'contextWindow'>;

const deepseekModelOptions = {
	'deepseek-flash': model(deepseekFlashCapabilities),
	'deepseek-v4-flash': model(deepseekFlashCapabilities),
	'deepseek-v4-flash-vision-exp': model(deepseekFlashCapabilities),
	'deepseek-v4-pro': model({
		displayName: 'DeepSeek V4 Pro',
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 32_768,
		supportsVision: true,
		reasoningCapabilities: reasoningOn({
			canTurnOff: true,
			reserved: 32_768,
			slider: { type: 'effort_slider' as const, values: ['low', 'high', 'max'], default: 'high' },
		}),
	}),
	'deepseek-chat': model({
		contextWindow: 128_000,
		reservedOutputTokenSpace: 8_192,
	}),
	'deepseek-reasoner': model({
		contextWindow: 128_000,
		reservedOutputTokenSpace: 8_192,
		reasoningCapabilities: reasoningOn({ canTurnOff: false, reserved: 32_000 }),
	}),
} as const satisfies { [s: string]: SapphireStaticModelInfo };

const mistralModelOptions = {
	'codestral-latest': model({
		contextWindow: 32_000,
		supportsFIM: true,
		fimMaxTokens: 300,
	}),
	'devstral-small-latest': model({ contextWindow: 131_000, reservedOutputTokenSpace: 8_192 }),
	'mistral-large-latest': model({ contextWindow: 128_000, reservedOutputTokenSpace: 8_192 }),
	'mistral-medium-latest': model({ contextWindow: 128_000, reservedOutputTokenSpace: 8_192 }),
	'ministral-3b-latest': model({ contextWindow: 128_000 }),
	'ministral-8b-latest': model({ contextWindow: 128_000 }),
} as const satisfies { [s: string]: SapphireStaticModelInfo };

const openSourceProfiles = {
	deepseekR1: {
		supportsFIM: false,
		supportsSystemMessage: 'system-role' as const,
		reasoningCapabilities: reasoningOn({ canTurnOff: false, reserved: 16_384 }),
		contextWindow: 64_000,
		reservedOutputTokenSpace: 8_192,
	},
	deepseekChat: {
		supportsFIM: false,
		supportsSystemMessage: 'system-role' as const,
		reasoningCapabilities: false as const,
		contextWindow: 128_000,
		reservedOutputTokenSpace: 8_192,
	},
	codestral: {
		supportsFIM: true,
		fimMaxTokens: 300,
		supportsSystemMessage: 'system-role' as const,
		reasoningCapabilities: false as const,
		contextWindow: 32_000,
		reservedOutputTokenSpace: 4_096,
	},
	devstral: {
		supportsFIM: false,
		supportsSystemMessage: 'system-role' as const,
		reasoningCapabilities: false as const,
		contextWindow: 131_000,
		reservedOutputTokenSpace: 8_192,
	},
	qwen2_5coder: {
		supportsFIM: true,
		fimMaxTokens: 300,
		supportsSystemMessage: 'system-role' as const,
		reasoningCapabilities: false as const,
		contextWindow: 32_000,
		reservedOutputTokenSpace: 4_096,
	},
	qwen3: {
		supportsFIM: false,
		supportsSystemMessage: 'system-role' as const,
		reasoningCapabilities: reasoningOn({ slider: effortSlider('low'), reserved: 8_192 }),
		contextWindow: 32_768,
		reservedOutputTokenSpace: 8_192,
	},
	qwq: {
		supportsFIM: false,
		supportsSystemMessage: 'system-role' as const,
		reasoningCapabilities: reasoningOn({ canTurnOff: false, reserved: 8_192 }),
		contextWindow: 128_000,
		reservedOutputTokenSpace: 8_192,
	},
	llama3: {
		supportsFIM: false,
		supportsSystemMessage: 'system-role' as const,
		reasoningCapabilities: false as const,
		contextWindow: 128_000,
		reservedOutputTokenSpace: 4_096,
	},
	gemma: {
		supportsFIM: false,
		supportsSystemMessage: 'system-role' as const,
		reasoningCapabilities: false as const,
		contextWindow: 32_000,
		reservedOutputTokenSpace: 4_096,
	},
} as const satisfies { [s: string]: Partial<SapphireStaticModelInfo> };

const extensiveModelOptionsFallback: SapphireStaticProviderInfo['modelOptionsFallback'] = (
	modelName,
	fallbackKnownValues,
) => {
	const lower = modelName.toLowerCase();

	const toFallback = <T extends { [s: string]: Partial<SapphireStaticModelInfo> }>(
		obj: T,
		recognizedModelName: string & keyof T,
	): SapphireStaticModelInfo & { modelName: string; recognizedModelName: string } => {
		const opts = obj[recognizedModelName];
		return {
			recognizedModelName,
			modelName,
			...defaultModelOptions,
			supportsSystemMessage: 'system-role',
			...opts,
			...fallbackKnownValues,
		};
	};

	if (lower.includes('gemini') && (lower.includes('2.5') || lower.includes('2-5')))
		{return toFallback(geminiModelOptions, 'gemini-2.5-pro-exp-03-25');}
	if (lower.includes('gemini')) {return toFallback(geminiModelOptions, 'gemini-2.0-flash');}

	if (lower.includes('claude-3-5') || lower.includes('claude-3.5'))
		{return toFallback(anthropicModelOptions, 'claude-3-5-sonnet-20241022');}
	if (lower.includes('claude') && (lower.includes('opus') || lower.includes('sonnet') || lower.includes('3-7') || lower.includes('3.7')))
		{return toFallback(anthropicModelOptions, 'claude-3-7-sonnet-20250219');}
	if (lower.includes('claude')) {return toFallback(anthropicModelOptions, 'claude-3-5-sonnet-20241022');}

	if (lower.includes('grok')) {return toFallback(xAIModelOptions, 'grok-3');}

	if (lower.includes('deepseek') && (lower.includes('reasoner') || lower.includes('r1')))
		{return toFallback(openSourceProfiles, 'deepseekR1');}
	if (lower.includes('deepseek')) {return toFallback(openSourceProfiles, 'deepseekChat');}

	if (lower.includes('llama')) {return toFallback(openSourceProfiles, 'llama3');}
	if (lower.includes('qwen') && lower.includes('coder')) {return toFallback(openSourceProfiles, 'qwen2_5coder');}
	if (lower.includes('qwen') || lower.includes('glm')) {return toFallback(openSourceProfiles, 'qwen3');}
	if (lower.includes('qwq')) {return toFallback(openSourceProfiles, 'qwq');}
	if (lower.includes('codestral')) {return toFallback(openSourceProfiles, 'codestral');}
	if (lower.includes('devstral')) {return toFallback(openSourceProfiles, 'devstral');}
	if (lower.includes('gemma')) {return toFallback(openSourceProfiles, 'gemma');}

	if (lower.includes('gpt') && lower.includes('nano') && (lower.includes('4.1') || lower.includes('4-1')))
		{return toFallback(openAIModelOptions, 'gpt-4.1-nano');}
	if (lower.includes('gpt') && lower.includes('mini') && (lower.includes('4.1') || lower.includes('4-1')))
		{return toFallback(openAIModelOptions, 'gpt-4.1-mini');}
	if (lower.includes('gpt') && (lower.includes('4.1') || lower.includes('4-1')))
		{return toFallback(openAIModelOptions, 'gpt-4.1');}
	if (lower.includes('4o') && lower.includes('mini')) {return toFallback(openAIModelOptions, 'gpt-4o-mini');}
	if (lower.includes('4o')) {return toFallback(openAIModelOptions, 'gpt-4o');}
	if (lower.includes('o1') && lower.includes('mini')) {return toFallback(openAIModelOptions, 'o1-mini');}
	if (lower.includes('o1')) {return toFallback(openAIModelOptions, 'o1');}
	if (lower.includes('o3') && lower.includes('mini')) {return toFallback(openAIModelOptions, 'o3-mini');}
	if (lower.includes('o3')) {return toFallback(openAIModelOptions, 'o3');}
	if (lower.includes('o4') && lower.includes('mini')) {return toFallback(openAIModelOptions, 'o4-mini');}

	if (
		Object.keys(openSourceProfiles)
			.map((k) => k.toLowerCase())
			.includes(lower)
	)
		{return toFallback(openSourceProfiles, lower as keyof typeof openSourceProfiles);}

	return null;
};

const gatewayIncludeInPayloadReasoning = (reasoningInfo: SendableReasoningInfo) => {
	if (!reasoningInfo?.isReasoningEnabled) {return null;}
	if (reasoningInfo.type === 'effort_slider_value') {
		return { reasoning_effort: reasoningInfo.reasoningEffort };
	}
	return null;
};

const openAICompatReasoning: ProviderReasoningIOSettings = {
	input: { includeInPayload: gatewayIncludeInPayloadReasoning },
	output: { nameOfFieldInDelta: 'reasoning_content' },
};

const providerSettings = (
	modelOptions: { [key: string]: SapphireStaticModelInfo },
	reasoning: boolean,
): SapphireStaticProviderInfo => ({
	modelOptions,
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName),
	...(reasoning ? { providerReasoningIOSettings: openAICompatReasoning } : {}),
});

const modelSettingsOfProvider: { [providerName in ProviderName]: SapphireStaticProviderInfo } = {
	anthropic: providerSettings(anthropicModelOptions, false),
	openAI: providerSettings(openAIModelOptions, true),
	deepseek: providerSettings(deepseekModelOptions, true),
	ollama: providerSettings({}, true),
	vLLM: providerSettings({}, true),
	openRouter: providerSettings({}, true),
	openAICompatible: providerSettings({}, true),
	gemini: providerSettings(geminiModelOptions, false),
	groq: providerSettings({}, true),
	xAI: providerSettings(xAIModelOptions, true),
	mistral: providerSettings(mistralModelOptions, true),
	lmStudio: providerSettings({}, true),
	liteLLM: providerSettings({}, true),
	googleVertex: providerSettings({}, true),
	microsoftAzure: providerSettings({}, true),
	awsBedrock: providerSettings({}, true),
};

export const getModelCapabilities = (
	providerName: ProviderName,
	modelName: string,
	overridesOfModel: OverridesOfModel | undefined,
): SapphireStaticModelInfo &
	(
		| { modelName: string; recognizedModelName: string; isUnrecognizedModel: false }
		| { modelName: string; recognizedModelName?: undefined; isUnrecognizedModel: true }
	) => {
	const lowercaseModelName = modelName.toLowerCase();

	const { modelOptions, modelOptionsFallback } = modelSettingsOfProvider[providerName];

	const overrides = overridesOfModel?.[providerName]?.[modelName];

	for (const modelName_ in modelOptions) {
		const lowercaseModelName_ = modelName_.toLowerCase();
		if (lowercaseModelName === lowercaseModelName_) {
			return {
				...modelOptions[modelName_],
				...overrides,
				modelName,
				recognizedModelName: modelName_,
				isUnrecognizedModel: false,
			};
		}
	}

	const result = modelOptionsFallback(modelName);
	if (result) {
		return { ...result, ...overrides, modelName: result.modelName, isUnrecognizedModel: false };
	}

	return { modelName, ...defaultModelOptions, ...overrides, isUnrecognizedModel: true };
};

export const getProviderCapabilities = (providerName: ProviderName) => {
	const { providerReasoningIOSettings } = modelSettingsOfProvider[providerName];
	return { providerReasoningIOSettings };
};

/** Подпись в UI: displayName из каталога или сырой model id. */
export const getModelDisplayName = (
	providerName: ProviderName,
	modelName: string,
	overridesOfModel?: OverridesOfModel,
): string => getModelCapabilities(providerName, modelName, overridesOfModel).displayName ?? modelName;

export const getIsReasoningEnabledState = (
	featureName: FeatureName,
	providerName: ProviderName,
	modelName: string,
	modelSelectionOptions: ModelSelectionOptions | undefined,
	overridesOfModel: OverridesOfModel | undefined,
) => {
	const { supportsReasoning, canTurnOffReasoning } =
		getModelCapabilities(providerName, modelName, overridesOfModel).reasoningCapabilities || {};
	if (!supportsReasoning) {return false;}

	const defaultEnabledVal = featureName === 'Chat' || !canTurnOffReasoning;

	const isReasoningEnabled = modelSelectionOptions?.reasoningEnabled ?? defaultEnabledVal;
	return isReasoningEnabled;
};

/** Резерв под ответ модели — как API `max_tokens` (дефолт 4096), не больше context window. */
export const effectiveReservedOutputTokens = (
	contextWindow: number,
	reservedOutputTokenSpace: number | null | undefined,
): number => Math.min(contextWindow, reservedOutputTokenSpace ?? 4_096);

export const getReservedOutputTokenSpace = (
	providerName: ProviderName,
	modelName: string,
	opts: { isReasoningEnabled: boolean; overridesOfModel: OverridesOfModel | undefined },
) => {
	const { reasoningCapabilities, reservedOutputTokenSpace } = getModelCapabilities(
		providerName,
		modelName,
		opts.overridesOfModel,
	);
	return opts.isReasoningEnabled && reasoningCapabilities
		? reasoningCapabilities.reasoningReservedOutputTokenSpace
		: reservedOutputTokenSpace;
};

export const getSendableReasoningInfo = (
	featureName: FeatureName,
	providerName: ProviderName,
	modelName: string,
	modelSelectionOptions: ModelSelectionOptions | undefined,
	overridesOfModel: OverridesOfModel | undefined,
): SendableReasoningInfo => {
	const { reasoningSlider: reasoningBudgetSlider } =
		getModelCapabilities(providerName, modelName, overridesOfModel).reasoningCapabilities || {};
	const isReasoningEnabled = getIsReasoningEnabledState(
		featureName,
		providerName,
		modelName,
		modelSelectionOptions,
		overridesOfModel,
	);
	if (!isReasoningEnabled) {return null;}

	if (reasoningBudgetSlider?.type === 'effort_slider') {
		const reasoningEffort = modelSelectionOptions?.reasoningEffort ?? reasoningBudgetSlider.default;
		return {
			type: 'effort_slider_value',
			isReasoningEnabled: true,
			reasoningEffort,
		};
	}

	if (reasoningBudgetSlider?.type === 'budget_slider') {
		const reasoningBudget = modelSelectionOptions?.reasoningBudget ?? reasoningBudgetSlider.default;
		if (reasoningBudget <= 0) {return null;}
		return {
			type: 'budget_slider_value',
			isReasoningEnabled: true,
			reasoningBudget,
		};
	}

	return null;
};

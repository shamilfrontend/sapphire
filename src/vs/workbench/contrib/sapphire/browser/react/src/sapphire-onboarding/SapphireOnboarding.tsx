/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import {
	useAccessor,
	useIsDark,
	useSettingsState,
	useRefreshModelListener,
} from '../util/services.js';
import {
	customSettingNamesOfProvider,
	displayInfoOfProviderName,
	displayInfoOfSettingName,
	FeatureName,
	LayoutMode,
	ModelSelection,
	ProviderName,
	providerNames,
	SettingName,
} from '../../../../common/sapphireSettingsTypes.js';
import { getModelCapabilities } from '../../../../common/modelCapabilities.js';
import { LLM_IDE_TITLE } from '../../../../common/llmProviderConfig.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';
import { LayoutModeCards } from '../util/LayoutModeCards.js';

type ValidationState =
	| { kind: 'idle' }
	| { kind: 'validating' }
	| { kind: 'success'; modelCount: number }
	| { kind: 'error'; message: string };

const OVERRIDE_VALUE = false;
const VALIDATE_TIMEOUT_MS = 20_000;
const DEFAULT_ONBOARDING_PROVIDER: ProviderName = 'deepseek';

const applyDefaultFeatureModels = async (
	providerName: ProviderName,
	modelNames: string[],
	setModelSelectionOfFeature: (featureName: FeatureName, selection: ModelSelection) => Promise<void>,
) => {
	if (!modelNames.length) return;
	const chatModel =
		modelNames.find((name) => !getModelCapabilities(providerName, name, undefined).supportsFIM) ??
		modelNames[0];
	const fimModel = modelNames.find((name) => getModelCapabilities(providerName, name, undefined).supportsFIM);

	await setModelSelectionOfFeature('Chat', { providerName, modelName: chatModel });
	await setModelSelectionOfFeature('Ctrl+K', { providerName, modelName: chatModel });
	await setModelSelectionOfFeature('Apply', { providerName, modelName: chatModel });
	await setModelSelectionOfFeature('SCM', { providerName, modelName: chatModel });
	if (fimModel) {
		await setModelSelectionOfFeature('Autocomplete', { providerName, modelName: fimModel });
	}
};

export const SapphireOnboarding = () => {
	const sapphireSettingsState = useSettingsState();
	const isOnboardingComplete = sapphireSettingsState.globalSettings.isOnboardingComplete || OVERRIDE_VALUE;
	const isDark = useIsDark();

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''}`}>
			<div
				className={`
					bg-void-bg-3 fixed top-0 right-0 bottom-0 left-0 width-full z-[99999]
					transition-all duration-1000
					${isOnboardingComplete ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}
				`}
				style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
			>
				<ErrorBoundary>
					<OnboardingContent />
				</ErrorBoundary>
			</div>
		</div>
	);
};

const OnboardingContent = () => {
	const accessor = useAccessor();
	const sapphireSettingsService = accessor.get('ISapphireSettingsService');
	const refreshModelService = accessor.get('IRefreshModelService');
	const settingsState = useSettingsState();

	const [providerName, setProviderName] = useState<ProviderName>(DEFAULT_ONBOARDING_PROVIDER);
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [validation, setValidation] = useState<ValidationState>({ kind: 'idle' });
	const [step, setStep] = useState<'provider' | 'layout'>('provider');
	const [layoutChoice, setLayoutChoice] = useState<LayoutMode>('ide');

	const isOnboardingComplete = settingsState.globalSettings.isOnboardingComplete;
	const layoutMode = settingsState.globalSettings.layoutMode;
	const wasCompleteRef = useRef(isOnboardingComplete);
	const providerInfo = displayInfoOfProviderName(providerName);
	const settingNames = customSettingNamesOfProvider(providerName);

	const models = settingsState.settingsOfProvider[providerName].models;
	const availableModelNames = useMemo(() => {
		const visible = models.filter((model) => !model.isHidden).map((model) => model.modelName);
		return visible.length ? visible : models.map((model) => model.modelName);
	}, [models]);

	useEffect(() => {
		const next: Record<string, string> = {};
		for (const settingName of settingNames) {
			const value = settingsState.settingsOfProvider[providerName][settingName];
			next[settingName] = typeof value === 'string' ? value : '';
		}
		setDrafts(next);
		setValidation({ kind: 'idle' });
	}, [providerName]); // drafts follow the selected provider, not every settings tick

	const validateInProgressRef = useRef(false);
	const validateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearValidateTimeout = useCallback(() => {
		if (validateTimeoutRef.current !== null) {
			clearTimeout(validateTimeoutRef.current);
			validateTimeoutRef.current = null;
		}
	}, []);

	const markSuccess = useCallback(
		(modelCount: number) => {
			if (!validateInProgressRef.current) return;
			validateInProgressRef.current = false;
			clearValidateTimeout();
			setValidation({ kind: 'success', modelCount });
		},
		[clearValidateTimeout],
	);

	const markError = useCallback(
		(message: string) => {
			if (!validateInProgressRef.current) return;
			validateInProgressRef.current = false;
			clearValidateTimeout();
			setValidation({ kind: 'error', message });
		},
		[clearValidateTimeout],
	);

	useRefreshModelListener(
		useCallback(
			(refreshedProvider, nextRefreshState) => {
				if (refreshedProvider !== providerName) return;
				if (!validateInProgressRef.current) return;
				const st = nextRefreshState[providerName]?.state;
				if (st === 'finished') {
					const count = sapphireSettingsService.state.settingsOfProvider[providerName].models.length;
					if (count > 0) markSuccess(count);
					else markError(`${providerInfo.title} ответил, но список моделей пуст.`);
				} else if (st === 'error') {
					markError(`Не удалось получить список моделей от ${providerInfo.title}. Проверьте ключ и адрес API.`);
				}
			},
			[markSuccess, markError, providerInfo.title, providerName, sapphireSettingsService],
		),
	);

	useEffect(() => () => clearValidateTimeout(), [clearValidateTimeout]);

	useLayoutEffect(() => {
		if (wasCompleteRef.current && !isOnboardingComplete) {
			validateInProgressRef.current = false;
			clearValidateTimeout();
			setValidation({ kind: 'idle' });
			setStep('provider');
			setLayoutChoice(layoutMode);
			setProviderName(DEFAULT_ONBOARDING_PROVIDER);
		}
		wasCompleteRef.current = isOnboardingComplete;
	}, [isOnboardingComplete, layoutMode, clearValidateTimeout]);

	const missingRequired = settingNames.some((settingName) => {
		if (providerName === 'awsBedrock' && settingName === 'endpoint') return false;
		if (settingName === 'headersJSON') return false;
		return !(drafts[settingName] ?? '').trim();
	});

	const onValidate = async () => {
		if (missingRequired) {
			setValidation({ kind: 'error', message: 'Заполните обязательные поля провайдера.' });
			return;
		}
		clearValidateTimeout();
		setValidation({ kind: 'validating' });
		validateInProgressRef.current = true;
		validateTimeoutRef.current = setTimeout(() => {
			markError(`${providerInfo.title} не ответил за ${VALIDATE_TIMEOUT_MS / 1000} с. Проверьте сеть и адрес API.`);
		}, VALIDATE_TIMEOUT_MS);

		for (const settingName of settingNames) {
			await sapphireSettingsService.setSettingOfProvider(
				providerName,
				settingName,
				(drafts[settingName] ?? '').trim(),
			);
		}
		refreshModelService.startRefreshingModels(providerName, {
			enableProviderOnSuccess: true,
			doNotFire: false,
		});
	};

	const canFinish = validation.kind === 'success' && availableModelNames.length > 0;

	const onFinish = async () => {
		await applyDefaultFeatureModels(
			providerName,
			availableModelNames,
			sapphireSettingsService.setModelSelectionOfFeature,
		);
		sapphireSettingsService.setGlobalSetting('layoutMode', layoutChoice);
		sapphireSettingsService.setGlobalSetting('isOnboardingComplete', true);
	};

	if (step === 'layout') {
		return (
			<div className="w-full max-w-[560px] px-6 py-10 flex flex-col gap-6">
				<div className="flex flex-col items-center gap-2 text-center">
					<div className="text-4xl font-light">Как работать в {LLM_IDE_TITLE}</div>
					<div className="text-void-fg-3 text-sm max-w-md">
						Режим можно сменить позже в настройках или кнопкой справа сверху.
					</div>
				</div>
				<LayoutModeCards value={layoutChoice} onChange={setLayoutChoice} />
				<div className="flex justify-between">
					<button
						type="button"
						onClick={() => setStep('provider')}
						className="px-4 py-2 rounded text-sm text-void-fg-2 hover:text-void-fg-1"
					>
						Назад
					</button>
					<button
						type="button"
						onClick={onFinish}
						className="px-6 py-2 rounded font-medium bg-zinc-100 text-black hover:bg-white"
					>
						Начать
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="w-full max-w-[560px] px-6 py-10 flex flex-col gap-6">
			<div className="flex flex-col items-center gap-2 text-center">
				<div className="text-4xl font-light">Добро пожаловать в {LLM_IDE_TITLE}</div>
				<div className="text-void-fg-3 text-sm max-w-md">
					Подключите провайдера моделей: облачный API или локальный OpenAI-совместимый сервер.
				</div>
			</div>

			<div className="flex flex-col gap-3 bg-void-bg-2 border border-void-border-2 rounded-md p-5">
				<div className="flex items-center gap-2 text-void-fg-1 text-base font-medium">
					<KeyRound className="w-4 h-4" />
					<span>Провайдер</span>
				</div>
				<select
					value={providerName}
					onChange={(e) => setProviderName(e.target.value as ProviderName)}
					className="w-full px-3 py-2 rounded-sm bg-void-bg-1 border border-void-border-2 text-void-fg-1"
				>
					{providerNames.map((name) => (
						<option key={name} value={name}>
							{displayInfoOfProviderName(name).title}
						</option>
					))}
				</select>
				{providerInfo.desc ? <div className="text-void-fg-3 text-xs">{providerInfo.desc}</div> : null}
				{providerInfo.usageUrl ? (
					<a
						href={providerInfo.usageUrl}
						target="_blank"
						rel="noreferrer"
						className="text-xs underline inline-flex items-center gap-1 text-void-fg-2"
					>
						Ключ и расход
						<ExternalLink className="w-3 h-3" />
					</a>
				) : null}

				{settingNames.map((settingName) => {
					const info = displayInfoOfSettingName(providerName, settingName as SettingName);
					return (
						<label key={settingName} className="flex flex-col gap-1">
							<span className="text-void-fg-3 text-xs">{info.title}</span>
							<input
								type={info.isPasswordField ? 'password' : 'text'}
								value={drafts[settingName] ?? ''}
								spellCheck={false}
								placeholder={info.placeholder}
								onChange={(e) => {
									setDrafts((prev) => ({ ...prev, [settingName]: e.target.value }));
									if (validation.kind !== 'idle') setValidation({ kind: 'idle' });
								}}
								className="w-full px-3 py-2 rounded-sm bg-void-bg-1 border border-void-border-2 text-void-fg-1 focus:outline-none focus:border-void-border-1"
							/>
						</label>
					);
				})}

				<div className="flex items-center gap-2">
					<button
						type="button"
						disabled={missingRequired || validation.kind === 'validating'}
						onClick={onValidate}
						className={`px-4 py-2 rounded text-sm font-medium transition-colors
							${missingRequired || validation.kind === 'validating'
								? 'bg-void-bg-3 text-void-fg-3 cursor-not-allowed'
								: 'bg-[#00b0cc] text-white hover:bg-[#0097b2]'
							}`}
					>
						{validation.kind === 'validating' ? (
							<span className="flex items-center gap-2">
								<Loader2 className="w-3.5 h-3.5 animate-spin" /> Проверка…
							</span>
						) : (
							'Проверить подключение'
						)}
					</button>
					{validation.kind === 'success' && (
						<div className="flex items-center gap-1.5 text-emerald-500 text-sm">
							<CheckCircle2 className="w-4 h-4" />
							<span>Подключено. Моделей: {validation.modelCount}</span>
						</div>
					)}
					{validation.kind === 'error' && (
						<div className="flex items-center gap-1.5 text-rose-500 text-sm">
							<AlertCircle className="w-4 h-4" />
							<span>{validation.message}</span>
						</div>
					)}
				</div>
			</div>

			<div className="text-void-fg-3 text-xs">
				Ключ хранится зашифрованно на этой машине. Сменить провайдера можно в Settings → Провайдеры.
			</div>

			<div className="flex justify-end">
				<button
					type="button"
					disabled={!canFinish}
					onClick={() => setStep('layout')}
					className={`px-6 py-2 rounded font-medium transition-all
						${canFinish ? 'bg-zinc-100 text-black hover:bg-white' : 'bg-zinc-100/40 text-black/40 cursor-not-allowed'}`}
				>
					Далее
				</button>
			</div>
		</div>
	);
};

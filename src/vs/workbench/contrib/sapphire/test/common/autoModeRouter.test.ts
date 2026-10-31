/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	enrichPoolEntry,
	parseRouterChoice,
	partitionModels,
	pickFallbackModel,
	pickRouterModel,
	prepareAutoPool,
	resolveAutoContextEstimateSelection,
	STRONG_CONTEXT_THRESHOLD,
} from '../../common/autoModeRouter.js';
import { getModelCapabilities } from '../../common/modelCapabilities.js';
import {
	isAutoModelSelection,
	SAPPHIRE_AUTO_SELECTION,
} from '../../common/sapphireSettingsTypes.js';

suite('autoModeRouter', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const overrides = undefined;

	test('isAutoModelSelection matches sentinel modelName', () => {
		assert.strictEqual(isAutoModelSelection(SAPPHIRE_AUTO_SELECTION), true);
		assert.strictEqual(
			isAutoModelSelection({ providerName: 'kimi', modelName: 'auto' }),
			true,
		);
		assert.strictEqual(
			isAutoModelSelection({ providerName: 'deepseek', modelName: 'deepseek-flash' }),
			false,
		);
		assert.strictEqual(isAutoModelSelection(null), false);
	});

	test('partition DeepSeek 1M vs 128K', () => {
		const pool = [
			enrichPoolEntry({ providerName: 'deepseek', modelName: 'deepseek-flash' }, overrides),
			enrichPoolEntry({ providerName: 'deepseek', modelName: 'deepseek-v4-pro' }, overrides),
			enrichPoolEntry({ providerName: 'deepseek', modelName: 'deepseek-chat' }, overrides),
			enrichPoolEntry({ providerName: 'deepseek', modelName: 'deepseek-reasoner' }, overrides),
		];
		const { strong, simple } = partitionModels(pool);
		assert.ok(strong.every((entry) => entry.contextWindow >= STRONG_CONTEXT_THRESHOLD));
		assert.ok(simple.every((entry) => entry.contextWindow < STRONG_CONTEXT_THRESHOLD));
		assert.deepStrictEqual(
			strong.map((entry) => entry.modelName).sort(),
			['deepseek-flash', 'deepseek-v4-pro'],
		);
		assert.deepStrictEqual(
			simple.map((entry) => entry.modelName).sort(),
			['deepseek-chat', 'deepseek-reasoner'],
		);
	});

	test('partition mixed DeepSeek + Kimi', () => {
		const pool = [
			enrichPoolEntry({ providerName: 'deepseek', modelName: 'deepseek-flash' }, overrides),
			enrichPoolEntry({ providerName: 'deepseek', modelName: 'deepseek-chat' }, overrides),
			enrichPoolEntry({ providerName: 'kimi', modelName: 'kimi-k3.1-pro' }, overrides),
			enrichPoolEntry({ providerName: 'kimi', modelName: 'kimi-k2.6' }, overrides),
		];
		const { strong, simple } = partitionModels(pool);
		assert.deepStrictEqual(
			strong.map((entry) => `${entry.providerName}/${entry.modelName}`).sort(),
			['deepseek/deepseek-flash', 'kimi/kimi-k3.1-pro'],
		);
		assert.deepStrictEqual(
			simple.map((entry) => `${entry.providerName}/${entry.modelName}`).sort(),
			['deepseek/deepseek-chat', 'kimi/kimi-k2.6'],
		);
		assert.strictEqual(
			enrichPoolEntry({ providerName: 'kimi', modelName: 'kimi-k2.6' }, overrides).contextWindow,
			262_144,
		);
	});

	test('prepareAutoPool single and empty', () => {
		assert.strictEqual(prepareAutoPool([], overrides).kind, 'empty');
		assert.strictEqual(
			prepareAutoPool([SAPPHIRE_AUTO_SELECTION], overrides).kind,
			'empty',
		);
		const single = prepareAutoPool(
			[{ providerName: 'kimi', modelName: 'kimi-k2.6' }],
			overrides,
		);
		assert.strictEqual(single.kind, 'single');
		if (single.kind === 'single') {
			assert.strictEqual(single.selection.modelName, 'kimi-k2.6');
		}
	});

	test('prepareAutoPool multi returns router', () => {
		const prepared = prepareAutoPool(
			[
				{ providerName: 'deepseek', modelName: 'deepseek-chat' },
				{ providerName: 'deepseek', modelName: 'deepseek-flash' },
			],
			overrides,
		);
		assert.strictEqual(prepared.kind, 'multi');
		if (prepared.kind === 'multi') {
			assert.strictEqual(prepared.pool.length, 2);
			assert.ok(prepared.router.contextWindow >= STRONG_CONTEXT_THRESHOLD);
		}
	});

	test('pickRouterModel prefers highspeed at equal context', () => {
		const pool = [
			enrichPoolEntry({ providerName: 'kimi', modelName: 'kimi-k3.1-pro' }, overrides),
			enrichPoolEntry(
				{ providerName: 'kimi', modelName: 'kimi-k3.1-pro-highspeed' },
				overrides,
			),
		];
		const router = pickRouterModel(pool);
		assert.strictEqual(router?.modelName, 'kimi-k3.1-pro-highspeed');
	});

	test('pickFallbackModel uses strong when available', () => {
		const pool = [
			enrichPoolEntry({ providerName: 'deepseek', modelName: 'deepseek-chat' }, overrides),
			enrichPoolEntry({ providerName: 'deepseek', modelName: 'deepseek-flash' }, overrides),
		];
		assert.strictEqual(pickFallbackModel(pool)?.modelName, 'deepseek-flash');
	});

	test('resolveAutoContextEstimateSelection uses router window, not Auto default 4096', () => {
		const sentinelWindow = getModelCapabilities(
			SAPPHIRE_AUTO_SELECTION.providerName,
			SAPPHIRE_AUTO_SELECTION.modelName,
			overrides,
		).contextWindow;
		assert.strictEqual(sentinelWindow, 4_096);

		const pool = [
			SAPPHIRE_AUTO_SELECTION,
			{ providerName: 'deepseek' as const, modelName: 'deepseek-chat' },
			{ providerName: 'deepseek' as const, modelName: 'deepseek-flash' },
		];
		const standIn = resolveAutoContextEstimateSelection(pool, overrides);
		assert.deepStrictEqual(standIn, {
			providerName: 'deepseek',
			modelName: 'deepseek-flash',
		});
		assert.strictEqual(
			getModelCapabilities(standIn!.providerName, standIn!.modelName, overrides).contextWindow,
			1_048_576,
		);

		assert.strictEqual(
			resolveAutoContextEstimateSelection([SAPPHIRE_AUTO_SELECTION], overrides),
			undefined,
		);
		assert.deepStrictEqual(
			resolveAutoContextEstimateSelection(
				[{ providerName: 'kimi', modelName: 'kimi-k2.6' }],
				overrides,
			),
			{ providerName: 'kimi', modelName: 'kimi-k2.6' },
		);
	});

	test('parseRouterChoice accepts JSON and rejects unknown ids', () => {
		const pool = [
			{ providerName: 'deepseek' as const, modelName: 'deepseek-flash' },
			{ providerName: 'kimi' as const, modelName: 'kimi-k2.6' },
		];
		assert.deepStrictEqual(
			parseRouterChoice(
				'{"providerName":"kimi","modelName":"kimi-k2.6"}',
				pool,
			),
			{ providerName: 'kimi', modelName: 'kimi-k2.6' },
		);
		assert.deepStrictEqual(
			parseRouterChoice(
				'Sure.\n```json\n{"providerName":"deepseek","modelName":"deepseek-flash"}\n```',
				pool,
			),
			{ providerName: 'deepseek', modelName: 'deepseek-flash' },
		);
		assert.strictEqual(
			parseRouterChoice('{"providerName":"kimi","modelName":"kimi-hallucinated"}', pool),
			undefined,
		);
		assert.strictEqual(parseRouterChoice('not json', pool), undefined);
	});
});

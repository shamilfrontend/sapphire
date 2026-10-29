/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { ActivityBarPosition, LayoutSettings } from '../../../services/layout/browser/layoutService.js';
import { IWorkbenchThemeService, ThemeSettingDefaults, ThemeSettings } from '../../../services/themes/common/workbenchThemeService.js';

/** Уже перевели профиль с Dark 2026 на Sapphire UI. Повторно не трогаем. */
const MIGRATION_KEY = 'sapphire.theme.sapphireUi.v1';
const LEGACY_DARK_THEME = 'Dark 2026';

/** Ряд иконок в шапке сайдбара уже приведён к Cursor. Повторно не трогаем. */
const ACTIVITY_BAR_MIGRATION_KEY = 'sapphire.activityBar.cursorRow.v1';
const PINNED_VIEWLETS_KEY = 'workbench.activity.pinnedViewlets2';
const CURSOR_ACTIVITY_ROW = [
	'workbench.view.explorer',
	'workbench.view.search',
	'workbench.view.scm',
	'workbench.view.extensions',
];

interface IPinnedViewlet {
	id: string;
	pinned: boolean;
	visible?: boolean;
	order?: number;
}

class SapphireCursorChromeContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.sapphireCursorChrome';

	constructor(
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
	) {
		super();
		void this.migrateOnce();
		void this.migrateActivityBarOnce();
	}

	private async migrateOnce(): Promise<void> {
		try {
			if (this.storageService.getBoolean(MIGRATION_KEY, StorageScope.PROFILE, false)) {
				return;
			}
			await this.extensionService.whenInstalledExtensionsRegistered();
			const themes = await this.themeService.getColorThemes();
			const sapphire = themes.find(theme => theme.settingsId === ThemeSettingDefaults.COLOR_THEME_DARK);
			if (!sapphire) {
				return;
			}

			const current = this.configurationService.getValue<string>(ThemeSettings.COLOR_THEME);
			const preferred = this.configurationService.getValue<string>(ThemeSettings.PREFERRED_DARK_THEME);
			if (current === LEGACY_DARK_THEME) {
				const applied = await this.themeService.setColorTheme(sapphire.id, ConfigurationTarget.USER);
				if (!applied) {
					return;
				}
			}
			if (preferred === LEGACY_DARK_THEME) {
				await this.configurationService.updateValue(
					ThemeSettings.PREFERRED_DARK_THEME,
					ThemeSettingDefaults.COLOR_THEME_DARK,
					ConfigurationTarget.USER,
				);
			}
			this.storageService.store(MIGRATION_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
		} catch (error) {
			onUnexpectedError(error);
		}
	}

	/** Боковую рейку поднимаем в шапку и оставляем в ряду только четыре иконки Cursor. */
	private async migrateActivityBarOnce(): Promise<void> {
		try {
			if (this.environmentService.isSessionsWindow) {
				return;
			}
			if (this.storageService.getBoolean(ACTIVITY_BAR_MIGRATION_KEY, StorageScope.PROFILE, false)) {
				return;
			}
			await this.extensionService.whenInstalledExtensionsRegistered();

			const current = this.configurationService.getValue<string>(LayoutSettings.ACTIVITY_BAR_LOCATION);
			if (current === ActivityBarPosition.DEFAULT) {
				await this.configurationService.updateValue(
					LayoutSettings.ACTIVITY_BAR_LOCATION,
					ActivityBarPosition.TOP,
					ConfigurationTarget.USER,
				);
			}
			const remembered = this.storageService.get(LayoutSettings.ACTIVITY_BAR_LOCATION, StorageScope.PROFILE);
			if (remembered === ActivityBarPosition.DEFAULT) {
				this.storageService.store(
					LayoutSettings.ACTIVITY_BAR_LOCATION,
					ActivityBarPosition.TOP,
					StorageScope.PROFILE,
					StorageTarget.USER,
				);
			}
			this.pinCursorActivityRow();
			this.storageService.store(ACTIVITY_BAR_MIGRATION_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
		} catch (error) {
			onUnexpectedError(error);
		}
	}

	private pinCursorActivityRow(): void {
		const raw = this.storageService.get(PINNED_VIEWLETS_KEY, StorageScope.PROFILE, '[]');
		let items: IPinnedViewlet[] = [];
		try {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				items = parsed.filter((item): item is IPinnedViewlet => !!item && typeof item.id === 'string');
			}
		} catch {
			return;
		}

	const pinnedIds = new Set(CURSOR_ACTIVITY_ROW);
	const row = CURSOR_ACTIVITY_ROW.map((id, order) => {
		const existing = items.find(item => item.id === id);
		// visible: true обязательно: PaneCompositeBar строит ряд только из item.visible,
		// иначе после записи в storage четыре иконки Cursor пропадут.
		return { ...existing, id, pinned: true, visible: true, order };
	});
		let order = CURSOR_ACTIVITY_ROW.length;
		const rest = items
			.filter(item => !pinnedIds.has(item.id))
			.map(item => ({ ...item, pinned: false, order: order++ }));
		this.storageService.store(
			PINNED_VIEWLETS_KEY,
			JSON.stringify([...row, ...rest]),
			StorageScope.PROFILE,
			StorageTarget.USER,
		);
	}
}

registerWorkbenchContribution2(
	SapphireCursorChromeContribution.ID,
	SapphireCursorChromeContribution,
	WorkbenchPhase.AfterRestored,
);

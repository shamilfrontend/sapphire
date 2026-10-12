/*--------------------------------------------------------------------------------------
 *  PPR Code — show «Проект проиндексирован» in the IDE titlebar (left).
 *--------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { getActiveWindow, h } from '../../../../base/browser/dom.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
  IWorkbenchContribution,
  registerWorkbenchContribution2,
  WorkbenchPhase,
} from '../../../common/contributions.js';
import { ISapphireSettingsService } from '../common/sapphireSettingsService.js';
import { mountProjectIndexTitlebar } from './vue/out/project-index-titlebar-tsx/index.js';

const HOST_CLASS = 'ppr-project-index-titlebar';

class ProjectIndexTitlebarContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.sapphireProjectIndexTitlebar';

  private readonly _mount = this._register(new MutableDisposable());
  private readonly _retry = this._register(new MutableDisposable());

  constructor(
    @IInstantiationService private readonly instantiationService: IInstantiationService,
    @ISapphireSettingsService private readonly settingsService: ISapphireSettingsService,
  ) {
    super();
    this._register(this.settingsService.onDidChangeState(() => this._sync()));
    void this.settingsService.waitForInitState.then(() => this._sync());
    // Titlebar может появиться чуть позже фазы AfterRestored.
    const win = getActiveWindow();
    const t = win.setTimeout(() => this._sync(), 0);
    this._register(toDisposable(() => win.clearTimeout(t)));
  }

  private _sync(attempt = 0): void {
    const { layoutMode, isOnboardingComplete } = this.settingsService.state.globalSettings;
    const show = isOnboardingComplete && layoutMode === 'ide';
    if (!show) {
      this._retry.clear();
      this._mount.clear();
      this._removeHost();
      return;
    }
    if (this._mount.value) {
      this._retry.clear();
      return;
    }
    const left = getActiveWindow().document.querySelector(
      '.monaco-workbench .part.titlebar .titlebar-left',
    );
    if (!left) {
      if (attempt < 20) {
        const win = getActiveWindow();
        const t = win.setTimeout(() => this._sync(attempt + 1), 100);
        this._retry.value = toDisposable(() => win.clearTimeout(t));
      }
      return;
    }
    this._retry.clear();
    // Не дублируем host, если прошлый dispose не снял DOM.
    this._removeHost();
    const host = h(`div.${HOST_CLASS}`).root;
    host.style.display = 'flex';
    host.style.alignItems = 'center';
    host.style.flexShrink = '0';
    host.style.minWidth = '188px';
    host.style.marginLeft = '4px';
    // Выше .titlebar-drag-region; no-drag как у menubar / toolbar.
    host.style.position = 'relative';
    host.style.zIndex = '2500';
    (host.style as CSSStyleDeclaration & { webkitAppRegion?: string }).webkitAppRegion = 'no-drag';
    left.appendChild(host);

    this.instantiationService.invokeFunction((accessor: ServicesAccessor) => {
      const result = mountProjectIndexTitlebar(host, accessor);
      this._mount.value = toDisposable(() => {
        result?.dispose?.();
        host.remove();
      });
    });
  }

  private _removeHost(): void {
    getActiveWindow()
      .document.querySelectorAll(`.${HOST_CLASS}`)
      .forEach((el) => el.remove());
  }
}

registerWorkbenchContribution2(
  ProjectIndexTitlebarContribution.ID,
  ProjectIndexTitlebarContribution,
  WorkbenchPhase.AfterRestored,
);

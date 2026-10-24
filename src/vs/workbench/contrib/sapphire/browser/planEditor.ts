/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { Event } from '../../../../base/common/event.js';
import {
  Disposable,
  DisposableStore,
  IReference,
  MutableDisposable,
  toDisposable,
} from '../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { assertReturnsDefined } from '../../../../base/common/types.js';
import { ICodeEditorViewState, ScrollType } from '../../../../editor/common/editorCommon.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import {
  IResolvedTextEditorModel,
  ITextModelService,
} from '../../../../editor/common/services/resolverService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { AbstractTextCodeEditor } from '../../../browser/parts/editor/textCodeEditor.js';
import {
  EditorExtensions,
  IEditorFactoryRegistry,
  IEditorOpenContext,
  IEditorSerializer,
  IMoveResult,
  GroupIdentifier,
  IUntypedEditorInput,
  isResourceEditorInput,
  isTextEditorViewState,
} from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { AbstractTextResourceEditorInput } from '../../../common/editor/textResourceEditorInput.js';
import { applyTextEditorOptions } from '../../../common/editor/editorOptions.js';
import {
  IWorkbenchContribution,
  WorkbenchPhase,
  registerWorkbenchContribution2,
} from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import {
  IEditorGroup,
  IEditorGroupsService,
} from '../../../services/editor/common/editorGroupsService.js';
import {
  IEditorResolverService,
  RegisteredEditorPriority,
} from '../../../services/editor/common/editorResolverService.js';
import { ICustomEditorLabelService } from '../../../services/editor/common/customEditorLabelService.js';
import { IFilesConfigurationService } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import {
  ITextFileEditorModel,
  ITextFileService,
  TextFileResolveReason,
} from '../../../services/textfile/common/textfiles.js';
import {
  IWorkingCopyEditorHandler,
  IWorkingCopyEditorService,
} from '../../../services/workingCopy/common/workingCopyEditorService.js';
import {
  IWorkingCopyIdentifier,
  NO_TYPE_ID,
} from '../../../services/workingCopy/common/workingCopy.js';
import { ITextEditorOptions } from '../../../../platform/editor/common/editor.js';
import {
  isPlanFilePath,
  parsePlanMarkdown,
  type ParsedPlanMarkdown,
} from '../common/prompt/planFileHelpers.js';
import { mountPlanEditor } from './vue/out/plan-editor-tsx/index.js';

type PlanEditorMode = 'preview' | 'markdown';

const PLAN_EDITOR_ID = 'sapphire.planEditor';
const LEGACY_PLAN_EDITOR_ID = 'ppr.planEditor';
const PLAN_EDITOR_INPUT_ID = 'workbench.editors.sapphire.planEditorInput';
const LEGACY_PLAN_EDITOR_INPUT_ID = 'workbench.editors.ppr.planEditorInput';
const PLAN_EDITOR_PANE_ID = 'workbench.editor.sapphire.planEditor';
const PLAN_EDITOR_TOOLBAR_HEIGHT = 36;

interface IPlanEditorViewState extends ICodeEditorViewState {
  planMode?: PlanEditorMode;
}

interface ISerializedPlanEditorInput {
  resourceJSON: UriComponents;
}

class PlanEditorInput extends AbstractTextResourceEditorInput {
  static readonly ID = PLAN_EDITOR_INPUT_ID;

  override get typeId(): string {
    return PlanEditorInput.ID;
  }

  override get editorId(): string | undefined {
    return PLAN_EDITOR_ID;
  }

  private cachedModelRef: IReference<IResolvedTextEditorModel> | undefined;
  private readonly modelListeners = this._register(new DisposableStore());

  constructor(
    resource: URI,
    @IEditorService editorService: IEditorService,
    @ITextFileService textFileService: ITextFileService,
    @ILabelService labelService: ILabelService,
    @IFileService fileService: IFileService,
    @IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
    @ITextResourceConfigurationService
    textResourceConfigurationService: ITextResourceConfigurationService,
    @ICustomEditorLabelService customEditorLabelService: ICustomEditorLabelService,
    @ITextModelService private readonly textModelService: ITextModelService,
  ) {
    super(
      resource,
      undefined,
      editorService,
      textFileService,
      labelService,
      fileService,
      filesConfigurationService,
      textResourceConfigurationService,
      customEditorLabelService,
    );

    const existing = this.textFileService.files.get(resource);
    if (existing) {
      this.registerModelListeners(existing);
    }
    this._register(
      this.textFileService.files.onDidCreate((model) => {
        if (isEqual(model.resource, this.resource)) {
          this.registerModelListeners(model);
        }
      }),
    );
  }

  private registerModelListeners(model: ITextFileEditorModel): void {
    this.modelListeners.clear();
    this.modelListeners.add(model.onDidChangeDirty(() => this._onDidChangeDirty.fire()));
    this.modelListeners.add(model.onDidChangeReadonly(() => this._onDidChangeCapabilities.fire()));
    this.modelListeners.add(model.onDidSaveError(() => this._onDidChangeDirty.fire()));
    this.modelListeners.add(
      Event.once(model.onWillDispose)(() => {
        this.modelListeners.clear();
      }),
    );
  }

  override isDirty(): boolean {
    return !!this.textFileService.files.get(this.resource)?.isDirty();
  }

  override async resolve(): Promise<IResolvedTextEditorModel> {
    await this.textFileService.files.resolve(this.resource, {
      reload: { async: true },
      reason: TextFileResolveReason.EDITOR,
    });

    if (!this.cachedModelRef) {
      this.cachedModelRef = await this.textModelService.createModelReference(this.resource);
    }

    const model = this.cachedModelRef.object;
    if (this.isDisposed()) {
      this.disposeModelReference();
    }
    return model;
  }

  override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
    if (this === otherInput) {
      return true;
    }
    if (otherInput instanceof PlanEditorInput) {
      return isEqual(otherInput.resource, this.resource);
    }
    if (isResourceEditorInput(otherInput)) {
      return super.matches(otherInput);
    }
    return false;
  }

  override toUntyped(): IUntypedEditorInput {
    return {
      resource: this.resource,
      options: { override: PLAN_EDITOR_ID },
    };
  }

  override async rename(group: GroupIdentifier, target: URI): Promise<IMoveResult> {
    return {
      editor: {
        resource: target,
        options: { override: PLAN_EDITOR_ID },
      },
    };
  }

  override dispose(): void {
    this.disposeModelReference();
    super.dispose();
  }

  private disposeModelReference(): void {
    this.cachedModelRef?.dispose();
    this.cachedModelRef = undefined;
  }
}

class PlanEditorInputSerializer implements IEditorSerializer {
  canSerialize(editorInput: EditorInput): boolean {
    return editorInput instanceof PlanEditorInput;
  }

  serialize(editorInput: EditorInput): string | undefined {
    if (!(editorInput instanceof PlanEditorInput)) {
      return undefined;
    }
    const serialized: ISerializedPlanEditorInput = {
      resourceJSON: editorInput.resource.toJSON(),
    };
    return JSON.stringify(serialized);
  }

  deserialize(
    instantiationService: IInstantiationService,
    serializedEditorInput: string,
  ): PlanEditorInput | undefined {
    const parsed = JSON.parse(serializedEditorInput) as ISerializedPlanEditorInput;
    const resource = URI.revive(parsed.resourceJSON);
    if (!resource || !isPlanFilePath(resource.path)) {
      return undefined;
    }
    return instantiationService.createInstance(PlanEditorInput, resource);
  }
}

class PlanEditorPane extends AbstractTextCodeEditor<IPlanEditorViewState> {
  static readonly ID = PLAN_EDITOR_PANE_ID;

  private overlay: HTMLElement | undefined;
  private editorRoot: HTMLElement | undefined;
  private mount: { rerender: (props?: unknown) => void; dispose: () => void } | undefined;
  private mode: PlanEditorMode = 'preview';
  private parsed: ParsedPlanMarkdown = { name: '', overview: '', plan: '', todos: [] };
  private readonly contentListener = this._register(new MutableDisposable());

  constructor(
    group: IEditorGroup,
    @ITelemetryService telemetryService: ITelemetryService,
    @IInstantiationService instantiationService: IInstantiationService,
    @IStorageService storageService: IStorageService,
    @ITextResourceConfigurationService
    textResourceConfigurationService: ITextResourceConfigurationService,
    @IThemeService themeService: IThemeService,
    @IEditorService editorService: IEditorService,
    @IEditorGroupsService editorGroupService: IEditorGroupsService,
    @IFileService fileService: IFileService,
  ) {
    super(
      PlanEditorPane.ID,
      group,
      telemetryService,
      instantiationService,
      storageService,
      textResourceConfigurationService,
      themeService,
      editorService,
      editorGroupService,
      fileService,
    );
  }

  override get input(): PlanEditorInput | undefined {
    return this._input as PlanEditorInput;
  }

  protected override createEditor(parent: HTMLElement): void {
    this.editorRoot = parent;
    parent.classList.add('sapphire-plan-editor');
    this.syncModeClass();

    const monacoHost = document.createElement('div');
    monacoHost.className = 'sapphire-plan-editor-monaco';
    parent.appendChild(monacoHost);

    super.createEditor(monacoHost);

    this.overlay = document.createElement('div');
    this.overlay.className = 'sapphire-plan-editor-overlay';
    parent.appendChild(this.overlay);

    this.instantiationService.invokeFunction((accessor) => {
      this.mount = mountPlanEditor(this.overlay!, accessor, this.getChromeProps());
      this._register(toDisposable(() => this.mount?.dispose()));
    });
  }

  private syncModeClass(): void {
    this.editorRoot?.classList.toggle('sapphire-plan-editor-mode-preview', this.mode === 'preview');
    this.editorRoot?.classList.toggle('sapphire-plan-editor-mode-markdown', this.mode === 'markdown');
  }

  private getChromeProps() {
    return {
      mode: this.mode,
      name: this.parsed.name,
      overview: this.parsed.overview,
      plan: this.parsed.plan,
      todos: this.parsed.todos,
      planUriFsPath: this.input?.resource.fsPath ?? '',
      onModeChange: (mode: PlanEditorMode) => this.setMode(mode),
    };
  }

  private setMode(mode: PlanEditorMode): void {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    this.syncModeClass();
    this.mount?.rerender(this.getChromeProps());
    if (mode === 'markdown') {
      this.editorControl?.focus();
    }
  }

  private refreshPreviewFromModel(): void {
    const value = this.editorControl?.getModel()?.getValue() ?? '';
    this.parsed = parsePlanMarkdown(value);
    this.mount?.rerender(this.getChromeProps());
  }

  override async setInput(
    input: PlanEditorInput,
    options: ITextEditorOptions | undefined,
    context: IEditorOpenContext,
    token: CancellationToken,
  ): Promise<void> {
    await super.setInput(input, options, context, token);
    const resolvedModel = await input.resolve();
    if (token.isCancellationRequested) {
      return;
    }

    const control = assertReturnsDefined(this.editorControl);
    const textEditorModel = resolvedModel.textEditorModel;
    control.setModel(textEditorModel);

    this.contentListener.value = textEditorModel.onDidChangeContent(() =>
      this.refreshPreviewFromModel(),
    );

    let editorViewState = isTextEditorViewState(options?.viewState)
      ? (options?.viewState as IPlanEditorViewState)
      : this.loadEditorViewState(input, context);

    if (editorViewState?.planMode) {
      this.mode = editorViewState.planMode;
    } else {
      this.mode = 'preview';
    }
    this.syncModeClass();

    if (!isTextEditorViewState(options?.viewState) && editorViewState) {
      if (options?.selection) {
        editorViewState = { ...editorViewState, cursorState: [] };
      }
      control.restoreViewState(editorViewState);
    }

    if (options) {
      applyTextEditorOptions(options, control, ScrollType.Immediate);
    }

    control.updateOptions(this.getReadonlyConfiguration(resolvedModel.isReadonly()));
    this.refreshPreviewFromModel();
  }

  override clearInput(): void {
    this.contentListener.clear();
    super.clearInput();
    this.editorControl?.setModel(null);
    this.parsed = { name: '', overview: '', plan: '', todos: [] };
    this.mode = 'preview';
    this.syncModeClass();
    this.mount?.rerender(this.getChromeProps());
  }

  protected override computeEditorViewState(resource: URI): IPlanEditorViewState | undefined {
    const viewState = super.computeEditorViewState(resource);
    if (!viewState) {
      return undefined;
    }
    return { ...viewState, planMode: this.mode };
  }

  protected override tracksEditorViewState(input: EditorInput): boolean {
    return input instanceof PlanEditorInput;
  }

  protected override tracksDisposedEditorViewState(): boolean {
    return true;
  }

  override layout(dimension: Dimension): void {
    this.editorControl?.layout(
      new Dimension(dimension.width, Math.max(0, dimension.height - PLAN_EDITOR_TOOLBAR_HEIGHT)),
    );
  }
}

class PlanEditorContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.sapphire.planEditor';

  constructor(
    @IEditorResolverService editorResolverService: IEditorResolverService,
    @IInstantiationService instantiationService: IInstantiationService,
  ) {
    super();
    const options = {
      singlePerResource: true,
      canSupportResource: (resource: URI) => isPlanFilePath(resource.path),
    };
    const factory = {
      createEditorInput: ({ resource }: { resource: URI }) => ({
        editor: instantiationService.createInstance(PlanEditorInput, resource),
      }),
    };
    const label = localize('sapphire.planEditor.label', 'Plan Editor');
    this._register(
      editorResolverService.registerEditor(
        '*.plan.md',
        {
          id: PLAN_EDITOR_ID,
          label,
          priority: RegisteredEditorPriority.default,
        },
        options,
        factory,
      ),
    );
    // Legacy Open With / association id from PPR builds
    this._register(
      editorResolverService.registerEditor(
        '*.plan.md',
        {
          id: LEGACY_PLAN_EDITOR_ID,
          label,
          priority: RegisteredEditorPriority.option,
        },
        options,
        factory,
      ),
    );
  }
}

class PlanEditorWorkingCopyEditorHandler
  extends Disposable
  implements IWorkbenchContribution, IWorkingCopyEditorHandler
{
  static readonly ID = 'workbench.contrib.sapphire.planEditorWorkingCopyHandler';

  constructor(
    @IInstantiationService private readonly instantiationService: IInstantiationService,
    @IWorkingCopyEditorService workingCopyEditorService: IWorkingCopyEditorService,
  ) {
    super();
    this._register(workingCopyEditorService.registerHandler(this));
  }

  handles(workingCopy: IWorkingCopyIdentifier): boolean {
    return workingCopy.typeId === NO_TYPE_ID && isPlanFilePath(workingCopy.resource.path);
  }

  isOpen(workingCopy: IWorkingCopyIdentifier, editor: EditorInput): boolean {
    return editor instanceof PlanEditorInput && isEqual(workingCopy.resource, editor.resource);
  }

  createEditor(workingCopy: IWorkingCopyIdentifier): EditorInput {
    return this.instantiationService.createInstance(PlanEditorInput, workingCopy.resource);
  }
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
  EditorPaneDescriptor.create(
    PlanEditorPane,
    PlanEditorPane.ID,
    localize('sapphire.planEditor.pane', 'Plan Editor'),
  ),
  [new SyncDescriptor(PlanEditorInput)],
);

const editorFactoryRegistry = Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory);
editorFactoryRegistry.registerEditorSerializer(PlanEditorInput.ID, PlanEditorInputSerializer);
// Restore tabs serialized under the legacy PPR input typeId
editorFactoryRegistry.registerEditorSerializer(LEGACY_PLAN_EDITOR_INPUT_ID, PlanEditorInputSerializer);
registerWorkbenchContribution2(
  PlanEditorContribution.ID,
  PlanEditorContribution,
  WorkbenchPhase.BlockStartup,
);

registerWorkbenchContribution2(
  PlanEditorWorkingCopyEditorHandler.ID,
  PlanEditorWorkingCopyEditorHandler,
  WorkbenchPhase.BlockRestore,
);

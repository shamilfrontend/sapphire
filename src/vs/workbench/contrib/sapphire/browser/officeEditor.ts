/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { FileChangeType, IFileService } from '../../../../platform/files/common/files.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import {
	EditorExtensions,
	EditorInputCapabilities,
	GroupIdentifier,
	IEditorFactoryRegistry,
	IEditorOpenContext,
	IEditorSerializer,
	IRevertOptions,
	ISaveOptions,
	IUntypedEditorInput,
} from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import {
	IWorkbenchContribution,
	WorkbenchPhase,
	registerWorkbenchContribution2,
} from '../../../common/contributions.js';
import {
	IEditorResolverService,
	RegisteredEditorPriority,
} from '../../../services/editor/common/editorResolverService.js';
import {
	IWorkingCopyEditorHandler,
	IWorkingCopyEditorService,
} from '../../../services/workingCopy/common/workingCopyEditorService.js';
import {
	IWorkingCopy,
	IWorkingCopyBackup,
	IWorkingCopyIdentifier,
	IWorkingCopySaveEvent,
	WorkingCopyCapabilities,
} from '../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { IOfficeExtractService } from '../common/officeExtractService.js';
import { officeKindFromPath } from '../common/office/officeDocument.js';
import {
	OfficeDocumentModel,
	OfficeFileStamp,
	OfficeTextEdit,
	cellId,
	sheetDisplayRows,
} from '../common/office/officeModel.js';
import { Dimension } from '../../../../base/browser/dom.js';

const OFFICE_EDITOR_ID = 'sapphire.officeEditor';
const OFFICE_EDITOR_INPUT_ID = 'workbench.editors.sapphire.officeEditorInput';
const OFFICE_EDITOR_PANE_ID = 'workbench.editor.sapphire.officeEditor';
const OFFICE_WORKING_COPY_TYPE = 'sapphire.officeEditor';
const MAX_RENDER_ROWS = 300;

type OfficeEditorSession = {
	collectEdits(): OfficeTextEdit[];
	getStamp(): OfficeFileStamp;
	markSaved(stamp: OfficeFileStamp): void;
	revertFromDisk(): Promise<void>;
	showError(message: string): void;
};

class OfficeEditorInput extends EditorInput {
	static readonly ID = OFFICE_EDITOR_INPUT_ID;

	private dirty = false;
	private session: OfficeEditorSession | undefined;
	private readonly _onDidSave = this._register(new Emitter<IWorkingCopySaveEvent>());
	private readonly _onDidChangeContent = this._register(new Emitter<void>());

	constructor(
		readonly resource: URI,
		@IOfficeExtractService private readonly officeExtractService: IOfficeExtractService,
		@ILabelService private readonly labelService: ILabelService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
	) {
		super();
		const input = this;
		const workingCopy: IWorkingCopy = {
			typeId: OFFICE_WORKING_COPY_TYPE,
			resource: input.resource,
			get name() { return input.getName(); },
			capabilities: WorkingCopyCapabilities.None,
			onDidChangeDirty: input.onDidChangeDirty,
			onDidChangeContent: input._onDidChangeContent.event,
			onDidSave: input._onDidSave.event,
			isDirty: () => input.isDirty(),
			isModified: () => input.isDirty(),
			backup: async (_token: CancellationToken): Promise<IWorkingCopyBackup> => ({
				content: VSBuffer.fromString(JSON.stringify(input.session?.collectEdits() ?? [])),
			}),
			save: async (options) => !!(await input.save(0, options)),
			revert: async (options) => input.revert(0, options),
		};
		this._register(workingCopyService.registerWorkingCopy(workingCopy));
	}

	override get typeId(): string {
		return OfficeEditorInput.ID;
	}

	override get editorId(): string {
		return OFFICE_EDITOR_ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.None;
	}

	override getName(): string {
		return this.labelService.getUriBasenameLabel(this.resource);
	}

	override getDescription(): string | undefined {
		return this.labelService.getUriLabel(URI.joinPath(this.resource, '..'), { relative: true });
	}

	override isDirty(): boolean {
		return this.dirty;
	}

	setDirty(value: boolean): void {
		if (this.dirty === value) {
			return;
		}
		this.dirty = value;
		this._onDidChangeDirty.fire();
		this._onDidChangeContent.fire();
	}

	bind(session: OfficeEditorSession): void {
		this.session = session;
	}

	unbind(session: OfficeEditorSession): void {
		if (this.session === session) {
			this.session = undefined;
		}
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (other instanceof OfficeEditorInput) {
			return isEqual(other.resource, this.resource);
		}
		return super.matches(other);
	}

	override toUntyped(): IUntypedEditorInput {
		return {
			resource: this.resource,
			options: { override: OFFICE_EDITOR_ID },
		};
	}

	override async save(_group: GroupIdentifier, options?: ISaveOptions): Promise<EditorInput | undefined> {
		const session = this.session;
		if (!session) {
			return undefined;
		}
		try {
			const result = await this.officeExtractService.patchOffice(this.resource, session.collectEdits(), session.getStamp());
			if (result.size === undefined || result.mtime === undefined) {
				throw new Error('Office save did not return a file stamp.');
			}
			session.markSaved({ size: result.size, mtime: result.mtime });
			this.setDirty(false);
			this._onDidSave.fire({ reason: options?.reason, source: options?.source });
			return this;
		} catch (error) {
			session.showError(error instanceof Error ? error.message : String(error));
			return undefined;
		}
	}

	override async revert(_group: GroupIdentifier, _options?: IRevertOptions): Promise<void> {
		await this.session?.revertFromDisk();
		this.setDirty(false);
	}
}

class OfficeEditorPane extends EditorPane {
	static readonly ID = OFFICE_EDITOR_PANE_ID;

	private root: HTMLElement | undefined;
	private readonly watchers = this._register(new DisposableStore());
	private model: OfficeDocumentModel | undefined;
	private texts = new Map<string, string>();
	private original = new Map<string, string>();
	private stamp: OfficeFileStamp = { size: 0, mtime: 0 };
	private conflict = false;
	private error: string | undefined;
	private activeSheet = 0;
	private activeSlide = 0;
	private loading = false;

	constructor(
		group: ConstructorParameters<typeof EditorPane>[1],
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IOfficeExtractService private readonly officeExtractService: IOfficeExtractService,
		@IFileService private readonly fileService: IFileService,
	) {
		super(OfficeEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.root = document.createElement('div');
		this.root.className = 'sapphire-office-editor';
		this.root.tabIndex = 0;
		parent.appendChild(this.root);
	}

	override layout(_dimension: Dimension): void {
		if (this.root) {
			this.root.style.height = '100%';
		}
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof OfficeEditorInput) || token.isCancellationRequested) {
			return;
		}
		this.watchers.clear();
		const session = this.sessionFor(input);
		input.bind(session);
		this.watchers.add({ dispose: () => input.unbind(session) });
		this.watchers.add(this.fileService.onDidFilesChange((event) => {
			if (!event.contains(input.resource, FileChangeType.UPDATED, FileChangeType.DELETED)) {
				return;
			}
			void this.onDiskChanged(input);
		}));
		await this.load(input, false);
	}

	override clearInput(): void {
		this.watchers.clear();
		this.model = undefined;
		super.clearInput();
	}

	private sessionFor(input: OfficeEditorInput): OfficeEditorSession {
		return {
			collectEdits: () => this.collectEdits(),
			getStamp: () => this.stamp,
			markSaved: (stamp) => this.markSaved(stamp),
			revertFromDisk: () => this.load(input, true),
			showError: (message) => {
				this.error = message;
				if (message.includes('changed on disk')) {
					this.conflict = true;
				}
				this.render();
			},
		};
	}

	private async load(input: OfficeEditorInput, force: boolean): Promise<void> {
		if (this.loading) {
			return;
		}
		this.loading = true;
		try {
			const result = await this.officeExtractService.readOfficeModel(input.resource);
			if (this.input !== input) {
				return;
			}
			if (!force && input.isDirty()) {
				this.conflict = true;
				this.render();
				return;
			}
			this.model = result.model;
			this.stamp = { size: result.size, mtime: result.mtime };
			this.texts = seedTexts(result.model);
			this.original = new Map(this.texts);
			this.conflict = false;
			this.error = undefined;
			this.activeSheet = 0;
			this.activeSlide = 0;
			input.setDirty(false);
			this.render();
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
			this.render();
		} finally {
			this.loading = false;
		}
	}

	private async onDiskChanged(input: OfficeEditorInput): Promise<void> {
		if (this.loading || this.input !== input) {
			return;
		}
		let stat: { size: number; mtime: number };
		try {
			const file = await this.fileService.stat(input.resource);
			stat = { size: file.size, mtime: Math.round(file.mtime) };
		} catch {
			this.conflict = true;
			this.error = localize('sapphire.officeEditor.deleted', 'Файл удалён на диске.');
			this.render();
			return;
		}
		if (stat.size === this.stamp.size && stat.mtime === this.stamp.mtime) {
			return;
		}
		if (input.isDirty()) {
			this.conflict = true;
			this.render();
			return;
		}
		await this.load(input, true);
	}

	private collectEdits(): OfficeTextEdit[] {
		const edits: OfficeTextEdit[] = [];
		for (const [id, text] of this.texts) {
			if (text !== (this.original.get(id) ?? '')) {
				edits.push({ id, text });
			}
		}
		return edits;
	}

	private markSaved(stamp: OfficeFileStamp): void {
		this.stamp = stamp;
		this.original = new Map(this.texts);
		this.conflict = false;
		this.error = undefined;
		this.render();
	}

	private setText(id: string, text: string): void {
		this.texts.set(id, text);
		const dirty = this.collectEdits().length > 0;
		if (this.input instanceof OfficeEditorInput) {
			this.input.setDirty(dirty);
		}
	}

	private render(): void {
		const root = this.root;
		if (!root) {
			return;
		}
		root.replaceChildren();
		if (this.conflict) {
			const banner = document.createElement('div');
			banner.className = 'sapphire-office-banner';
			banner.textContent = this.error ?? localize('sapphire.officeEditor.conflict', 'Файл изменён на диске. Перечитайте его, прежде чем сохранять.');
			const revert = document.createElement('button');
			revert.type = 'button';
			revert.textContent = localize('sapphire.officeEditor.revert', 'Перечитать');
			revert.addEventListener('click', () => {
				if (this.input instanceof OfficeEditorInput) {
					void this.input.revert(this.group.id);
				}
			});
			banner.appendChild(revert);
			root.appendChild(banner);
		} else if (this.error) {
			const banner = document.createElement('div');
			banner.className = 'sapphire-office-banner';
			banner.textContent = this.error;
			root.appendChild(banner);
		}
		if (!this.model) {
			return;
		}
		if (this.model.kind === 'xlsx') {
			this.renderSheets(root, this.model);
		} else if (this.model.kind === 'docx') {
			this.renderDocument(root, this.model);
		} else {
			this.renderSlides(root, this.model);
		}
	}

	private renderSheets(root: HTMLElement, model: Extract<OfficeDocumentModel, { kind: 'xlsx' }>): void {
		const tabs = document.createElement('div');
		tabs.className = 'sapphire-office-tabs';
		model.sheets.forEach((sheet, index) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = sheet.name;
			button.className = index === this.activeSheet ? 'active' : '';
			button.addEventListener('click', () => {
				this.activeSheet = index;
				this.render();
			});
			tabs.appendChild(button);
		});
		root.appendChild(tabs);
		const sheet = model.sheets[this.activeSheet];
		if (!sheet) {
			return;
		}
		const rows = sheetDisplayRows(sheet);
		const minRow = rows[0]?.row ?? 1;
		const lastRow = rows[rows.length - 1]?.row ?? minRow;
		const endRow = Math.min(lastRow, minRow + MAX_RENDER_ROWS - 1);
		const byRow = new Map(rows.map((row) => [row.row, row]));
		const maxCol = rows.reduce((max, row) => Math.max(max, row.cells[row.cells.length - 1]?.col ?? 0), 0);
		const scroller = document.createElement('div');
		scroller.className = 'sapphire-office-scroll';
		const table = document.createElement('table');
		table.className = 'sapphire-office-grid';
		const head = document.createElement('tr');
		head.appendChild(document.createElement('th'));
		for (let col = 1; col <= maxCol; col++) {
			const th = document.createElement('th');
			th.textContent = columnLabel(col);
			head.appendChild(th);
		}
		table.appendChild(head);
		for (let rowNumber = minRow; rowNumber <= endRow; rowNumber++) {
			const row = byRow.get(rowNumber);
			const tr = document.createElement('tr');
			const label = document.createElement('th');
			label.textContent = String(rowNumber);
			tr.appendChild(label);
			for (let col = 1; col <= maxCol; col++) {
				const cell = row?.cells.find((item) => item.col === col) ?? {
					id: cellId(sheet.index, col, rowNumber),
					text: '',
				};
				const td = document.createElement('td');
				td.textContent = this.texts.get(cell.id) ?? cell.text;
				td.title = cell.id;
				td.addEventListener('dblclick', () => this.editCell(td, cell.id));
				tr.appendChild(td);
			}
			table.appendChild(tr);
		}
		scroller.appendChild(table);
		if (lastRow > endRow) {
			const note = document.createElement('p');
			note.className = 'sapphire-office-note';
			note.textContent = localize('sapphire.officeEditor.rowCap', 'Показаны первые {0} строк.', MAX_RENDER_ROWS);
			scroller.appendChild(note);
		}
		root.appendChild(scroller);
	}

	private editCell(td: HTMLTableCellElement, id: string): void {
		if (td.querySelector('input')) {
			return;
		}
		const input = document.createElement('input');
		input.value = this.texts.get(id) ?? td.textContent ?? '';
		td.replaceChildren(input);
		input.focus();
		input.select();
		let done = false;
		const commit = (save: boolean) => {
			if (done) {
				return;
			}
			done = true;
			if (save) {
				this.setText(id, input.value);
			}
			td.textContent = this.texts.get(id) ?? '';
		};
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				commit(true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				commit(false);
			}
		});
		input.addEventListener('blur', () => commit(true));
	}

	private renderDocument(root: HTMLElement, model: Extract<OfficeDocumentModel, { kind: 'docx' }>): void {
		const scroller = document.createElement('div');
		scroller.className = 'sapphire-office-scroll sapphire-office-doc';
		for (const block of model.blocks) {
			if (block.type === 'paragraph') {
				if (!block.text && !this.texts.get(block.id)) {
					continue;
				}
				const field = document.createElement('textarea');
				field.className = block.headingLevel ? `sapphire-office-p heading-${block.headingLevel}` : 'sapphire-office-p';
				field.value = this.texts.get(block.id) ?? block.text;
				field.rows = Math.min(8, Math.max(1, field.value.split('\n').length));
				field.addEventListener('input', () => this.setText(block.id, field.value));
				scroller.appendChild(field);
				continue;
			}
			const table = document.createElement('table');
			table.className = 'sapphire-office-grid';
			for (const row of block.rows) {
				const tr = document.createElement('tr');
				for (const cell of row.cells) {
					const td = document.createElement('td');
					const field = document.createElement('textarea');
					field.value = this.texts.get(cell.id) ?? cell.text;
					field.rows = 1;
					field.addEventListener('input', () => this.setText(cell.id, field.value));
					td.appendChild(field);
					tr.appendChild(td);
				}
				table.appendChild(tr);
			}
			scroller.appendChild(table);
		}
		root.appendChild(scroller);
	}

	private renderSlides(root: HTMLElement, model: Extract<OfficeDocumentModel, { kind: 'pptx' }>): void {
		const tabs = document.createElement('div');
		tabs.className = 'sapphire-office-tabs';
		model.slides.forEach((slide, index) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = localize('sapphire.officeEditor.slide', 'Слайд {0}', index + 1);
			button.className = index === this.activeSlide ? 'active' : '';
			button.addEventListener('click', () => {
				this.activeSlide = index;
				this.render();
			});
			tabs.appendChild(button);
		});
		root.appendChild(tabs);
		const slide = model.slides[this.activeSlide];
		if (!slide) {
			return;
		}
		const scroller = document.createElement('div');
		scroller.className = 'sapphire-office-scroll';
		const canvas = document.createElement('div');
		canvas.className = 'sapphire-office-slide';
		canvas.style.aspectRatio = `${model.slideCx} / ${model.slideCy}`;
		for (const image of slide.images) {
			if (!image.dataUrl) {
				continue;
			}
			const img = document.createElement('img');
			img.src = image.dataUrl;
			img.alt = '';
			place(img, image, model.slideCx, model.slideCy);
			canvas.appendChild(img);
		}
		const loose: HTMLElement[] = [];
		for (const shape of slide.shapes) {
			const box = document.createElement('div');
			box.className = 'sapphire-office-shape';
			const field = document.createElement('textarea');
			field.value = this.texts.get(shape.id) ?? shape.text;
			field.addEventListener('input', () => this.setText(shape.id, field.value));
			box.appendChild(field);
			if (shape.cx > 0 && shape.cy > 0) {
				place(box, shape, model.slideCx, model.slideCy);
				canvas.appendChild(box);
			} else {
				loose.push(box);
			}
		}
		scroller.appendChild(canvas);
		for (const box of loose) {
			scroller.appendChild(box);
		}
		const notesLabel = document.createElement('p');
		notesLabel.className = 'sapphire-office-note';
		notesLabel.textContent = localize('sapphire.officeEditor.notes', 'Заметки');
		const notes = document.createElement('textarea');
		notes.className = 'sapphire-office-p';
		notes.value = this.texts.get(slide.notes.id) ?? slide.notes.text;
		notes.addEventListener('input', () => this.setText(slide.notes.id, notes.value));
		scroller.appendChild(notesLabel);
		scroller.appendChild(notes);
		root.appendChild(scroller);
	}
}

function place(node: HTMLElement, box: { x: number; y: number; cx: number; cy: number }, slideCx: number, slideCy: number): void {
	node.style.position = 'absolute';
	node.style.left = `${(box.x / slideCx) * 100}%`;
	node.style.top = `${(box.y / slideCy) * 100}%`;
	node.style.width = `${Math.max(4, (box.cx / slideCx) * 100)}%`;
	node.style.height = `${Math.max(4, (box.cy / slideCy) * 100)}%`;
}

function columnLabel(col: number): string {
	let n = col;
	let s = '';
	while (n > 0) {
		const rem = (n - 1) % 26;
		s = String.fromCharCode(65 + rem) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s;
}

function seedTexts(model: OfficeDocumentModel): Map<string, string> {
	const texts = new Map<string, string>();
	if (model.kind === 'xlsx') {
		for (const sheet of model.sheets) {
			for (const row of sheetDisplayRows(sheet)) {
				for (const cell of row.cells) {
					texts.set(cell.id, cell.text);
				}
			}
		}
		return texts;
	}
	if (model.kind === 'docx') {
		for (const block of model.blocks) {
			if (block.type === 'paragraph') {
				texts.set(block.id, block.text);
			} else {
				for (const row of block.rows) {
					for (const cell of row.cells) {
						texts.set(cell.id, cell.text);
					}
				}
			}
		}
		return texts;
	}
	for (const slide of model.slides) {
		for (const shape of slide.shapes) {
			texts.set(shape.id, shape.text);
		}
		texts.set(slide.notes.id, slide.notes.text);
	}
	return texts;
}

class OfficeEditorContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.sapphire.officeEditor';

	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		const globs = ['*.xlsx', '*.xlsm', '*.docx', '*.pptx'];
		for (const glob of globs) {
			this._register(editorResolverService.registerEditor(
				glob,
				{
					id: OFFICE_EDITOR_ID,
					label: localize('sapphire.officeEditor.label', 'Office Editor'),
					priority: RegisteredEditorPriority.builtin,
				},
				{
					singlePerResource: true,
					canSupportResource: (resource: URI) => {
						const kind = officeKindFromPath(resource.path);
						return kind === 'xlsx' || kind === 'docx' || kind === 'pptx';
					},
				},
				{
					createEditorInput: ({ resource }: { resource: URI }) => ({
						editor: instantiationService.createInstance(OfficeEditorInput, resource),
					}),
				},
			));
		}
	}
}

class OfficeEditorInputSerializer implements IEditorSerializer {
	canSerialize(editor: EditorInput): boolean {
		return editor instanceof OfficeEditorInput;
	}

	serialize(editor: EditorInput): string | undefined {
		if (!(editor instanceof OfficeEditorInput)) {
			return undefined;
		}
		return JSON.stringify({ resource: editor.resource.toJSON() });
	}

	deserialize(instantiationService: IInstantiationService, serialized: string): EditorInput | undefined {
		try {
			const parsed = JSON.parse(serialized) as { resource: URI };
			const resource = URI.revive(parsed.resource);
			if (!resource) {
				return undefined;
			}
			return instantiationService.createInstance(OfficeEditorInput, resource);
		} catch {
			return undefined;
		}
	}
}

class OfficeWorkingCopyEditorHandler extends Disposable implements IWorkbenchContribution, IWorkingCopyEditorHandler {
	static readonly ID = 'workbench.contrib.sapphire.officeEditorWorkingCopyHandler';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkingCopyEditorService workingCopyEditorService: IWorkingCopyEditorService,
	) {
		super();
		this._register(workingCopyEditorService.registerHandler(this));
	}

	handles(workingCopy: IWorkingCopyIdentifier): boolean {
		return workingCopy.typeId === OFFICE_WORKING_COPY_TYPE;
	}

	isOpen(workingCopy: IWorkingCopyIdentifier, editor: EditorInput): boolean {
		return editor instanceof OfficeEditorInput && isEqual(workingCopy.resource, editor.resource);
	}

	createEditor(workingCopy: IWorkingCopyIdentifier): EditorInput {
		return this.instantiationService.createInstance(OfficeEditorInput, workingCopy.resource);
	}
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		OfficeEditorPane,
		OfficeEditorPane.ID,
		localize('sapphire.officeEditor.pane', 'Office Editor'),
	),
	[new SyncDescriptor(OfficeEditorInput)],
);

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	OfficeEditorInput.ID,
	OfficeEditorInputSerializer,
);

registerWorkbenchContribution2(OfficeEditorContribution.ID, OfficeEditorContribution, WorkbenchPhase.BlockStartup);
registerWorkbenchContribution2(OfficeWorkingCopyEditorHandler.ID, OfficeWorkingCopyEditorHandler, WorkbenchPhase.BlockRestore);

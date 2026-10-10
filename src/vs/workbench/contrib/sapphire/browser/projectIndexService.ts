/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { DocumentSymbol, symbolKindNames } from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import {
  InstantiationType,
  registerSingleton,
} from '../../../../platform/instantiation/common/extensions.js';
import {
  createDecorator,
  ServicesAccessor,
} from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
  IWorkbenchContribution,
  registerWorkbenchContribution2,
  WorkbenchPhase,
} from '../../../common/contributions.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IOfficeExtractService } from '../common/officeExtractService.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { ISapphireModelService } from '../common/sapphireModelService.js';
import { ISapphireSettingsService } from '../common/sapphireSettingsService.js';
import {
  analyzeCsv,
  analyzeOfficeText,
  analyzeTextFile,
  contentHash,
  isSecretPath,
  kindFromPath,
  localRoleFromPath,
  shouldSkipDirName,
  shouldSkipPath,
} from '../common/projectIndex/projectIndexAnalyze.js';
import { searchProjectIndex } from '../common/projectIndex/projectIndexSearch.js';
import {
  EMPTY_PROJECT_INDEX_STATUS,
  emptyManifest,
  PROJECT_INDEX_DIR_SEGMENTS,
  PROJECT_INDEX_GITIGNORE_LINE,
  PROJECT_INDEX_SCHEMA_VERSION,
  ProjectIndexChunkRecord,
  ProjectIndexEdgeRecord,
  ProjectIndexFileKind,
  ProjectIndexFileRecord,
  ProjectIndexManifest,
  ProjectIndexSearchHit,
  ProjectIndexStatus,
  ProjectIndexSymbolRecord,
} from '../common/projectIndex/projectIndexTypes.js';
import { joinPath } from '../../../../base/common/resources.js';
import { WORKSPACE_DOT_DIR, isUnderWorkspaceStateDir } from '../common/workspaceDotDir.js';
import { migrateLegacyWorkspaceDotDir } from './migrateWorkspaceDotDir.js';

export const IProjectIndexService = createDecorator<IProjectIndexService>('projectIndexService');

export const PPR_REINDEX_WORKSPACE_COMMAND_ID = 'ppr.projectIndex.reindex';

export interface IProjectIndexService {
  readonly _serviceBrand: undefined;
  readonly onDidChangeStatus: Event<ProjectIndexStatus>;
  getStatus(): ProjectIndexStatus;
  getFiles(): ProjectIndexFileRecord[];
  getChunks(): ProjectIndexChunkRecord[];
  getSymbols(): ProjectIndexSymbolRecord[];
  getEdges(): ProjectIndexEdgeRecord[];
  search(query: string, pageNumber: number): ProjectIndexSearchHit[];
  searchPaged(
    query: string,
    pageNumber: number,
  ): { hits: ProjectIndexSearchHit[]; hasNextPage: boolean };
  startIfNeeded(): void;
  reindexFull(): Promise<void>;
  /** Пауза индексации (как cancel) — до resume или полного reindex. */
  pause(): void;
  /** Продолжить после паузы (инкремент + оставшийся purpose через LLM). */
  resume(): Promise<void>;
  cancel(): void;
}

const MAX_TEXT_BYTES = 1_500_000;
const PURPOSE_CONCURRENCY = 1;
const RECENT_FILES_LIMIT = 40;

class ProjectIndexService extends Disposable implements IProjectIndexService {
  readonly _serviceBrand: undefined;

  private readonly _onDidChangeStatus = this._register(new Emitter<ProjectIndexStatus>());
  readonly onDidChangeStatus = this._onDidChangeStatus.event;

  private status: ProjectIndexStatus = { ...EMPTY_PROJECT_INDEX_STATUS };
  private files = new Map<string, ProjectIndexFileRecord>();
  private chunks: ProjectIndexChunkRecord[] = [];
  private symbols: ProjectIndexSymbolRecord[] = [];
  private edges: ProjectIndexEdgeRecord[] = [];
  private runId = 0;
  private cancelled = false;
  /** После Cancel пользователя — не стартуем watcher/startIfNeeded до явного reindex. */
  private autoIndexPaused = false;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private purposeQueue: string[] = [];
  private purposeRunning = false;
  private loaded = false;
  /** true, пока идёт discover/analyze (не очередь purpose). */
  private indexRunning = false;
  /** Схлопнуть события watcher, пришедшие во время активного прогона. */
  private pendingIncremental = false;

  constructor(
    @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
    @IFileService private readonly fileService: IFileService,
    @IOfficeExtractService private readonly officeExtractService: IOfficeExtractService,
    @ISapphireSettingsService private readonly sapphireSettingsService: ISapphireSettingsService,
    @ISapphireModelService private readonly sapphireModelService: ISapphireModelService,
    @ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
    @ILLMMessageService private readonly llmMessageService: ILLMMessageService,
    @IConvertToLLMMessageService
    private readonly convertToLLMMessageService: IConvertToLLMMessageService,
  ) {
    super();
    this._register(
      this.workspaceContextService.onDidChangeWorkspaceFolders(() => {
        void this.reloadAndMaybeStart();
      }),
    );
    this._register(
      this.fileService.onDidFilesChange((e) => {
        if (!this.sapphireSettingsService.state.globalSettings.projectIndexEnabled) {
          return;
        }
        const root = this.rootUri();
        if (!root) {
          return;
        }
        const changed = [...e.rawAdded, ...e.rawUpdated, ...e.rawDeleted];
        if (!changed.length || changed.every((uri) => this.isWatcherNoise(uri, root))) {
          return;
        }
        this.scheduleIncrementalIndex();
      }),
    );
    this._register(
      this.sapphireSettingsService.onDidChangeState(() => {
        if (this.sapphireSettingsService.state.globalSettings.projectIndexEnabled) {
          this.startIfNeeded();
        }
      }),
    );
    void this.reloadAndMaybeStart();
  }

  getStatus(): ProjectIndexStatus {
    return this.status;
  }

  getFiles(): ProjectIndexFileRecord[] {
    return [...this.files.values()];
  }

  getChunks(): ProjectIndexChunkRecord[] {
    return this.chunks;
  }

  getSymbols(): ProjectIndexSymbolRecord[] {
    return this.symbols;
  }

  getEdges(): ProjectIndexEdgeRecord[] {
    return this.edges;
  }

  search(query: string, pageNumber: number): ProjectIndexSearchHit[] {
    return this.searchPaged(query, pageNumber).hits;
  }

  searchPaged(
    query: string,
    pageNumber: number,
  ): { hits: ProjectIndexSearchHit[]; hasNextPage: boolean } {
    return searchProjectIndex({
      query,
      files: this.getFiles(),
      chunks: this.chunks,
      symbols: this.symbols,
      pageNumber,
    });
  }

  startIfNeeded(): void {
    if (!this.sapphireSettingsService.state.globalSettings.projectIndexEnabled) {
      return;
    }
    if (!this.rootUri()) {
      return;
    }
    if (this.autoIndexPaused) {
      return;
    }
    if (this.isIndexBusy()) {
      this.pendingIncremental = true;
      return;
    }
    void this.runIndex(false);
  }

  async reindexFull(): Promise<void> {
    this.autoIndexPaused = false;
    this.pendingIncremental = false;
    await this.runIndex(true);
  }

  pause(): void {
    this.cancel();
  }

  async resume(): Promise<void> {
    this.autoIndexPaused = false;
    this.cancelled = false;
    await this.runIndex(false);
  }

  cancel(): void {
    this.cancelled = true;
    this.autoIndexPaused = true;
    this.runId++;
    this.purposeQueue = [];
    this.pendingIncremental = false;
    this.indexRunning = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.setStatus({
      phase: 'idle',
      currentPath: null,
    });
  }

  private isIndexBusy(): boolean {
    return (
      this.indexRunning ||
      this.purposeRunning ||
      this.status.phase === 'scanning' ||
      this.status.phase === 'analyzing' ||
      this.status.phase === 'purpose'
    );
  }

  /** Инкремент с debounce; при занятом прогоне — один отложенный follow-up. */
  private scheduleIncrementalIndex(): void {
    if (this.autoIndexPaused) {
      return;
    }
    if (this.isIndexBusy()) {
      this.pendingIncremental = true;
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      if (this.autoIndexPaused) {
        return;
      }
      if (this.isIndexBusy()) {
        this.pendingIncremental = true;
        return;
      }
      void this.runIndex(false);
    }, 1500);
  }

  private relPathFromRoot(uri: URI, root: URI): string {
    if (!uri.path.startsWith(root.path)) {
      return '';
    }
    return uri.path.slice(root.path.length).replace(/^\//, '').replace(/\\/g, '/');
  }

  /** Игнор каталога состояния IDE, skip-папок и неиндексируемых файлов; каталоги оставляем. */
  private isWatcherNoise(uri: URI, root: URI): boolean {
    const rel = this.relPathFromRoot(uri, root);
    if (!rel) {
      return true;
    }
    if (isUnderWorkspaceStateDir(rel)) {
      return true;
    }
    const parts = rel.split('/');
    for (const part of parts) {
      if (shouldSkipDirName(part)) {
        return true;
      }
    }
    const base = parts[parts.length - 1] ?? '';
    // Без расширения чаще каталог — всё равно будим индексатор.
    if (!base.includes('.')) {
      return false;
    }
    return shouldSkipPath(rel);
  }

  private hasPurposeWork(forceAll: boolean): boolean {
    if (this.sapphireSettingsService.state.globalSettings.projectIndexLlmPurpose === false) {
      return false;
    }
    for (const f of this.files.values()) {
      if (f.llmStatus === 'skipped') {
        continue;
      }
      if (!forceAll && f.llmStatus === 'done' && f.purpose) {
        continue;
      }
      if (forceAll || f.llmStatus === 'pending' || f.llmStatus === 'failed') {
        return true;
      }
    }
    return false;
  }

  private flushPendingIncremental(): void {
    if (this.autoIndexPaused || this.cancelled || !this.pendingIncremental) {
      return;
    }
    this.pendingIncremental = false;
    void this.runIndex(false);
  }

  private rootUri(): URI | undefined {
    return this.workspaceContextService.getWorkspace().folders[0]?.uri;
  }

  private indexDir(root: URI): URI {
    return joinPath(root, ...PROJECT_INDEX_DIR_SEGMENTS);
  }

  private async reloadAndMaybeStart(): Promise<void> {
    // Новая/сменённая папка workspace — снова разрешаем автоиндекс.
    this.autoIndexPaused = false;
    await this.loadFromDisk();
    this.startIfNeeded();
  }

  /**
   * Общий прогресс по фазам (не локальный внутри фазы):
   * scanning ~2%, analyzing 5–80% (или 0–100% без LLM purpose), purpose 80–100%.
   */
  private computeOverallPercent(
    phase: ProjectIndexStatus['phase'],
    processed: number,
    total: number,
    purposeDone: number,
  ): number {
    const llmPurpose =
      this.sapphireSettingsService.state.globalSettings.projectIndexLlmPurpose !== false;
    if (phase === 'idle') {
      return this.files.size > 0 ? 100 : 0;
    }
    if (phase === 'error') {
      return this.status.percent;
    }
    if (phase === 'scanning') {
      return 2;
    }
    if (phase === 'analyzing') {
      // Инкремент без изменений — анализ считаем завершённым.
      const local = total > 0 ? Math.min(1, processed / total) : 1;
      if (!llmPurpose) {
        return Math.round(local * 100);
      }
      return Math.round(5 + local * 75);
    }
    if (phase === 'purpose') {
      const filesTotal = Math.max(1, this.files.size);
      const local = Math.min(1, purposeDone / filesTotal);
      return Math.min(99, Math.round(80 + local * 20));
    }
    return 0;
  }

  private setStatus(patch: Partial<ProjectIndexStatus>): void {
    const manifest = this.buildManifest();
    const errors = [...this.files.values()]
      .filter((f) => !!f.error)
      .slice(-20)
      .map((f) => ({ path: f.path, error: f.error! }));
    const recentFiles = [...this.files.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, RECENT_FILES_LIMIT);
    const merged = { ...this.status, ...patch };
    const purposeDone = manifest?.counts.purposeDone ?? 0;
    const percent = this.computeOverallPercent(
      merged.phase,
      merged.processed,
      merged.total,
      purposeDone,
    );
    this.status = {
      ...merged,
      percent,
      isIndexed: this.files.size > 0,
      isPaused: this.autoIndexPaused,
      manifest,
      recentFiles,
      errors,
    };
    this._onDidChangeStatus.fire(this.status);
  }

  private buildManifest(): ProjectIndexManifest | null {
    const root = this.rootUri();
    if (!root) {
      return null;
    }
    const byKind: Partial<Record<ProjectIndexFileKind, number>> = {};
    let purposeDone = 0;
    let purposePending = 0;
    let purposeFailed = 0;
    for (const f of this.files.values()) {
      byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
      if (f.llmStatus === 'done') {
        purposeDone++;
      } else if (f.llmStatus === 'failed') {
        purposeFailed++;
      } else if (f.llmStatus === 'pending') {
        purposePending++;
      }
    }
    const prev = this.status.manifest;
    return {
      schemaVersion: PROJECT_INDEX_SCHEMA_VERSION,
      root: root.fsPath,
      builtAt: prev?.builtAt ?? Date.now(),
      lastFullAt: prev?.lastFullAt ?? null,
      lastIncrementalAt: prev?.lastIncrementalAt ?? null,
      counts: {
        files: this.files.size,
        chunks: this.chunks.length,
        symbols: this.symbols.length,
        edges: this.edges.length,
        byKind,
        purposeDone,
        purposePending,
        purposeFailed,
      },
    };
  }

  private async loadFromDisk(): Promise<void> {
    const root = this.rootUri();
    if (!root) {
      this.files.clear();
      this.chunks = [];
      this.symbols = [];
      this.edges = [];
      this.setStatus({ ...EMPTY_PROJECT_INDEX_STATUS });
      this.loaded = true;
      return;
    }
    await migrateLegacyWorkspaceDotDir(this.fileService, root);
    const dir = this.indexDir(root);
    try {
      const manifestBuf = await this.fileService.readFile(joinPath(dir, 'manifest.json'));
      const manifest = JSON.parse(manifestBuf.value.toString()) as ProjectIndexManifest;
      const files = await this.readJsonl<ProjectIndexFileRecord>(joinPath(dir, 'files.jsonl'));
      this.chunks = await this.readJsonl<ProjectIndexChunkRecord>(joinPath(dir, 'chunks.jsonl'));
      this.symbols = await this.readJsonl<ProjectIndexSymbolRecord>(joinPath(dir, 'symbols.jsonl'));
      this.edges = await this.readJsonl<ProjectIndexEdgeRecord>(joinPath(dir, 'edges.jsonl'));
      this.files.clear();
      for (const f of files) {
        this.files.set(f.path, f);
      }
      this.status = {
        ...EMPTY_PROJECT_INDEX_STATUS,
        phase: 'idle',
        percent: files.length > 0 ? 100 : 0,
        isIndexed: files.length > 0,
        manifest,
        recentFiles: files.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_FILES_LIMIT),
        errors: files.filter((f) => f.error).map((f) => ({ path: f.path, error: f.error! })),
      };
      this._onDidChangeStatus.fire(this.status);
    } catch {
      this.files.clear();
      this.chunks = [];
      this.symbols = [];
      this.edges = [];
      this.setStatus({
        ...EMPTY_PROJECT_INDEX_STATUS,
        manifest: emptyManifest(root.fsPath),
      });
    }
    this.loaded = true;
  }

  private async readJsonl<T>(uri: URI): Promise<T[]> {
    try {
      const buf = await this.fileService.readFile(uri);
      return buf.value
        .toString()
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l) as T);
    } catch {
      return [];
    }
  }

  private async writeJsonl(uri: URI, rows: unknown[]): Promise<void> {
    const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
    await this.fileService.writeFile(uri, VSBuffer.fromString(body));
  }

  private async persist(): Promise<void> {
    const root = this.rootUri();
    if (!root) {
      return;
    }
    const dir = this.indexDir(root);
    try {
      await migrateLegacyWorkspaceDotDir(this.fileService, root);
      await this.fileService.createFolder(joinPath(root, WORKSPACE_DOT_DIR));
    } catch {
      /* каталог уже есть */
    }
    try {
      await this.fileService.createFolder(dir);
    } catch {
      /* каталог уже есть */
    }
    await this.ensureGitignore(root);
    const manifest = this.buildManifest();
    if (!manifest) {
      return;
    }
    await this.fileService.writeFile(
      joinPath(dir, 'manifest.json'),
      VSBuffer.fromString(JSON.stringify(manifest, null, 2)),
    );
    await this.writeJsonl(joinPath(dir, 'files.jsonl'), this.getFiles());
    await this.writeJsonl(joinPath(dir, 'chunks.jsonl'), this.chunks);
    await this.writeJsonl(joinPath(dir, 'symbols.jsonl'), this.symbols);
    await this.writeJsonl(joinPath(dir, 'edges.jsonl'), this.edges);
    this.status = { ...this.status, manifest };
  }

  private async ensureGitignore(root: URI): Promise<void> {
    const gitignore = joinPath(root, '.gitignore');
    try {
      if (await this.fileService.exists(gitignore)) {
        const cur = (await this.fileService.readFile(gitignore)).value.toString();
        if (cur.includes(PROJECT_INDEX_GITIGNORE_LINE)) {
          return;
        }
        const next = cur.endsWith('\n')
          ? `${cur}${PROJECT_INDEX_GITIGNORE_LINE}\n`
          : `${cur}\n${PROJECT_INDEX_GITIGNORE_LINE}\n`;
        await this.fileService.writeFile(gitignore, VSBuffer.fromString(next));
      } else {
        await this.fileService.writeFile(
          gitignore,
          VSBuffer.fromString(`${PROJECT_INDEX_GITIGNORE_LINE}\n`),
        );
      }
    } catch {
      /* игнорируем */
    }
  }

  private async runIndex(full: boolean): Promise<void> {
    if (!this.sapphireSettingsService.state.globalSettings.projectIndexEnabled) {
      return;
    }
    if (this.autoIndexPaused) {
      return;
    }
    const root = this.rootUri();
    if (!root) {
      return;
    }
    if (!this.loaded) {
      await this.loadFromDisk();
    }
    // Не отменяем текущий прогон ради ещё одного инкремента — только флаг follow-up.
    if (!full && this.indexRunning) {
      this.pendingIncremental = true;
      return;
    }

    this.indexRunning = true;
    const myRun = ++this.runId;
    this.cancelled = false;
    if (full) {
      this.pendingIncremental = false;
    }

    try {
      // Discover без фазы scanning в UI — иначе на пустом инкременте мигало 0↔100%.
      const discovered = await this.discoverFiles(root);
      if (myRun !== this.runId || this.cancelled) {
        return;
      }
      const existingPaths = new Set(discovered.map((d) => d.relPath));
      const toProcess = full
        ? discovered
        : discovered.filter((d) => {
            const prev = this.files.get(d.relPath);
            return !prev || prev.mtime !== d.mtime || prev.size !== d.size;
          });
      const deletedPaths = [...this.files.keys()].filter((path) => !existingPaths.has(path));

      // Тихий no-op: idle @ 100%, без persist и без сдвига lastIncrementalAt.
      if (!full && toProcess.length === 0 && deletedPaths.length === 0) {
        if (this.hasPurposeWork(false)) {
          this.enqueuePurposeJobs(false);
        }
        return;
      }

      // Удаляем записи по файлам, которых больше нет на диске
      for (const path of deletedPaths) {
        this.files.delete(path);
      }
      if (deletedPaths.length > 0) {
        this.chunks = this.chunks.filter((c) => existingPaths.has(c.path));
        this.symbols = this.symbols.filter((s) => existingPaths.has(s.path));
        this.edges = this.edges.filter(
          (e) => existingPaths.has(e.fromPath) && existingPaths.has(e.toPath),
        );
      }

      if (toProcess.length > 0) {
        this.setStatus({
          phase: 'analyzing',
          processed: 0,
          total: toProcess.length,
          currentPath: null,
          error: null,
        });

        let processed = 0;
        for (const item of toProcess) {
          if (myRun !== this.runId || this.cancelled) {
            return;
          }
          this.setStatus({ currentPath: item.relPath, processed });
          await this.analyzeOne(root, item.uri, item.relPath, item.mtime, item.size, existingPaths);
          processed++;
          this.setStatus({ processed });
          if (processed % 25 === 0) {
            await this.persist();
          }
        }
      }

      const now = Date.now();
      const manifest = this.buildManifest();
      if (manifest) {
        manifest.builtAt = now;
        if (full) {
          manifest.lastFullAt = now;
        } else {
          manifest.lastIncrementalAt = now;
        }
        this.status = { ...this.status, manifest };
      }
      await this.persist();

      const llmPurpose =
        this.sapphireSettingsService.state.globalSettings.projectIndexLlmPurpose !== false;
      if (llmPurpose) {
        if (toProcess.length > 0) {
          // Сразу в purpose, без краткого idle @ 100%.
          this.setStatus({
            processed: toProcess.length,
            total: toProcess.length,
            currentPath: null,
          });
        }
        this.enqueuePurposeJobs(full);
      } else {
        this.setStatus({
          phase: 'idle',
          currentPath: null,
          processed: toProcess.length,
          total: toProcess.length,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus({ phase: 'error', error: message, currentPath: null });
    } finally {
      if (myRun === this.runId) {
        this.indexRunning = false;
        // purpose может ещё идти — follow-up после drain (или сейчас, если idle).
        if (!this.purposeRunning) {
          this.flushPendingIncremental();
        }
      }
    }
  }

  private async discoverFiles(
    root: URI,
  ): Promise<Array<{ uri: URI; relPath: string; mtime: number; size: number }>> {
    const out: Array<{ uri: URI; relPath: string; mtime: number; size: number }> = [];
    const walk = async (dir: URI, rel: string): Promise<void> => {
      let stat;
      try {
        stat = await this.fileService.resolve(dir);
      } catch {
        return;
      }
      for (const child of stat.children ?? []) {
        const name = child.name;
        if (child.isDirectory) {
          if (shouldSkipDirName(name)) {
            continue;
          }
          const childRel = rel ? `${rel}/${name}` : name;
          await walk(child.resource, childRel);
          continue;
        }
        const childRel = rel ? `${rel}/${name}` : name;
        if (shouldSkipPath(childRel)) {
          continue;
        }
        out.push({
          uri: child.resource,
          relPath: childRel.replace(/\\/g, '/'),
          mtime: child.mtime ?? 0,
          size: child.size ?? 0,
        });
      }
    };
    await walk(root, '');
    return out;
  }

  private async analyzeOne(
    root: URI,
    uri: URI,
    relPath: string,
    mtime: number,
    size: number,
    existingPaths: Set<string>,
  ): Promise<void> {
    const kind = kindFromPath(relPath);
    if (!kind) {
      return;
    }
    const includeOffice = this.sapphireSettingsService.state.globalSettings.projectIndexIncludeOffice;
    if (!includeOffice && (kind === 'xlsx' || kind === 'docx' || kind === 'pptx' || kind === 'pdf')) {
      return;
    }

    this.chunks = this.chunks.filter((c) => c.path !== relPath);
    this.symbols = this.symbols.filter((s) => s.path !== relPath);
    this.edges = this.edges.filter((e) => e.fromPath !== relPath);

    const prev = this.files.get(relPath);
    let localRole = localRoleFromPath(relPath);
    let hash = `${mtime}:${size}`;
    let error: string | undefined;

    try {
      if (kind === 'xlsx' || kind === 'docx' || kind === 'pptx' || kind === 'pdf') {
        const extracted = await this.officeExtractService.extractIfOffice(uri);
        if (extracted) {
          hash = contentHash(extracted.outline + extracted.body, mtime, size);
          if (extracted.error) {
            error = extracted.error;
          }
          const analyzed = analyzeOfficeText(
            relPath,
            kind,
            extracted.outline,
            extracted.body,
          );
          localRole = analyzed.localRole;
          this.chunks.push(...analyzed.chunks);
        }
      } else if (kind === 'csv') {
        const text = await this.readTextCapped(uri);
        hash = contentHash(text, mtime, size);
        const analyzed = analyzeCsv(relPath, text);
        localRole = analyzed.localRole;
        this.chunks.push(...analyzed.chunks);
      } else {
        const text = await this.readTextCapped(uri);
        hash = contentHash(text, mtime, size);
        const analyzed = analyzeTextFile({ relPath, text, existingPaths });
        localRole = analyzed.localRole;
        this.chunks.push(...analyzed.chunks);
        this.symbols.push(...analyzed.symbols);
        this.edges.push(...analyzed.edges);
        const lsSymbols = await this.collectDocumentSymbols(uri);
        if (lsSymbols.length) {
          this.symbols = this.symbols.filter((s) => s.path !== relPath);
          this.symbols.push(...lsSymbols);
          localRole = localRoleFromPath(
            relPath,
            lsSymbols.map((s) => s.symbolName).slice(0, 8),
          );
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    // Хэш не изменился — сохраняем LLM-purpose/tags без повторного вызова модели
    const unchangedPurpose = prev && prev.hash === hash && prev.llmStatus === 'done';
    this.files.set(relPath, {
      path: relPath,
      mtime,
      size,
      kind,
      hash,
      localRole,
      purpose: unchangedPurpose ? prev.purpose : undefined,
      tags: unchangedPurpose ? prev.tags : undefined,
      whenUseful: unchangedPurpose ? prev.whenUseful : undefined,
      llmStatus: isSecretPath(relPath)
        ? 'skipped'
        : unchangedPurpose
          ? 'done'
          : 'pending',
      error,
      updatedAt: Date.now(),
    });
  }

  private async readTextCapped(uri: URI): Promise<string> {
    const buf = await this.fileService.readFile(uri);
    if (buf.value.byteLength > MAX_TEXT_BYTES) {
      return buf.value.slice(0, MAX_TEXT_BYTES).toString();
    }
    return buf.value.toString();
  }

  private async collectDocumentSymbols(uri: URI): Promise<ProjectIndexSymbolRecord[]> {
    try {
      await this.sapphireModelService.initializeModel(uri);
      const { model } = await this.sapphireModelService.getModelSafe(uri);
      if (!model) {
        return [];
      }
      const providers = this.languageFeaturesService.documentSymbolProvider.ordered(model);
      const out: ProjectIndexSymbolRecord[] = [];
      const folders = this.workspaceContextService.getWorkspace().folders;
      let relPath = uri.path;
      for (const folder of folders) {
        const folderPath = folder.uri.path.replace(/\/$/, '');
        if (uri.path === folderPath || uri.path.startsWith(folderPath + '/')) {
          relPath = uri.path.slice(folderPath.length + 1);
          break;
        }
      }
      const collect = (sym: DocumentSymbol, parent = '') => {
        const fullName = parent ? `${parent}.${sym.name}` : sym.name;
        out.push({
          path: relPath.replace(/\\/g, '/'),
          symbolName: fullName,
          kind: symbolKindNames[sym.kind] ?? String(sym.kind),
          startLine: sym.range.startLineNumber,
          endLine: sym.range.endLineNumber,
        });
        for (const child of sym.children ?? []) {
          collect(child, fullName);
        }
      };
      for (const provider of providers) {
        const docs = await provider.provideDocumentSymbols(model, CancellationToken.None);
        if (!docs) {
          continue;
        }
        for (const sym of docs) {
          collect(sym);
        }
        if (out.length) {
          break;
        }
      }
      return out.slice(0, 80);
    } catch {
      return [];
    }
  }

  private enqueuePurposeJobs(forceAll: boolean): void {
    this.purposeQueue = [];
    for (const f of this.files.values()) {
      if (f.llmStatus === 'skipped') {
        continue;
      }
      if (!forceAll && f.llmStatus === 'done' && f.purpose) {
        continue;
      }
      if (forceAll || f.llmStatus === 'pending' || f.llmStatus === 'failed') {
        this.purposeQueue.push(f.path);
      }
    }
    void this.drainPurposeQueue();
  }

  private async drainPurposeQueue(): Promise<void> {
    if (this.purposeRunning) {
      return;
    }
    this.purposeRunning = true;
    try {
      while (this.purposeQueue.length && PURPOSE_CONCURRENCY > 0) {
        if (this.cancelled) {
          break;
        }
        if (!this.sapphireSettingsService.state.globalSettings.projectIndexLlmPurpose) {
          break;
        }
        const path = this.purposeQueue.shift();
        if (!path) {
          break;
        }
        const file = this.files.get(path);
        if (!file) {
          continue;
        }
        this.setStatus({
          phase: 'purpose',
          currentPath: path,
          processed: this.status.manifest?.counts.purposeDone ?? 0,
          total: this.files.size,
        });
        await this.summarizePurpose(file);
        await this.persist();
        this.setStatus({
          phase: 'purpose',
          processed: this.status.manifest?.counts.purposeDone ?? 0,
          total: this.files.size,
        });
      }
      this.setStatus({ phase: 'idle', currentPath: null });
    } finally {
      this.purposeRunning = false;
      if (!this.indexRunning) {
        this.flushPendingIncremental();
      }
    }
  }

  private async summarizePurpose(file: ProjectIndexFileRecord): Promise<void> {
    const chunkText = this.chunks
      .filter((c) => c.path === file.path)
      .map((c) => c.text)
      .join('\n')
      .slice(0, 1800);
    const symbolText = this.symbols
      .filter((s) => s.path === file.path)
      .map((s) => s.symbolName)
      .slice(0, 20)
      .join(', ');

    const systemMessage = `You classify a project file for a codebase index. Reply with ONLY compact JSON:
{"purpose":"one short sentence","tags":["t1","t2"],"when_useful":"when to open this file"}
No markdown. Russian or English ok.`;
    const user = `path: ${file.path}
kind: ${file.kind}
localRole: ${file.localRole}
symbols: ${symbolText}
excerpt:
${chunkText}`;

    try {
      const modelSelection = this.sapphireSettingsService.state.modelSelectionOfFeature.SCM ?? null;
      const modelSelectionOptions = modelSelection
        ? this.sapphireSettingsService.state.optionsOfModelSelection.SCM[modelSelection.providerName]?.[
            modelSelection.modelName
          ]
        : undefined;
      const overridesOfModel = this.sapphireSettingsService.state.overridesOfModel;
      const { messages, separateSystemMessage } =
        this.convertToLLMMessageService.prepareLLMSimpleMessages({
          simpleMessages: [{ role: 'user', content: user }],
          systemMessage,
          modelSelection,
          featureName: 'SCM',
        });

      const fullText = await new Promise<string>((resolve, reject) => {
        const requestId = this.llmMessageService.sendLLMMessage({
          messagesType: 'chatMessages',
          featureName: 'SCM',
          messages,
          separateSystemMessage,
          chatMode: null,
          modelSelection,
          modelSelectionOptions,
          overridesOfModel,
          onText: () => {},
          onFinalMessage: ({ fullText }) => resolve(fullText),
          onError: (e) => reject(e),
          onAbort: () => reject(new Error('aborted')),
          logging: { loggingName: 'ProjectIndex', loggingExtras: { path: file.path } },
        });
        if (!requestId) {
          reject(new Error('LLM request not started'));
        }
      });

      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON in purpose response');
      }
      const parsed = JSON.parse(jsonMatch[0]) as {
        purpose?: string;
        tags?: string[];
        when_useful?: string;
      };
      this.files.set(file.path, {
        ...file,
        purpose: (parsed.purpose ?? '').trim() || file.localRole,
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 8) : [],
        whenUseful: (parsed.when_useful ?? '').trim() || undefined,
        llmStatus: 'done',
        updatedAt: Date.now(),
      });
    } catch (err) {
      this.files.set(file.path, {
        ...file,
        llmStatus: 'failed',
        error: err instanceof Error ? err.message : String(err),
        updatedAt: Date.now(),
      });
    }
  }
}

registerSingleton(IProjectIndexService, ProjectIndexService, InstantiationType.Eager);

class ProjectIndexWorkbenchContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.ppr.projectIndex';

  constructor(@IProjectIndexService projectIndexService: IProjectIndexService) {
    super();
    projectIndexService.startIfNeeded();
  }
}

registerWorkbenchContribution2(
  ProjectIndexWorkbenchContribution.ID,
  ProjectIndexWorkbenchContribution,
  WorkbenchPhase.AfterRestored,
);

registerAction2(
  class extends Action2 {
    constructor() {
      super({
        id: PPR_REINDEX_WORKSPACE_COMMAND_ID,
        title: {
          value: localize('ppr.reindex', 'Sapphire: Reindex Workspace'),
          original: 'Sapphire: Reindex Workspace',
        },
        f1: true,
      });
    }
    run(accessor: ServicesAccessor) {
      return accessor.get(IProjectIndexService).reindexFull();
    }
  },
);


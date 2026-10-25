/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
  IInstantiationService,
  ServicesAccessor,
} from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
  IWorkbenchContribution,
  registerWorkbenchContribution2,
  WorkbenchPhase,
} from '../../../common/contributions.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IOfficeExtractService } from '../common/officeExtractService.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { ISapphireModelService } from '../common/sapphireModelService.js';
import { hasActiveChatWork } from '../common/chatStreamGuards.js';
import { ISapphireSettingsService } from '../common/sapphireSettingsService.js';
import {
  analyzeCsv,
  analyzeOfficeText,
  analyzeTextFile,
  contentHash,
  formatProjectIndexError,
  isSecretPath,
  kindFromPath,
  layerFromPath,
  localRoleFromPath,
  parsePurposeLlmJson,
  shouldSkipDirName,
  shouldSkipPath,
} from '../common/projectIndex/projectIndexAnalyze.js';
import { searchProjectIndex } from '../common/projectIndex/projectIndexSearch.js';
import { isScriptPath } from '../common/projectIndex/projectIndexStructure.js';
import {
  buildTourPromptInput,
  buildTourRecord,
  isTourStale,
  parseTourLlmJson,
  PROJECT_INDEX_TOUR_SYSTEM_MESSAGE,
} from '../common/projectIndex/projectIndexTour.js';
import {
  EMPTY_PROJECT_INDEX_STATUS,
  emptyManifest,
  emptyProjectIndexSteps,
  PROJECT_INDEX_DIR_SEGMENTS,
  PROJECT_INDEX_SCHEMA_VERSION,
  ProjectIndexChunkRecord,
  ProjectIndexEdgeRecord,
  ProjectIndexFileKind,
  ProjectIndexFileRecord,
  ProjectIndexManifest,
  ProjectIndexSearchHit,
  ProjectIndexStatus,
  ProjectIndexStepProgress,
  ProjectIndexSteps,
  ProjectIndexSymbolRecord,
  ProjectIndexTour,
} from '../common/projectIndex/projectIndexTypes.js';
import { joinPath } from '../../../../base/common/resources.js';
import { WORKSPACE_DOT_DIR, isUnderWorkspaceStateDir } from '../common/workspaceDotDir.js';
import { migrateLegacyWorkspaceDotDir } from './migrateWorkspaceDotDir.js';

export const IProjectIndexService = createDecorator<IProjectIndexService>('projectIndexService');

/**
 * Тот же service id, что у IChatThreadService.
 * Прямой import chatThreadService зациклил бы tools/heuristic → index → chat.
 */
const IChatThreadServiceForIndex = createDecorator<{
  readonly streamState: Readonly<
    Record<string, { isRunning?: string; interrupt?: unknown } | undefined>
  >;
  readonly onDidChangeStreamState: Event<{ threadId: string }>;
}>('sapphireChatThreadService');

export const SAPPHIRE_REINDEX_WORKSPACE_COMMAND_ID = 'sapphire.projectIndex.reindex';
/** @deprecated keybindings may still use this; aliased to SAPPHIRE_REINDEX_WORKSPACE_COMMAND_ID */
export const LEGACY_PPR_REINDEX_WORKSPACE_COMMAND_ID = 'ppr.projectIndex.reindex';

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
  /** Продолжить локальную индексацию после паузы. Purpose — когда чат idle. */
  resume(): Promise<void>;
  /** Запуск очереди LLM-описаний (purpose); если чат занят — откладывается. */
  startPurposeEnrichment(): Promise<void>;
  getTour(): ProjectIndexTour | null;
  /** Один LLM-запрос → `.sapphire/index/tour.json`. */
  generateTour(): Promise<void>;
  cancel(): void;
}

const MAX_TEXT_BYTES = 1_500_000;
const PURPOSE_CONCURRENCY = 1;
const RECENT_FILES_LIMIT = 40;

class ProjectIndexService extends Disposable implements IProjectIndexService {
  readonly _serviceBrand: undefined;

  private readonly _onDidChangeStatus = this._register(new Emitter<ProjectIndexStatus>());
  readonly onDidChangeStatus = this._onDidChangeStatus.event;

  private status: ProjectIndexStatus = {
    ...EMPTY_PROJECT_INDEX_STATUS,
    steps: emptyProjectIndexSteps(),
  };
  private files = new Map<string, ProjectIndexFileRecord>();
  private chunks: ProjectIndexChunkRecord[] = [];
  private symbols: ProjectIndexSymbolRecord[] = [];
  private edges: ProjectIndexEdgeRecord[] = [];
  private tour: ProjectIndexTour | null = null;
  private runId = 0;
  private cancelled = false;
  /** После Cancel пользователя — не стартуем watcher/startIfNeeded до явного reindex. */
  private autoIndexPaused = false;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private purposeQueue: string[] = [];
  private purposeRunning = false;
  /** Один авто-тур на успешный purpose-batch. */
  private autoTourScheduledForBatch = false;
  private tourRunning = false;
  private tourError: string | null = null;
  private loaded = false;
  /** true, пока идёт discover/analyze (не очередь purpose). */
  private indexRunning = false;
  /** Схлопнуть события watcher, пришедшие во время активного прогона. */
  private pendingIncremental = false;
  /** Purpose ждёт, пока в чате не останется активных запросов. */
  private purposeDeferredForChat = false;
  /** Тур ждёт idle чата (purpose уже не нужен или очередь пуста). */
  private tourDeferredForChat = false;
  /**
   * Авто-purpose один раз после загрузки или после файлов, которым purpose ещё не считали.
   * Иначе каждый пустой инкремент заново слал бы failed на шлюз.
   */
  private autoPurposeArmed = true;
  private lastLlmPurposeEnabled = false;
  private chatIdleListenerRegistered = false;
  private chatIdleDebounce: ReturnType<typeof setTimeout> | undefined;

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
    @IInstantiationService private readonly instantiationService: IInstantiationService,
  ) {
    super();
    this.lastLlmPurposeEnabled =
      this.sapphireSettingsService.state.globalSettings.projectIndexLlmPurpose === true;
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
        const purposeEnabled =
          this.sapphireSettingsService.state.globalSettings.projectIndexLlmPurpose === true;
        const turnedOn = purposeEnabled && !this.lastLlmPurposeEnabled;
        this.lastLlmPurposeEnabled = purposeEnabled;
        if (!purposeEnabled) {
          this.purposeDeferredForChat = false;
          return;
        }
        if (
          turnedOn &&
          this.loaded &&
          !this.indexRunning &&
          !this.autoIndexPaused &&
          !this.purposeRunning
        ) {
          this.autoPurposeArmed = true;
          this.afterLocalIndex();
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

  getTour(): ProjectIndexTour | null {
    return this.tour;
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
    this.tour = null;
    this.tourError = null;
    this.setStatus({ tour: null, tourError: null, tourStale: false });
    await this.clearTourFile();
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

  async startPurposeEnrichment(): Promise<void> {
    if (!this.rootUri()) {
      return;
    }
    if (!this.sapphireSettingsService.state.globalSettings.projectIndexLlmPurpose) {
      this.lastLlmPurposeEnabled = true;
      await this.sapphireSettingsService.setGlobalSetting('projectIndexLlmPurpose', true);
    }
    this.autoIndexPaused = false;
    this.cancelled = false;
    if (!this.loaded) {
      await this.loadFromDisk();
    }
    this.enqueuePurposeJobs(false);
  }

  override dispose(): void {
    if (this.chatIdleDebounce) {
      clearTimeout(this.chatIdleDebounce);
      this.chatIdleDebounce = undefined;
    }
    super.dispose();
  }

  async generateTour(): Promise<void> {
    if (!this.rootUri()) {
      return;
    }
    if (this.tourRunning) {
      return;
    }
    if (!this.loaded) {
      await this.loadFromDisk();
    }
    if (this.files.size === 0) {
      this.tourError = 'Index is empty — run indexing first.';
      this.setStatus({ tourError: this.tourError, tourRunning: false });
      return;
    }
    this.tourRunning = true;
    this.tourError = null;
    this.cancelled = false;
    this.autoIndexPaused = false;
    this.setStatus({ tourRunning: true, tourError: null });
    try {
      const files = this.getFiles();
      const knownPaths = new Set(files.map((f) => f.path));
      const user = buildTourPromptInput({ files, edges: this.edges });
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
          systemMessage: PROJECT_INDEX_TOUR_SYSTEM_MESSAGE,
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
          logging: { loggingName: 'ProjectIndexTour' },
        });
        if (!requestId) {
          reject(new Error('LLM request not started'));
        }
      });

      if (this.cancelled) {
        return;
      }
      const steps = parseTourLlmJson(fullText, knownPaths);
      const purposeDone = [...this.files.values()].filter((f) => f.llmStatus === 'done').length;
      this.tour = buildTourRecord(steps, {
        files: this.files.size,
        edges: this.edges.length,
        purposeDone,
      });
      this.tourError = null;
      await this.persistTour();
      this.setStatus({
        tour: this.tour,
        tourRunning: false,
        tourError: null,
        tourStale: false,
      });
    } catch (err) {
      this.tourError = formatProjectIndexError(err);
      this.setStatus({ tourRunning: false, tourError: this.tourError });
    } finally {
      this.tourRunning = false;
      if (this.status.tourRunning) {
        this.setStatus({ tourRunning: false });
      }
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.autoIndexPaused = true;
    this.runId++;
    this.purposeQueue = [];
    this.purposeDeferredForChat = false;
    this.tourDeferredForChat = false;
    if (this.chatIdleDebounce) {
      clearTimeout(this.chatIdleDebounce);
      this.chatIdleDebounce = undefined;
    }
    this.pendingIncremental = false;
    this.indexRunning = false;
    this.tourRunning = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.setStatus({
      phase: 'idle',
      currentPath: null,
      tourRunning: false,
    });
  }

  private isIndexBusy(): boolean {
    return (
      this.indexRunning ||
      this.purposeRunning ||
      this.tourRunning ||
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
   * Общий прогресс только по локальным шагам (scan + analyze).
   * Purpose — отдельный опциональный трек, не влияет на «проиндексирован».
   */
  private computeOverallPercent(
    phase: ProjectIndexStatus['phase'],
    processed: number,
    total: number,
  ): number {
    if (phase === 'idle' || phase === 'purpose') {
      return this.files.size > 0 ? 100 : 0;
    }
    if (phase === 'error') {
      return this.status.percent;
    }
    if (phase === 'scanning') {
      return 2;
    }
    if (phase === 'analyzing') {
      const local = total > 0 ? Math.min(1, processed / total) : 1;
      return Math.round(local * 100);
    }
    return 0;
  }

  private computeSteps(
    phase: ProjectIndexStatus['phase'],
    processed: number,
    total: number,
    purposeDone: number,
    purposePending: number,
    purposeFailed: number,
  ): ProjectIndexSteps {
    const purposeTotal = purposeDone + purposePending + purposeFailed;
    const purposePercent =
      purposeTotal > 0 ? Math.round((purposeDone / purposeTotal) * 100) : phase === 'idle' && this.files.size > 0 ? 100 : 0;

    const scanning: ProjectIndexStepProgress = (() => {
      if (phase === 'scanning') {
        return { state: 'active', percent: 50, processed: 0, total: 0 };
      }
      if (phase === 'error' && this.status.steps.scanning.state === 'active') {
        return { state: 'error', percent: this.status.steps.scanning.percent, processed: 0, total: 0 };
      }
      if (
        phase === 'analyzing' ||
        phase === 'purpose' ||
        (phase === 'idle' && this.files.size > 0) ||
        (phase === 'error' && this.files.size > 0)
      ) {
        return { state: 'done', percent: 100, processed: 0, total: 0 };
      }
      return { state: 'pending', percent: 0, processed: 0, total: 0 };
    })();

    const analyzing: ProjectIndexStepProgress = (() => {
      if (phase === 'scanning') {
        return { state: 'pending', percent: 0, processed: 0, total: 0 };
      }
      if (phase === 'analyzing') {
        const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
        return { state: 'active', percent: pct, processed, total };
      }
      if (phase === 'error' && this.status.steps.analyzing.state === 'active') {
        return {
          state: 'error',
          percent: this.status.steps.analyzing.percent,
          processed: this.status.steps.analyzing.processed,
          total: this.status.steps.analyzing.total,
        };
      }
      if (
        phase === 'purpose' ||
        (phase === 'idle' && this.files.size > 0) ||
        (phase === 'error' && this.files.size > 0)
      ) {
        return {
          state: 'done',
          percent: 100,
          processed: total > 0 ? total : this.files.size,
          total: total > 0 ? total : this.files.size,
        };
      }
      return { state: 'pending', percent: 0, processed: 0, total: 0 };
    })();

    const purpose: ProjectIndexStepProgress = (() => {
      // Живой прогресс только когда очередь реально бежит — иначе UI не мимикрирует под LLM.
      if (phase === 'purpose' || this.purposeRunning) {
        return {
          state: 'active',
          percent: Math.min(99, purposePercent),
          processed: purposeDone,
          total: Math.max(purposeTotal, 1),
        };
      }
      const queueLeft = purposePending + purposeFailed;
      if (queueLeft > 0) {
        return {
          state: 'pending',
          percent: 0,
          processed: 0,
          total: queueLeft,
        };
      }
      if (this.files.size > 0 && purposeDone > 0) {
        return {
          state: 'done',
          percent: 100,
          processed: purposeDone,
          total: purposeTotal || purposeDone,
        };
      }
      return {
        state: 'pending',
        percent: 0,
        processed: 0,
        total: 0,
      };
    })();

    return { scanning, analyzing, purpose };
  }

  private setStatus(patch: Partial<ProjectIndexStatus>): void {
    const manifest = this.buildManifest();
    // Не показываем stale error после успешного purpose (llmStatus === 'done').
    const errors = [...this.files.values()]
      .filter((f) => !!f.error && f.llmStatus !== 'done')
      .slice(-20)
      .map((f) => ({ path: f.path, error: f.error! }));
    const recentFiles = [...this.files.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, RECENT_FILES_LIMIT);
    const merged = { ...this.status, ...patch };
    const purposeDone = manifest?.counts.purposeDone ?? 0;
    const purposePending = manifest?.counts.purposePending ?? 0;
    const purposeFailed = manifest?.counts.purposeFailed ?? 0;
    const percent = this.computeOverallPercent(merged.phase, merged.processed, merged.total);
    const steps = this.computeSteps(
      merged.phase,
      merged.processed,
      merged.total,
      purposeDone,
      purposePending,
      purposeFailed,
    );
    const tour = merged.tour !== undefined ? merged.tour : this.tour;
    const tourStale = isTourStale(tour, manifest?.counts);
    this.status = {
      ...merged,
      percent,
      steps,
      isIndexed: this.files.size > 0,
      isPaused: this.autoIndexPaused,
      manifest,
      recentFiles,
      errors,
      tour,
      tourRunning: merged.tourRunning ?? this.tourRunning,
      tourError: merged.tourError !== undefined ? merged.tourError : this.tourError,
      tourStale,
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
      this.tour = null;
      this.tourError = null;
      this.setStatus({ ...EMPTY_PROJECT_INDEX_STATUS });
      this.loaded = true;
      return;
    }
    await migrateLegacyWorkspaceDotDir(this.fileService, root);
    const dir = this.indexDir(root);
    try {
      const manifestBuf = await this.fileService.readFile(joinPath(dir, 'manifest.json'));
      const manifest = JSON.parse(manifestBuf.value.toString()) as ProjectIndexManifest;
      if (manifest.schemaVersion !== PROJECT_INDEX_SCHEMA_VERSION) {
        this.files.clear();
        this.chunks = [];
        this.symbols = [];
        this.edges = [];
        this.tour = null;
        this.tourError = null;
        this.setStatus({
          phase: 'idle',
          percent: 0,
          processed: 0,
          total: 0,
          currentPath: null,
          error: null,
          manifest: emptyManifest(root.fsPath),
          tour: null,
          tourError: null,
          tourStale: false,
        });
        this.loaded = true;
        return;
      }
      const files = await this.readJsonl<ProjectIndexFileRecord>(joinPath(dir, 'files.jsonl'));
      this.chunks = await this.readJsonl<ProjectIndexChunkRecord>(joinPath(dir, 'chunks.jsonl'));
      this.symbols = await this.readJsonl<ProjectIndexSymbolRecord>(joinPath(dir, 'symbols.jsonl'));
      this.edges = await this.readJsonl<ProjectIndexEdgeRecord>(joinPath(dir, 'edges.jsonl'));
      this.tour = await this.readTour(dir);
      this.tourError = null;
      this.files.clear();
      for (const f of files) {
        this.files.set(f.path, f);
      }
      this.setStatus({
        phase: 'idle',
        percent: files.length > 0 ? 100 : 0,
        processed: 0,
        total: 0,
        currentPath: null,
        error: null,
        manifest,
        tour: this.tour,
        tourError: null,
      });
    } catch {
      this.files.clear();
      this.chunks = [];
      this.symbols = [];
      this.edges = [];
      this.tour = null;
      this.tourError = null;
      this.setStatus({
        phase: 'idle',
        percent: 0,
        processed: 0,
        total: 0,
        currentPath: null,
        error: null,
        manifest: emptyManifest(root.fsPath),
        tour: null,
        tourError: null,
        tourStale: false,
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

  private async readTour(dir: URI): Promise<ProjectIndexTour | null> {
    try {
      const buf = await this.fileService.readFile(joinPath(dir, 'tour.json'));
      const parsed = JSON.parse(buf.value.toString()) as ProjectIndexTour;
      if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async persistTour(): Promise<void> {
    const root = this.rootUri();
    if (!root || !this.tour) {
      return;
    }
    const dir = this.indexDir(root);
    try {
      await this.fileService.createFolder(dir);
    } catch {
      /* already exists */
    }
    await this.fileService.writeFile(
      joinPath(dir, 'tour.json'),
      VSBuffer.fromString(JSON.stringify(this.tour, null, 2)),
    );
  }

  private async clearTourFile(): Promise<void> {
    const root = this.rootUri();
    if (!root) {
      return;
    }
    try {
      await this.fileService.del(joinPath(this.indexDir(root), 'tour.json'));
    } catch {
      /* missing ok */
    }
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
    // Не мутируем корневой .gitignore пользователя (Wave 5).
    await this.ensureSapphireIndexGitignore(root);
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

  /** Только `.sapphire/.gitignore` — не трогаем корневой `.gitignore` репозитория. */
  private async ensureSapphireIndexGitignore(root: URI): Promise<void> {
    const gitignore = joinPath(root, WORKSPACE_DOT_DIR, '.gitignore');
    const line = 'index/\n';
    try {
      if (await this.fileService.exists(gitignore)) {
        const cur = (await this.fileService.readFile(gitignore)).value.toString();
        if (cur.includes('index/')) {
          return;
        }
        const next = cur.endsWith('\n') ? `${cur}${line}` : `${cur}\n${line}`;
        await this.fileService.writeFile(gitignore, VSBuffer.fromString(next));
      } else {
        await this.fileService.writeFile(gitignore, VSBuffer.fromString(line));
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
      const showScanning = full || this.files.size === 0;
      if (showScanning) {
        this.setStatus({
          phase: 'scanning',
          processed: 0,
          total: 0,
          currentPath: null,
          error: null,
        });
      }
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
      // Purpose/tour — если ещё есть работа и чат свободен.
      if (!full && toProcess.length === 0 && deletedPaths.length === 0) {
        this.setStatus({
          phase: 'idle',
          currentPath: null,
          processed: 0,
          total: 0,
        });
        this.afterLocalIndex();
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

      this.setStatus({
        phase: 'idle',
        currentPath: null,
        processed: toProcess.length,
        total: toProcess.length,
      });
      this.autoTourScheduledForBatch = false;
      this.afterLocalIndex();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus({ phase: 'error', error: message, currentPath: null });
    } finally {
      if (myRun === this.runId) {
        this.indexRunning = false;
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
    // Secret paths: не читаем и не пишем chunks (раньше только llmStatus=skipped).
    if (isSecretPath(relPath)) {
      this.chunks = this.chunks.filter((c) => c.path !== relPath);
      this.symbols = this.symbols.filter((s) => s.path !== relPath);
      this.edges = this.edges.filter((e) => e.fromPath !== relPath);
      this.files.set(relPath, {
        path: relPath,
        mtime,
        size,
        kind: kindFromPath(relPath) ?? 'other',
        hash: `${mtime}:${size}`,
        layer: layerFromPath(relPath),
        localRole: localRoleFromPath(relPath),
        llmStatus: 'skipped',
        updatedAt: Date.now(),
      });
      return;
    }
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
        if (!isScriptPath(relPath)) {
          const lsSymbols = await this.collectDocumentSymbols(uri);
          if (lsSymbols.length) {
            this.symbols = this.symbols.filter((s) => s.path !== relPath);
            this.symbols.push(...lsSymbols);
            this.edges = this.edges.filter((e) => !(e.fromPath === relPath && e.type === 'contains'));
            for (const symbol of lsSymbols) {
              this.edges.push({
                fromPath: relPath,
                toPath: relPath,
                type: 'contains',
                toSymbol: symbol.symbolName,
              });
            }
            localRole = localRoleFromPath(
              relPath,
              lsSymbols.map((s) => s.symbolName).slice(0, 8),
            );
          }
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
      layer: layerFromPath(relPath),
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
    if (!isSecretPath(relPath) && !unchangedPurpose) {
      this.autoPurposeArmed = true;
    }
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

  /** После локального индекса: purpose при включённом флаге, иначе тур если нужен. */
  private afterLocalIndex(): void {
    if (this.cancelled || this.autoIndexPaused || this.purposeRunning || this.tourRunning) {
      return;
    }
    if (!this.loaded) {
      return;
    }
    if (this.sapphireSettingsService.state.globalSettings.projectIndexLlmPurpose) {
      const resumeQueue = this.purposeDeferredForChat || this.purposeQueue.length > 0;
      if (!this.autoPurposeArmed && !resumeQueue) {
        this.scheduleAutoTour();
        return;
      }
      this.autoPurposeArmed = false;
      this.schedulePurposeWhenChatIdle();
      return;
    }
    this.purposeDeferredForChat = false;
    this.scheduleAutoTour();
  }

  private hasPendingPurposeFiles(): boolean {
    for (const file of this.files.values()) {
      if (file.llmStatus === 'pending' || file.llmStatus === 'failed') {
        return true;
      }
    }
    return false;
  }

  private chatThreads(): {
    readonly streamState: Readonly<
      Record<string, { isRunning?: string; interrupt?: unknown } | undefined>
    >;
    readonly onDidChangeStreamState: Event<{ threadId: string }>;
  } {
    return this.instantiationService.invokeFunction((accessor) =>
      accessor.get(IChatThreadServiceForIndex),
    );
  }

  private chatIsBusy(): boolean {
    return hasActiveChatWork(this.chatThreads().streamState);
  }

  private ensureChatIdleListener(): void {
    if (this.chatIdleListenerRegistered) {
      return;
    }
    this.chatIdleListenerRegistered = true;
    this._register(
      this.chatThreads().onDidChangeStreamState(() => {
        if (!this.purposeDeferredForChat && !this.tourDeferredForChat && this.purposeQueue.length === 0) {
          return;
        }
        if (this.chatIdleDebounce) {
          clearTimeout(this.chatIdleDebounce);
        }
        this.chatIdleDebounce = setTimeout(() => {
          this.chatIdleDebounce = undefined;
          if (this.chatIsBusy()) {
            return;
          }
          if (this.purposeDeferredForChat || this.purposeQueue.length > 0) {
            this.schedulePurposeWhenChatIdle();
            return;
          }
          if (this.tourDeferredForChat) {
            this.scheduleAutoTour();
          }
        }, 400);
      }),
    );
  }

  /** Стартует или продолжает purpose, только когда в чате нет активных запросов. */
  private schedulePurposeWhenChatIdle(): void {
    if (this.cancelled || this.autoIndexPaused || this.purposeRunning) {
      return;
    }
    if (!this.sapphireSettingsService.state.globalSettings.projectIndexLlmPurpose) {
      this.purposeDeferredForChat = false;
      this.scheduleAutoTour();
      return;
    }
    if (this.purposeQueue.length === 0 && !this.hasPendingPurposeFiles()) {
      this.purposeDeferredForChat = false;
      this.scheduleAutoTour();
      return;
    }
    if (this.chatIsBusy()) {
      this.purposeDeferredForChat = true;
      this.ensureChatIdleListener();
      return;
    }
    this.purposeDeferredForChat = false;
    if (this.purposeQueue.length === 0) {
      this.fillPurposeQueue(false);
    }
    if (this.purposeQueue.length === 0) {
      this.scheduleAutoTour();
      return;
    }
    void this.drainPurposeQueue();
  }

  private fillPurposeQueue(forceAll: boolean): void {
    this.autoTourScheduledForBatch = false;
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
  }

  private enqueuePurposeJobs(forceAll: boolean): void {
    this.fillPurposeQueue(forceAll);
    this.schedulePurposeWhenChatIdle();
  }

  private scheduleAutoTour(): void {
    if (this.autoTourScheduledForBatch || this.tourRunning || this.cancelled || this.files.size === 0) {
      return;
    }
    const counts = this.status.manifest?.counts;
    const snapshot = counts
      ? { files: counts.files, edges: counts.edges, purposeDone: counts.purposeDone }
      : null;
    const missing = !this.tour || !this.tour.steps?.length;
    if (!missing && !isTourStale(this.tour, snapshot)) {
      this.tourDeferredForChat = false;
      return;
    }
    if (this.chatIsBusy()) {
      this.tourDeferredForChat = true;
      this.ensureChatIdleListener();
      return;
    }
    this.tourDeferredForChat = false;
    this.autoTourScheduledForBatch = true;
    void this.generateTour();
  }

  private async drainPurposeQueue(): Promise<void> {
    if (this.purposeRunning) {
      return;
    }
    const batchSize = this.purposeQueue.length;
    this.purposeRunning = true;
    let pausedForChat = false;
    try {
      while (this.purposeQueue.length && PURPOSE_CONCURRENCY > 0) {
        if (this.cancelled) {
          break;
        }
        if (!this.sapphireSettingsService.state.globalSettings.projectIndexLlmPurpose) {
          break;
        }
        if (this.chatIsBusy()) {
          this.purposeDeferredForChat = true;
          pausedForChat = true;
          this.ensureChatIdleListener();
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
      const purposeStillEnabled =
        this.sapphireSettingsService.state.globalSettings.projectIndexLlmPurpose;
      if (
        batchSize > 0 &&
        !this.cancelled &&
        !pausedForChat &&
        (this.purposeQueue.length === 0 || !purposeStillEnabled)
      ) {
        this.scheduleAutoTour();
      }
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

      const parsed = parsePurposeLlmJson(fullText);
      this.files.set(file.path, {
        ...file,
        purpose: (parsed.purpose ?? '').trim() || file.localRole,
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 8) : [],
        whenUseful: (parsed.when_useful ?? '').trim() || undefined,
        llmStatus: 'done',
        error: undefined,
        updatedAt: Date.now(),
      });
    } catch (err) {
      this.files.set(file.path, {
        ...file,
        llmStatus: 'failed',
        error: formatProjectIndexError(err),
        updatedAt: Date.now(),
      });
    }
  }
}

registerSingleton(IProjectIndexService, ProjectIndexService, InstantiationType.Eager);

class ProjectIndexWorkbenchContribution extends Disposable implements IWorkbenchContribution {
  static readonly ID = 'workbench.contrib.sapphire.projectIndex';

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
        id: SAPPHIRE_REINDEX_WORKSPACE_COMMAND_ID,
        title: {
          value: localize('sapphire.reindex', 'Sapphire: Reindex Workspace'),
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

CommandsRegistry.registerCommandAlias(
  LEGACY_PPR_REINDEX_WORKSPACE_COMMAND_ID,
  SAPPHIRE_REINDEX_WORKSPACE_COMMAND_ID,
);

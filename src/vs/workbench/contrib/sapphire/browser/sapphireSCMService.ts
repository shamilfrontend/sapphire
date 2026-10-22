/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import {
  ContextKeyExpr,
  IContextKey,
  IContextKeyService,
} from '../../../../platform/contextkey/common/contextkey.js';
import { ISCMService } from '../../scm/common/scm.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { ISapphireSCMService } from '../common/sapphireSCMTypes.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ISapphireSettingsService } from '../common/sapphireSettingsService.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import {
  ModelSelection,
  OverridesOfModel,
  ModelSelectionOptions,
} from '../common/sapphireSettingsTypes.js';
import {
  gitCommitMessage_systemMessage,
  gitCommitMessage_userMessage,
} from '../common/prompt/prompts.js';
import { LLMChatMessage } from '../common/sendLLMMessageTypes.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ThrottledDelayer } from '../../../../base/common/async.js';
import { CancellationError, isCancellationError } from '../../../../base/common/errors.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import {
  createDecorator,
  ServicesAccessor,
} from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProjectIndexService } from './projectIndexService.js';
import {
  buildProjectIndexImpact,
  formatProjectIndexImpact,
} from '../common/projectIndex/projectIndexImpact.js';

interface ModelOptions {
  modelSelection: ModelSelection | null;
  modelSelectionOptions?: ModelSelectionOptions;
  overridesOfModel: OverridesOfModel;
}

interface IGenerateCommitMessageService {
  readonly _serviceBrand: undefined;
  generateCommitMessage(): Promise<void>;
  abort(): void;
}

const IGenerateCommitMessageService = createDecorator<IGenerateCommitMessageService>(
  'sapphireGenerateCommitMessageService',
);

const loadingContextKey = 'sapphireSCMGenerateCommitMessageLoading';

class GenerateCommitMessageService extends Disposable implements IGenerateCommitMessageService {
  readonly _serviceBrand: undefined;

  private readonly execute = new ThrottledDelayer(300);

  private llmRequestId: string | null = null;

  private currentRequestId: string | null = null;

  private sapphireSCM: ISapphireSCMService;

  private loadingContextKey: IContextKey<boolean>;

  constructor(
    @ISCMService private readonly scmService: ISCMService,
    @IMainProcessService mainProcessService: IMainProcessService,
    @ISapphireSettingsService private readonly sapphireSettingsService: ISapphireSettingsService,
    @IConvertToLLMMessageService
    private readonly convertToLLMMessageService: IConvertToLLMMessageService,
    @ILLMMessageService private readonly llmMessageService: ILLMMessageService,
    @IContextKeyService private readonly contextKeyService: IContextKeyService,
    @INotificationService private readonly notificationService: INotificationService,
    @IProjectIndexService private readonly projectIndexService: IProjectIndexService,
  ) {
    super();
    this.loadingContextKey = this.contextKeyService.createKey(loadingContextKey, false);
    this.sapphireSCM = ProxyChannel.toService<ISapphireSCMService>(
      mainProcessService.getChannel('sapphire-channel-scm'),
    );
  }

  override dispose() {
    this.execute.dispose();
    super.dispose();
  }

  async generateCommitMessage() {
    this.loadingContextKey.set(true);
    this.execute.trigger(async () => {
      const requestId = generateUuid();
      this.currentRequestId = requestId;

      try {
        const { path, repo } = this.gitRepoInfo();
        const [stat, sampledDiffs, branch, log, changedFiles] = await Promise.all([
          this.sapphireSCM.gitStat(path),
          this.sapphireSCM.gitSampledDiffs(path),
          this.sapphireSCM.gitBranch(path),
          this.sapphireSCM.gitLog(path),
          this.sapphireSCM.gitChangedFiles(path).catch(() => [] as string[]),
        ]);

        if (!this.isCurrentRequest(requestId)) {
          throw new CancellationError();
        }

        const modelSelection = this.sapphireSettingsService.state.modelSelectionOfFeature.SCM ?? null;
        const modelSelectionOptions = modelSelection
          ? this.sapphireSettingsService.state.optionsOfModelSelection.SCM[
              modelSelection?.providerName
            ]?.[modelSelection.modelName]
          : undefined;
        const overridesOfModel = this.sapphireSettingsService.state.overridesOfModel;

        const modelOptions: ModelOptions = {
          modelSelection,
          modelSelectionOptions,
          overridesOfModel,
        };

        const impact =
          changedFiles.length > 0
            ? formatProjectIndexImpact(
                buildProjectIndexImpact({
                  changedPaths: changedFiles,
                  files: this.projectIndexService.getFiles(),
                  symbols: this.projectIndexService.getSymbols(),
                  edges: this.projectIndexService.getEdges(),
                }),
              )
            : undefined;
        const prompt = gitCommitMessage_userMessage(stat, sampledDiffs, branch, log, impact);

        const simpleMessages = [{ role: 'user', content: prompt } as const];
        const { messages, separateSystemMessage } =
          this.convertToLLMMessageService.prepareLLMSimpleMessages({
            simpleMessages,
            systemMessage: gitCommitMessage_systemMessage,
            modelSelection: modelOptions.modelSelection,
            featureName: 'SCM',
          });

        const commitMessage = await this.sendLLMMessage(
          messages,
          separateSystemMessage!,
          modelOptions,
        );

        if (!this.isCurrentRequest(requestId)) {
          throw new CancellationError();
        }

        repo.input.setValue(commitMessage, false);
      } catch (error) {
        this.onError(error);
      } finally {
        if (this.isCurrentRequest(requestId)) {
          this.loadingContextKey.set(false);
        }
      }
    });
  }

  abort() {
    if (this.llmRequestId) {
      this.llmMessageService.abort(this.llmRequestId);
    }
    this.execute.cancel();
    this.loadingContextKey.set(false);
    this.currentRequestId = null;
  }

  private gitRepoInfo() {
    const repo = Array.from(this.scmService.repositories || []).find(
      (r: any) => r.provider.contextValue === 'git',
    );
    if (!repo) {
      throw new Error('No git repository found');
    }
    if (!repo.provider.rootUri?.fsPath) {
      throw new Error('No git repository root path found');
    }
    return { path: repo.provider.rootUri.fsPath, repo };
  }

  /** Вызов LLM для сообщения коммита */

  private sendLLMMessage(
    messages: LLMChatMessage[],
    separateSystemMessage: string,
    modelOptions: ModelOptions,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.llmRequestId = this.llmMessageService.sendLLMMessage({
        messagesType: 'chatMessages',
        featureName: 'SCM',
        messages,
        separateSystemMessage,
        chatMode: null,
        modelSelection: modelOptions.modelSelection,
        modelSelectionOptions: modelOptions.modelSelectionOptions,
        overridesOfModel: modelOptions.overridesOfModel,
        onText: () => {},
        onFinalMessage: (params: { fullText: string }) => {
          const match = params.fullText.match(/<output>([\s\S]*?)<\/output>/i);
          const commitMessage = match ? match[1].trim() : '';
          resolve(commitMessage);
        },
        onError: (error) => {
          console.error(error);
          reject(error);
        },
        onAbort: () => {
          reject(new CancellationError());
        },
        logging: { loggingName: 'SapphireSCM - Commit Message' },
      });
    });
  }

  /** Проверка актуальности запроса после debounce */

  private isCurrentRequest(requestId: string) {
    return requestId === this.currentRequestId;
  }

  /** Ошибки генерации (кроме отмены) */

  private onError(error: any) {
    if (!isCancellationError(error)) {
      console.error(error);
      this.notificationService.error(
        localize2('sapphireFailedToGenerateCommitMessage', 'Failed to generate commit message.').value,
      );
    }
  }
}

class GenerateCommitMessageAction extends Action2 {
  constructor() {
    super({
      id: 'sapphire.generateCommitMessageAction',
      title: localize2('sapphireCommitMessagePrompt', 'Sapphire: Generate Commit Message'),
      icon: ThemeIcon.fromId('sparkle'),
      tooltip: localize2('sapphireCommitMessagePromptTooltip', 'Sapphire: Generate Commit Message'),
      f1: true,
      menu: [
        {
          id: MenuId.SCMInputBox,
          when: ContextKeyExpr.and(
            ContextKeyExpr.equals('scmProvider', 'git'),
            ContextKeyExpr.equals(loadingContextKey, false),
          ),
          group: 'inline',
        },
      ],
    });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const generateCommitMessageService = accessor.get(IGenerateCommitMessageService);
    generateCommitMessageService.generateCommitMessage();
  }
}

class LoadingGenerateCommitMessageAction extends Action2 {
  constructor() {
    super({
      id: 'sapphire.loadingGenerateCommitMessageAction',
      title: localize2('sapphireCommitMessagePromptCancel', 'Sapphire: Cancel Commit Message Generation'),
      icon: ThemeIcon.fromId('stop-circle'),
      tooltip: localize2(
        'sapphireCommitMessagePromptCancelTooltip',
        'Sapphire: Cancel Commit Message Generation',
      ),
      f1: false, // Отмена в палитре команд только мешает.
      menu: [
        {
          id: MenuId.SCMInputBox,
          when: ContextKeyExpr.and(
            ContextKeyExpr.equals('scmProvider', 'git'),
            ContextKeyExpr.equals(loadingContextKey, true),
          ),
          group: 'inline',
        },
      ],
    });
  }

  async run(accessor: ServicesAccessor): Promise<void> {
    const generateCommitMessageService = accessor.get(IGenerateCommitMessageService);
    generateCommitMessageService.abort();
  }
}

registerAction2(GenerateCommitMessageAction);
registerAction2(LoadingGenerateCommitMessageAction);
registerSingleton(
  IGenerateCommitMessageService,
  GenerateCommitMessageService,
  InstantiationType.Delayed,
);

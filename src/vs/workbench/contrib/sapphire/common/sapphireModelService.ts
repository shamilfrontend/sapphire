import { Disposable, IReference } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import {
  IResolvedTextEditorModel,
  ITextModelService,
} from '../../../../editor/common/services/resolverService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import {
  registerSingleton,
  InstantiationType,
} from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';

type SapphireModelType = {
  model: ITextModel | null;
  editorModel: IResolvedTextEditorModel | null;
};

export interface ISapphireModelService {
  readonly _serviceBrand: undefined;
  initializeModel(uri: URI): Promise<void>;
  getModel(uri: URI): SapphireModelType;
  getModelFromFsPath(fsPath: string): SapphireModelType;
  getModelSafe(uri: URI): Promise<SapphireModelType>;
  saveModel(uri: URI): Promise<void>;
}

export const ISapphireModelService = createDecorator<ISapphireModelService>('sapphireModelService');

class SapphireModelService extends Disposable implements ISapphireModelService {
  _serviceBrand: undefined;

  static readonly ID = 'sapphireModelService';

  private readonly _modelRefOfURI: Record<string, IReference<IResolvedTextEditorModel>> = {};

  constructor(
    @ITextModelService private readonly _textModelService: ITextModelService,
    @ITextFileService private readonly _textFileService: ITextFileService,
    @IFileService private readonly _fileService: IFileService,
  ) {
    super();
  }

  saveModel = async (uri: URI) => {
    await this._textFileService.save(uri, {
      // Цепочка [наше изменение] → save — одна запись undo
      skipSaveParticipants: true, // не дергаем extensions (reformat добавит лишний undo)
    });
  };

  initializeModel = async (uri: URI) => {
    try {
      if (uri.fsPath in this._modelRefOfURI) return;
      // untitled / inmemory / прочие схемы — нет FS-провайдера, не на диске
      if (!this._fileService.hasProvider(uri)) {
        return;
      }
      // Устаревшие URI из истории чата (другой workspace / удалённые temp) —
      // не спамим консоль ошибками createModelReference.
      if (!(await this._fileService.exists(uri))) {
        return;
      }
      const editorModelRef = await this._textModelService.createModelReference(uri);
      // Сильная ссылка, чтобы модель не dispose-илась
      this._modelRefOfURI[uri.fsPath] = editorModelRef;
    } catch (e) {
      console.log('InitializeModel error:', e);
    }
  };

  getModelFromFsPath = (fsPath: string): SapphireModelType => {
    const editorModelRef = this._modelRefOfURI[fsPath];
    if (!editorModelRef) {
      return { model: null, editorModel: null };
    }

    const model = editorModelRef.object.textEditorModel;

    if (!model) {
      return { model: null, editorModel: editorModelRef.object };
    }

    return { model, editorModel: editorModelRef.object };
  };

  getModel = (uri: URI) => this.getModelFromFsPath(uri.fsPath);

  getModelSafe = async (uri: URI): Promise<SapphireModelType> => {
    if (!(uri.fsPath in this._modelRefOfURI)) await this.initializeModel(uri);
    return this.getModel(uri);
  };

  override dispose() {
    super.dispose();
    for (const ref of Object.values(this._modelRefOfURI)) {
      ref.dispose(); // отпустить ссылку для dispose модели
    }
  }
}

registerSingleton(ISapphireModelService, SapphireModelService, InstantiationType.Eager);

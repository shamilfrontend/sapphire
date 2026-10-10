/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import {
  InstantiationType,
  registerSingleton,
} from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

// «Постоянный» элемент привязан к модели (URI), а не к одному экземпляру редактора

type AddItemInputs = { uri: URI; fn: (editor: ICodeEditor) => () => void };

export interface IConsistentItemService {
  readonly _serviceBrand: undefined;
  getEditorsOnURI(uri: URI): ICodeEditor[];
  addConsistentItemToURI(inputs: AddItemInputs): string;
  removeConsistentItemFromURI(consistentItemId: string): void;
}

export const IConsistentItemService =
  createDecorator<IConsistentItemService>('ConsistentItemService');

export class ConsistentItemService extends Disposable implements IConsistentItemService {
  readonly _serviceBrand: undefined;

  // элементы по URI, независимо от того, какие редакторы сейчас открыты
  private readonly consistentItemIdsOfURI: Record<string, Set<string> | undefined> = {};

  private readonly infoOfConsistentItemId: Record<string, AddItemInputs> = {};

  // какие itemId смонтированы на каждом редакторе и fn для их снятия
  private readonly itemIdsOfEditorId: Record<string, Set<string> | undefined> = {};

  private readonly consistentItemIdOfItemId: Record<string, string> = {};

  private readonly disposeFnOfItemId: Record<string, () => void> = {};

  constructor(@ICodeEditorService private readonly _editorService: ICodeEditorService) {
    super();

    const removeItemsFromEditor = (editor: ICodeEditor) => {
      const editorId = editor.getId();
      for (const itemId of this.itemIdsOfEditorId[editorId] ?? [])
        this._removeItemFromEditor(editor, itemId);
    };

    // смонтировать на редактор все consistent-элементы для URI модели
    const putItemsOnEditor = (editor: ICodeEditor, uri: URI | null) => {
      if (!uri) return;
      for (const consistentItemId of this.consistentItemIdsOfURI[uri.fsPath] ?? [])
        this._putItemOnEditor(editor, consistentItemId);
    };

    // смена вкладки / модели в редакторе
    const addTabSwitchListeners = (editor: ICodeEditor) => {
      this._register(
        editor.onDidChangeModel((e) => {
          removeItemsFromEditor(editor);
          putItemsOnEditor(editor, e.newModelUrl);
        }),
      );
    };

    // dispose редактора
    const addDisposeListener = (editor: ICodeEditor) => {
      this._register(
        editor.onDidDispose(() => {
          // виджеты редактора уже уничтожены — только чистим записи
          for (const itemId of this.itemIdsOfEditorId[editor.getId()] ?? [])
            delete this.disposeFnOfItemId[itemId];
        }),
      );
    };

    const initializeEditor = (editor: ICodeEditor) => {
      // if (editor.getModel()?.uri.scheme !== 'file') return // ломает сценарии — не включать
      addTabSwitchListeners(editor);
      addDisposeListener(editor);
      putItemsOnEditor(editor, editor.getModel()?.uri ?? null);
    };

    // уже открытые редакторы и каждый новый
    for (let editor of this._editorService.listCodeEditors()) initializeEditor(editor);
    this._register(
      this._editorService.onCodeEditorAdd((editor) => {
        initializeEditor(editor);
      }),
    );

    // редактор закрыт — снять все его item
    this._register(
      this._editorService.onCodeEditorRemove((editor) => {
        removeItemsFromEditor(editor);
      }),
    );
  }

  _putItemOnEditor(editor: ICodeEditor, consistentItemId: string) {
    const { fn } = this.infoOfConsistentItemId[consistentItemId];

    // создать item на редакторе
    const dispose = fn(editor);

    const itemId = generateUuid();
    const editorId = editor.getId();

    if (!(editorId in this.itemIdsOfEditorId)) this.itemIdsOfEditorId[editorId] = new Set();
    this.itemIdsOfEditorId[editorId]!.add(itemId);

    this.consistentItemIdOfItemId[itemId] = consistentItemId;

    this.disposeFnOfItemId[itemId] = () => {
      // console.log('calling remove for', itemId)
      dispose?.();
    };
  }

  _removeItemFromEditor(editor: ICodeEditor, itemId: string) {
    const editorId = editor.getId();
    this.itemIdsOfEditorId[editorId]?.delete(itemId);

    this.disposeFnOfItemId[itemId]?.();
    delete this.disposeFnOfItemId[itemId];

    delete this.consistentItemIdOfItemId[itemId];
  }

  getEditorsOnURI(uri: URI) {
    const editors = this._editorService
      .listCodeEditors()
      .filter((editor) => editor.getModel()?.uri.fsPath === uri.fsPath);
    return editors;
  }

  consistentItemIdPool = 0;

  addConsistentItemToURI({ uri, fn }: AddItemInputs) {
    const consistentItemId = `${this.consistentItemIdPool++}`;

    if (!(uri.fsPath in this.consistentItemIdsOfURI))
      this.consistentItemIdsOfURI[uri.fsPath] = new Set();
    this.consistentItemIdsOfURI[uri.fsPath]!.add(consistentItemId);

    this.infoOfConsistentItemId[consistentItemId] = { fn, uri };

    const editors = this.getEditorsOnURI(uri);
    for (const editor of editors) this._putItemOnEditor(editor, consistentItemId);

    return consistentItemId;
  }

  removeConsistentItemFromURI(consistentItemId: string) {
    if (!(consistentItemId in this.infoOfConsistentItemId)) return;

    const { uri } = this.infoOfConsistentItemId[consistentItemId];
    const editors = this.getEditorsOnURI(uri);

    for (const editor of editors) {
      for (const itemId of this.itemIdsOfEditorId[editor.getId()] ?? []) {
        if (this.consistentItemIdOfItemId[itemId] === consistentItemId)
          this._removeItemFromEditor(editor, itemId);
      }
    }

    // убрать из реестра URI
    this.consistentItemIdsOfURI[uri.fsPath]?.delete(consistentItemId);

    delete this.infoOfConsistentItemId[consistentItemId];
  }
}

registerSingleton(IConsistentItemService, ConsistentItemService, InstantiationType.Eager);

// Вариант для одного редактора (логика близка к ConsistentItemService выше)
export interface IConsistentEditorItemService {
  readonly _serviceBrand: undefined;
  addToEditor(editor: ICodeEditor, fn: () => () => void): string;
  removeFromEditor(itemId: string): void;
}
export const IConsistentEditorItemService = createDecorator<IConsistentEditorItemService>(
  'ConsistentEditorItemService',
);

export class ConsistentEditorItemService extends Disposable {
  readonly _serviceBrand: undefined;

  /**
   * Для каждого editorId — множество itemId, «добавленных» к этому редактору.
   * Не значит, что они сейчас смонтированы (модель могли сменить).
   */
  private readonly itemIdsByEditorId: Record<string, Set<string>> = {};

  /**
   * По itemId: fn для редактора, editorId, uri и текущий dispose.
   */
  private readonly itemInfoById: Record<
    string,
    {
      editorId: string;
      uriFsPath: string;
      fn: (editor: ICodeEditor) => () => void;
      disposeFn?: () => void;
    }
  > = {};

  constructor(@ICodeEditorService private readonly _editorService: ICodeEditorService) {
    super();

    // Слушатели: новые/удалённые редакторы

    // Уже открытые редакторы
    for (const editor of this._editorService.listCodeEditors()) {
      this._initializeEditor(editor);
    }

    // Новый редактор
    this._register(
      this._editorService.onCodeEditorAdd((editor) => {
        this._initializeEditor(editor);
      }),
    );

    // Редактор закрыт — снять все его item
    this._register(
      this._editorService.onCodeEditorRemove((editor) => {
        this._removeAllItemsFromEditor(editor);
      }),
    );
  }

  /**
   * Подписки на редактор:
   * - смена модели → снять item и смонтировать только совпадающие с новым URI;
   * - dispose → очистка.
   */
  private _initializeEditor(editor: ICodeEditor) {
    const editorId = editor.getId();

    // Смена модели
    this._register(
      editor.onDidChangeModel((e) => {
        this._removeAllItemsFromEditor(editor);
        if (!e.newModelUrl) {
          return;
        }
        // Смонтировать item этого редактора, если uri совпадает с новой моделью
        const itemsForEditor = this.itemIdsByEditorId[editorId];
        if (itemsForEditor) {
          for (const itemId of itemsForEditor) {
            const itemInfo = this.itemInfoById[itemId];
            if (itemInfo && itemInfo.uriFsPath === e.newModelUrl.fsPath) {
              this._mountItemOnEditor(editor, itemId);
            }
          }
        }
      }),
    );

    // Dispose редактора
    this._register(
      editor.onDidDispose(() => {
        this._removeAllItemsFromEditor(editor);
      }),
    );

    // При первом открытии — смонтировать item для текущей модели
    const uri = editor.getModel()?.uri;
    if (!uri) {
      return;
    }

    const itemsForEditor = this.itemIdsByEditorId[editorId];
    if (itemsForEditor) {
      for (const itemId of itemsForEditor) {
        const itemInfo = this.itemInfoById[itemId];
        if (itemInfo && itemInfo.uriFsPath === uri.fsPath) {
          this._mountItemOnEditor(editor, itemId);
        }
      }
    }
  }

  /** Вызывает `fn(editor)` и сохраняет disposeFn для последующей очистки. */
  private _mountItemOnEditor(editor: ICodeEditor, itemId: string) {
    const info = this.itemInfoById[itemId];
    if (!info) {
      return;
    }
    const { fn } = info;
    const disposeFn = fn(editor);
    info.disposeFn = disposeFn;
  }

  /** Снять один item с редактора (вызвать disposeFn, если есть). */
  private _removeItemFromEditor(editor: ICodeEditor, itemId: string) {
    const info = this.itemInfoById[itemId];
    if (info?.disposeFn) {
      info.disposeFn();
      info.disposeFn = undefined;
    }
  }

  /** Снять все item с редактора (смена модели или dispose). */
  private _removeAllItemsFromEditor(editor: ICodeEditor) {
    const editorId = editor.getId();
    const itemsForEditor = this.itemIdsByEditorId[editorId];
    if (!itemsForEditor) {
      return;
    }

    for (const itemId of itemsForEditor) {
      this._removeItemFromEditor(editor, itemId);
    }
  }

  /**
   * Добавить item одному редактору (по editorId);
   * монтируется сразу, только если uri.fsPath совпадает с текущей моделью.
   */
  addToEditor(editor: ICodeEditor, fn: () => () => void): string {
    const uri = editor.getModel()?.uri;
    if (!uri) {
      throw new Error('No URI on the provided editor or in AddItemInputs.');
    }

    const editorId = editor.getId();

    // id элемента
    const itemId = generateUuid();

    // метаданные item
    this.itemInfoById[itemId] = {
      editorId,
      uriFsPath: uri.fsPath,
      fn,
    };

    // учёт в itemIdsByEditorId
    if (!this.itemIdsByEditorId[editorId]) {
      this.itemIdsByEditorId[editorId] = new Set();
    }
    this.itemIdsByEditorId[editorId].add(itemId);

    // uri совпадает — монтируем сразу
    if (editor.getModel()?.uri.fsPath === uri.fsPath) {
      this._mountItemOnEditor(editor, itemId);
    }

    return itemId;
  }

  /** Удалить item: находим редактор по itemId и снимаем item там. */
  removeFromEditor(itemId: string): void {
    const info = this.itemInfoById[itemId];
    if (!info) {
      // нечего удалять
      return;
    }

    const { editorId } = info;

    // редактор-владелец
    const editor = this._editorService.listCodeEditors().find((ed) => ed.getId() === editorId);
    if (editor) {
      // dispose на этом редакторе
      this._removeItemFromEditor(editor, itemId);
    }

    // убрать из словарей
    this.itemIdsByEditorId[editorId]?.delete(itemId);
    delete this.itemInfoById[itemId];
  }
}

registerSingleton(
  IConsistentEditorItemService,
  ConsistentEditorItemService,
  InstantiationType.Eager,
);

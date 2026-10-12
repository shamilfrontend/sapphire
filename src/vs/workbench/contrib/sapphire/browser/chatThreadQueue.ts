/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import {
  ChatImageAttachment,
  QueuedUserMessage,
  StagingSelectionItem,
} from '../common/chatThreadServiceTypes.js';
import { canEnqueueFollowUp } from '../common/chatStreamGuards.js';
import { chatTrace } from '../common/chatSendTrace.js';
import { ChatThreadCollaboratorHost } from './chatThreadTypes.js';

export class ChatThreadQueue {
  constructor(private readonly _s: ChatThreadCollaboratorHost) {}

  private _notifyMessageQueue(threadId: string) {
    // Те же слушатели stream-state — React перечитает getMessageQueue
    this._s._onDidChangeStreamState.fire({ threadId });
  }

  getMessageQueue(threadId: string): QueuedUserMessage[] {
    return this._s._messageQueues[threadId] ?? [];
  }

  enqueueUserMessage(opts: {
    threadId: string;
    text: string;
    images?: ChatImageAttachment[];
    selections?: StagingSelectionItem[];
  }): QueuedUserMessage {
    const item: QueuedUserMessage = {
      id: generateUuid(),
      text: opts.text,
      ...(opts.images?.length ? { images: opts.images } : {}),
      ...(opts.selections?.length ? { selections: opts.selections } : {}),
    };
    const queue =
      this._s._messageQueues[opts.threadId] ?? (this._s._messageQueues[opts.threadId] = []);
    queue.push(item);
    this._notifyMessageQueue(opts.threadId);
    const stream = this._s.streamState[opts.threadId];
    const running = stream?.isRunning;
    const interrupt = stream && 'interrupt' in stream ? stream.interrupt : undefined;
    chatTrace(opts.threadId, 'enqueue', `chars=${opts.text.length} q=${queue.length} running=${running ?? 'none'}`);
    // Мёртвая очередь: нет живого агента — сразу flush, иначе сообщение пропадает.
    if (!canEnqueueFollowUp(running, interrupt)) {
      chatTrace(opts.threadId, 'enqueue.flush-now', `running=${running ?? 'none'}`);
      void this._flushMessageQueue(opts.threadId);
    }
    return item;
  }

  removeQueuedMessage(threadId: string, queuedId: string): QueuedUserMessage | undefined {
    const queue = this._s._messageQueues[threadId];
    if (!queue?.length) return undefined;
    const idx = queue.findIndex((q: QueuedUserMessage) => q.id === queuedId);
    if (idx < 0) return undefined;
    const [removed] = queue.splice(idx, 1);
    if (!queue.length) delete this._s._messageQueues[threadId];
    this._notifyMessageQueue(threadId);
    return removed;
  }

  updateQueuedMessage(
    threadId: string,
    queuedId: string,
    patch: Partial<Pick<QueuedUserMessage, 'text' | 'images' | 'selections'>>,
  ): void {
    const queue = this._s._messageQueues[threadId];
    if (!queue) return;
    const idx = queue.findIndex((q: QueuedUserMessage) => q.id === queuedId);
    if (idx < 0) return;
    queue[idx] = { ...queue[idx], ...patch };
    this._notifyMessageQueue(threadId);
  }

  clearMessageQueue(threadId: string): void {
    if (!this._s._messageQueues[threadId]?.length) return;
    delete this._s._messageQueues[threadId];
    this._notifyMessageQueue(threadId);
  }

  async steerQueuedMessage(threadId: string, queuedId: string): Promise<void> {
    const item = this.removeQueuedMessage(threadId, queuedId);
    if (!item) return;
    await this._s.abortRunning(threadId, { skipFlush: true });
    // Ждём сброса stream state, чтобы steer не гонялся с умирающим tool/LLM-циклом
    for (let i = 0; i < 50 && this._s.streamState[threadId]?.isRunning; i++) {
      await timeout(20);
    }
    await this._s.addUserMessageAndStreamResponse({
      userMessage: item.text,
      threadId,
      images: item.images,
      _chatSelections: item.selections,
    });
  }

  async _flushMessageQueue(threadId: string): Promise<void> {
    if (this._s._flushingQueue.has(threadId)) {
      chatTrace(threadId, 'flush.skip', 'already-flushing');
      return;
    }
    const stream = this._s.streamState[threadId];
    const running = stream?.isRunning;
    const interrupt = stream && 'interrupt' in stream ? stream.interrupt : undefined;
    // preparing / awaiting_user / undefined / idle+not_needed — можно стартовать; LLM/tool/живой idle — ждём
    if (canEnqueueFollowUp(running, interrupt)) {
      chatTrace(threadId, 'flush.skip', `running=${running}`);
      return;
    }
    const queue = this._s._messageQueues[threadId];
    if (!queue?.length) return;
    chatTrace(threadId, 'flush.start', `q=${queue.length} running=${running ?? 'none'}`);

    const next = queue.shift()!;
    if (!queue.length) delete this._s._messageQueues[threadId];
    this._notifyMessageQueue(threadId);

    this._s._flushingQueue.add(threadId);
    try {
      await this._s.addUserMessageAndStreamResponse({
        userMessage: next.text,
        threadId,
        images: next.images,
        _chatSelections: next.selections,
      });
    } finally {
      this._s._flushingQueue.delete(threadId);
    }
  }
}

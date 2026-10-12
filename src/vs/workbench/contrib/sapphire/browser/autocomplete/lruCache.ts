/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export class LRUCache<K, V> {
  public items: Map<K, V>;

  private keyOrder: K[];

  private maxSize: number;

  private disposeCallback?: (value: V, key?: K) => void;

  constructor(maxSize: number, disposeCallback?: (value: V, key?: K) => void) {
    if (maxSize <= 0) throw new Error('Cache size must be greater than 0');

    this.items = new Map();
    this.keyOrder = [];
    this.maxSize = maxSize;
    this.disposeCallback = disposeCallback;
  }

  set(key: K, value: V): void {
    // ключ есть — обновить порядок LRU
    if (this.items.has(key)) {
      this.keyOrder = this.keyOrder.filter((k) => k !== key);
    }
    // переполнение — вытеснить LRU
    else if (this.items.size >= this.maxSize) {
      const key = this.keyOrder[0];
      const value = this.items.get(key);

      // dispose при вытеснении/удалении
      if (this.disposeCallback && value !== undefined) {
        this.disposeCallback(value, key);
      }

      this.items.delete(key);
      this.keyOrder.shift();
    }

    // добавить в конец LRU
    this.items.set(key, value);
    this.keyOrder.push(key);
  }

  delete(key: K): boolean {
    const value = this.items.get(key);

    if (value !== undefined) {
      // dispose при вытеснении/удалении
      if (this.disposeCallback) {
        this.disposeCallback(value, key);
      }

      this.items.delete(key);
      this.keyOrder = this.keyOrder.filter((k) => k !== key);
      return true;
    }

    return false;
  }

  clear(): void {
    // dispose всех элементов
    if (this.disposeCallback) {
      for (const [key, value] of this.items.entries()) {
        this.disposeCallback(value, key);
      }
    }

    this.items.clear();
    this.keyOrder = [];
  }

  get size(): number {
    return this.items.size;
  }

  has(key: K): boolean {
    return this.items.has(key);
  }
}

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

Object.defineProperty(window, 'localStorage', { configurable: true, value: new MemoryStorage() });
Object.defineProperty(window, 'ResizeObserver', {
  configurable: true,
  value: class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
});

afterEach(() => {
  cleanup();
  window.localStorage?.clear();
});

import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as unknown as typeof IntersectionObserver;

// Polyfill minimal DragEvent/DataTransfer for jsdom
const globalWithDrag = globalThis as typeof globalThis & {
  DataTransfer?: typeof DataTransfer;
  DragEvent?: typeof DragEvent;
};

if (typeof globalWithDrag.DataTransfer === 'undefined') {
  class DataTransferPolyfill {
    private data: Record<string, string> = {};
    dropEffect = 'none';
    effectAllowed = 'all';
    files: File[] = [];
    items: DataTransferItem[] = [];
    types: string[] = [];

    setData(format: string, data: string) {
      this.data[format] = data;
      this.types = Object.keys(this.data);
    }

    getData(format: string) {
      return this.data[format] ?? '';
    }

    clearData(format?: string) {
      if (format) {
        delete this.data[format];
      } else {
        this.data = {};
      }
      this.types = Object.keys(this.data);
    }
  }

  globalWithDrag.DataTransfer = DataTransferPolyfill as unknown as typeof DataTransfer;
}

if (typeof globalWithDrag.DragEvent === 'undefined') {
  class DragEventPolyfill extends Event {
    dataTransfer: DataTransfer | null;

    constructor(type: string, eventInitDict: DragEventInit = {}) {
      super(type, eventInitDict);
      this.dataTransfer = eventInitDict.dataTransfer ?? null;
    }
  }

  globalWithDrag.DragEvent = DragEventPolyfill as typeof DragEvent;
}

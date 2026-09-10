// Vitest 5 changed `Assertion` from a single type parameter (`Assertion<T>`)
// to two (`Assertion<R, T>`) — see vitest-dev/vitest#10221 ("Inline `expect`
// package"). @testing-library/jest-dom's own `./vitest` type augmentation
// (types/vitest.d.ts) still targets the old single-parameter shape, so it no
// longer merges with vitest 5's `Assertion` interface and its matchers
// (toBeInTheDocument, toHaveTextContent, ...) silently disappear from the
// `expect(...)` return type. This file re-declares the augmentation against
// vitest 5's actual arity using jest-dom's public `./matchers` matcher types.
// TODO: drop this file once @testing-library/jest-dom ships vitest 5 support
// (https://github.com/testing-library/jest-dom) and its own `/vitest` types
// merge cleanly again.
/* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import type jestDomMatchers from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  interface Assertion<R = void, T = unknown>
    extends jestDomMatchers.TestingLibraryMatchers<any, R> {}
  interface AsymmetricMatchersContaining
    extends jestDomMatchers.TestingLibraryMatchers<any, any> {}
}

export {};

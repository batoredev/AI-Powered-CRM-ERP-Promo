import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// React Testing Library does not auto-cleanup between tests unless
// `test.globals: true` is set (it isn't, in vitest.config.ts — global
// injection is avoided project-wide so every test file imports what it
// uses explicitly). Without this, a component rendered in one `it()`
// stays mounted into the next, causing duplicate-element / stale-DOM
// failures in any file with more than one test that calls `render()`.
// Found in Phase 2B-2 Task 3 (DealCard.test.tsx) and fixed globally here
// so no future component test file has to rediscover it.
afterEach(() => {
  cleanup();
});

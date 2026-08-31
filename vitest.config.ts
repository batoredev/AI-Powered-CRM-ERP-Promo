import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';

// Load .env.local so DB connection strings (DATABASE_URL,
// APP_RUNTIME_DATABASE_URL) are available to test files without every
// test having to load them itself.
loadDotenv({ path: '.env.local' });

export default defineConfig({
  test: {
    // Vitest 4 replaced the separate `vitest.workspace.ts` file with an
    // inline `test.projects` array. Two projects run side by side:
    //  - "backend": existing db/lib tests, node environment, hits a real
    //    Postgres connection (jsdom would break these).
    //  - "components": new app/**/*.test.tsx component tests, jsdom
    //    environment, with Testing Library's jest-dom matchers.
    projects: [
      {
        extends: true,
        test: {
          name: 'backend',
          environment: 'node',
          include: ['db/**/*.test.ts', 'lib/**/*.test.ts'],
        },
      },
      {
        extends: true,
        // tsconfig.json sets `jsx: "preserve"` (Next.js requires this so its
        // own compiler can do the JSX transform at build time). Vite's
        // default transformer (oxc) can't handle "preserve" JSX and errors
        // on any .tsx file, so this project overrides its jsx mode locally
        // — scoped to component tests only, leaving the real tsconfig (and
        // the "backend" project, which never touches JSX) untouched.
        oxc: {
          jsx: { runtime: 'automatic' },
        },
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['app/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});

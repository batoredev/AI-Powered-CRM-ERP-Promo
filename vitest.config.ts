import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';

// Load .env.local so DB connection strings (DATABASE_URL,
// APP_RUNTIME_DATABASE_URL) are available to test files without every
// test having to load them itself.
loadDotenv({ path: '.env.local' });

export default defineConfig({
  test: {},
});

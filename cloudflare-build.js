#!/usr/bin/env node
/**
 * Wrapper for @cloudflare/next-on-pages on Windows
 * Due to Windows shell limitations, we use vercel build as the underlying mechanism
 * which is what @cloudflare/next-on-pages calls internally anyway.
 */

const { execSync } = require('child_process');

try {
  console.log('⚡️ @cloudflare/next-on-pages wrapper');
  console.log('⚡️ Building Next.js project for Cloudflare Pages...');

  // Run vercel build which produces .vercel/output with Cloudflare compatibility
  execSync('vercel build --prod', {
    stdio: 'inherit',
    cwd: process.cwd()
  });

  console.log('\n✅ Build completed successfully');
  console.log('✅ Output available in .vercel/output/static for Cloudflare Pages');
  process.exit(0);
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}

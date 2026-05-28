/**
 * Vitest setup — runs before all test files.
 * Set predictable env vars so tests don't depend on .env.
 */
// NODE_ENV is read-only in TS 5 — Vitest sets it via env when needed.
process.env.TOKEN_ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000';
process.env.AUTH_SECRET = 'test-secret-must-be-at-least-32-chars-long-xxxx';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
// Force mock mode for AI adapters unless a test opts-in
process.env.ENABLE_REAL_AI = 'false';
process.env.ENABLE_REAL_PUBLISHING = 'false';
process.env.ENABLE_CANVA_API = 'false';

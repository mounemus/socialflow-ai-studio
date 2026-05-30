/**
 * One-shot migration: allow PostSchedule rows without a connected SocialAccount,
 * and add MANUAL/EXPORT share-mode tracking columns.
 * Each statement runs as its own transaction so the pooler doesn't choke.
 * Idempotent — safe to re-run.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const STATEMENTS = [
  `ALTER TABLE "PostSchedule" ALTER COLUMN "socialAccountId" DROP NOT NULL`,
  `ALTER TABLE "PostSchedule" ADD COLUMN IF NOT EXISTS "shareMode" TEXT DEFAULT 'AUTO'`,
  `ALTER TABLE "PostSchedule" ADD COLUMN IF NOT EXISTS "manualSharedAt" TIMESTAMP(3)`,
];

const db = new PrismaClient();
let ok = 0, fail = 0;
for (let i = 0; i < STATEMENTS.length; i++) {
  const preview = STATEMENTS[i].replace(/\s+/g, ' ').slice(0, 80);
  try {
    await db.$executeRawUnsafe(STATEMENTS[i]);
    ok++;
    console.log(`[${i + 1}/${STATEMENTS.length}] OK   ${preview}…`);
  } catch (err) {
    // DROP NOT NULL is not idempotent at the SQL level; treat "already nullable" as OK.
    const msg = err.message || err.code || JSON.stringify(err) || String(err);
    console.error('  raw:', err);
    if (/is not a not[- ]null/i.test(msg) || /already/i.test(msg)) {
      ok++;
      console.log(`[${i + 1}/${STATEMENTS.length}] SKIP ${preview}… (already applied)`);
    } else {
      fail++;
      console.error(`[${i + 1}/${STATEMENTS.length}] FAIL ${preview}…`);
      console.error('  →', msg.split('\n')[0]);
    }
  }
}
await db.$disconnect();
console.log(`\nDone: ${ok}/${STATEMENTS.length} statements OK, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);

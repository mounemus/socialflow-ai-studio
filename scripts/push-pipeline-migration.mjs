/**
 * One-shot migration: applies BrandPipelineRun additions via Prisma's raw SQL.
 * Each statement runs as its own transaction so the pooler doesn't choke.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const STATEMENTS = [
  `DO $$ BEGIN
    CREATE TYPE "BrandPipelineStatus" AS ENUM ('RUNNING','AWAITING_ADMIN','PAUSED','COMPLETED','FAILED','CANCELLED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "BrandPipelineStep" AS ENUM ('CREATE_BRAND','ENRICH_PROFILE','VALIDATE_PROFILE','GENERATE_STRATEGY','VALIDATE_STRATEGY_ITEMS','EXECUTE_ITEMS','DONE');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "BrandPipelineFieldStatus" AS ENUM ('PENDING','PROPOSED','EDITED','APPROVED','REJECTED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `CREATE TABLE IF NOT EXISTS "BrandPipelineRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "startedById" TEXT NOT NULL,
    "agentRunId" TEXT,
    "strategyId" TEXT,
    "horizon" TEXT NOT NULL DEFAULT '90d',
    "language" TEXT NOT NULL DEFAULT 'fr',
    "status" "BrandPipelineStatus" NOT NULL DEFAULT 'RUNNING',
    "step" "BrandPipelineStep" NOT NULL DEFAULT 'CREATE_BRAND',
    "seed" JSONB NOT NULL DEFAULT '{}',
    "fieldStates" JSONB NOT NULL DEFAULT '{}',
    "itemStates" JSONB NOT NULL DEFAULT '{}',
    "executionLog" JSONB NOT NULL DEFAULT '[]',
    "trace" JSONB NOT NULL DEFAULT '[]',
    "adminNotes" TEXT,
    "approvedProfileAt" TIMESTAMP(3),
    "approvedProfileById" TEXT,
    "approvedStrategyAt" TIMESTAMP(3),
    "approvedStrategyById" TEXT,
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrandPipelineRun_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "BrandPipelineRun_organizationId_idx" ON "BrandPipelineRun"("organizationId")`,
  `CREATE INDEX IF NOT EXISTS "BrandPipelineRun_brandId_idx" ON "BrandPipelineRun"("brandId")`,
  `CREATE INDEX IF NOT EXISTS "BrandPipelineRun_startedById_idx" ON "BrandPipelineRun"("startedById")`,
  `CREATE INDEX IF NOT EXISTS "BrandPipelineRun_status_idx" ON "BrandPipelineRun"("status")`,
  `CREATE INDEX IF NOT EXISTS "BrandPipelineRun_step_idx" ON "BrandPipelineRun"("step")`,
  `DO $$ BEGIN
    ALTER TABLE "BrandPipelineRun" ADD CONSTRAINT "BrandPipelineRun_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "BrandPipelineRun" ADD CONSTRAINT "BrandPipelineRun_brandId_fkey"
      FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "BrandPipelineRun" ADD CONSTRAINT "BrandPipelineRun_startedById_fkey"
      FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "BrandPipelineRun" ADD CONSTRAINT "BrandPipelineRun_strategyId_fkey"
      FOREIGN KEY ("strategyId") REFERENCES "MarketingStrategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
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
    fail++;
    console.error(`[${i + 1}/${STATEMENTS.length}] FAIL ${preview}…`);
    console.error('  →', err.message.split('\n')[0]);
  }
}
await db.$disconnect();
console.log(`\nDone: ${ok}/${STATEMENTS.length} statements OK, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);

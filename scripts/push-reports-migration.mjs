/**
 * One-shot migration: applies Reporting (Report + ReportSchedule) additions
 * via Prisma's raw SQL. Each statement runs as its own transaction so the
 * pooler doesn't choke. Idempotent: enums and ADD CONSTRAINT wrapped in
 * DO $$ EXCEPTION blocks, tables/indexes use IF NOT EXISTS.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const STATEMENTS = [
  `DO $$ BEGIN
    CREATE TYPE "ReportStatus" AS ENUM ('DRAFT','GENERATING','READY','FAILED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "ReportPeriod" AS ENUM ('LAST_7_DAYS','LAST_30_DAYS','LAST_90_DAYS','LAST_12_MONTHS','LAST_MONTH','LAST_QUARTER','CUSTOM');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "ReportFrequency" AS ENUM ('ONCE','WEEKLY','MONTHLY','QUARTERLY');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  // Backfill enum values in case the enum already existed from an earlier
  // partial migration that lacked these literals (ALTER TYPE ... ADD VALUE
  // can't run inside the DO block above on older PG, so do it idempotently).
  `DO $$ BEGIN
    ALTER TYPE "ReportPeriod" ADD VALUE IF NOT EXISTS 'LAST_12_MONTHS';
  EXCEPTION WHEN others THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TYPE "ReportFrequency" ADD VALUE IF NOT EXISTS 'QUARTERLY';
  EXCEPTION WHEN others THEN null; END $$`,
  `CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "period" "ReportPeriod" NOT NULL DEFAULT 'LAST_30_DAYS',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "sections" TEXT[],
    "whiteLabel" JSONB NOT NULL DEFAULT '{}',
    "data" JSONB NOT NULL DEFAULT '{}',
    "aiSummary" TEXT,
    "pdfUrl" TEXT,
    "generatedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdById" TEXT,
    "scheduleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ReportSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "title" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL DEFAULT 'MONTHLY',
    "period" "ReportPeriod" NOT NULL DEFAULT 'LAST_30_DAYS',
    "sections" TEXT[],
    "whiteLabel" JSONB NOT NULL DEFAULT '{}',
    "recipients" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "Report_organizationId_status_idx" ON "Report"("organizationId","status")`,
  `CREATE INDEX IF NOT EXISTS "Report_brandId_idx" ON "Report"("brandId")`,
  `CREATE INDEX IF NOT EXISTS "Report_scheduleId_idx" ON "Report"("scheduleId")`,
  `CREATE INDEX IF NOT EXISTS "ReportSchedule_organizationId_idx" ON "ReportSchedule"("organizationId")`,
  `CREATE INDEX IF NOT EXISTS "ReportSchedule_enabled_nextRunAt_idx" ON "ReportSchedule"("enabled","nextRunAt")`,
  `DO $$ BEGIN
    ALTER TABLE "Report" ADD CONSTRAINT "Report_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Report" ADD CONSTRAINT "Report_brandId_fkey"
      FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Report" ADD CONSTRAINT "Report_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Report" ADD CONSTRAINT "Report_scheduleId_fkey"
      FOREIGN KEY ("scheduleId") REFERENCES "ReportSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_brandId_fkey"
      FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
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

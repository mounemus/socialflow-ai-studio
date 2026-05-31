/**
 * One-shot migration: applies Social Listening (MentionWatch + BrandMention +
 * MentionAlert) additions via Prisma's raw SQL. Each statement runs as its own
 * transaction so the pooler doesn't choke. Idempotent: enums and ADD CONSTRAINT
 * wrapped in DO $$ EXCEPTION blocks, tables/indexes use IF NOT EXISTS.
 *
 * SQL generated from:
 *   npx prisma migrate diff --from-empty \
 *     --to-schema-datamodel prisma/schema.prisma --script
 * then made idempotent.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const STATEMENTS = [
  // ---- Enums -------------------------------------------------------------
  `DO $$ BEGIN
    CREATE TYPE "MentionSource" AS ENUM ('TWITTER','REDDIT','WEB','NEWS','INSTAGRAM','FACEBOOK','LINKEDIN','YOUTUBE','BLOG','FORUM','OTHER');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "MentionSentiment" AS ENUM ('POSITIVE','NEGATIVE','NEUTRAL','MIXED','UNKNOWN');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "MentionStatus" AS ENUM ('NEW','REVIEWED','RESPONDED','IGNORED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "AlertType" AS ENUM ('NEGATIVE_MENTION','VOLUME_SPIKE','INFLUENCER_MENTION','KEYWORD_MATCH');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "AlertSeverity" AS ENUM ('INFO','WARNING','CRITICAL');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,

  // Backfill enum values in case an enum already existed from an earlier
  // partial migration that lacked these literals.
  `DO $$ BEGIN
    ALTER TYPE "MentionSource" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
    ALTER TYPE "MentionSource" ADD VALUE IF NOT EXISTS 'FACEBOOK';
    ALTER TYPE "MentionSource" ADD VALUE IF NOT EXISTS 'LINKEDIN';
    ALTER TYPE "MentionSource" ADD VALUE IF NOT EXISTS 'TWITTER';
    ALTER TYPE "MentionSource" ADD VALUE IF NOT EXISTS 'YOUTUBE';
    ALTER TYPE "MentionSource" ADD VALUE IF NOT EXISTS 'BLOG';
    ALTER TYPE "MentionSource" ADD VALUE IF NOT EXISTS 'FORUM';
    ALTER TYPE "MentionSource" ADD VALUE IF NOT EXISTS 'OTHER';
  EXCEPTION WHEN others THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TYPE "MentionSentiment" ADD VALUE IF NOT EXISTS 'MIXED';
  EXCEPTION WHEN others THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'KEYWORD_MATCH';
  EXCEPTION WHEN others THEN null; END $$`,

  // ---- Tables ------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS "MentionWatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "name" TEXT NOT NULL,
    "keywords" TEXT[],
    "excludeKeywords" TEXT[],
    "sources" "MentionSource"[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minRelevance" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "alertOnNegative" BOOLEAN NOT NULL DEFAULT true,
    "alertOnSpike" BOOLEAN NOT NULL DEFAULT true,
    "slackWebhookUrl" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MentionWatch_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "BrandMention" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "watchId" TEXT NOT NULL,
    "source" "MentionSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "authorHandle" TEXT,
    "authorName" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "sentiment" "MentionSentiment" NOT NULL DEFAULT 'UNKNOWN',
    "sentimentScore" DOUBLE PRECISION,
    "relevanceScore" DOUBLE PRECISION,
    "reach" INTEGER,
    "engagementCount" INTEGER,
    "language" TEXT,
    "status" "MentionStatus" NOT NULL DEFAULT 'NEW',
    "rawData" JSONB NOT NULL DEFAULT '{}',
    "publishedAt" TIMESTAMP(3),
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrandMention_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "MentionAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "watchId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "mentionIds" TEXT[],
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MentionAlert_pkey" PRIMARY KEY ("id")
  )`,

  // ---- Indexes -----------------------------------------------------------
  `CREATE INDEX IF NOT EXISTS "MentionWatch_organizationId_enabled_idx" ON "MentionWatch"("organizationId","enabled")`,
  `CREATE INDEX IF NOT EXISTS "MentionWatch_brandId_idx" ON "MentionWatch"("brandId")`,
  `CREATE INDEX IF NOT EXISTS "BrandMention_organizationId_status_idx" ON "BrandMention"("organizationId","status")`,
  `CREATE INDEX IF NOT EXISTS "BrandMention_brandId_idx" ON "BrandMention"("brandId")`,
  `CREATE INDEX IF NOT EXISTS "BrandMention_sentiment_idx" ON "BrandMention"("sentiment")`,
  `CREATE INDEX IF NOT EXISTS "BrandMention_ingestedAt_idx" ON "BrandMention"("ingestedAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "BrandMention_watchId_externalId_key" ON "BrandMention"("watchId","externalId")`,
  `CREATE INDEX IF NOT EXISTS "MentionAlert_organizationId_acknowledged_idx" ON "MentionAlert"("organizationId","acknowledged")`,
  `CREATE INDEX IF NOT EXISTS "MentionAlert_brandId_idx" ON "MentionAlert"("brandId")`,

  // ---- Foreign keys ------------------------------------------------------
  `DO $$ BEGIN
    ALTER TABLE "MentionWatch" ADD CONSTRAINT "MentionWatch_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "MentionWatch" ADD CONSTRAINT "MentionWatch_brandId_fkey"
      FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "BrandMention" ADD CONSTRAINT "BrandMention_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "BrandMention" ADD CONSTRAINT "BrandMention_brandId_fkey"
      FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "BrandMention" ADD CONSTRAINT "BrandMention_watchId_fkey"
      FOREIGN KEY ("watchId") REFERENCES "MentionWatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "MentionAlert" ADD CONSTRAINT "MentionAlert_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "MentionAlert" ADD CONSTRAINT "MentionAlert_brandId_fkey"
      FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "MentionAlert" ADD CONSTRAINT "MentionAlert_watchId_fkey"
      FOREIGN KEY ("watchId") REFERENCES "MentionWatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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

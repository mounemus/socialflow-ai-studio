/**
 * One-shot migration: applies Inbox (SocialInteraction + AutoReplyRule) additions
 * via Prisma's raw SQL. Each statement runs as its own transaction so the
 * pooler doesn't choke.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const STATEMENTS = [
  `DO $$ BEGIN
    CREATE TYPE "InteractionType" AS ENUM ('COMMENT','DM','MENTION','REPLY','REACTION');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "InteractionStatus" AS ENUM ('NEW','READ','REPLIED','ARCHIVED','AUTO_REPLIED','IGNORED');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    CREATE TYPE "InteractionSentiment" AS ENUM ('POSITIVE','NEGATIVE','NEUTRAL','SPAM','UNKNOWN');
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `CREATE TABLE IF NOT EXISTS "SocialInteraction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "socialAccountId" TEXT,
    "postId" TEXT,
    "externalId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "type" "InteractionType" NOT NULL,
    "threadId" TEXT,
    "content" TEXT NOT NULL,
    "fromHandle" TEXT NOT NULL,
    "fromName" TEXT,
    "fromAvatarUrl" TEXT,
    "fromIsVerified" BOOLEAN NOT NULL DEFAULT false,
    "sentiment" "InteractionSentiment" NOT NULL DEFAULT 'UNKNOWN',
    "sentimentScore" DOUBLE PRECISION,
    "status" "InteractionStatus" NOT NULL DEFAULT 'NEW',
    "assignedToId" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedById" TEXT,
    "replyContent" TEXT,
    "isAutoReplied" BOOLEAN NOT NULL DEFAULT false,
    "rawData" JSONB NOT NULL DEFAULT '{}',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialInteraction_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SocialInteraction_externalId_key" ON "SocialInteraction"("externalId")`,
  `CREATE INDEX IF NOT EXISTS "SocialInteraction_organizationId_status_idx" ON "SocialInteraction"("organizationId","status")`,
  `CREATE INDEX IF NOT EXISTS "SocialInteraction_brandId_idx" ON "SocialInteraction"("brandId")`,
  `CREATE INDEX IF NOT EXISTS "SocialInteraction_socialAccountId_idx" ON "SocialInteraction"("socialAccountId")`,
  `CREATE INDEX IF NOT EXISTS "SocialInteraction_postId_idx" ON "SocialInteraction"("postId")`,
  `CREATE INDEX IF NOT EXISTS "SocialInteraction_receivedAt_idx" ON "SocialInteraction"("receivedAt")`,
  `CREATE TABLE IF NOT EXISTS "AutoReplyRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowedSentiments" "InteractionSentiment"[],
    "allowedTypes" "InteractionType"[],
    "customPromptFragment" TEXT,
    "minSentimentScore" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "maxReplyLength" INTEGER NOT NULL DEFAULT 280,
    "requireApproval" BOOLEAN NOT NULL DEFAULT true,
    "dailyCap" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutoReplyRule_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "AutoReplyRule_organizationId_idx" ON "AutoReplyRule"("organizationId")`,
  `CREATE INDEX IF NOT EXISTS "AutoReplyRule_brandId_idx" ON "AutoReplyRule"("brandId")`,
  `DO $$ BEGIN
    ALTER TABLE "SocialInteraction" ADD CONSTRAINT "SocialInteraction_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "SocialInteraction" ADD CONSTRAINT "SocialInteraction_brandId_fkey"
      FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "SocialInteraction" ADD CONSTRAINT "SocialInteraction_socialAccountId_fkey"
      FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "SocialInteraction" ADD CONSTRAINT "SocialInteraction_postId_fkey"
      FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "SocialInteraction" ADD CONSTRAINT "SocialInteraction_assignedToId_fkey"
      FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "SocialInteraction" ADD CONSTRAINT "SocialInteraction_repliedById_fkey"
      FOREIGN KEY ("repliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "AutoReplyRule" ADD CONSTRAINT "AutoReplyRule_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "AutoReplyRule" ADD CONSTRAINT "AutoReplyRule_brandId_fkey"
      FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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

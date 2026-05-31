/**
 * Shared types for mention-listening source adapters.
 *
 * Each adapter exports:
 *   async function search(keywords: string[], opts?: SearchOpts): Promise<RawMention[]>
 *
 * RawMention is a source-neutral shape that MentionListenerService scores
 * (relevance + sentiment) and persists as BrandMention rows.
 *
 * Defensive contract: every adapter MUST catch its own errors and return []
 * on any failure — one failing source must never kill the others.
 */
import type { MentionSource } from '@prisma/client';

export interface RawMention {
  source: MentionSource;
  /** Stable external identifier (permalink / citation url) — dedup key with watchId. */
  externalId: string;
  url?: string;
  authorHandle?: string;
  authorName?: string;
  title?: string;
  content: string;
  /** Estimated audience size of the author / item (followers, subscribers...). */
  reach?: number;
  /** Upvotes + comments, likes + retweets, etc. */
  engagementCount?: number;
  /** BCP-47-ish language tag if known. */
  language?: string;
  /** Epoch-ms or Date of publication if known. */
  publishedAt?: number | Date;
}

export interface SearchOpts {
  /** Max items to return per source. */
  limit?: number;
  /** Preferred language (affects News/Web queries). */
  language?: string;
  /** Optional watch context for logging. */
  watchId?: string;
}

/** Adapter signature every source module conforms to. */
export type MentionAdapter = (keywords: string[], opts?: SearchOpts) => Promise<RawMention[]>;

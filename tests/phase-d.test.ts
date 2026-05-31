/**
 * Phase D smoke tests — perf cache + bulk CSV import.
 *
 * - lib/cache: dedupe within TTL, re-run after invalidate, prefix invalidation
 * - BulkImportService.parseCsv: quoted fields with commas, blank-line skip,
 *   header detection
 * - BulkImportService.importFromRows: creates N DRAFT posts (db mocked)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory db mock (only db.post.create is exercised by importFromRows)
// ---------------------------------------------------------------------------
interface PostRow { id: string; organizationId: string; status: string; format: string; title: string | null; body: string | null; hashtags: string[]; cta: string | null; metadata: unknown }
const store: { posts: PostRow[]; seq: number } = { posts: [], seq: 0 };

vi.mock('@/lib/db', () => ({
  db: {
    post: {
      create: vi.fn(async (args: { data: Partial<PostRow> }) => {
        const rec: PostRow = {
          id: `post_${++store.seq}`,
          organizationId: args.data.organizationId as string,
          status: (args.data.status as string) ?? 'DRAFT',
          format: (args.data.format as string) ?? 'INSTAGRAM_POST',
          title: (args.data.title as string | null) ?? null,
          body: (args.data.body as string | null) ?? null,
          hashtags: (args.data.hashtags as string[]) ?? [],
          cta: (args.data.cta as string | null) ?? null,
          metadata: args.data.metadata ?? {},
        };
        store.posts.push(rec);
        return rec;
      }),
    },
  },
}));

const { cached, invalidate, __clearCache } = await import('@/lib/cache');
const { BulkImportService } = await import('@/services/import/BulkImportService');

describe('lib/cache', () => {
  beforeEach(() => __clearCache());

  it('dedupes calls within TTL (fn runs once)', async () => {
    let calls = 0;
    const fn = async () => { calls++; return 42; };
    const a = await cached('k:1', 60_000, fn);
    const b = await cached('k:1', 60_000, fn);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(calls).toBe(1);
  });

  it('re-runs after invalidate', async () => {
    let calls = 0;
    const fn = async () => { calls++; return calls; };
    await cached('k:2', 60_000, fn);
    invalidate('k:2');
    const second = await cached('k:2', 60_000, fn);
    expect(calls).toBe(2);
    expect(second).toBe(2);
  });

  it('prefix invalidation drops matching keys only', async () => {
    let aCalls = 0, bCalls = 0;
    await cached('org_1:next', 60_000, async () => { aCalls++; return 'a'; });
    await cached('org_2:next', 60_000, async () => { bCalls++; return 'b'; });
    invalidate('org_1:');
    await cached('org_1:next', 60_000, async () => { aCalls++; return 'a'; });
    await cached('org_2:next', 60_000, async () => { bCalls++; return 'b'; });
    expect(aCalls).toBe(2); // re-ran (invalidated)
    expect(bCalls).toBe(1); // still cached
  });
});

describe('BulkImportService.parseCsv', () => {
  it('parses headers + quoted fields containing commas', () => {
    const csv = [
      'title,body,platform,hashtags',
      '"Lancement, enfin","Notre produit, arrive",INSTAGRAM,"#a #b"',
      'Simple,Du texte,LINKEDIN,#c',
    ].join('\n');
    const rows = BulkImportService.parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe('Lancement, enfin');
    expect(rows[0].body).toBe('Notre produit, arrive');
    expect(rows[0].platform).toBe('INSTAGRAM');
    expect(rows[1].title).toBe('Simple');
  });

  it('skips blank lines', () => {
    const csv = 'title,body\n\nA,B\n\n\nC,D\n';
    const rows = BulkImportService.parseCsv(csv);
    expect(rows).toHaveLength(2);
  });

  it('returns [] for empty input', () => {
    expect(BulkImportService.parseCsv('')).toEqual([]);
    expect(BulkImportService.parseCsv('   ')).toEqual([]);
  });
});

describe('BulkImportService.importFromRows', () => {
  beforeEach(() => { store.posts = []; store.seq = 0; });

  it('creates one DRAFT post per usable row', async () => {
    const rows = [
      { title: 'Post A', body: 'Body A', platform: 'INSTAGRAM', hashtags: '#x #y' },
      { title: 'Post B', body: 'Body B', platform: 'LINKEDIN' },
    ];
    const res = await BulkImportService.importFromRows({ organizationId: 'org_1', rows });
    expect(res.created).toBe(2);
    expect(store.posts).toHaveLength(2);
    expect(store.posts[0].status).toBe('DRAFT');
    expect(store.posts[0].hashtags.length).toBeGreaterThan(0);
    expect((store.posts[0].metadata as { importedFrom?: string }).importedFrom).toBe('csv');
  });

  it('skips rows with neither title nor body', async () => {
    const rows = [
      { title: 'Keep', body: 'yes' },
      { platform: 'INSTAGRAM' }, // no title/body
    ];
    const res = await BulkImportService.importFromRows({ organizationId: 'org_1', rows });
    expect(res.created).toBe(1);
    expect(res.skipped).toBe(1);
  });
});

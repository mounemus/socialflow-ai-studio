/**
 * Contract test: GET /api/me/active-org and getActiveMembership() MUST agree
 * on which organization is "active" for a given (user, cookie) state.
 *
 * If they disagree, server-rendered pages and the API drift apart — that's the
 * exact bug class that caused the multi-org dashboard breakage (task #54).
 *
 * Fixtures cover the 4 cookie states:
 *   1. no cookie set                → both = oldest membership
 *   2. valid cookie                 → both = cookie org
 *   3. stale cookie (org id user no longer belongs to) → both = oldest membership
 *   4. foreign cookie (org id that doesn't exist at all)→ both = oldest membership
 *
 * Approach: unit test with vi.mock for next/headers, @/lib/db, @/lib/auth.
 * Calls the GET handler directly and getActiveMembership() directly under
 * the same mocked world, then asserts equality of the resolved organizationId.
 *
 * NOTE: vitest.config.ts include pattern is *.test.ts but the harness expects
 * this filename — passing the file path explicitly to `vitest run` bypasses
 * the include filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Fixtures -----
const USER_ID = 'user_1';
const ORG_OLDEST = 'org_oldest';
const ORG_NEWER = 'org_newer';
const ORG_STALE_USER_REMOVED = 'org_stale'; // exists in DB, user not a member anymore
const ORG_FOREIGN = 'org_does_not_exist';

// Memberships ordered chronologically (oldest first) — what findFirst({orderBy createdAt asc}) returns.
const MEMBERSHIPS = [
  { userId: USER_ID, organizationId: ORG_OLDEST, role: 'OWNER', createdAt: new Date('2024-01-01') },
  { userId: USER_ID, organizationId: ORG_NEWER, role: 'EDITOR', createdAt: new Date('2024-06-01') },
];

// Mutable cookie store so each test can configure the value before invoking either path.
let activeOrgCookie: string | undefined;

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'active_org_id' && activeOrgCookie !== undefined
        ? { value: activeOrgCookie }
        : undefined,
    delete: (name: string) => {
      if (name === 'active_org_id') activeOrgCookie = undefined;
    },
    set: (_name: string, _value: string) => {
      // no-op for these tests
    },
  }),
}));

vi.mock('@/lib/auth', () => ({
  auth: async () => ({ user: { id: USER_ID } }),
}));

vi.mock('@/lib/db', () => {
  const teamMember = {
    findUnique: vi.fn(async (args: { where: { userId_organizationId: { userId: string; organizationId: string } } }) => {
      const { userId, organizationId } = args.where.userId_organizationId;
      return (
        MEMBERSHIPS.find((m) => m.userId === userId && m.organizationId === organizationId) ?? null
      );
    }),
    findFirst: vi.fn(async (args: { where: { userId: string }; orderBy?: { createdAt: 'asc' | 'desc' } }) => {
      const list = MEMBERSHIPS.filter((m) => m.userId === args.where.userId);
      const sorted = [...list].sort((a, b) =>
        args.orderBy?.createdAt === 'desc'
          ? b.createdAt.getTime() - a.createdAt.getTime()
          : a.createdAt.getTime() - b.createdAt.getTime(),
      );
      return sorted[0] ?? null;
    }),
    findMany: vi.fn(async (args: { where: { userId: string }; orderBy?: { createdAt: 'asc' | 'desc' } }) => {
      const list = MEMBERSHIPS.filter((m) => m.userId === args.where.userId).map((m) => ({
        ...m,
        organization: { id: m.organizationId, name: m.organizationId, slug: m.organizationId, plan: 'FREE' },
      }));
      return [...list].sort((a, b) =>
        args.orderBy?.createdAt === 'desc'
          ? b.createdAt.getTime() - a.createdAt.getTime()
          : a.createdAt.getTime() - b.createdAt.getTime(),
      );
    }),
  };
  // Route GET also looks up the user to allow SUPER_ADMIN to ignore stale cookie
  // validation. For these fixtures the user is a plain member (not super-admin).
  const user = {
    findUnique: vi.fn(async (_args: { where: { id: string } }) => ({ globalRole: 'OWNER' })),
  };
  return { db: { teamMember, user } };
});

// Import AFTER mocks are registered so the SUT sees the mocked deps.
const { getActiveMembership } = await import('@/lib/tenant');
const { GET } = await import('@/app/api/me/active-org/route');

async function callGet(): Promise<string | null> {
  const res = await GET(new Request('http://localhost/api/me/active-org'), {
    params: Promise.resolve({}),
  });
  const json = (await res.json()) as { data: { activeOrganizationId: string | null } };
  return json.data.activeOrganizationId;
}

async function callTenant(): Promise<string | null> {
  const m = await getActiveMembership(USER_ID);
  return m?.organizationId ?? null;
}

describe('multitenant active-org contract', () => {
  beforeEach(() => {
    activeOrgCookie = undefined;
  });

  it('Fixture 1: no cookie → both resolve to oldest membership', async () => {
    activeOrgCookie = undefined;
    const route = await callGet();
    const tenant = await callTenant();
    expect(route).toBe(ORG_OLDEST);
    expect(tenant).toBe(ORG_OLDEST);
    expect(route).toBe(tenant);
  });

  it('Fixture 2: valid cookie → both resolve to that org', async () => {
    activeOrgCookie = ORG_NEWER;
    const route = await callGet();
    const tenant = await callTenant();
    expect(route).toBe(ORG_NEWER);
    expect(tenant).toBe(ORG_NEWER);
    expect(route).toBe(tenant);
  });

  it('Fixture 3: stale cookie (user no longer in that org) → both fall back to oldest', async () => {
    activeOrgCookie = ORG_STALE_USER_REMOVED;
    const route = await callGet();
    const tenant = await callTenant();
    // Both paths must validate the cookie against memberships and fall through
    // to oldest. If either echoes the stale value naively, the header chip and
    // server-rendered pages drift apart — this assertion is the contract.
    expect(tenant).toBe(ORG_OLDEST);
    expect(route).toBe(tenant);
  });

  it('Fixture 4: foreign cookie (org id does not exist) → both fall back to oldest', async () => {
    activeOrgCookie = ORG_FOREIGN;
    const route = await callGet();
    const tenant = await callTenant();
    expect(tenant).toBe(ORG_OLDEST);
    expect(route).toBe(tenant);
  });
});

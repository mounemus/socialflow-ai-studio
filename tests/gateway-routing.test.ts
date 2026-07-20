import { describe, it, expect, afterEach } from 'vitest';
import type { SocialAccount } from '@prisma/client';
import { SocialGatewayService } from '@/services/gateway/SocialGatewayService';
import { lateGatewayAdapter } from '@/services/gateway/adapters/late';
import { manualGatewayAdapter } from '@/services/gateway/adapters/manual';

function account(platform: string, metadata: Record<string, unknown> = {}): SocialAccount {
  return {
    id: 'sa1',
    organizationId: 'org1',
    brandId: null,
    platform,
    type: 'PROFILE',
    externalId: 'ext1',
    handle: 'test',
    displayName: 'Test',
    avatarUrl: null,
    status: 'CONNECTED',
    permissions: [],
    metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never;
}

afterEach(() => {
  delete process.env.LATE_API_KEY;
  delete process.env.ENABLE_REAL_PUBLISHING;
});

describe('SocialGatewayService.resolveGateway', () => {
  it('choisit native quand la plateforme est supportée ET qu’un token existe', () => {
    expect(SocialGatewayService.resolveGateway(account('FACEBOOK'), true)).toBe('native');
    expect(SocialGatewayService.resolveGateway(account('LINKEDIN'), true)).toBe('native');
  });

  it('bascule sur Late quand pas de token natif mais compte mappé + clé', () => {
    process.env.LATE_API_KEY = 'k';
    const acc = account('TWITTER', { lateAccountId: 'late_123' });
    expect(SocialGatewayService.resolveGateway(acc, false)).toBe('late');
  });

  it('X sans mapping Late → manuel (jamais un faux succès)', () => {
    expect(SocialGatewayService.resolveGateway(account('TWITTER'), false)).toBe('manual');
  });

  it('FACEBOOK sans token et sans Late → manuel', () => {
    expect(SocialGatewayService.resolveGateway(account('FACEBOOK'), false)).toBe('manual');
  });

  it('respecte la préférence explicite du compte quand elle est utilisable', () => {
    process.env.LATE_API_KEY = 'k';
    const acc = account('FACEBOOK', { preferredGateway: 'late', lateAccountId: 'late_9' });
    expect(SocialGatewayService.resolveGateway(acc, true)).toBe('late');
  });

  it('ignore une préférence non utilisable (Late sans mapping)', () => {
    const acc = account('FACEBOOK', { preferredGateway: 'late' });
    expect(SocialGatewayService.resolveGateway(acc, true)).toBe('native');
  });
});

describe('Adaptateurs gateway — honnêteté', () => {
  const input = {
    postId: 'p1', scheduleId: 's1', socialAccountId: 'sa1',
    body: 'Hello', hashtags: [], mediaUrls: [],
  };

  it('manual échoue explicitement (NOT_IMPLEMENTED), aucun id fabriqué', async () => {
    const r = await manualGatewayAdapter.publish(input, { account: account('TWITTER') });
    expect(r.success).toBe(false);
    expect(r.externalPostId).toBeUndefined();
    expect(r.gateway).toBe('manual');
  });

  it('late simule proprement hors mode réel (pas d’appel réseau, pas d’id)', async () => {
    process.env.LATE_API_KEY = 'k';
    const r = await lateGatewayAdapter.publish(input, {
      account: account('TWITTER', { lateAccountId: 'late_1' }),
    });
    expect(r.simulated).toBe(true);
    expect(r.externalPostId).toBeUndefined();
  });

  it('late en mode réel sans mapping → MISSING_TARGET', async () => {
    process.env.ENABLE_REAL_PUBLISHING = 'true';
    process.env.LATE_API_KEY = 'k';
    const r = await lateGatewayAdapter.publish(input, { account: account('TWITTER') });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('MISSING_TARGET');
  });
});

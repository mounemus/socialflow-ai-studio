import { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger';

/**
 * Pool de connexions adapté au serverless "fluid compute" de Vercel.
 *
 * Incidents P2024 observés en prod ("Timed out fetching a new connection"):
 *   - connection_limit=1 → tout se sérialise localement;
 *   - mais un pool local trop large multiplié par N instances chaudes peut
 *     saturer le POOLER côté Supabase (transaction mode) ou max_connections
 *     en connexion directe.
 *
 * Posture:
 *   - connection_limit par instance: PRISMA_CONNECTION_LIMIT (défaut 3);
 *   - pool_timeout: PRISMA_POOL_TIMEOUT (défaut 20s);
 *   - port 6543 / host pooler Supabase → pgbouncer=true forcé (obligatoire en
 *     transaction mode pour désactiver les prepared statements Prisma);
 *   - cible loggée au démarrage (host:port, JAMAIS les credentials) pour
 *     diagnostiquer sans deviner.
 */
function pooledDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const limit = process.env.PRISMA_CONNECTION_LIMIT ?? '3';
    const timeout = process.env.PRISMA_POOL_TIMEOUT ?? '20';
    url.searchParams.set('connection_limit', limit);
    url.searchParams.set('pool_timeout', timeout);
    const isPgBouncer =
      url.port === '6543' || url.hostname.includes('pooler.supabase.');
    if (isPgBouncer) url.searchParams.set('pgbouncer', 'true');
    logger.info('db: datasource configurée', {
      host: url.hostname,
      port: url.port || '5432',
      pgbouncer: isPgBouncer,
      connectionLimit: limit,
      poolTimeout: timeout,
    });
    return url.toString();
  } catch {
    return raw; // URL non parsable — on n'y touche pas.
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const pooledUrl = pooledDatabaseUrl();

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    ...(pooledUrl ? { datasources: { db: { url: pooledUrl } } } : {}),
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;

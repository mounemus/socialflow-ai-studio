import { PrismaClient } from '@prisma/client';

/**
 * Pool de connexions adapté au serverless "fluid compute" de Vercel : une même
 * instance sert plusieurs requêtes concurrentes (polling UI, crons, fonctions
 * longues de concrétisation). Avec connection_limit=1 (constaté en prod), tout
 * se sérialise et P2024 "Timed out fetching a new connection" fait tomber la
 * page entière.
 *
 * On force donc un pool raisonnable via l'URL, sans toucher à la variable
 * d'environnement :
 *   - PRISMA_CONNECTION_LIMIT (défaut 5) et PRISMA_POOL_TIMEOUT (défaut 20s)
 *   - les valeurs déjà présentes dans DATABASE_URL sont ÉCRASÉES par celles-ci
 *     (c'est le but — le connection_limit=1 hérité est la cause de l'incident).
 */
function pooledDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const limit = process.env.PRISMA_CONNECTION_LIMIT ?? '5';
    const timeout = process.env.PRISMA_POOL_TIMEOUT ?? '20';
    url.searchParams.set('connection_limit', limit);
    url.searchParams.set('pool_timeout', timeout);
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

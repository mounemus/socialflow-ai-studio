/**
 * Seed démo — crée un user, une org, 2 marques, des comptes sociaux, des posts, une veille, un concurrent.
 * Idempotent : safe à relancer.
 * Run: npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('demo1234', 10);

  const user = await db.user.upsert({
    where: { email: 'demo@socialflow.ai' },
    update: {},
    create: {
      email: 'demo@socialflow.ai',
      name: 'Démo Owner',
      passwordHash,
      locale: 'fr',
    },
  });

  const org = await db.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: { slug: 'demo-org', name: 'Demo Agency', plan: 'AGENCY' },
  });

  await db.teamMember.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: { role: 'OWNER' },
    create: { userId: user.id, organizationId: org.id, role: 'OWNER' },
  });

  const brandsData = [
    { slug: 'lumen-cafe', name: 'Lumen Café', industry: 'Hospitality', tone: 'chaleureux, artisanal', audience: 'urbains 25-45 ans aimant le café de spécialité' },
    { slug: 'nova-saas', name: 'Nova SaaS', industry: 'B2B SaaS', tone: 'expert, accessible, factuel', audience: 'PME tech 50-500 employés' },
  ];

  for (const b of brandsData) {
    await db.brand.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: b.slug } },
      update: {},
      create: {
        organizationId: org.id,
        slug: b.slug,
        name: b.name,
        industry: b.industry,
        profile: {
          create: {
            mission: `Promouvoir ${b.name} via un contenu cohérent.`,
            toneOfVoice: b.tone,
            audienceTarget: b.audience,
            officialHashtags: [`#${b.slug.replace(/-/g, '')}`],
            wordsToUse: ['authentique', 'qualité', 'communauté'],
            wordsToAvoid: ['cheap', 'gratuit', 'urgent'],
            primaryColor: '#3d62f5',
            visualStyle: 'minimal, photographique',
          },
        },
      },
    });
  }

  const lumen = await db.brand.findFirst({ where: { organizationId: org.id, slug: 'lumen-cafe' } });
  const nova = await db.brand.findFirst({ where: { organizationId: org.id, slug: 'nova-saas' } });

  if (lumen) {
    await db.socialAccount.upsert({
      where: { platform_externalId: { platform: 'INSTAGRAM', externalId: 'demo_lumen_ig' } },
      update: {},
      create: {
        organizationId: org.id,
        brandId: lumen.id,
        platform: 'INSTAGRAM',
        type: 'BUSINESS',
        externalId: 'demo_lumen_ig',
        handle: 'lumencafe',
        displayName: 'Lumen Café',
        status: 'CONNECTED',
        permissions: ['publish_actions', 'manage_pages'],
      },
    });

    await db.post.create({
      data: {
        organizationId: org.id,
        brandId: lumen.id,
        format: 'INSTAGRAM_POST',
        status: 'PUBLISHED',
        title: 'Nouveau grain Éthiopie',
        body: 'Un grain rare arrivé directement de Yirgacheffe ☕\nNotes florales, profil acidulé, finale longue.\n#cafedespecialite #lumencafe',
        hashtags: ['#cafedespecialite', '#lumencafe'],
        cta: 'Viens le déguster en boutique →',
      },
    });

    await db.trendWatch.create({
      data: {
        organizationId: org.id,
        brandId: lumen.id,
        kind: 'RSS',
        name: 'Hacker News (tech trends)',
        config: { rssUrl: 'https://hnrss.org/frontpage', keywords: ['ai', 'startup'] },
      },
    });

    await db.competitor.create({
      data: {
        organizationId: org.id,
        brandId: lumen.id,
        name: 'Café Concurrent A',
        website: 'https://example.com',
        industry: 'Hospitality',
        country: 'FR',
        keywords: ['café', 'torréfaction'],
      },
    });
  }

  if (nova) {
    await db.socialAccount.upsert({
      where: { platform_externalId: { platform: 'LINKEDIN', externalId: 'demo_nova_li' } },
      update: {},
      create: {
        organizationId: org.id,
        brandId: nova.id,
        platform: 'LINKEDIN',
        type: 'BUSINESS',
        externalId: 'demo_nova_li',
        handle: 'nova-saas',
        displayName: 'Nova SaaS',
        status: 'CONNECTED',
        permissions: ['w_organization_social', 'r_organization_social'],
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log('✓ Seed terminé. User: demo@socialflow.ai / demo1234');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

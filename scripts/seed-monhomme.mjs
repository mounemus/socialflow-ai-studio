/**
 * Demo seed — marque factice "monhomme" (prêt-à-porter homme).
 * Peuple TOUT le système pour une démo/simulation complète :
 * brand+profil+DNA, comptes sociaux, posts (tous statuts) + analytics,
 * médias, campagnes, stratégie+items, pipeline, concurrents, veille,
 * inbox (interactions+auto-reply), social listening (mentions+alertes),
 * rapports, validations.
 *
 * Idempotent : nettoie la marque monhomme existante avant de recréer.
 * Run : node scripts/seed-monhomme.mjs   (nécessite .env avec DATABASE_URL)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const SLUG = 'monhomme';

// ---- date helpers ----
const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * 86_400_000);
const daysAhead = (n) => new Date(now.getTime() + n * 86_400_000);
const hoursAgo = (n) => new Date(now.getTime() - n * 3_600_000);

async function pickTargetOrgAndUser() {
  // Prefer the org of mounemus@gmail.com (their first membership), else demo-org.
  const mounemus = await db.user.findUnique({ where: { email: 'mounemus@gmail.com' } });
  if (mounemus) {
    const m = await db.teamMember.findFirst({
      where: { userId: mounemus.id },
      orderBy: { createdAt: 'asc' },
      include: { organization: true },
    });
    if (m) return { org: m.organization, user: mounemus };
  }
  const org = await db.organization.findUnique({ where: { slug: 'demo-org' } });
  if (org) {
    const owner = await db.teamMember.findFirst({ where: { organizationId: org.id }, include: { user: true } });
    return { org, user: owner?.user ?? mounemus };
  }
  throw new Error('No target org found (need mounemus@gmail.com membership or demo-org).');
}

async function cleanup(orgId) {
  const brand = await db.brand.findFirst({ where: { organizationId: orgId, slug: SLUG } });
  if (!brand) return;
  const bId = brand.id;
  console.log(`Cleaning existing monhomme brand ${bId}…`);
  // Delete by brandId; children cascade from parents.
  await db.mentionAlert.deleteMany({ where: { brandId: bId } });
  await db.brandMention.deleteMany({ where: { brandId: bId } });
  await db.mentionWatch.deleteMany({ where: { brandId: bId } });
  await db.socialInteraction.deleteMany({ where: { brandId: bId } });
  await db.autoReplyRule.deleteMany({ where: { brandId: bId } });
  await db.report.deleteMany({ where: { brandId: bId } });
  await db.reportSchedule.deleteMany({ where: { brandId: bId } });
  await db.brandPipelineRun.deleteMany({ where: { brandId: bId } });
  await db.strategyItem.deleteMany({ where: { strategy: { brandId: bId } } });
  await db.marketingStrategy.deleteMany({ where: { brandId: bId } });
  await db.post.deleteMany({ where: { brandId: bId } }); // cascades schedules/analytics/variants/approvals
  await db.campaign.deleteMany({ where: { brandId: bId } });
  await db.competitor.deleteMany({ where: { brandId: bId } });
  await db.trendWatch.deleteMany({ where: { brandId: bId } });
  await db.mediaAsset.deleteMany({ where: { brandId: bId } });
  await db.socialAccount.deleteMany({ where: { brandId: bId } });
  await db.brandProfile.deleteMany({ where: { brandId: bId } });
  await db.brand.delete({ where: { id: bId } });
  console.log('Cleanup done.');
}

async function main() {
  const { org, user } = await pickTargetOrgAndUser();
  const orgId = org.id;
  const userId = user?.id ?? null;
  console.log(`Target org: ${org.name} (${orgId}) — author user: ${user?.email ?? 'none'}`);

  await cleanup(orgId);

  // ============ BRAND + PROFILE + DNA ============
  const brandDna = {
    voiceFingerprint: 'Ton confiant et raffiné mais accessible — monhomme parle à l\'homme moderne qui veut s\'habiller bien sans y passer des heures. Mélange de conseil pratique et d\'inspiration mode.',
    signatureMoves: ['Ouvre par un problème vestimentaire concret', 'Donne 3 règles simples', 'Termine par un CTA produit doux'],
    narrativeThemes: ['Élégance sans effort', 'Polyvalence garde-robe', 'Matières durables', 'Confiance en soi'],
    vocabularyPatterns: {
      powerWords: ['intemporel', 'polyvalent', 'maille', 'coupe', 'allure', 'essentiel'],
      avoidedWords: ['cheap', 'fast-fashion', 'jetable', 'tendance éphémère'],
      signaturePhrases: ['L\'élégance sans effort', 'Moins, mais mieux', 'Ton vestiaire essentiel'],
    },
    structuralTics: ['1 emoji discret max', '3-4 lignes par bloc', 'Saut de ligne avant le CTA'],
    audienceSignals: ['Hommes 28-45 urbains', 'Soucieux de qualité et durabilité', 'Peu de temps pour magasiner'],
    sample: { count: 8, source: 'published-posts' },
    extractedAt: daysAgo(20).toISOString(),
    mocked: false,
  };

  const brand = await db.brand.create({
    data: {
      organizationId: orgId,
      slug: SLUG,
      name: 'monhomme',
      industry: 'Mode masculine — prêt-à-porter homme',
      description: 'Marque de prêt-à-porter masculin qui mise sur des essentiels intemporels, des matières durables et une élégance sans effort.',
      logo: 'https://placehold.co/200x200/1e2a44/ffffff/png?text=monhomme',
      profile: {
        create: {
          slogan: 'L\'élégance sans effort',
          mission: 'Aider chaque homme à composer un vestiaire intemporel, polyvalent et durable — moins de pièces, mais mieux choisies.',
          audienceTarget: 'Hommes urbains de 28 à 45 ans, actifs, soucieux de qualité et de durabilité, qui veulent bien s\'habiller sans passer des heures à magasiner.',
          toneOfVoice: 'confiant, raffiné, accessible, pédagogue',
          values: ['Qualité durable', 'Simplicité', 'Polyvalence', 'Transparence', 'Confiance'],
          productsServices: ['Chemises en coton', 'Mailles', 'Pantalons chino', 'Vestes', 'Accessoires en cuir'],
          wordsToUse: ['intemporel', 'polyvalent', 'maille', 'coupe', 'allure', 'essentiel', 'durable'],
          wordsToAvoid: ['cheap', 'fast-fashion', 'jetable', 'gratuit', 'urgent'],
          officialHashtags: ['#monhomme', '#elegancesanseffort', '#vestiaireessentiel', '#modehomme', '#moinsmaismieux'],
          primaryColor: '#1e2a44',
          secondaryColor: '#c8a878',
          accentColor: '#9a3b2e',
          typography: 'Serif élégante pour les titres, sans-serif pour le corps',
          visualStyle: 'minimal, éditorial, lumière naturelle, palette neutre (navy, camel, blanc cassé)',
          canvaStyle: 'editorial-minimal',
          importantLinks: { _dna: brandDna, website: 'https://monhomme.example.com' },
          successfulExamples: ['Carrousel "3 façons de porter le chino"', 'Reel "L\'essentiel en 30s"'],
        },
      },
    },
    include: { profile: true },
  });
  console.log(`✓ Brand monhomme created (${brand.id})`);

  // ============ SOCIAL ACCOUNTS (CONNECTED) ============
  const igAcc = await db.socialAccount.create({
    data: {
      organizationId: orgId, brandId: brand.id, platform: 'INSTAGRAM', type: 'BUSINESS',
      externalId: 'demo_monhomme_ig', handle: 'monhomme', displayName: 'monhomme',
      avatarUrl: 'https://placehold.co/100x100/1e2a44/ffffff/png?text=mh',
      status: 'CONNECTED', permissions: ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'],
      metadata: { followers: 18420 },
    },
  });
  const fbAcc = await db.socialAccount.create({
    data: {
      organizationId: orgId, brandId: brand.id, platform: 'FACEBOOK', type: 'PAGE',
      externalId: 'demo_monhomme_fb', handle: 'monhomme.officiel', displayName: 'monhomme',
      status: 'CONNECTED', permissions: ['pages_manage_posts', 'pages_read_engagement'],
      metadata: { followers: 9230 },
    },
  });
  const liAcc = await db.socialAccount.create({
    data: {
      organizationId: orgId, brandId: brand.id, platform: 'LINKEDIN', type: 'BUSINESS',
      externalId: 'demo_monhomme_li', handle: 'monhomme', displayName: 'monhomme',
      status: 'CONNECTED', permissions: ['w_organization_social', 'r_organization_social'],
      metadata: { followers: 3120 },
    },
  });
  // dummy tokens so accounts look fully connected (won't be decrypted for real API calls)
  for (const acc of [igAcc, fbAcc, liAcc]) {
    await db.socialToken.create({
      data: { socialAccountId: acc.id, accessTokenEnc: 'demo:not-a-real-token', scope: acc.permissions.join(' '), expiresAt: daysAhead(50) },
    });
  }
  console.log('✓ 3 social accounts CONNECTED (IG, FB, LinkedIn)');

  // ============ MEDIA ASSETS ============
  const media = [];
  const mediaSpecs = [
    ['La chemise blanche parfaite', '1e2a44'],
    ['3 façons de porter le chino', 'c8a878'],
    ['Maille camel automne', '9a3b2e'],
    ['Veste en lin été', '6b7280'],
  ];
  for (const [alt, color] of mediaSpecs) {
    media.push(await db.mediaAsset.create({
      data: {
        organizationId: orgId, brandId: brand.id, kind: 'IMAGE',
        url: `https://placehold.co/1080x1080/${color}/ffffff/png?text=${encodeURIComponent(alt)}`,
        thumbnailUrl: `https://placehold.co/300x300/${color}/ffffff/png?text=mh`,
        mimeType: 'image/png', width: 1080, height: 1080, altText: alt, source: 'demo',
      },
    }));
  }
  console.log(`✓ ${media.length} media assets`);

  // ============ CAMPAIGNS ============
  const campAutomne = await db.campaign.create({
    data: {
      organizationId: orgId, brandId: brand.id, name: 'Collection Automne', slug: 'collection-automne',
      objective: 'Lancer la collection automne et générer +20% de ventes maille/veste sur 6 semaines.',
      status: 'ACTIVE', startsAt: daysAgo(14), endsAt: daysAhead(28), budgetCents: 350000,
      targetAudience: 'Hommes 28-45 urbains, intérêt mode masculine, durabilité.',
    },
  });
  await db.campaignAnalytics.create({
    data: { campaignId: campAutomne.id, data: { impressions: 142000, clicks: 5800, conversions: 312, revenueCents: 1980000, ctr: 0.041 } },
  });
  await db.campaign.create({
    data: {
      organizationId: orgId, brandId: brand.id, name: 'Black Friday Essentiels', slug: 'black-friday-essentiels',
      objective: 'Préparer une campagne Black Friday axée sur les essentiels intemporels (anti-gaspillage).',
      status: 'DRAFT', startsAt: daysAhead(20), endsAt: daysAhead(27), budgetCents: 500000,
    },
  });
  console.log('✓ 2 campaigns (1 ACTIVE + analytics, 1 DRAFT)');

  // ============ POSTS + SCHEDULES + ANALYTICS ============
  // PUBLISHED posts (8) spread over last 30 days with analytics → feeds reports/analytics
  const publishedSpecs = [
    { title: 'La chemise blanche parfaite', fmt: 'INSTAGRAM_POST', acc: igAcc, d: 28, body: 'La chemise blanche, c\'est la pièce qui sauve toutes les situations.\n\nNotre coupe ajustée en coton égyptien tombe parfaitement, du bureau au dîner.\n\nMoins, mais mieux. 🤍', tags: ['#monhomme', '#chemiseblanche', '#vestiaireessentiel'], likes: 842, comments: 56, shares: 23, reach: 14200, impressions: 18900 },
    { title: '3 façons de porter le chino', fmt: 'INSTAGRAM_CAROUSEL', acc: igAcc, d: 24, body: 'Un seul chino, trois allures.\n\n1. Avec un pull col rond → casual chic\n2. Avec une chemise + veste → bureau\n3. Avec un tee blanc → week-end\n\nLa polyvalence, c\'est l\'élégance.', tags: ['#monhomme', '#chino', '#elegancesanseffort'], likes: 1203, comments: 89, shares: 67, reach: 21400, impressions: 28700 },
    { title: 'L\'essentiel en 30s', fmt: 'INSTAGRAM_REEL', acc: igAcc, d: 20, body: 'Comment composer un vestiaire capsule en 5 pièces ⚡', tags: ['#monhomme', '#capsulewardrobe', '#moinsmaismieux'], likes: 2410, comments: 142, shares: 188, reach: 41200, impressions: 58300 },
    { title: 'Maille camel automne', fmt: 'INSTAGRAM_POST', acc: igAcc, d: 16, body: 'Le camel, la couleur qui réchauffe toutes les tenues d\'automne.\n\nNotre pull en laine mérinos, doux et durable.', tags: ['#monhomme', '#maille', '#automne'], likes: 967, comments: 61, shares: 34, reach: 16800, impressions: 22100 },
    { title: 'Pourquoi investir dans le cuir', fmt: 'LINKEDIN_POST', acc: liAcc, d: 12, body: 'Un bon accessoire en cuir dure 10 ans. Un accessoire jetable, 6 mois.\n\nChez monhomme, on fabrique pour durer. Voici pourquoi le cuir pleine fleur change tout.', tags: ['#monhomme', '#durabilite', '#modehomme'], likes: 312, comments: 28, shares: 19, reach: 8400, impressions: 11200 },
    { title: 'Le retour de la veste en lin', fmt: 'FACEBOOK_POST', acc: fbAcc, d: 9, body: 'Respirante, élégante, intemporelle : la veste en lin est l\'arme secrète de l\'été.', tags: ['#monhomme', '#lin', '#ete'], likes: 421, comments: 33, shares: 41, reach: 9800, impressions: 13400 },
    { title: 'Notre engagement durable', fmt: 'INSTAGRAM_POST', acc: igAcc, d: 5, body: 'Coton bio, laine mérinos certifiée, cuir tanné végétal.\n\nLa transparence n\'est pas une option.', tags: ['#monhomme', '#durable', '#transparence'], likes: 1102, comments: 74, shares: 52, reach: 19200, impressions: 25600 },
    { title: 'Le total look navy', fmt: 'INSTAGRAM_REEL', acc: igAcc, d: 2, body: 'Le navy, plus polyvalent que le noir. La preuve en 20 secondes.', tags: ['#monhomme', '#navy', '#elegancesanseffort'], likes: 1840, comments: 96, shares: 134, reach: 33700, impressions: 47900 },
  ];

  for (const p of publishedSpecs) {
    const er = +((p.likes + p.comments * 3 + p.shares * 5) / Math.max(p.impressions, 1) * 100).toFixed(2);
    const post = await db.post.create({
      data: {
        organizationId: orgId, brandId: brand.id, authorId: userId ?? undefined,
        format: p.fmt, status: 'PUBLISHED', title: p.title, body: p.body, hashtags: p.tags,
        cta: 'Découvre la collection →', aiProvider: 'claude', aiModel: 'claude-sonnet',
        metadata: { lastScore: { overall: 78 + Math.floor(Math.random() * 14), verdict: 'GOOD', at: daysAgo(p.d).toISOString() } },
      },
    });
    const sched = await db.postSchedule.create({
      data: {
        postId: post.id, socialAccountId: p.acc.id, scheduledFor: daysAgo(p.d), publishedAt: daysAgo(p.d),
        status: 'PUBLISHED', shareMode: 'AUTO', externalPostId: `ext_${post.id.slice(0, 8)}`,
      },
    });
    await db.postAnalytics.create({
      data: {
        postId: post.id, postScheduleId: sched.id, socialAccountId: p.acc.id,
        impressions: p.impressions, reach: p.reach, likes: p.likes, comments: p.comments,
        shares: p.shares, clicks: Math.round(p.reach * 0.03), engagementRate: er, capturedAt: daysAgo(p.d - 1),
      },
    });
  }
  console.log(`✓ ${publishedSpecs.length} PUBLISHED posts + schedules + analytics`);

  // SCHEDULED (AUTO connected) — upcoming
  const schedAutoPost = await db.post.create({
    data: { organizationId: orgId, brandId: brand.id, authorId: userId ?? undefined, format: 'INSTAGRAM_POST', status: 'SCHEDULED', title: 'Le jean brut, mode d\'emploi', body: 'Comment porter le jean brut sans faux pas. 3 règles simples.', hashtags: ['#monhomme', '#jeanbrut'], cta: 'Voir le guide →' },
  });
  await db.postSchedule.create({ data: { postId: schedAutoPost.id, socialAccountId: igAcc.id, scheduledFor: daysAhead(2), status: 'SCHEDULED', shareMode: 'AUTO' } });

  // SCHEDULED (MANUAL — no account match e.g. TikTok) → shows orange badge in calendar
  const schedManualPost = await db.post.create({
    data: { organizationId: orgId, brandId: brand.id, authorId: userId ?? undefined, format: 'TIKTOK_VIDEO', status: 'SCHEDULED', title: 'Get ready with monhomme', body: 'GRWM : la tenue parfaite pour un premier rendez-vous pro.', hashtags: ['#monhomme', '#grwm', '#ootd'], cta: 'Lien en bio' },
  });
  await db.postSchedule.create({ data: { postId: schedManualPost.id, scheduledFor: daysAhead(4), status: 'SCHEDULED', shareMode: 'MANUAL' } });
  console.log('✓ 2 SCHEDULED posts (1 AUTO, 1 MANUAL)');

  // DRAFT posts (from strategy execution, awaiting production)
  const draftPosts = [];
  for (const [title, fmt, body] of [
    ['Top 5 erreurs de style à éviter', 'INSTAGRAM_CAROUSEL', 'Les 5 erreurs qui plombent une tenue (et comment les corriger).'],
    ['Notre histoire en 30s', 'INSTAGRAM_REEL', 'D\'un atelier parisien à ton dressing : l\'histoire de monhomme.'],
    ['Newsletter — l\'essentiel du mois', 'EMAIL_MARKETING', 'Les nouveautés, conseils et offres du mois pour ton vestiaire.'],
  ]) {
    draftPosts.push(await db.post.create({
      data: { organizationId: orgId, brandId: brand.id, authorId: userId ?? undefined, format: fmt, status: 'DRAFT', title, body, hashtags: ['#monhomme'], cta: 'Découvre →', metadata: { fromStrategy: true } },
    }));
  }
  console.log(`✓ ${draftPosts.length} DRAFT posts`);

  // PENDING_APPROVAL posts (+ approval requests)
  const pendingPost = await db.post.create({
    data: { organizationId: orgId, brandId: brand.id, authorId: userId ?? undefined, format: 'LINKEDIN_POST', status: 'PENDING_APPROVAL', title: 'monhomme x atelier solidaire', body: 'Annonce d\'un partenariat avec un atelier de réinsertion. À valider avant publication.', hashtags: ['#monhomme', '#engagement'], cta: 'En savoir plus →' },
  });
  await db.approvalRequest.create({
    data: { organizationId: orgId, postId: pendingPost.id, status: 'PENDING', requestedBy: userId ?? undefined, message: 'Peux-tu valider le ton du communiqué partenariat ?' },
  });
  const pendingPost2 = await db.post.create({
    data: { organizationId: orgId, brandId: brand.id, authorId: userId ?? undefined, format: 'INSTAGRAM_POST', status: 'PENDING_APPROVAL', title: 'Soldes — derniers jours', body: 'Communication soldes — à valider (vérifier qu\'on ne tombe pas dans le ton "urgent").', hashtags: ['#monhomme', '#soldes'], cta: 'Profite →' },
  });
  await db.approvalRequest.create({
    data: { organizationId: orgId, postId: pendingPost2.id, status: 'IN_REVIEW', requestedBy: userId ?? undefined, message: 'Vérifier conformité avec la charte (éviter "urgent").' },
  });
  console.log('✓ 2 PENDING_APPROVAL posts + approval requests');

  // ============ MARKETING STRATEGY + ITEMS ============
  const strategy = await db.marketingStrategy.create({
    data: {
      organizationId: orgId, brandId: brand.id, title: 'Stratégie monhomme — 90 jours', horizon: '90d',
      status: 'IN_EXECUTION', generatedByModel: 'claude-sonnet', validatedAt: daysAgo(22), validatedById: userId ?? undefined,
      strategy: {
        vision: 'Positionner monhomme comme la référence du vestiaire masculin essentiel et durable en France.',
        pillars: ['Éducation style (comment bien s\'habiller)', 'Coulisses & savoir-faire', 'Durabilité & transparence', 'Inspiration looks'],
        kpis: ['+25% abonnés IG en 90j', 'Taux engagement > 4%', '+20% ventes maille/veste', '500 inscrits newsletter'],
        targetAudience: 'Hommes 28-45 urbains, qualité & durabilité.',
      },
    },
  });
  const itemSpecs = [
    ['CONTENT_PILLAR', 'Pilier Éducation Style', 'Série hebdomadaire "La règle de la semaine" — conseils style actionnables.', null, null, 'APPROVED'],
    ['POST_IDEA', 'Top 5 erreurs de style', 'Carrousel listant 5 erreurs courantes + correction.', 'INSTAGRAM', 'INSTAGRAM_CAROUSEL', 'EXECUTED'],
    ['REEL_IDEA', 'Notre histoire en 30s', 'Reel narratif sur la genèse de la marque.', 'INSTAGRAM', 'INSTAGRAM_REEL', 'EXECUTED'],
    ['EMAIL_IDEA', 'Newsletter mensuelle', 'Newsletter "l\'essentiel du mois".', 'EMAIL', 'EMAIL_MARKETING', 'EXECUTED'],
    ['CAMPAIGN_IDEA', 'Campagne Collection Automne', 'Campagne multi-touch lancement automne.', null, null, 'APPROVED'],
    ['AD_IDEA', 'Meta Ads — essentiels', 'Pub carrousel produits essentiels, audience lookalike acheteurs.', 'FACEBOOK', 'AD_VISUAL', 'APPROVED'],
    ['POST_IDEA', 'Le jean brut, mode d\'emploi', 'Post éducatif sur le port du jean brut.', 'INSTAGRAM', 'INSTAGRAM_POST', 'APPROVED'],
    ['EXPERIMENT', 'A/B test horaires de publication', 'Tester 18h vs 20h sur 2 semaines.', null, null, 'PROPOSED'],
    ['PARTNERSHIP', 'Collab micro-influenceurs mode', 'Identifier 5 micro-influenceurs mode masculine.', null, null, 'PROPOSED'],
    ['MILESTONE', 'Atteindre 25k abonnés IG', 'Objectif intermédiaire à 60 jours.', null, null, 'PROPOSED'],
  ];
  let order = 0;
  for (const [kind, title, desc, platform, format, status] of itemSpecs) {
    await db.strategyItem.create({
      data: {
        strategyId: strategy.id, order: order++, kind, title, description: desc,
        platform: platform ?? undefined, format: format ?? undefined, status,
        suggestedDate: daysAhead(order * 3), hashtags: ['#monhomme'], cta: 'Découvre →',
      },
    });
  }
  console.log(`✓ Strategy IN_EXECUTION + ${itemSpecs.length} items (mixed statuses)`);

  // ============ BRAND PIPELINE RUNS ============
  if (userId) {
    await db.brandPipelineRun.create({
      data: {
        organizationId: orgId, brandId: brand.id, startedById: userId, strategyId: strategy.id,
        horizon: '90d', status: 'COMPLETED', step: 'DONE', completedAt: daysAgo(22),
        seed: { name: 'monhomme', industry: 'Mode masculine' },
        trace: [{ step: 'CREATE_BRAND', at: daysAgo(25).toISOString() }, { step: 'DONE', at: daysAgo(22).toISOString() }],
      },
    });
    await db.brandPipelineRun.create({
      data: {
        organizationId: orgId, brandId: brand.id, startedById: userId,
        horizon: '30d', status: 'AWAITING_ADMIN', step: 'VALIDATE_STRATEGY_ITEMS',
        seed: { name: 'monhomme — sprint hiver', focus: 'collection hiver' },
        adminNotes: 'En attente de validation des items de la stratégie hiver.',
        trace: [{ step: 'GENERATE_STRATEGY', at: hoursAgo(6).toISOString() }],
      },
    });
    console.log('✓ 2 pipeline runs (1 COMPLETED, 1 AWAITING_ADMIN)');
  }

  // ============ COMPETITORS ============
  const compSpecs = [
    ['Asphalte', 'https://asphalte.com', ['mode homme', 'précommande', 'durable'], 'INSTAGRAM', 'asphalte', 312000],
    ['Loom', 'https://loom.fr', ['mode homme', 'durable', 'éthique'], 'INSTAGRAM', 'loom', 148000],
  ];
  for (const [name, website, kw, plat, handle, followers] of compSpecs) {
    const comp = await db.competitor.create({
      data: { organizationId: orgId, brandId: brand.id, name, website, industry: 'Mode masculine', country: 'FR', keywords: kw, notes: 'Concurrent direct mode homme durable.' },
    });
    await db.competitorSocialAccount.create({ data: { competitorId: comp.id, platform: plat, handle, url: `https://instagram.com/${handle}`, followers } });
    await db.competitorPost.create({
      data: { competitorId: comp.id, platform: plat, externalId: `comp_${handle}_1`, url: `https://instagram.com/p/${handle}1`, caption: `Nouvelle collection ${name} — précommande ouverte.`, postedAt: daysAgo(3), likes: 4200, comments: 180, shares: 90, hashtags: ['#modehomme', '#durable'] },
    });
  }
  console.log('✓ 2 competitors + social accounts + posts');

  // ============ TREND WATCH + ITEMS ============
  const watch = await db.trendWatch.create({
    data: { organizationId: orgId, brandId: brand.id, kind: 'KEYWORD', name: 'Tendances mode homme', query: 'mode masculine tendance 2026', country: 'FR', language: 'fr', active: true, config: { keywords: ['mode homme', 'vestiaire', 'quiet luxury'] } },
  });
  for (const [title, summary, score] of [
    ['Le "quiet luxury" continue de dominer', 'L\'élégance discrète et les matières nobles restent la tendance forte 2026.', 0.92],
    ['Montée du seconde main premium homme', 'Le marché de la seconde main haut de gamme masculine explose (+34%).', 0.78],
    ['Retour des coupes amples', 'Les coupes oversize et relaxed gagnent du terrain chez les 25-35 ans.', 0.71],
  ]) {
    await db.trendItem.create({
      data: { trendWatchId: watch.id, title, summary, url: 'https://example.com/trend', source: 'web', publishedAt: daysAgo(2), trendScore: score, contentOpportunityScore: score, relevanceScore: score },
    });
  }
  console.log('✓ Trend watch + 3 trend items');

  // ============ INBOX — SOCIAL INTERACTIONS + AUTO-REPLY RULE ============
  const interactions = [
    ['COMMENT', 'POSITIVE', 0.9, 'NEW', 'paul_durand', 'Paul Durand', 'Superbe carrousel ! Le chino beige est dispo en 42 ?', igAcc],
    ['COMMENT', 'POSITIVE', 0.8, 'NEW', 'marc.lefevre', 'Marc Lefèvre', 'Enfin une marque qui mise sur la qualité 👏', igAcc],
    ['DM', 'NEUTRAL', 0.1, 'NEW', 'antoine_b', 'Antoine B.', 'Bonjour, quel est le délai de livraison pour la veste en lin ?', igAcc],
    ['COMMENT', 'NEGATIVE', -0.6, 'NEW', 'julien_râleur', 'Julien M.', 'Reçu ma commande avec 2 semaines de retard, déçu.', igAcc],
    ['MENTION', 'POSITIVE', 0.7, 'READ', 'styleblog_fr', 'Style Blog FR', '@monhomme fait partie de notre top 5 des marques homme durables.', igAcc],
    ['COMMENT', 'POSITIVE', 0.85, 'REPLIED', 'thomas_g', 'Thomas G.', 'La maille mérinos est juste parfaite, merci !', igAcc],
    ['DM', 'NEUTRAL', 0.0, 'NEW', 'pro_buyer', 'Boutique Le Dressing', 'Bonjour, possibilité de vente en gros / B2B ?', liAcc],
    ['COMMENT', 'SPAM', -0.2, 'IGNORED', 'crypto_xyz', 'Crypto Deals', 'Gagnez 5000€/jour avec notre méthode 🚀🚀', igAcc],
    ['COMMENT', 'POSITIVE', 0.75, 'NEW', 'lucas_v', 'Lucas V.', 'Le total look navy est canon, ça donne envie !', igAcc],
    ['MENTION', 'NEGATIVE', -0.4, 'NEW', 'conso_avis', 'Conso Avis', 'Déçu par la coupe de la chemise @monhomme, taille petit.', fbAcc],
  ];
  let i = 0;
  for (const [type, sentiment, score, status, handle, name, content, acc] of interactions) {
    await db.socialInteraction.create({
      data: {
        organizationId: orgId, brandId: brand.id, socialAccountId: acc.id,
        externalId: `demo_int_${SLUG}_${i++}`, platform: acc.platform, type, content,
        fromHandle: handle, fromName: name, fromIsVerified: handle === 'styleblog_fr',
        sentiment, sentimentScore: score, status,
        ...(status === 'REPLIED' ? { repliedAt: hoursAgo(2), replyContent: 'Merci beaucoup Thomas, ravi que la maille te plaise ! 🙏', repliedById: userId ?? undefined } : {}),
        receivedAt: hoursAgo(i * 3),
      },
    });
  }
  await db.autoReplyRule.create({
    data: {
      organizationId: orgId, brandId: brand.id, enabled: true,
      allowedSentiments: ['POSITIVE'], allowedTypes: ['COMMENT'],
      minSentimentScore: 0.5, maxReplyLength: 220, requireApproval: true, dailyCap: 15,
      customPromptFragment: 'Réponds toujours avec chaleur et élégance, signe avec un emoji discret.',
    },
  });
  console.log(`✓ ${interactions.length} inbox interactions + auto-reply rule (POSITIVE, requireApproval)`);

  // ============ SOCIAL LISTENING — MENTION WATCH + MENTIONS + ALERT ============
  const mWatch = await db.mentionWatch.create({
    data: {
      organizationId: orgId, brandId: brand.id, name: 'Veille marque monhomme',
      keywords: ['monhomme', 'mon homme mode', 'monhomme vestiaire'], excludeKeywords: ['emploi', 'recrutement'],
      sources: ['REDDIT', 'WEB', 'NEWS'], enabled: true, minRelevance: 0.4, alertOnNegative: true, alertOnSpike: true,
      lastPolledAt: hoursAgo(1),
    },
  });
  const mentionSpecs = [
    ['REDDIT', 'POSITIVE', 0.8, 'r/mode_homme', 'u/fashionfan', 'Quelqu\'un a testé monhomme ? J\'ai commandé la chemise blanche, super qualité.', 'NEW', 0.85, 1200],
    ['WEB', 'POSITIVE', 0.7, 'blog mode', 'Le Mag Homme', 'monhomme s\'impose comme une référence du vestiaire masculin durable.', 'NEW', 0.9, 5400],
    ['NEWS', 'NEUTRAL', 0.0, 'Fashion News', 'Rédaction', 'monhomme lève des fonds pour accélérer sa croissance en Europe.', 'REVIEWED', 0.75, 12000],
    ['REDDIT', 'NEGATIVE', -0.5, 'r/buyitforlife', 'u/skeptic', 'Déçu par monhomme, la maille a bouloché après 3 lavages.', 'NEW', 0.7, 800],
    ['WEB', 'POSITIVE', 0.65, 'forum style', 'membre_anon', 'Le rapport qualité-prix de monhomme est imbattable sur les chinos.', 'NEW', 0.6, 300],
  ];
  const negMentionIds = [];
  let mi = 0;
  for (const [source, sentiment, score, authorH, authorN, content, status, relevance, reach] of mentionSpecs) {
    const m = await db.brandMention.create({
      data: {
        organizationId: orgId, brandId: brand.id, watchId: mWatch.id, source,
        externalId: `demo_men_${SLUG}_${mi++}`, url: 'https://example.com/mention',
        authorHandle: authorH, authorName: authorN, content, sentiment, sentimentScore: score,
        relevanceScore: relevance, reach, language: 'fr', status, publishedAt: hoursAgo(mi * 5), ingestedAt: hoursAgo(mi * 2),
      },
    });
    if (sentiment === 'NEGATIVE') negMentionIds.push(m.id);
  }
  if (negMentionIds.length) {
    await db.mentionAlert.create({
      data: {
        organizationId: orgId, brandId: brand.id, watchId: mWatch.id, type: 'NEGATIVE_MENTION', severity: 'CRITICAL',
        title: 'Mention négative détectée', message: 'Une mention négative sur la durabilité de la maille a été détectée sur Reddit. Réponse recommandée.',
        mentionIds: negMentionIds, acknowledged: false,
      },
    });
  }
  console.log(`✓ Mention watch + ${mentionSpecs.length} brand mentions + 1 CRITICAL alert`);

  // ============ REPORTS ============
  await db.report.create({
    data: {
      organizationId: orgId, brandId: brand.id, title: 'Rapport mensuel monhomme — 30 jours',
      status: 'READY', period: 'LAST_30_DAYS', periodStart: daysAgo(30), periodEnd: now,
      sections: ['overview', 'engagement', 'top-posts', 'platforms', 'competitors', 'ai-summary'],
      whiteLabel: { agencyName: 'Demo Agency', primaryColor: '#1e2a44', accentColor: '#c8a878', footerText: 'Rapport confidentiel — monhomme' },
      generatedAt: daysAgo(1), createdById: userId ?? undefined,
      aiSummary: 'Sur les 30 derniers jours, monhomme affiche une dynamique solide : 8 publications, ~280k impressions cumulées et un taux d\'engagement moyen de 4,3% — au-dessus de l\'objectif de 4%. Le format Reel surperforme (engagement 2x supérieur aux posts statiques), porté par "L\'essentiel en 30s" (58k impressions). Le pilier "Éducation style" génère le plus de sauvegardes. Recommandations : (1) doubler la cadence de Reels, (2) capitaliser sur le total look navy qui résonne fort, (3) répondre rapidement aux 2 mentions négatives sur la durabilité de la maille pour protéger l\'image. La collection automne montre déjà +20% de ventes maille/veste.',
      data: { overview: { totalPosts: 8, totalImpressions: 280100, totalEngagement: 13420, avgEngagementRate: 4.3 } },
    },
  });
  await db.reportSchedule.create({
    data: {
      organizationId: orgId, brandId: brand.id, title: 'Rapport mensuel automatique', frequency: 'MONTHLY', period: 'LAST_30_DAYS',
      sections: ['overview', 'engagement', 'top-posts', 'platforms', 'ai-summary'],
      whiteLabel: { agencyName: 'Demo Agency', primaryColor: '#1e2a44' },
      recipients: ['client@monhomme.example.com'], enabled: true, lastRunAt: daysAgo(1), nextRunAt: daysAhead(29),
    },
  });
  console.log('✓ 1 Report READY + 1 monthly ReportSchedule');

  console.log('\n========================================');
  console.log('✅ DÉMO monhomme COMPLÈTE');
  console.log(`   Organisation : ${org.name}`);
  console.log(`   → Bascule sur cette org dans le switcher pour voir la démo.`);
  console.log('========================================');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });

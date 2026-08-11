import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Share2, Plus, Mail } from 'lucide-react';
import { AccountsGrid } from './AccountsGrid';
import { GoogleMailService } from '@/services/integrations/GoogleMailService';

export const dynamic = 'force-dynamic';

export default async function SocialAccountsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  const [accountsRaw, brands, gmail] = await Promise.all([
    db.socialAccount.findMany({
      where: { organizationId: membership.organizationId },
      include: { brand: true, pages: true, tokens: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.brand.findMany({
      where: { organizationId: membership.organizationId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    GoogleMailService.status(membership.organizationId),
  ]);
  const gmailByBrand = new Map(gmail.connections.filter((c) => c.brandId).map((c) => [c.brandId as string, c]));
  const gmailOrg = gmail.connections.find((c) => c.brandId === null) ?? null;
  // Capacité RÉELLE de chaque compte — c'est ce qui distingue un compte
  // vraiment connecté (Zernio/jeton natif, publication automatique possible)
  // d'un simple enregistrement manuel (partage manuel uniquement). Sans cette
  // distinction, tous affichaient « CONNECTED » et l'utilisateur ne pouvait pas
  // savoir lesquels publieraient réellement.
  const accounts = accountsRaw.map((a) => {
    const lateAccountId = (a.metadata as Record<string, unknown> | null)?.lateAccountId;
    const link: 'zernio' | 'native' | 'manual' = lateAccountId
      ? 'zernio'
      : a.tokens.length > 0
        ? 'native'
        : 'manual';
    return {
      id: a.id,
      platform: a.platform,
      type: a.type,
      handle: a.handle,
      displayName: a.displayName,
      status: a.status,
      brand: a.brand ? { id: a.brand.id, name: a.brand.name } : null,
      pagesCount: a.pages.length,
      link,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Comptes sociaux</h1>
          <p className="text-sm text-muted-foreground">Connecte plusieurs comptes par marque, par plateforme, par client.</p>
        </div>
        <Link href="/social-accounts/connect">
          <Button variant="brand"><Plus className="mr-2 h-4 w-4" /> Connecter un compte</Button>
        </Link>
      </div>

      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <strong>Comment ça marche :</strong> connectez vos comptes une fois (via la passerelle Zernio
        en deux clics, ou en <Link className="underline" href="/social-accounts/connect">enregistrement manuel</Link>),
        puis <strong>affectez chaque compte à une marque</strong> ci-dessous. Un compte « Toutes les marques »
        sert de repli pour n’importe quelle publication. Tant qu’aucun jeton réel n’est configuré, la
        publication reste en simulation.
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div>
          <p className="font-medium">Google — Gmail &amp; Agenda</p>
          <p className="text-sm text-muted-foreground">
            Chaque marque peut avoir son propre compte Google connecté (boîte Conversations + synchro
            Agenda dédiées) ; sinon elle utilise la connexion « Organisation » en repli.
          </p>
          {!gmail.configured && (
            <p className="mt-1 text-[11px] text-amber-600">
              Identifiants Google absents : ajoute GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sur Vercel
              (guide : docs/GOOGLE_OAUTH.md) puis redéploie — le bouton s&apos;activera.
            </p>
          )}
        </div>
        <div className="divide-y rounded-md border">
          {[{ id: null as string | null, name: 'Organisation (repli)', row: gmailOrg }, ...brands.map((b) => ({ id: b.id, name: b.name, row: gmailByBrand.get(b.id) ?? null }))].map(
            ({ id, name, row }) => (
              <div key={id ?? 'org'} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    {row ? `Connecté : ${row.email ?? 'compte Google'}` : 'Non connecté'}
                  </p>
                </div>
                {gmail.configured ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/integrations/google/start${id ? `?brandId=${id}` : ''}`}>
                      <Mail className="mr-2 h-4 w-4" /> {row ? 'Reconnecter' : 'Connecter'}
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled title="GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants">
                    <Mail className="mr-2 h-4 w-4" /> Connecter
                  </Button>
                )}
              </div>
            ),
          )}
        </div>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={<Share2 className="h-10 w-10" />}
          title="Aucun compte connecté"
          description="Connecte ou enregistre manuellement un premier compte social."
          action={<Link href="/social-accounts/connect"><Button variant="brand">Connecter</Button></Link>}
        />
      ) : (
        <AccountsGrid accounts={accounts} brands={brands} />
      )}
    </div>
  );
}

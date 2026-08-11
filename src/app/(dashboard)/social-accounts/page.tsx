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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <div>
          <p className="font-medium">Google — Gmail &amp; Agenda</p>
          <p className="text-sm text-muted-foreground">
            {gmail.connected
              ? `Connecté : ${gmail.email ?? 'compte Google'} — source de la boîte Conversations et de la synchro calendrier.`
              : 'Connecte le Gmail de ton organisation pour recevoir les emails dans Conversations et synchroniser les publications programmées vers Google Agenda.'}
          </p>
          <p className="mt-1 text-[11px] text-amber-600">
            Reconnexion nécessaire après mise à jour des accès (lecture Gmail + Agenda).
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <a href="/api/integrations/google/start">
            <Mail className="mr-2 h-4 w-4" /> {gmail.connected ? 'Reconnecter' : 'Connecter'}
          </a>
        </Button>
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

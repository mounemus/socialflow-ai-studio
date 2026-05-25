import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Share2, Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

const PLATFORM_LABEL: Record<string, string> = {
  FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', LINKEDIN: 'LinkedIn', TWITTER: 'X / Twitter',
  TIKTOK: 'TikTok', YOUTUBE: 'YouTube', PINTEREST: 'Pinterest',
};

export default async function SocialAccountsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await db.teamMember.findFirst({ where: { userId } });
  if (!membership) return null;

  const accounts = await db.socialAccount.findMany({
    where: { organizationId: membership.organizationId },
    include: { brand: true, pages: true },
    orderBy: { createdAt: 'desc' },
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

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Mode MVP :</strong> les connexions OAuth sociales nécessitent une configuration par plateforme (Facebook App, X Dev Portal, etc.).
        Pour l'instant tu peux <Link className="underline" href="/social-accounts/connect">enregistrer un compte manuellement</Link> et tester toute la chaîne de publication en mode mock.
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={<Share2 className="h-10 w-10" />}
          title="Aucun compte connecté"
          description="Connecte ou enregistre manuellement un premier compte social."
          action={<Link href="/social-accounts/connect"><Button variant="brand">Connecter</Button></Link>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-sm">
                  <span>{a.displayName}</span>
                  <Badge variant={a.status === 'CONNECTED' ? 'success' : 'warning'}>{a.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="text-muted-foreground">{PLATFORM_LABEL[a.platform]} · {a.type}</div>
                <div>@{a.handle}</div>
                {a.brand ? <div className="text-xs text-slate-500">Marque : {a.brand.name}</div> : null}
                {a.pages.length > 0 ? <div className="text-xs text-slate-500">{a.pages.length} page{a.pages.length > 1 ? 's' : ''}</div> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

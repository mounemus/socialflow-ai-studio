import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { OrgEditor } from './OrgEditor';
import { OrgMembers } from './OrgMembers';

export const dynamic = 'force-dynamic';

export default async function AdminOrgDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await db.organization.findUnique({
    where: { id },
    include: {
      members: { include: { user: { select: { id: true, email: true, name: true, disabled: true } } }, orderBy: { createdAt: 'asc' } },
      brands: { include: { _count: { select: { posts: true, socialAccounts: true } } } },
      socialAccounts: { include: { brand: true } },
      subscription: true,
      _count: { select: { posts: true, campaigns: true, automations: true, trendWatches: true, competitors: true, agentRuns: true } },
    },
  });
  if (!org) notFound();

  const allUsers = await db.user.findMany({
    select: { id: true, email: true, name: true },
    orderBy: { email: 'asc' },
    take: 500,
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/orgs" className="text-xs text-slate-500 hover:underline">
          <ArrowLeft className="h-3 w-3 inline" /> Toutes les organisations
        </Link>
        <h1 className="text-2xl font-bold tracking-tight mt-1">{org.name}</h1>
        <p className="text-sm text-muted-foreground">
          {org.slug} · <Badge variant="secondary">{org.plan}</Badge>
          {' · '}créée le {org.createdAt.toLocaleDateString('fr-FR')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
        {[
          ['Membres', org.members.length],
          ['Marques', org.brands.length],
          ['Comptes sociaux', org.socialAccounts.length],
          ['Publications', org._count.posts],
          ['Campagnes', org._count.campaigns],
          ['Agent runs', org._count.agentRuns],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">{label}</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{(value as number).toLocaleString('fr-FR')}</div></CardContent>
          </Card>
        ))}
      </div>

      <OrgEditor org={{ id: org.id, name: org.name, plan: org.plan }} />

      <OrgMembers organizationId={org.id} members={org.members} allUsers={allUsers} />

      <Card>
        <CardHeader>
          <CardTitle>Marques ({org.brands.length})</CardTitle>
          <CardDescription>Brands appartenant à cette organisation.</CardDescription>
        </CardHeader>
        <CardContent>
          {org.brands.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune marque.</p>
          ) : (
            <ul className="divide-y text-sm">
              {org.brands.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium">{b.name}</div>
                    <div className="text-xs text-muted-foreground">{b.industry ?? '—'} · {b._count.posts} posts · {b._count.socialAccounts} comptes</div>
                  </div>
                  <span className="text-xs text-muted-foreground">{b.slug}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Comptes sociaux ({org.socialAccounts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {org.socialAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun compte connecté.</p>
          ) : (
            <ul className="divide-y text-sm">
              {org.socialAccounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium">{a.displayName} <span className="text-muted-foreground">@{a.handle}</span></div>
                    <div className="text-xs text-muted-foreground">{a.platform} · {a.type} · {a.brand?.name ?? 'sans marque'}</div>
                  </div>
                  <Badge variant={a.status === 'CONNECTED' ? 'success' : 'warning'}>{a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

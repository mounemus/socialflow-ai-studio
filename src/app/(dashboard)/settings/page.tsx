import { auth } from '@/lib/auth';
import { getActiveMembership } from '@/lib/tenant';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import PublicationFlowSettings from './PublicationFlowSettings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId, {
    include: { organization: true, user: true },
  });
  if (!membership) return null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Paramètres</h1>
        <a href="/settings/team" className="text-sm text-brand-600 hover:underline">→ Gérer l'équipe</a>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Utilisateur</CardTitle>
          <CardDescription>Tes infos de compte.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div><span className="text-muted-foreground">Email :</span> {membership.user.email}</div>
          <div><span className="text-muted-foreground">Nom :</span> {membership.user.name ?? '—'}</div>
          <div><span className="text-muted-foreground">Rôle :</span> {membership.role}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organisation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div><span className="text-muted-foreground">Nom :</span> {membership.organization.name}</div>
          <div><span className="text-muted-foreground">Slug :</span> {membership.organization.slug}</div>
          <div><span className="text-muted-foreground">Plan :</span> {membership.organization.plan}</div>
        </CardContent>
      </Card>

      <PublicationFlowSettings />

      <Card>
        <CardHeader>
          <CardTitle>Intégrations</CardTitle>
          <CardDescription>État des connexions externes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="OpenAI" enabled={!!process.env.OPENAI_API_KEY} />
          <Row label="Anthropic" enabled={!!process.env.ANTHROPIC_API_KEY} />
          <Row label="Canva Connect" enabled={process.env.ENABLE_CANVA_API === 'true'} />
          <Row label="Redis (queues)" enabled={!!process.env.REDIS_URL} />
          <Row label="Publication réelle" enabled={process.env.ENABLE_REAL_PUBLISHING === 'true'} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between rounded border p-3">
      <span>{label}</span>
      <span className={enabled ? 'text-emerald-600' : 'text-slate-400'}>
        {enabled ? '✓ Connecté' : '○ Non configuré'}
      </span>
    </div>
  );
}

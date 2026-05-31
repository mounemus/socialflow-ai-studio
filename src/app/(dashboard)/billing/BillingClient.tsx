'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, ExternalLink, CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Plan {
  id: string;
  label: string;
  priceCents: number;
  currency: string;
  features: string[];
  limits: Record<string, number>;
  stripePriceEnv?: string;
}

export function BillingClient({
  organization,
  subscription,
  usage,
  plans,
  stripeConfigured,
  canManage,
}: {
  organization: { id: string; name: string; plan: string };
  subscription: { currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  usage: { brands: number; socialAccounts: number; postsThisMonth: number; aiRequestsThisMonth: number; teamMembers: number };
  plans: Plan[];
  stripeConfigured: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (sp.get('success') === '1') toast.success('Abonnement activé');
    if (sp.get('canceled') === '1') toast.info('Checkout annulé');
  }, [sp]);

  async function checkout(planId: string) {
    if (!canManage) return toast.error('Seuls OWNER/ADMIN peuvent gérer la facturation');
    setBusy(planId);
    const res = await fetch('/api/billing/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: planId }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return toast.error(j.message ?? 'Erreur');
    }
    const { data } = await res.json();
    if (!data.configured) return toast.warning(data.message);
    window.location.href = data.url;
  }

  async function openPortal() {
    if (!canManage) return toast.error('Seuls OWNER/ADMIN peuvent gérer la facturation');
    setBusy('portal');
    const res = await fetch('/api/billing/portal', { method: 'POST' });
    setBusy(null);
    if (!res.ok) return toast.error('Erreur');
    const { data } = await res.json();
    if (!data.configured) return toast.warning(data.message);
    window.location.href = data.url;
  }

  const currentPlan = plans.find((p) => p.id === organization.plan);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Facturation</h1>
        <p className="text-sm text-muted-foreground">Plan actuel, usage en cours et upgrade.</p>
      </div>

      {!stripeConfigured ? (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-base text-amber-900">Stripe non configuré</CardTitle>
            <CardDescription className="text-amber-800">
              Pour activer la facturation, pose STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET + les price IDs via le wizard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a href="/admin/setup/stripe">
              <Button variant="brand">Configurer Stripe</Button>
            </a>
          </CardContent>
        </Card>
      ) : null}

      {/* Current plan + usage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Plan actuel : {currentPlan?.label ?? organization.plan}</span>
            {subscription?.cancelAtPeriodEnd ? (
              <Badge variant="warning">Annulation prévue</Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            {subscription?.currentPeriodEnd
              ? `Prochaine facturation : ${new Date(subscription.currentPeriodEnd).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`
              : 'Plan gratuit'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              { label: 'Marques', value: usage.brands, limit: currentPlan?.limits.brands },
              { label: 'Comptes sociaux', value: usage.socialAccounts, limit: currentPlan?.limits.socialAccounts },
              { label: 'Posts ce mois', value: usage.postsThisMonth, limit: currentPlan?.limits.postsPerMonth },
              { label: 'IA ce mois', value: usage.aiRequestsThisMonth, limit: currentPlan?.limits.aiRequestsPerMonth },
              { label: 'Membres', value: usage.teamMembers, limit: currentPlan?.limits.teamMembers },
            ].map((u) => {
              const pct = u.limit && u.limit < 99999 ? Math.min(100, (u.value / u.limit) * 100) : 0;
              const over = u.limit && u.limit < 99999 && u.value >= u.limit;
              return (
                <div key={u.label} className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">{u.label}</div>
                  <div className={cn('text-lg font-bold', over && 'text-rose-600')}>
                    {u.value.toLocaleString('fr-FR')}
                    {u.limit && u.limit < 99999 ? <span className="text-xs text-muted-foreground"> / {u.limit.toLocaleString('fr-FR')}</span> : null}
                  </div>
                  {u.limit && u.limit < 99999 ? (
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                      <div className={cn('h-full rounded-full', over ? 'bg-rose-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {stripeConfigured && organization.plan !== 'FREE' ? (
            <div className="mt-4">
              <Button variant="outline" onClick={openPortal} disabled={busy === 'portal' || !canManage}>
                <CreditCard className="mr-2 h-4 w-4" />
                {busy === 'portal' ? '...' : 'Gérer mon abonnement (Stripe portal)'}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Plans */}
      <div>
        <div className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Plans disponibles</div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => {
            const isCurrent = p.id === organization.plan;
            const isContact = p.id === 'ENTERPRISE';
            return (
              <Card key={p.id} className={cn(isCurrent && 'border-brand-600 ring-2 ring-brand-600/20')}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-lg">
                    {p.label}
                    {isCurrent ? <Badge variant="success">Actuel</Badge> : null}
                  </CardTitle>
                  <CardDescription>
                    {p.priceCents > 0 ? (
                      <>
                        <span className="text-2xl font-bold text-slate-900">{(p.priceCents / 100).toFixed(0)} €</span>
                        <span className="text-xs">/mois</span>
                      </>
                    ) : isContact ? 'Sur devis' : 'Gratuit'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-xs">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  {isCurrent ? (
                    <Button variant="outline" className="w-full" disabled>Plan actuel</Button>
                  ) : p.id === 'FREE' ? (
                    <Button variant="outline" className="w-full" disabled>Downgrade via portal</Button>
                  ) : isContact ? (
                    <a href="mailto:contact@socialflow.ai" className="w-full">
                      <Button variant="outline" className="w-full">
                        <ExternalLink className="mr-1 h-3 w-3" /> Nous contacter
                      </Button>
                    </a>
                  ) : (
                    <Button
                      variant="brand"
                      className="w-full"
                      disabled={busy === p.id || !stripeConfigured || !canManage}
                      onClick={() => checkout(p.id)}
                    >
                      {busy === p.id ? '...' : `Passer en ${p.label}`}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>

      {!canManage ? (
        <p className="text-xs text-muted-foreground">Seuls les rôles OWNER et ADMIN peuvent modifier la facturation.</p>
      ) : null}
    </div>
  );
}

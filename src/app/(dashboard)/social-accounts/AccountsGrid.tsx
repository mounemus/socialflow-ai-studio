'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Trash2, RefreshCw } from 'lucide-react';

const PLATFORM_LABEL: Record<string, string> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  LINKEDIN: 'LinkedIn',
  TWITTER: 'X / Twitter',
  TIKTOK: 'TikTok',
  YOUTUBE: 'YouTube',
  PINTEREST: 'Pinterest',
};

export interface AccountRow {
  id: string;
  platform: string;
  type: string;
  handle: string;
  displayName: string;
  status: string;
  brand: { id: string; name: string } | null;
  pagesCount: number;
  /** Capacité réelle : passerelle Zernio, jeton natif, ou partage manuel. */
  link: 'zernio' | 'native' | 'manual';
}

const LINK_META: Record<
  AccountRow['link'],
  { label: string; variant: 'success' | 'info' | 'warning'; hint: string }
> = {
  zernio: {
    label: 'Publication auto',
    variant: 'success',
    hint: 'Connecté via la passerelle Zernio — la publication part automatiquement.',
  },
  native: {
    label: 'Publication auto',
    variant: 'success',
    hint: 'Jeton natif de la plateforme — la publication part automatiquement.',
  },
  manual: {
    label: 'Partage manuel',
    variant: 'warning',
    hint: 'Enregistrement manuel sans autorisation : aucune publication automatique. Connectez-le via Zernio pour publier.',
  },
};

export interface BrandOption {
  id: string;
  name: string;
}

function cleanHandle(h: string): string {
  return String(h ?? '')
    .replace(/^@+/, '')
    .replace(/^https?:\/\/\S*\//i, '');
}

/**
 * Grille des comptes sociaux avec AFFECTATION à une marque par carte. Le
 * modèle : on connecte une fois (Zernio/OAuth au niveau org), puis on distribue
 * chaque compte/page à la bonne marque ici — réassignable à tout moment. Un
 * compte « non rattaché » reste utilisable par toutes les marques (fallback de
 * publication).
 */
export function AccountsGrid({
  accounts,
  brands,
}: {
  accounts: AccountRow[];
  brands: BrandOption[];
}) {
  const [rows, setRows] = useState(accounts);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Le <select> contrôlé rendu depuis un arbre serveur déclenche un mismatch
  // d'hydratation React 19 (#418). On ne le monte qu'après hydratation : le
  // SSR et le premier rendu client affichent la marque en statique (identiques),
  // puis on bascule sur le sélecteur interactif.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [syncing, setSyncing] = useState(false);

  async function syncFromZernio() {
    setSyncing(true);
    try {
      const res = await fetch('/api/late/sync-accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message ?? 'Synchronisation impossible (clé Zernio ?)');
      const d = json?.data as { mapped: number; created: number; total: number } | undefined;
      if (!d || d.total === 0) {
        // Message actionnable plutôt qu'un « 0 compte » énigmatique.
        toast.warning('Aucun compte trouvé côté Zernio', {
          description:
            'Vérifiez que les comptes sont bien connectés dans Zernio (dashboard → Connections) et que la clé API pointe sur le même espace.',
          duration: 8000,
        });
        return;
      }
      toast.success(
        `Zernio : ${d.total} compte(s) — ${d.mapped} mis à jour, ${d.created} ajouté(s).`,
      );
      window.location.reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function assignBrand(accountId: string, brandId: string) {
    setBusyId(accountId);
    try {
      const res = await fetch(`/api/social/accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brandId: brandId || null }),
      });
      if (!res.ok) throw new Error('Échec de l’affectation');
      const target = brands.find((b) => b.id === brandId) ?? null;
      setRows((prev) =>
        prev.map((a) => (a.id === accountId ? { ...a, brand: target } : a)),
      );
      toast.success(target ? `Rattaché à ${target.name}` : 'Détaché (toutes marques)');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeAccount(account: AccountRow) {
    if (
      !window.confirm(
        `Supprimer le compte @${cleanHandle(account.handle)} ? La publication vers ce compte ne sera plus possible.`,
      )
    )
      return;
    setBusyId(account.id);
    try {
      const res = await fetch(`/api/social/accounts/${account.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Suppression impossible');
      setRows((prev) => prev.filter((a) => a.id !== account.id));
      toast.success('Compte supprimé');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const manualCount = rows.filter((a) => a.link === 'manual').length;

  return (
    <div className="space-y-4" suppressHydrationWarning>
      {/* Synchro Zernio : rapatrie l'état réel des connexions (source de
          vérité), au lieu de laisser diverger un registre local. */}
      <div className="flex flex-col gap-2 rounded-lg border bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-slate-600">
          {manualCount > 0
            ? `${manualCount} compte${manualCount > 1 ? 's' : ''} en partage manuel — reconnectez-le${manualCount > 1 ? 's' : ''} via Zernio pour publier automatiquement.`
            : 'Tous les comptes peuvent publier automatiquement.'}
        </span>
        <Button variant="outline" size="sm" onClick={syncFromZernio} disabled={syncing}>
          {syncing ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3 w-3" />
          )}
          Synchroniser depuis Zernio
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {rows.map((a) => (
        <Card key={a.id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{a.displayName}</span>
              {/* Capacité RÉELLE — pas un simple « CONNECTED » qui masquait les
                  comptes manuels incapables de publier. */}
              <Badge variant={LINK_META[a.link].variant} className="shrink-0 text-[10px]">
                {LINK_META[a.link].label}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="text-muted-foreground">
              {PLATFORM_LABEL[a.platform] ?? a.platform} · {a.type}
            </div>
            <div>@{cleanHandle(a.handle)}</div>
            <p className="text-[11px] leading-snug text-muted-foreground">{LINK_META[a.link].hint}</p>
            {a.pagesCount > 0 ? (
              <div className="text-xs text-slate-500">
                {a.pagesCount} page{a.pagesCount > 1 ? 's' : ''}
              </div>
            ) : null}

            {/* Affectation à une marque */}
            <div className="space-y-1 pt-1">
              <label className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Marque
                {busyId === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              </label>
              {mounted ? (
                <select
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                  value={a.brand?.id ?? ''}
                  disabled={busyId === a.id}
                  onChange={(e) => assignBrand(a.id, e.target.value)}
                >
                  <option value="">— Toutes les marques —</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-600">
                  {a.brand?.name ?? '— Toutes les marques —'}
                </div>
              )}
            </div>

            {/* Supprimer (détacher = choisir « Toutes les marques » ci-dessus) */}
            <div className="flex justify-end pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-slate-400 hover:text-rose-600"
                disabled={busyId === a.id}
                onClick={() => removeAccount(a)}
              >
                <Trash2 className="mr-1 h-3 w-3" /> Supprimer
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      </div>
    </div>
  );
}

export default AccountsGrid;

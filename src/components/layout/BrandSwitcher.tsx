'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Check, Layers, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';

type BrandItem = { id: string; name: string; industry: string | null };

/**
 * Sélecteur de marque GLOBAL (Refonte Phase A — « la marque est le contexte,
 * pas une page »). Vit dans la Topbar à côté du sélecteur d'organisation.
 *
 * La sélection est persistée côté serveur (cookie httpOnly via
 * /api/me/active-brand) puis router.refresh() re-rend les pages serveur, qui
 * filtrent leurs listes via getActiveBrandId(). `null` = « Toutes les
 * marques » (vue agence).
 */
export function BrandSwitcher({ variant = 'light' }: { variant?: 'light' | 'dark' }) {
  const router = useRouter();
  const [brands, setBrands] = useState<BrandItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/me/active-brand')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.data) {
          setBrands(d.data.brands ?? []);
          setActiveId(d.data.activeBrandId ?? null);
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  async function switchTo(id: string | null) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    const res = await fetch('/api/me/active-brand', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brandId: id }),
    });
    setSwitching(false);
    if (res.ok) {
      setActiveId(id);
      setOpen(false);
      router.refresh();
    }
  }

  // Pas de marques (nouvel utilisateur) → rien à afficher.
  if (loaded && brands.length === 0) return null;

  const active = brands.find((b) => b.id === activeId);
  const label = active ? active.name : 'Toutes les marques';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={switching || !loaded}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border text-xs font-medium transition-colors',
          variant === 'dark'
            ? 'w-full border-white/10 bg-white/5 px-3 py-2 text-white hover:bg-white/10'
            : cn(
                'max-w-[220px] rounded-full px-3 py-1',
                active
                  ? 'border-brand-100 bg-brand-50 text-brand-700 hover:bg-brand-100'
                  : 'border-border bg-secondary text-muted-foreground hover:bg-accent',
              ),
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Marque active"
      >
        <Tag className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="listbox"
            className="absolute left-0 top-full z-50 mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border bg-white py-1 shadow-lg"
          >
            <button
              type="button"
              role="option"
              aria-selected={activeId === null}
              onClick={() => switchTo(null)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
            >
              <Layers className="h-4 w-4 text-slate-400" />
              <span className="flex-1">Toutes les marques</span>
              {activeId === null ? <Check className="h-4 w-4 text-brand-600" /> : null}
            </button>
            <div className="my-1 border-t" />
            {brands.map((b) => (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={activeId === b.id}
                onClick={() => switchTo(b.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <Tag className="h-4 w-4 shrink-0 text-brand-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{b.name}</span>
                  {b.industry ? (
                    <span className="block truncate text-[11px] text-muted-foreground">{b.industry}</span>
                  ) : null}
                </span>
                {activeId === b.id ? <Check className="h-4 w-4 shrink-0 text-brand-600" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

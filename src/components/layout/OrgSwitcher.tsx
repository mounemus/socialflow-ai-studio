'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Check, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Org = { id: string; name: string; slug: string; plan: string; role: string };

export function OrgSwitcher() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch('/api/me/active-org').then((r) => r.json()).then((d) => {
      if (d.data) {
        setOrgs(d.data.organizations);
        setActiveId(d.data.activeOrganizationId);
      }
    });
  }, []);

  async function switchTo(id: string) {
    if (id === activeId) { setOpen(false); return; }
    setSwitching(true);
    const res = await fetch('/api/me/active-org', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: id }),
    });
    setSwitching(false);
    if (res.ok) {
      setActiveId(id);
      setOpen(false);
      router.refresh();
    }
  }

  const active = orgs.find((o) => o.id === activeId);

  if (orgs.length === 0) return null;
  if (orgs.length === 1) {
    // Just show the name, no switcher
    return (
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
        {active?.name}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
      >
        <Building2 className="h-3 w-3" />
        {active?.name ?? '—'}
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1 w-64 rounded-lg border bg-white shadow-lg">
            <div className="border-b p-2 text-[10px] uppercase tracking-wider text-slate-500">
              Mes organisations ({orgs.length})
            </div>
            <ul>
              {orgs.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => switchTo(o.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50',
                      o.id === activeId && 'bg-brand-50 text-brand-700',
                    )}
                  >
                    <div>
                      <div className="font-medium">{o.name}</div>
                      <div className="text-[10px] text-muted-foreground">{o.slug} · {o.role} · {o.plan}</div>
                    </div>
                    {o.id === activeId ? <Check className="h-4 w-4 shrink-0" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

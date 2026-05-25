import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await db.teamMember.findFirst({ where: { userId } });
  if (!membership) return null;

  const schedules = await db.postSchedule.findMany({
    where: { post: { organizationId: membership.organizationId } },
    include: { post: { include: { brand: true } }, socialAccount: true },
    orderBy: { scheduledFor: 'asc' },
    take: 200,
  });

  const today = new Date();
  const byDay = new Map<string, typeof schedules>();
  for (const s of schedules) {
    const key = s.scheduledFor.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, [] as never);
    byDay.get(key)!.push(s);
  }
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Calendrier éditorial</h1>
        <p className="text-sm text-muted-foreground">Vue 14 jours, toutes marques, toutes plateformes.</p>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const items = byDay.get(day) ?? [];
          const d = new Date(day);
          return (
            <Card key={day} className="min-h-[160px]">
              <CardHeader className="p-3">
                <CardTitle className="text-xs font-semibold">
                  {d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 p-3 pt-0">
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">—</p>
                ) : (
                  items.map((it) => (
                    <div key={it.id} className="rounded border bg-slate-50 p-1.5 text-[11px]">
                      <div className="font-medium">{it.post.brand?.name ?? 'Sans marque'}</div>
                      <div className="text-muted-foreground">{it.socialAccount.platform}</div>
                      <Badge variant={it.status === 'PUBLISHED' ? 'success' : 'info'}>{it.status}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Génération de calendrier IA</CardTitle>
          <CardDescription>Bientôt : génère un calendrier complet en 1 clic depuis l'AI Studio.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

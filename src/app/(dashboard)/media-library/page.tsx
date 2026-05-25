import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Image as ImageIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function MediaLibraryPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string }).id;
  const membership = await db.teamMember.findFirst({ where: { userId } });
  if (!membership) return null;

  const items = await db.mediaAsset.findMany({
    where: { organizationId: membership.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Médiathèque</h1>
      {items.length === 0 ? (
        <EmptyState icon={<ImageIcon className="h-10 w-10" />} title="Pas encore de média" description="Upload S3 / Supabase Storage à venir." />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((m) => (
            <Card key={m.id} className="overflow-hidden">
              {m.kind === 'IMAGE' ? (
                <img src={m.url} alt={m.altText ?? ''} className="aspect-square w-full object-cover" />
              ) : (
                <div className="aspect-square bg-slate-100 flex items-center justify-center text-xs text-muted-foreground">{m.kind}</div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

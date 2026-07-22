import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership, getActiveBrandId } from '@/lib/tenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Image as ImageIcon } from 'lucide-react';
import { MediaLibraryClient } from './MediaLibraryClient';

export const dynamic = 'force-dynamic';

export default async function MediaLibraryPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const membership = await getActiveMembership(userId);
  if (!membership) return null;

  // Contexte de marque global : la médiathèque suit la marque active.
  const activeBrandId = await getActiveBrandId(membership.organizationId);
  const items = await db.mediaAsset.findMany({
    where: {
      organizationId: membership.organizationId,
      ...(activeBrandId ? { brandId: activeBrandId } : {}),
    },
    include: { brand: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Médiathèque</h1>
        <p className="text-sm text-muted-foreground">Importer + organiser les médias pour tes posts et campagnes.</p>
      </div>

      <MediaLibraryClient initialItems={items.map((m) => ({
        id: m.id,
        url: m.url,
        kind: m.kind,
        mimeType: m.mimeType,
        altText: m.altText,
        brand: m.brand,
        createdAt: m.createdAt.toISOString(),
      }))} />

      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pas encore de média ?</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Configure le storage Supabase via <a className="text-brand-600 hover:underline" href="/admin/setup/supabase">/admin/setup/supabase</a> puis importe tes premiers fichiers.</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

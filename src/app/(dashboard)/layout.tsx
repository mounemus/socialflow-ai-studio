import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { AssistantDock } from '@/components/assistant/AssistantDock';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getActiveMembership } from '@/lib/tenant';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect('/login');

  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { globalRole: true } }),
    getActiveMembership(userId, { include: { organization: true } }),
  ]);
  if (!membership) redirect('/onboarding');
  const isSuperAdmin = user?.globalRole === 'SUPER_ADMIN';

  return (
    <div className="flex h-screen w-full">
      <Sidebar isSuperAdmin={isSuperAdmin} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar userEmail={session?.user?.email ?? undefined} isSuperAdmin={isSuperAdmin} />
        {/* Mobile-friendly padding: tighter on phones, roomier from sm up. */}
        <main className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">{children}</main>
      </div>
      {/* Assistant ambiant (Phase C) : bouton flottant + Ctrl+K, sur toutes
          les pages. Monté au niveau du layout pour que la conversation
          survive à la navigation. */}
      <AssistantDock />
    </div>
  );
}

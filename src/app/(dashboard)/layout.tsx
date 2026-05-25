import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect('/login');

  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { globalRole: true } }),
    db.teamMember.findFirst({ where: { userId }, include: { organization: true } }),
  ]);
  if (!membership) redirect('/onboarding');
  const isSuperAdmin = user?.globalRole === 'SUPER_ADMIN';

  return (
    <div className="flex h-screen w-full">
      <Sidebar isSuperAdmin={isSuperAdmin} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar orgName={membership.organization.name} userEmail={session?.user?.email ?? undefined} />
        <main className="flex-1 overflow-y-auto bg-slate-50 p-6">{children}</main>
      </div>
    </div>
  );
}

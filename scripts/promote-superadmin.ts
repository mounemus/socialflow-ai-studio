/**
 * Promote a user to SUPER_ADMIN by email.
 * Usage: tsx scripts/promote-superadmin.ts <email>
 */
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: tsx scripts/promote-superadmin.ts <email>');
    process.exit(1);
  }
  const user = await db.user.update({
    where: { email },
    data: { globalRole: 'SUPER_ADMIN' },
  });
  console.log(`✓ ${user.email} is now SUPER_ADMIN (id: ${user.id})`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());

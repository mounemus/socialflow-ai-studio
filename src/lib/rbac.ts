import type { UserRole } from '@prisma/client';
import { ForbiddenError } from './errors';

/**
 * Role-Based Access Control. Centralised permission checks.
 * Roles, from highest to lowest privilege:
 *   SUPER_ADMIN > OWNER > ADMIN > STRATEGIST > DESIGNER > EDITOR > CLIENT > VIEWER
 */

const ROLE_LEVEL: Record<UserRole, number> = {
  SUPER_ADMIN: 100,
  OWNER: 90,
  ADMIN: 80,
  STRATEGIST: 60,
  DESIGNER: 50,
  EDITOR: 40,
  CLIENT: 20,
  VIEWER: 10,
};

export type Permission =
  | 'org.manage'
  | 'org.billing'
  | 'brand.manage'
  | 'social.connect'
  | 'social.publish'
  | 'post.create'
  | 'post.edit'
  | 'post.delete'
  | 'post.approve'
  | 'post.comment'
  | 'campaign.manage'
  | 'automation.manage'
  | 'watch.manage'
  | 'competitor.manage'
  | 'analytics.view'
  | 'ai.use'
  | 'media.upload'
  | 'approval.review'
  | 'client.manage';

const PERMISSION_MIN_LEVEL: Record<Permission, number> = {
  'org.manage': ROLE_LEVEL.OWNER,
  'org.billing': ROLE_LEVEL.OWNER,
  'brand.manage': ROLE_LEVEL.ADMIN,
  'social.connect': ROLE_LEVEL.ADMIN,
  'social.publish': ROLE_LEVEL.EDITOR,
  'post.create': ROLE_LEVEL.EDITOR,
  'post.edit': ROLE_LEVEL.EDITOR,
  'post.delete': ROLE_LEVEL.STRATEGIST,
  // Approving content is a privileged action: OWNER / ADMIN / STRATEGIST and up.
  // Lower roles (DESIGNER, EDITOR, CLIENT, VIEWER) are read-only on approvals.
  'post.approve': ROLE_LEVEL.STRATEGIST,
  'post.comment': ROLE_LEVEL.CLIENT,
  'campaign.manage': ROLE_LEVEL.STRATEGIST,
  'automation.manage': ROLE_LEVEL.STRATEGIST,
  'watch.manage': ROLE_LEVEL.STRATEGIST,
  'competitor.manage': ROLE_LEVEL.STRATEGIST,
  'analytics.view': ROLE_LEVEL.VIEWER,
  'ai.use': ROLE_LEVEL.EDITOR,
  'media.upload': ROLE_LEVEL.EDITOR,
  'approval.review': ROLE_LEVEL.CLIENT,
  'client.manage': ROLE_LEVEL.ADMIN,
};

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_LEVEL[role] >= PERMISSION_MIN_LEVEL[permission];
}

export function requirePermission(role: UserRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}

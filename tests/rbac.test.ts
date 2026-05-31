import { describe, it, expect } from 'vitest';
import { can, requirePermission } from '@/lib/rbac';

describe('RBAC', () => {
  it('OWNER can manage org and billing', () => {
    expect(can('OWNER', 'org.manage')).toBe(true);
    expect(can('OWNER', 'org.billing')).toBe(true);
  });

  it('VIEWER can only view analytics, not create posts', () => {
    expect(can('VIEWER', 'analytics.view')).toBe(true);
    expect(can('VIEWER', 'post.create')).toBe(false);
    expect(can('VIEWER', 'org.manage')).toBe(false);
  });

  it('EDITOR can create posts but not delete', () => {
    expect(can('EDITOR', 'post.create')).toBe(true);
    expect(can('EDITOR', 'post.edit')).toBe(true);
    expect(can('EDITOR', 'post.delete')).toBe(false);
  });

  it('CLIENT can review and comment, but post.approve is privileged (STRATEGIST+)', () => {
    expect(can('CLIENT', 'approval.review')).toBe(true);
    expect(can('CLIENT', 'post.comment')).toBe(true);
    expect(can('CLIENT', 'post.create')).toBe(false);
    // post.approve was raised to STRATEGIST level (approvals feature, Phase D).
    expect(can('CLIENT', 'post.approve')).toBe(false);
    expect(can('STRATEGIST', 'post.approve')).toBe(true);
  });

  it('STRATEGIST can manage campaigns/automations/watch', () => {
    expect(can('STRATEGIST', 'campaign.manage')).toBe(true);
    expect(can('STRATEGIST', 'automation.manage')).toBe(true);
    expect(can('STRATEGIST', 'watch.manage')).toBe(true);
    expect(can('STRATEGIST', 'org.manage')).toBe(false);
  });

  it('SUPER_ADMIN can do everything', () => {
    expect(can('SUPER_ADMIN', 'org.manage')).toBe(true);
    expect(can('SUPER_ADMIN', 'post.delete')).toBe(true);
    expect(can('SUPER_ADMIN', 'org.billing')).toBe(true);
  });

  it('requirePermission throws Forbidden when missing', () => {
    expect(() => requirePermission('VIEWER', 'org.manage')).toThrow();
    expect(() => requirePermission('OWNER', 'org.manage')).not.toThrow();
  });
});

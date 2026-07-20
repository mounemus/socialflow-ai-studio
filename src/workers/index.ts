/**
 * Workers entrypoint. Run via `npm run worker` in a separate process.
 * On Vercel: deploy a separate worker on Render/Railway/Fly OR use Vercel Cron + serverless invocations.
 */
import { createWorker, QUEUE_NAMES } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { SocialPublisherService } from '@/services/publisher/SocialPublisherService';
import { MarketingWatchService } from '@/services/watch/MarketingWatchService';
import { AutomationEngine } from '@/services/automation/AutomationEngine';
import type { PublishInput } from '@/services/publisher/types';

logger.info('Starting SocialFlow workers...');

createWorker(QUEUE_NAMES.publish, async (job) => {
  logger.info('publish job', { id: job.id });
  return SocialPublisherService.publishNow(job.data as PublishInput);
});

createWorker(QUEUE_NAMES.watch, async (job) => {
  logger.info('watch job', { id: job.id });
  const orgId = (job.data as { organizationId: string }).organizationId;
  return MarketingWatchService.runAllForOrg(orgId);
});

createWorker(QUEUE_NAMES.automation, async (job) => {
  logger.info('automation job', { id: job.id });
  const data = job.data as { automationId: string; input?: Record<string, unknown> };
  return AutomationEngine.runById(data.automationId, data.input);
});

createWorker(QUEUE_NAMES.analytics, async (job) => {
  logger.info('analytics job', { id: job.id });
  const data = job.data as { organizationId?: string };
  const { AnalyticsCollectorService } = await import('@/services/analytics/AnalyticsCollectorService');
  return data.organizationId
    ? AnalyticsCollectorService.collectForOrganization(data.organizationId)
    : AnalyticsCollectorService.collectForAllOrgs();
});

logger.info('Workers ready');

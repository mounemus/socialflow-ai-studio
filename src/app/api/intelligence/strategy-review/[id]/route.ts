import { handle, ok } from '@/lib/api';
import { resolveStrategyContext } from '@/lib/tenant';
import { StrategyReviewService } from '@/services/intelligence/StrategyReviewService';

/** Trigger an on-demand review of a strategy. */
export const POST = handle(async (_req, { params }) => {
  const { id } = await params;
  await resolveStrategyContext(id);
  const review = await StrategyReviewService.reviewOne(id);
  return ok(review);
});

/** Get latest stored review. */
export const GET = handle(async (_req, { params }) => {
  const { id } = await params;
  await resolveStrategyContext(id);
  const review = await StrategyReviewService.getLatest(id);
  return ok(review);
});

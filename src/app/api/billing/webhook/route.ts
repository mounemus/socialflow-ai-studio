import { NextResponse } from 'next/server';
import { StripeService } from '@/services/billing/StripeService';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook — verifies signature with STRIPE_WEBHOOK_SECRET, then dispatches.
 * MUST use raw body, NOT JSON parsed.
 */
export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new NextResponse('Missing signature', { status: 400 });

  const rawBody = await req.text();
  let event;
  try {
    event = StripeService.verifyWebhook(rawBody, signature);
  } catch (err) {
    logger.error('Stripe webhook signature invalid', { err: (err as Error).message });
    return new NextResponse(`Webhook Error: ${(err as Error).message}`, { status: 400 });
  }

  try {
    await StripeService.handleEvent(event);
    return NextResponse.json({ received: true });
  } catch (err) {
    logger.error('Stripe webhook handler failed', { type: event.type, err: (err as Error).message });
    // Return 200 anyway to avoid Stripe retrying indefinitely on logic errors
    return NextResponse.json({ received: true, error: (err as Error).message });
  }
}

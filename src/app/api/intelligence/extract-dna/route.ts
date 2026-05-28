import { z } from 'zod';
import { handle, ok } from '@/lib/api';
import { resolveBrandContext } from '@/lib/tenant';
import { BrandDNAService } from '@/services/intelligence/BrandDNAService';

const schema = z.object({
  brandId: z.string(),
  save: z.boolean().optional(),
});

/** Extract & optionally save the brand DNA from past content + profile. */
export const POST = handle(async (req) => {
  const body = schema.parse(await req.json());
  await resolveBrandContext(body.brandId);
  const dna = await BrandDNAService.extractFor(body.brandId);
  if (body.save) await BrandDNAService.saveFor(body.brandId, dna);
  return ok({ dna, saved: !!body.save });
});

/** Retrieve currently stored DNA for a brand. */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const brandId = url.searchParams.get('brandId');
  if (!brandId) throw new Error('brandId required');
  await resolveBrandContext(brandId);
  const dna = await BrandDNAService.getStoredFor(brandId);
  return ok({ dna });
});

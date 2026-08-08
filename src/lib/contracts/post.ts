import { z } from 'zod';

/**
 * Contrats partagés de publication/planification d'un post — importés par les
 * routes API et les composants client (Acte 5, Studio → Diffusion). Voir
 * `pipeline.ts` pour la règle : aucun import serveur ici.
 */

export const SOCIAL_PLATFORMS = [
  'FACEBOOK',
  'INSTAGRAM',
  'LINKEDIN',
  'TWITTER',
  'TIKTOK',
  'YOUTUBE',
  'PINTEREST',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/**
 * Publication immédiate. Deux appels possibles :
 *  - `socialAccountId` (Studio → Diffusion) ;
 *  - `platform` seul (Acte 5) : la route résout le compte de l'org.
 */
export const publishPostInput = z.object({
  socialAccountId: z.string().optional(),
  platform: z.string().optional(),
});
export type PublishPostInput = z.infer<typeof publishPostInput>;

/**
 * Programmation. `scheduledAt` est accepté comme alias de `scheduledFor` ;
 * `platform` seul suffit (résolution du compte côté serveur).
 */
export const schedulePostInput = z
  .object({
    socialAccountId: z.string().optional(),
    socialPageId: z.string().optional(),
    scheduledFor: z.string().datetime().optional(),
    scheduledAt: z.string().datetime().optional(),
    platform: z.string().optional(),
  })
  .refine((b) => b.scheduledFor || b.scheduledAt, {
    message: 'scheduledFor (ou scheduledAt) est requis',
  });
export type SchedulePostInput = z.infer<typeof schedulePostInput>;

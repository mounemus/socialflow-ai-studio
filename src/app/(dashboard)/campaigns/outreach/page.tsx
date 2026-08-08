import type { Metadata } from 'next';
import { OutreachClient } from './OutreachClient';

export const metadata: Metadata = { title: 'Diffusion — Emailing & Messagerie' };
export const dynamic = 'force-dynamic';

export default function OutreachPage() {
  return <OutreachClient />;
}

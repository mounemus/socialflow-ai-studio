import type { Metadata } from 'next';
import { ProspectingService } from '@/services/prospecting/ProspectingService';
import { ProspectingClient } from './ProspectingClient';

export const metadata: Metadata = { title: 'Prospection intelligente' };
export const dynamic = 'force-dynamic';

export default function ProspectingPage() {
  return <ProspectingClient configured={ProspectingService.isConfigured()} />;
}

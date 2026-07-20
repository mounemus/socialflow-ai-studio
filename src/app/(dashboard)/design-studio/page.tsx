import { DesignStudioClient } from './DesignStudioClient';
import { StudioMigrationBanner } from '@/components/layout/StudioMigrationBanner';

export const dynamic = 'force-dynamic';

export default function DesignStudioPage() {
  return (
    <div className="space-y-4">
      <StudioMigrationBanner from="Le Design Studio" />
      <DesignStudioClient />
    </div>
  );
}

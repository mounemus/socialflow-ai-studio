import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot } from 'lucide-react';
import { AssistantChat } from '@/components/assistant/AssistantChat';

export const dynamic = 'force-dynamic';

/**
 * Assistant IA en pleine page. Depuis la Phase C, le même chat est aussi
 * disponible partout via le panneau latéral (bouton flottant / Ctrl+K) —
 * cette page reste utile pour les longues sessions de pilotage.
 * Le cœur du chat vit dans components/assistant/AssistantChat (partagé).
 */
export default function AssistantPage() {
  return (
    <Card className="flex h-[calc(100vh-8rem)] flex-col">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-brand-600" /> Assistant IA SocialFlow
        </CardTitle>
        <CardDescription>
          Pilote la plateforme en langage naturel : générer des posts, planifier un calendrier,
          analyser les concurrents, créer des briefs Canva. La conversation garde le fil (marque
          en cours, IDs créés). Astuce : Ctrl+K ouvre ce même assistant depuis n&apos;importe
          quelle page.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-0">
        <AssistantChat />
      </CardContent>
    </Card>
  );
}

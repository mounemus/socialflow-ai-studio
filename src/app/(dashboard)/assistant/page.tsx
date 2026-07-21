'use client';
import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Bot, User, Send } from 'lucide-react';

type Msg = { role: 'user' | 'assistant'; content: string; runId?: string; mocked?: boolean };

const WELCOME: Msg = {
  role: 'assistant',
  content: 'Bonjour ! Je peux générer des posts, planifier un calendrier, analyser tes concurrents, créer des briefs Canva. Dis-moi ce que tu veux faire.',
};

export default function AssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // Mémoire de conversation : runId du dernier tour, rejoué côté serveur
  // depuis AgentRun.messages (DB) — « cette marque » garde son sens.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function resetConversation() {
    setMessages([WELCOME]);
    setConversationId(null);
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim()) return;
    const msg = input.trim();
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: msg }]);
    setLoading(true);

    const res = await fetch('/api/agent/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: msg, conversationId: conversationId ?? undefined }),
    });
    setLoading(false);

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.message ?? 'Erreur');
      return;
    }
    const { data } = await res.json();
    setConversationId((data.conversationId as string) ?? (data.runId as string) ?? null);
    setMessages((m) => [...m, { role: 'assistant', content: data.finalText, runId: data.runId, mocked: data.mocked }]);
  }

  const examples = [
    'Génère 3 posts Instagram pour Lumen Café cette semaine',
    'Crée un calendrier de 7 jours pour Nova SaaS',
    'Analyse mes tendances marketing',
    'Génère un brief Canva pour un Reel sur le café Éthiopie',
  ];

  return (
    <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-4">
      <div className="lg:col-span-3">
        <Card className="flex h-[calc(100vh-8rem)] flex-col">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-brand-600" /> Assistant IA SocialFlow
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={resetConversation}>
                Nouvelle conversation
              </Button>
            </CardTitle>
            <CardDescription>
              Pilote la plateforme en langage naturel. La conversation garde le fil (marque en
              cours, IDs créés) — « Nouvelle conversation » repart de zéro.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`h-8 w-8 shrink-0 rounded-full ${m.role === 'user' ? 'bg-brand-600' : 'bg-slate-800'} flex items-center justify-center text-white`}>
                  {m.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                </div>
                <div className={`max-w-2xl rounded-2xl px-4 py-3 ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-900'}`}>
                  {m.mocked ? <Badge variant="warning" className="mb-2">Mock (configure ANTHROPIC_API_KEY)</Badge> : null}
                  <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{m.content}</pre>
                </div>
              </div>
            ))}
            {loading ? (
              <div className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center text-white">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-500">L'assistant réfléchit...</div>
              </div>
            ) : null}
            <div ref={endRef} />
          </CardContent>
          <form onSubmit={send} className="border-t p-4 flex gap-2">
            <Textarea
              rows={2}
              placeholder="Demande à l'assistant..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="resize-none"
            />
            <Button type="submit" variant="brand" disabled={loading || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </Card>
      </div>

      <div className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Exemples</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => setInput(ex)}
                className="block w-full rounded-lg border border-dashed p-3 text-left text-xs hover:bg-slate-50"
              >
                {ex}
              </button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Outils disponibles</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <div>• list_brands, list_social_accounts</div>
            <div>• generate_post (sauvegarde brouillon)</div>
            <div>• generate_calendar (N jours)</div>
            <div>• generate_canva_brief</div>
            <div>• schedule_post</div>
            <div>• run_marketing_watch, list_recent_trends</div>
            <div>• analyze_competitor (SWOT)</div>
            <div>• list_drafts</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

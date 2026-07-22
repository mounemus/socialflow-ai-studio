'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Bot, Send, User } from 'lucide-react';

type Msg = { role: 'user' | 'assistant'; content: string; runId?: string; mocked?: boolean };

const WELCOME: Msg = {
  role: 'assistant',
  content:
    'Bonjour ! Je peux générer des posts, planifier un calendrier, analyser tes concurrents, créer des briefs Canva. Dis-moi ce que tu veux faire.',
};

/**
 * Cœur du chat de l'Assistant IA (Refonte Phase C — « l'IA est ambiante,
 * pas une destination »). Extrait de la page /assistant pour être partagé
 * entre la page pleine largeur et le panneau latéral global (AssistantDock).
 *
 * La mémoire de conversation (conversationId → AgentRun.messages en DB) est
 * conservée telle quelle : « cette marque » garde son sens d'un tour à
 * l'autre, quel que soit le conteneur.
 */
export function AssistantChat({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
    setMessages((m) => [
      ...m,
      { role: 'assistant', content: data.finalText, runId: data.runId, mocked: data.mocked },
    ]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end border-b px-3 py-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={resetConversation}>
          Nouvelle conversation
        </Button>
      </div>
      <div className={`flex-1 space-y-4 overflow-y-auto ${compact ? 'p-3' : 'p-6'}`}>
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white ${
                m.role === 'user' ? 'bg-brand-600' : 'bg-slate-800'
              }`}
            >
              {m.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>
            <div
              className={`${compact ? 'max-w-[85%]' : 'max-w-2xl'} rounded-2xl px-4 py-3 ${
                m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-900'
              }`}
            >
              {m.mocked ? (
                <Badge variant="warning" className="mb-2">
                  Mock (configure ANTHROPIC_API_KEY)
                </Badge>
              ) : null}
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{m.content}</pre>
            </div>
          </div>
        ))}
        {loading ? (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-white">
              <Bot className="h-4 w-4" />
            </div>
            <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-500">
              L&apos;assistant réfléchit...
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
      {!compact && messages.length <= 1 ? (
        <div className="flex flex-wrap gap-2 border-t px-4 pt-3">
          {[
            'Génère 3 posts Instagram pour ma marque cette semaine',
            'Crée un calendrier de 7 jours',
            'Analyse mes tendances marketing',
            'Génère un brief Canva pour un Reel',
          ].map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setInput(ex)}
              className="rounded-full border border-dashed px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}
      <form onSubmit={send} className={`flex gap-2 border-t ${compact ? 'p-2' : 'p-4'}`}>
        <Textarea
          rows={2}
          placeholder="Demande à l'assistant..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="resize-none"
        />
        <Button type="submit" variant="brand" disabled={loading || !input.trim()} aria-label="Envoyer">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

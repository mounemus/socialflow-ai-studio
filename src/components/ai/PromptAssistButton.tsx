'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Wand2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type PromptKind = 'text' | 'image' | 'carousel' | 'video' | 'canva';

/**
 * Bouton d'assistance à la rédaction de prompt.
 *
 * Un prompt vague produit un résultat vague : ce bouton transforme l'intention
 * brute en prompt exploitable, enrichi du contexte de la marque (ton, audience,
 * style visuel, couleurs). Le texte retourné remplace le champ, et l'ancien
 * contenu reste récupérable via le bouton « Annuler ».
 *
 * Aucune invention côté client : si le fournisseur ne renvoie rien, on le dit.
 */
export function PromptAssistButton({
  kind,
  draft,
  brandId,
  platform,
  format,
  onResult,
  label = 'Rédiger avec l’IA',
  size = 'sm',
}: {
  kind: PromptKind;
  draft?: string;
  brandId?: string;
  platform?: string;
  format?: string;
  onResult: (prompt: string) => void;
  label?: string;
  size?: 'sm' | 'default';
}) {
  const [busy, setBusy] = useState(false);
  const [previous, setPrevious] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch('/api/ai/assist-prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, draft, brandId, platform, format }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { ok?: boolean; prompt?: string; reason?: string; mocked?: boolean };
        message?: string;
      };
      if (!res.ok) throw new Error(json.message ?? `Erreur ${res.status}`);
      const d = json.data;
      if (!d?.ok || !d.prompt) {
        toast.error(`Assistance indisponible — ${d?.reason ?? 'aucun texte renvoyé'}`);
        return;
      }
      setPrevious(draft ?? '');
      onResult(d.prompt);
      toast.success(
        d.mocked ? 'Prompt SIMULÉ (aucun fournisseur réel disponible)' : 'Prompt rédigé par l’IA',
      );
    } catch (err) {
      toast.error(`Assistance échouée : ${(err as Error).message.slice(0, 120)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" size={size} onClick={run} disabled={busy}>
        {busy ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Wand2 className="mr-1 h-3.5 w-3.5" />
        )}
        {label}
      </Button>
      {previous !== null ? (
        <Button
          type="button"
          variant="ghost"
          size={size}
          onClick={() => {
            onResult(previous);
            setPrevious(null);
          }}
          disabled={busy}
        >
          Annuler
        </Button>
      ) : null}
    </div>
  );
}

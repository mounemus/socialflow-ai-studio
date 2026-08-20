'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Bold, BookmarkPlus, Eraser, Italic, List, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { sanitizeSocialText, toUnicodeBold, toUnicodeItalic } from '@/lib/social-text';

/** Émojis les plus utiles en rédaction sociale — insérés au curseur. */
const EMOJIS = ['✨', '🚀', '💡', '✅', '👉', '🔥', '📣', '❤️'];

interface SocialTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  /** Action IA « Améliorer le texte » fournie par l'appelant — bouton affiché seulement si présent. */
  onImprove?: () => Promise<void> | void;
  improving?: boolean;
}

/**
 * Textarea + barre d'outils de rédaction sociale.
 *
 * Les réseaux (LinkedIn, Instagram…) ne rendent que du texte brut : la « mise
 * en forme » passe donc par l'Unicode (𝗴𝗿𝗮𝘀 / 𝘪𝘵𝘢𝘭𝘪𝘲𝘶𝘦), les puces
 * typographiques, les émojis, et « Nettoyer » retire le markdown résiduel.
 */
// Snippets d'organisation partagés entre toutes les instances de l'éditeur —
// un seul fetch par chargement de page, pas un par textarea.
let snippetsCache: Array<{ label: string; text: string }> | null = null;

export function SocialTextEditor({
  value,
  onChange,
  rows = 10,
  placeholder,
  id,
  disabled,
  onImprove,
  improving,
}: SocialTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Snippets réutilisables (signature, CTA, mentions…) — API /api/org/snippets.
  const [snippets, setSnippets] = useState<Array<{ label: string; text: string }>>(snippetsCache ?? []);
  useEffect(() => {
    if (snippetsCache) return;
    fetch('/api/org/snippets')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        snippetsCache = (j?.data?.snippets ?? []) as Array<{ label: string; text: string }>;
        setSnippets(snippetsCache);
      })
      .catch(() => {});
  }, []);

  const saveSnippet = useCallback(async () => {
    const el = ref.current;
    const sel = el ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
    if (!sel.trim()) return toast.error('Sélectionne d’abord le texte à enregistrer comme snippet.');
    const label = window.prompt('Nom du snippet :', sel.slice(0, 30));
    if (!label?.trim()) return;
    const next = [...(snippetsCache ?? []), { label: label.trim().slice(0, 60), text: sel }];
    const res = await fetch('/api/org/snippets', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snippets: next }),
    }).catch(() => null);
    if (!res?.ok) return toast.error('Enregistrement du snippet impossible.');
    snippetsCache = next;
    setSnippets(next);
    toast.success(`Snippet « ${label.trim()} » enregistré — disponible dans tous les éditeurs.`);
  }, []);

  /** Applique le nouveau texte et restaure focus + sélection dans le textarea. */
  const apply = useCallback(
    (next: string, selStart: number, selEnd: number) => {
      onChange(next);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (el) {
          el.focus();
          el.setSelectionRange(selStart, selEnd);
        }
      });
    },
    [onChange],
  );

  const transformSelection = useCallback(
    (fn: (s: string) => string) => {
      const el = ref.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start === end) {
        toast.error('Sélectionnez d’abord le texte à mettre en forme.');
        return;
      }
      const replaced = fn(el.value.slice(start, end));
      apply(el.value.slice(0, start) + replaced + el.value.slice(end), start, start + replaced.length);
    },
    [apply],
  );

  const insertAtCursor = useCallback(
    (text: string) => {
      const el = ref.current;
      const val = el ? el.value : value;
      const pos = el ? el.selectionEnd : val.length;
      apply(val.slice(0, pos) + text + val.slice(pos), pos + text.length, pos + text.length);
    },
    [apply, value],
  );

  /** Insère « • » au début de la ligne du curseur. */
  const insertBullet = useCallback(() => {
    const el = ref.current;
    const val = el ? el.value : value;
    const pos = el ? el.selectionStart : val.length;
    const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
    apply(val.slice(0, lineStart) + '• ' + val.slice(lineStart), pos + 2, pos + 2);
  }, [apply, value]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 rounded-md border bg-slate-50 px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          title="Gras (sélection)"
          disabled={disabled}
          onClick={() => transformSelection(toUnicodeBold)}
        >
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          title="Italique (sélection)"
          disabled={disabled}
          onClick={() => transformSelection(toUnicodeItalic)}
        >
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          title="Puce en début de ligne"
          disabled={disabled}
          onClick={insertBullet}
        >
          <List className="h-3.5 w-3.5" />
        </Button>
        <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            className="rounded px-1 text-sm leading-6 hover:bg-slate-200"
            title={`Insérer ${e}`}
            disabled={disabled}
            onClick={() => insertAtCursor(e)}
          >
            {e}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
        {/* Snippets réutilisables : insérer au curseur / enregistrer la sélection. */}
        {snippets.length > 0 ? (
          <select
            className="h-7 max-w-[140px] rounded border bg-white px-1 text-xs text-slate-600"
            value=""
            disabled={disabled}
            title="Insérer un snippet"
            onChange={(e) => {
              const s = snippets.find((x) => x.label === e.target.value);
              if (s) insertAtCursor(s.text);
            }}
          >
            <option value="">Snippets…</option>
            {snippets.map((s) => (
              <option key={s.label} value={s.label}>{s.label}</option>
            ))}
          </select>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          title="Enregistrer la sélection comme snippet réutilisable"
          disabled={disabled}
          onClick={saveSnippet}
        >
          <BookmarkPlus className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          title="Retirer le markdown et l’échafaudage IA"
          onClick={() => onChange(sanitizeSocialText(value))}
          disabled={disabled || !value.trim()}
        >
          <Eraser className="mr-1 h-3.5 w-3.5" /> Nettoyer
        </Button>
        {onImprove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={onImprove}
            disabled={disabled || improving || !value.trim()}
          >
            {improving ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3.5 w-3.5" />
            )}
            Améliorer le texte
          </Button>
        ) : null}
      </div>

      <Textarea
        ref={ref}
        id={id}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

'use client';

import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Bold, Eraser, Italic, List, Loader2, Sparkles } from 'lucide-react';
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

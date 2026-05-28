'use client';
import { useState } from 'react';
import { Type, ImagePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TextStudio } from './TextStudio';
import { ImageStudio } from './ImageStudio';

type Tab = 'text' | 'image';

export default function AiStudioPage() {
  const [tab, setTab] = useState<Tab>('text');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Studio IA</h1>
        <p className="text-sm text-muted-foreground">
          Génère du contenu (texte + images) adapté à ta marque, plateforme et format.
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {[
          { id: 'text' as const, label: 'Texte', icon: Type, hint: 'Posts, captions, scripts' },
          { id: 'image' as const, label: 'Image', icon: ImagePlus, hint: 'Visuels IA — FLUX, Stability' },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                active
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              <span className="text-[10px] text-muted-foreground">— {t.hint}</span>
            </button>
          );
        })}
      </div>

      {tab === 'text' ? <TextStudio /> : <ImageStudio />}
    </div>
  );
}

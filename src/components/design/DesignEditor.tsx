'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  X, Type, Plus, Trash2, Download, Check, Loader2, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9';

const DIMS: Record<AspectRatio, { w: number; h: number }> = {
  '1:1': { w: 1080, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
};

interface TextLayer {
  id: string;
  text: string;
  x: number; // 0..1 (center)
  y: number; // 0..1 (center)
  size: number; // px at export resolution
  color: string;
  font: string;
  bold: boolean;
  align: CanvasTextAlign;
}

const FONTS = ['Arial', 'Georgia', 'Impact', 'Verdana', 'Times New Roman', 'Courier New'];

interface FilterState {
  brightness: number; contrast: number; saturate: number; grayscale: number; blur: number;
}
const DEFAULT_FILTERS: FilterState = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, blur: 0 };

export function DesignEditor({
  imageUrl,
  aspect,
  onExport,
  onClose,
}: {
  imageUrl: string;
  aspect: AspectRatio;
  onExport: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [texts, setTexts] = useState<TextLayer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const dragRef = useRef<{ id: string } | null>(null);
  const dims = DIMS[aspect];

  // Load image (proxy remote URLs to avoid canvas taint on export)
  useEffect(() => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const src = imageUrl.startsWith('data:')
      ? imageUrl
      : `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
    image.onload = () => { setImg(image); setLoadError(false); };
    image.onerror = () => setLoadError(true);
    image.src = src;
  }, [imageUrl]);

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = dims.w;
    canvas.height = dims.h;
    ctx.clearRect(0, 0, dims.w, dims.h);

    if (img) {
      ctx.filter = `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturate}%) grayscale(${filters.grayscale}%) blur(${filters.blur}px)`;
      // cover-fit
      const ir = img.width / img.height;
      const cr = dims.w / dims.h;
      let dw = dims.w, dh = dims.h, dx = 0, dy = 0;
      if (ir > cr) { dh = dims.h; dw = dh * ir; dx = (dims.w - dw) / 2; }
      else { dw = dims.w; dh = dw / ir; dy = (dims.h - dh) / 2; }
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.filter = 'none';
    } else {
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(0, 0, dims.w, dims.h);
    }

    for (const t of texts) {
      ctx.font = `${t.bold ? 'bold ' : ''}${t.size}px ${t.font}`;
      ctx.fillStyle = t.color;
      ctx.textAlign = t.align;
      ctx.textBaseline = 'middle';
      // subtle shadow for readability
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = t.size * 0.12;
      const lines = t.text.split('\n');
      const lineH = t.size * 1.15;
      lines.forEach((line, i) => {
        ctx.fillText(line, t.x * dims.w, t.y * dims.h + (i - (lines.length - 1) / 2) * lineH);
      });
      ctx.shadowBlur = 0;
    }
  }, [img, filters, texts, dims]);

  useEffect(() => { draw(); }, [draw]);

  const selected = texts.find((t) => t.id === selectedId) ?? null;

  function addText() {
    const id = `t_${texts.length}_${texts.reduce((s, t) => s + t.text.length, 0)}`;
    setTexts((p) => [...p, { id, text: 'Ton texte', x: 0.5, y: 0.5, size: Math.round(dims.w * 0.08), color: '#ffffff', font: 'Arial', bold: true, align: 'center' }]);
    setSelectedId(id);
  }
  function patchSelected(patch: Partial<TextLayer>) {
    if (!selectedId) return;
    setTexts((p) => p.map((t) => (t.id === selectedId ? { ...t, ...patch } : t)));
  }
  function removeSelected() {
    if (!selectedId) return;
    setTexts((p) => p.filter((t) => t.id !== selectedId));
    setSelectedId(null);
  }

  // Drag text on canvas
  function canvasPos(e: React.MouseEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }
  function onDown(e: React.MouseEvent) {
    const { x, y } = canvasPos(e);
    // pick nearest text within range
    let best: { id: string; d: number } | null = null;
    for (const t of texts) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < 0.12 && (!best || d < best.d)) best = { id: t.id, d };
    }
    if (best) { setSelectedId(best.id); dragRef.current = { id: best.id }; }
  }
  function onMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const { x, y } = canvasPos(e);
    setTexts((p) => p.map((t) => (t.id === dragRef.current!.id ? { ...t, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : t)));
  }
  function onUp() { dragRef.current = null; }

  function exportPng() {
    setExporting(true);
    try {
      draw();
      const canvas = canvasRef.current!;
      const dataUrl = canvas.toDataURL('image/png');
      onExport(dataUrl);
      toast.success('Design exporté — appliqué comme visuel.');
      onClose();
    } catch {
      toast.error('Export impossible (image protégée). Réessaie avec une image générée par l\'app.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseUp={onUp}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-semibold"><Type className="h-4 w-4 text-fuchsia-600" /> Éditeur de design</div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[1fr_300px]">
          {/* canvas */}
          <div className="flex items-center justify-center rounded-lg bg-slate-100 p-3">
            {loadError ? (
              <div className="text-center text-sm text-rose-600">Image non chargée (CORS). Utilise un visuel généré par l&apos;app.</div>
            ) : (
              <canvas
                ref={canvasRef}
                onMouseDown={onDown}
                onMouseMove={onMove}
                className="max-h-[60vh] w-auto cursor-move rounded-md border bg-white shadow-sm"
                style={{ aspectRatio: aspect.replace(':', '/') }}
              />
            )}
          </div>

          {/* controls */}
          <div className="space-y-4">
            {/* filters */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Filtres</Label>
                <button onClick={() => setFilters(DEFAULT_FILTERS)} className="text-[10px] text-slate-500 hover:text-slate-800"><RotateCcw className="mr-0.5 inline h-3 w-3" />Reset</button>
              </div>
              {([
                ['brightness', 'Luminosité', 0, 200],
                ['contrast', 'Contraste', 0, 200],
                ['saturate', 'Saturation', 0, 200],
                ['grayscale', 'N&B', 0, 100],
                ['blur', 'Flou', 0, 20],
              ] as const).map(([key, label, min, max]) => (
                <div key={key}>
                  <div className="flex justify-between text-[11px] text-slate-600"><span>{label}</span><span>{filters[key]}</span></div>
                  <input type="range" min={min} max={max} value={filters[key]} onChange={(e) => setFilters((f) => ({ ...f, [key]: Number(e.target.value) }))} className="w-full" />
                </div>
              ))}
            </div>

            {/* text */}
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Texte</Label>
                <Button variant="outline" size="sm" onClick={addText}><Plus className="mr-1 h-3 w-3" /> Ajouter</Button>
              </div>
              {texts.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {texts.map((t) => (
                    <button key={t.id} onClick={() => setSelectedId(t.id)} className={`rounded border px-2 py-0.5 text-[10px] ${selectedId === t.id ? 'border-fuchsia-400 bg-fuchsia-50' : 'border-slate-200'}`}>{t.text.slice(0, 12) || '(vide)'}</button>
                  ))}
                </div>
              ) : <p className="text-[11px] text-muted-foreground">Aucun texte. Clique « Ajouter ».</p>}

              {selected ? (
                <div className="space-y-2 rounded-md border bg-slate-50 p-2">
                  <textarea value={selected.text} onChange={(e) => patchSelected({ text: e.target.value })} rows={2} className="w-full rounded border px-2 py-1 text-xs" />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px]">Police</Label>
                      <select value={selected.font} onChange={(e) => patchSelected({ font: e.target.value })} className="w-full rounded border px-1 py-1 text-xs">
                        {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-[10px]">Couleur</Label>
                      <input type="color" value={selected.color} onChange={(e) => patchSelected({ color: e.target.value })} className="h-7 w-full rounded border" />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-600"><span>Taille</span><span>{selected.size}</span></div>
                    <input type="range" min={20} max={Math.round(dims.w * 0.25)} value={selected.size} onChange={(e) => patchSelected({ size: Number(e.target.value) })} className="w-full" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={selected.bold} onChange={(e) => patchSelected({ bold: e.target.checked })} /> Gras</label>
                    <select value={selected.align} onChange={(e) => patchSelected({ align: e.target.value as CanvasTextAlign })} className="rounded border px-1 py-0.5 text-[11px]">
                      <option value="left">Gauche</option><option value="center">Centre</option><option value="right">Droite</option>
                    </select>
                    <Button variant="ghost" size="sm" onClick={removeSelected} className="ml-auto text-rose-600"><Trash2 className="h-3 w-3" /></Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Astuce : glisse le texte directement sur l&apos;image pour le positionner.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t px-4 py-3">
          <span className="text-[11px] text-muted-foreground">{dims.w}×{dims.h}px · {aspect}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
            <Button variant="brand" size="sm" onClick={exportPng} disabled={exporting || loadError || !img}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Appliquer le design
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

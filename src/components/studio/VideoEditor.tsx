'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Scissors, Plus, Trash2, Download, Save, Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiErrorMessage } from '@/lib/client-api-error';
import { uploadBlob } from '@/lib/client-upload';

interface Cue {
  start: number;
  end: number;
  text: string;
}

interface VideoMeta {
  trimStart?: number;
  trimEnd?: number;
  subtitles?: Cue[];
}

function fmtSrtTime(sec: number): string {
  const ms = Math.round((sec % 1) * 1000);
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function toSrt(cues: Cue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${fmtSrtTime(c.start)} --> ${fmtSrtTime(c.end)}\n${c.text}\n`)
    .join('\n');
}

export function VideoEditor({
  postId,
  brandId,
  videoUrl,
  metadata,
  onChanged,
}: {
  postId: string;
  brandId?: string | null;
  videoUrl: string;
  metadata: Record<string, unknown> | null;
  onChanged?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const initialVideo = ((metadata?.video as VideoMeta | undefined) ?? {});

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState<string>(initialVideo.trimStart?.toString() ?? '');
  const [trimEnd, setTrimEnd] = useState<string>(initialVideo.trimEnd?.toString() ?? '');
  const [subtitles, setSubtitles] = useState<Cue[]>(initialVideo.subtitles ?? []);
  const [playingSelection, setPlayingSelection] = useState(false);
  const [savingTrim, setSavingTrim] = useState(false);
  const [savingSubs, setSavingSubs] = useState(false);
  const [clipping, setClipping] = useState(false);
  const [clipProgress, setClipProgress] = useState<number | null>(null);

  const start = trimStart === '' ? null : Number(trimStart);
  const end = trimEnd === '' ? null : Number(trimEnd);

  const activeCue = subtitles.find((c) => currentTime >= c.start && currentTime <= c.end);

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    if (playingSelection && end !== null && v.currentTime >= end) {
      v.pause();
      setPlayingSelection(false);
    }
  }, [playingSelection, end]);

  function playSelection() {
    const v = videoRef.current;
    if (!v || start === null || end === null || end <= start) return;
    v.currentTime = start;
    setPlayingSelection(true);
    v.play();
  }

  async function saveTrim() {
    setSavingTrim(true);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          metadata: { video: { trimStart: start ?? undefined, trimEnd: end ?? undefined, subtitles } },
        }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      toast.success('Repères de découpe enregistrés');
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 160));
    } finally {
      setSavingTrim(false);
    }
  }

  async function saveSubtitles() {
    setSavingSubs(true);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          metadata: { video: { trimStart: start ?? undefined, trimEnd: end ?? undefined, subtitles } },
        }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      toast.success('Sous-titres enregistrés');
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 160));
    } finally {
      setSavingSubs(false);
    }
  }

  function addCue() {
    const t = Math.round(currentTime * 10) / 10;
    setSubtitles((s) => [...s, { start: t, end: Math.round((t + 2) * 10) / 10, text: '' }]);
  }

  function updateCue(idx: number, patch: Partial<Cue>) {
    setSubtitles((s) => s.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function removeCue(idx: number) {
    setSubtitles((s) => s.filter((_, i) => i !== idx));
  }

  function downloadSrt() {
    const blob = new Blob([toSrt(subtitles)], { type: 'application/x-subrip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sous-titres-${postId}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleClip() {
    if (start === null || end === null || end <= start) return;
    setClipping(true);
    setClipProgress(null);
    try {
      const srcRes = await fetch(videoUrl);
      if (!srcRes.ok) {
        throw new Error("Impossible de récupérer la vidéo source (CORS ou accès refusé). La découpe nécessite que la vidéo soit accessible depuis le navigateur.");
      }
      const srcBlob = await srcRes.blob();

      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL, fetchFile } = await import('@ffmpeg/util');
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress }) => {
        if (Number.isFinite(progress)) setClipProgress(Math.max(0, Math.min(100, Math.round(progress * 100))));
      });

      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      await ffmpeg.writeFile('in.mp4', await fetchFile(srcBlob));
      await ffmpeg.exec(['-ss', String(start), '-to', String(end), '-i', 'in.mp4', '-c', 'copy', 'out.mp4']);
      const data = await ffmpeg.readFile('out.mp4');
      const outBlob = new Blob([data as BlobPart], { type: 'video/mp4' });

      const uploaded = await uploadBlob({
        blob: outBlob,
        filename: `clip-${Date.now()}.mp4`,
        contentType: 'video/mp4',
        brandId,
      });
      if (!uploaded) throw new Error('Échec upload du clip');

      const attachRes = await fetch(`/api/posts/${postId}/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mediaId: uploaded.id, replace: false }),
      });
      if (!attachRes.ok) throw new Error(await apiErrorMessage(attachRes));

      toast.success('Clip créé et attaché à la publication');
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message.slice(0, 200));
    } finally {
      setClipping(false);
      setClipProgress(null);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="relative">
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          crossOrigin="anonymous"
          className="w-full rounded-md bg-black"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={onTimeUpdate}
        />
        {activeCue ? (
          <div className="pointer-events-none absolute bottom-4 left-1/2 max-w-[90%] -translate-x-1/2 rounded bg-black/70 px-2 py-1 text-center text-sm text-white">
            {activeCue.text}
          </div>
        ) : null}
      </div>

      {duration > 0 ? (
        <p className="text-xs text-muted-foreground">Durée : {duration.toFixed(1)} s · Position : {currentTime.toFixed(1)} s</p>
      ) : null}

      {/* A. Trim */}
      <div className="space-y-2 border-t pt-3">
        <p className="text-sm font-medium">Découpe</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-muted-foreground">Début (s)</label>
            <Input type="number" step="0.1" min="0" value={trimStart} onChange={(e) => setTrimStart(e.target.value)} className="w-28" />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setTrimStart(currentTime.toFixed(1))}>
            Prendre la position actuelle
          </Button>
          <div>
            <label className="block text-xs text-muted-foreground">Fin (s)</label>
            <Input type="number" step="0.1" min="0" value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} className="w-28" />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setTrimEnd(currentTime.toFixed(1))}>
            Prendre la position actuelle
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={playSelection} disabled={start === null || end === null || end <= start}>
            <Play className="mr-1 h-3.5 w-3.5" /> Lire la sélection
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={saveTrim} disabled={savingTrim}>
            {savingTrim ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            Enregistrer les repères
          </Button>
          <Button type="button" size="sm" variant="brand" onClick={handleClip} disabled={clipping || start === null || end === null || end <= start}>
            {clipping ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Scissors className="mr-1 h-3.5 w-3.5" />}
            {clipping ? (clipProgress !== null ? `Découpe en cours — ${clipProgress}%` : 'Découpe en cours — peut prendre une minute') : 'Découper la vidéo (créer un clip)'}
          </Button>
        </div>
      </div>

      {/* C. Subtitles */}
      <div className="space-y-2 border-t pt-3">
        <p className="text-sm font-medium">Sous-titres</p>
        <div className="space-y-1.5">
          {subtitles.map((c, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <Input type="number" step="0.1" min="0" value={c.start} onChange={(e) => updateCue(idx, { start: Number(e.target.value) })} className="w-20" />
              <span className="text-xs text-muted-foreground">→</span>
              <Input type="number" step="0.1" min="0" value={c.end} onChange={(e) => updateCue(idx, { end: Number(e.target.value) })} className="w-20" />
              <Input type="text" value={c.text} onChange={(e) => updateCue(idx, { text: e.target.value })} placeholder="Texte du sous-titre" className="flex-1" />
              <Button type="button" variant="ghost" size="icon" onClick={() => removeCue(idx)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addCue}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Ajouter un sous-titre
          </Button>
          <Button type="button" size="sm" onClick={saveSubtitles} disabled={savingSubs}>
            {savingSubs ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            Enregistrer les sous-titres
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={downloadSrt} disabled={subtitles.length === 0}>
            <Download className="mr-1 h-3.5 w-3.5" /> Télécharger .srt
          </Button>
        </div>
      </div>

      <p className="border-t pt-3 text-xs text-muted-foreground">
        La découpe crée un nouveau clip (sans ré-encodage). Les sous-titres sont enregistrés avec la publication et exportables en .srt — l&apos;incrustation dans la vidéo viendra ensuite.
      </p>
    </div>
  );
}

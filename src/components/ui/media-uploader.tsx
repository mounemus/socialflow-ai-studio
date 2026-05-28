'use client';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { UploadCloud, X, FileImage, FileVideo, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface UploadedMedia {
  id?: string;     // DB id once recorded
  url: string;
  path?: string;
  filename: string;
  contentType?: string;
  sizeBytes?: number;
}

type UploadState =
  | { status: 'pending'; file: File }
  | { status: 'signing'; file: File; progress: 0 }
  | { status: 'uploading'; file: File; progress: number }
  | { status: 'saving'; file: File; url: string; path: string }
  | { status: 'done'; result: UploadedMedia }
  | { status: 'error'; file: File; error: string };

export function MediaUploader({
  brandId,
  onUploaded,
  accept = 'image/*,video/*,application/pdf',
  multiple = true,
  maxSizeMB = 25,
  className,
}: {
  brandId?: string;
  onUploaded?: (media: UploadedMedia) => void;
  accept?: string;
  multiple?: boolean;
  maxSizeMB?: number;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const updateAt = useCallback((idx: number, next: UploadState) => {
    setUploads((u) => u.map((x, i) => (i === idx ? next : x)));
  }, []);

  const startUpload = useCallback(async (file: File, idx: number) => {
    if (file.size > maxSizeMB * 1024 * 1024) {
      updateAt(idx, { status: 'error', file, error: `Trop gros (max ${maxSizeMB}MB)` });
      return;
    }

    // 1. Get signed URL
    updateAt(idx, { status: 'signing', file, progress: 0 });
    const signRes = await fetch('/api/media/sign-upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      }),
    });
    if (!signRes.ok) {
      updateAt(idx, { status: 'error', file, error: 'Échec signing' });
      return;
    }
    const { data: sign } = await signRes.json();
    if (!sign.configured) {
      updateAt(idx, { status: 'error', file, error: sign.reason ?? 'Storage non configuré' });
      return;
    }
    if (sign.error) {
      updateAt(idx, { status: 'error', file, error: sign.error });
      return;
    }

    // 2. Upload directly to Supabase Storage via signed URL
    updateAt(idx, { status: 'uploading', file, progress: 5 });
    const uploadRes = await fetch(sign.signedUrl, {
      method: 'PUT',
      headers: { 'content-type': file.type, 'x-upsert': 'true' },
      body: file,
    });
    if (!uploadRes.ok) {
      updateAt(idx, { status: 'error', file, error: `Upload failed (${uploadRes.status})` });
      return;
    }

    // 3. Record MediaAsset in our DB
    updateAt(idx, { status: 'saving', file, url: sign.publicUrl, path: sign.path });
    const kind = file.type.startsWith('image/') ? 'IMAGE' : file.type.startsWith('video/') ? 'VIDEO' : file.type.startsWith('audio/') ? 'AUDIO' : 'DOCUMENT';
    const saveRes = await fetch('/api/media', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: sign.publicUrl,
        brandId,
        kind,
        mimeType: file.type,
        source: 'upload',
      }),
    });
    if (!saveRes.ok) {
      updateAt(idx, { status: 'error', file, error: 'Échec enregistrement DB' });
      return;
    }
    const { data: saved } = await saveRes.json();
    const result: UploadedMedia = {
      id: saved.id,
      url: sign.publicUrl,
      path: sign.path,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    };
    updateAt(idx, { status: 'done', result });
    onUploaded?.(result);
    toast.success(`${file.name} importé`);
  }, [brandId, maxSizeMB, onUploaded, updateAt]);

  const enqueueFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    setUploads((u) => {
      const startIdx = u.length;
      arr.forEach((file, i) => startUpload(file, startIdx + i));
      return [...u, ...arr.map((file) => ({ status: 'pending' as const, file }))];
    });
  }, [startUpload]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) enqueueFiles(e.dataTransfer.files);
  }, [enqueueFiles]);

  const onSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) enqueueFiles(e.target.files);
    e.target.value = '';
  }, [enqueueFiles]);

  function clear(idx: number) {
    setUploads((u) => u.filter((_, i) => i !== idx));
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors',
          dragOver ? 'border-brand-600 bg-brand-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50',
        )}
      >
        <UploadCloud className="mb-2 h-8 w-8 text-slate-400" />
        <p className="text-sm font-medium">Glisser-déposer ou cliquer pour importer</p>
        <p className="text-xs text-muted-foreground">Images, vidéos, PDFs · max {maxSizeMB}MB · {multiple ? 'multiple' : 'un fichier'}</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={onSelect}
          className="hidden"
        />
      </div>

      {uploads.length > 0 ? (
        <ul className="space-y-1.5">
          {uploads.map((u, idx) => {
            const file = 'file' in u ? u.file : null;
            const FileIcon = file?.type.startsWith('video/') ? FileVideo : FileImage;
            return (
              <li key={idx} className="flex items-center gap-2 rounded-lg border p-2 text-xs">
                <FileIcon className="h-4 w-4 shrink-0 text-slate-500" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{file?.name ?? ('result' in u ? u.result.filename : '?')}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {u.status === 'pending' && 'En attente…'}
                    {u.status === 'signing' && 'Signature URL…'}
                    {u.status === 'uploading' && 'Upload en cours…'}
                    {u.status === 'saving' && 'Enregistrement…'}
                    {u.status === 'done' && '✓ Importé'}
                    {u.status === 'error' && `❌ ${u.error}`}
                  </div>
                </div>
                {u.status === 'done' ? <Check className="h-4 w-4 text-emerald-600" /> :
                  u.status === 'error' ? null :
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                <button type="button" onClick={() => clear(idx)} className="rounded p-1 hover:bg-slate-100">
                  <X className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

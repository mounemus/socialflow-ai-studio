'use client';

/**
 * Campagnes de diffusion — emailing (Resend, réel) et messagerie des réseaux
 * connectés (réponse aux conversations existantes de l'inbox ; un contact sans
 * conversation est ignoré avec motif — jamais de faux « envoyé »).
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SocialTextEditor } from '@/components/ui/social-text-editor';
import { MediaUploader, type UploadedMedia } from '@/components/ui/media-uploader';
import { fixMojibake } from '@/lib/text-encoding';
import { useRef } from 'react';
import { Mail, MessageCircle, Send, RefreshCw, CheckCircle2, FileCode2, Eye, Paperclip, X, Pencil, Trash2, Sparkles, Loader2, Bold, Italic, Underline, List, Link2, Undo2, Baseline, Shapes } from 'lucide-react';

// Bibliothèque d'icônes UbSkilled — glyphes unicode monochromes en présentation
// texte (U+FE0E), teintés bleu marque via style inline (survit aux clients mail).
const UB_ICON_COLOR = '#0052CC';
const UB_ICON_STYLE = `color:${UB_ICON_COLOR};font-family:Inter,'Segoe UI Symbol','Noto Sans Symbols 2','Apple Symbols',sans-serif;font-weight:500;font-style:normal;`;
const UB_ICONS: Array<{ ch: string; label: string }> = [
  { ch: '✎︎', label: 'Design graphique' },
  { ch: '▣︎', label: 'UI/UX · Photoshop' },
  { ch: '◇︎', label: '3D · Fusion 360' },
  { ch: '✦︎', label: 'Intelligence artificielle' },
  { ch: '⚙︎', label: 'Robotique · Automatisation' },
  { ch: '⌨︎', label: 'Développement web' },
  { ch: '▦︎', label: 'Design system · Parcours' },
  { ch: '✒︎', label: 'Illustrator' },
  { ch: '⊞︎', label: 'Canva · Figma' },
  { ch: '◎︎', label: 'Parcours UX' },
  { ch: '◉︎', label: 'Prototypage · Tests' },
  { ch: '◈︎', label: 'Impression 3D' },
  { ch: '○︎', label: 'Blender' },
  { ch: '≋︎', label: 'Scan 3D · IoT' },
  { ch: '✶︎', label: 'Découpe laser' },
  { ch: '✧︎', label: 'Midjourney' },
  { ch: '◌︎', label: 'ChatGPT' },
  { ch: '⊙︎', label: 'Arduino' },
  { ch: '⌘︎', label: 'Électronique' },
  { ch: '▤︎', label: 'WordPress' },
  { ch: 'ϟ︎', label: 'JavaScript' },
];

type RecipientStatus = 'PENDING' | 'SENT' | 'SIMULATED' | 'FAILED' | 'SKIPPED';
type Outreach = {
  id: string;
  channel: 'EMAIL' | 'SOCIAL_DM';
  platform: string | null;
  name: string;
  subject: string | null;
  status: string;
  createdAt: string;
  brand: { name: string } | null;
  recipients: { status: RecipientStatus }[];
};
type Contact = { handle: string; name: string | null; platform: string; interactionId: string };

const DM_PLATFORMS = ['INSTAGRAM', 'FACEBOOK', 'LINKEDIN'];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Brouillon', SENDING: 'Envoi…', SENT: 'Envoyée', PARTIAL: 'Partielle', FAILED: 'Échec',
};
const RECIPIENT_LABEL: Record<RecipientStatus, string> = {
  PENDING: 'en attente', SENT: 'envoyé', SIMULATED: 'simulé', FAILED: 'échec', SKIPPED: 'ignoré',
};

export function OutreachClient() {
  const [items, setItems] = useState<Outreach[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [gmail, setGmail] = useState<{ connected: boolean; email: string | null; configured: boolean }>({
    connected: false, email: null, configured: false,
  });
  const [channel, setChannel] = useState<'EMAIL' | 'SOCIAL_DM'>('EMAIL');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [emails, setEmails] = useState('');
  const [platform, setPlatform] = useState('INSTAGRAM');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [attachments, setAttachments] = useState<UploadedMedia[]>([]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [aiBrief, setAiBrief] = useState('');
  const [generating, setGenerating] = useState(false);
  const [improving, setImproving] = useState(false);
  // Édition du HTML : mode « Visuel » (iframe éditable) ou « Code HTML ».
  // visualBase = HTML monté dans l'iframe (figé pour ne pas perdre le curseur),
  // visualKey force un remontage quand le HTML change hors de l'iframe.
  const [htmlView, setHtmlView] = useState<'visual' | 'code'>('visual');
  const [visualBase, setVisualBase] = useState('');
  const [visualKey, setVisualKey] = useState(0);
  const [showIcons, setShowIcons] = useState(false);
  const htmlFileRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const bodyIsHtml = /^\s*(<!doctype|<html|<head|<body|<table|<div)/i.test(body);

  function openVisual(html: string) {
    setVisualBase(html);
    setVisualKey((k) => k + 1);
    setHtmlView('visual');
  }

  async function importHtmlFile(file: File) {
    // Décodage robuste : UTF-8, repli Windows-1252 (fichier « ANSI »), puis
    // réparation mojibake (Ã©, â€"…) — plus de « livrÃ© dans vos Ã©coles ».
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
    text = fixMojibake(text);
    const title = /<title>([^<]*)<\/title>/i.exec(text)?.[1]?.trim();
    setBody(text);
    if (title && !subject) setSubject(title);
    if (!name) setName(file.name.replace(/\.html?$/i, ''));
    openVisual(text);
    // Les chemins relatifs ne s'affichent pas dans un email — il faut des URLs absolues.
    if (/src=["'](?!https?:|data:|cid:)/i.test(text)) {
      toast.warning(
        'Ce HTML référence des images en chemin relatif (ex. images/…). Héberge-les (Bibliothèque) puis remplace les src par leurs URLs publiques, sinon elles n’apparaîtront pas.',
        { duration: 15000 },
      );
    }
    toast.success(`${file.name} importé — corps HTML détecté, il sera envoyé tel quel.`);
  }

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach');
      const json = await res.json();
      if (res.ok) {
        setItems(json.data.items ?? []);
        setEmailConfigured(json.data.emailConfigured ?? false);
        if (json.data.gmail) setGmail(json.data.gmail);
      }
    } catch {
      /* liste indisponible — l'UI reste utilisable */
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  type DraftDetail = {
    id: string; channel: 'EMAIL' | 'SOCIAL_DM'; name: string; subject: string | null;
    body: string; status: string;
    attachments: { name: string; url: string; mimeType?: string; sizeBytes?: number }[];
    recipients: { email: string | null; status: RecipientStatus }[];
  };

  async function loadDraft(id: string) {
    try {
      const res = await fetch(`/api/outreach/${id}`);
      const json = await res.json();
      if (!res.ok || json?.data?.error) throw new Error(json?.data?.error ?? 'Chargement impossible');
      const d = json.data as DraftDetail;
      setChannel(d.channel);
      setName(d.name);
      setSubject(d.subject ?? '');
      setBody(d.body);
      setEmails(d.recipients.filter((r) => r.email && r.status === 'PENDING').map((r) => r.email as string).join('\n'));
      setAttachments((d.attachments ?? []).map((a) => ({
        filename: a.name, url: a.url, contentType: a.mimeType ?? 'application/octet-stream', sizeBytes: a.sizeBytes ?? 0,
      })));
      setEditingId(d.id);
      if (/^\s*(<!doctype|<html|<head|<body|<table|<div)/i.test(d.body)) openVisual(d.body);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function resetForm() {
    setEditingId(null);
    setName(''); setSubject(''); setBody(''); setEmails(''); setSelected(new Set()); setAttachments([]);
  }

  async function deleteCampaign(id: string) {
    if (!window.confirm('Supprimer cette campagne ?')) return;
    try {
      const res = await fetch(`/api/outreach/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || json?.data?.error) throw new Error(json?.data?.error ?? 'Suppression impossible');
      if (editingId === id) resetForm();
      toast.success('Campagne supprimée.');
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function generateHtmlEmail() {
    const brief = aiBrief.trim() || subject.trim() || name.trim();
    if (!brief) {
      toast.error('Décris l’email à générer (brief), ou renseigne au moins l’objet.');
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch('/api/outreach/generate-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief, subject: subject || undefined }),
      });
      const json = await res.json();
      if (!res.ok || json?.data?.error) throw new Error(json?.data?.error ?? 'Génération impossible');
      const html = json.data.html as string;
      setBody(html);
      openVisual(html);
      toast.success(`Email HTML généré (${json.data.provider}) — clique dans l’aperçu pour modifier le texte.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  /** Réécriture IA du texte existant — même fond, meilleure forme (pas de hashtags). */
  async function improveText() {
    if (!body.trim()) return;
    setImproving(true);
    try {
      const res = await fetch('/api/ai/generate-post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          language: 'fr',
          prompt:
            'Améliore cet email professionnel (clarté, structure, ton chaleureux et crédible, vouvoiement) ' +
            'sans en changer le fond ni la langue. Pas de hashtags, pas de commentaire. ' +
            `Conserve les champs {{nom}} exactement tels quels :\n\n${body}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Amélioration impossible');
      const text = (json?.data?.text ?? '') as string;
      if (!text) throw new Error('Aucun texte renvoyé');
      setBody(text);
      toast.success('Texte amélioré — vérifie le résultat.');
    } catch (err) {
      toast.error((err as Error).message.slice(0, 140));
    } finally {
      setImproving(false);
    }
  }

  /** Iframe d'édition visuelle : le corps devient éditable, chaque saisie est
   * resérialisée dans `body` (sans laisser l'attribut contenteditable). */
  /** Resérialise le document de l'iframe dans `body` (sans contenteditable). */
  function syncVisual(doc: Document) {
    doc.body.removeAttribute('contenteditable');
    const html = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    doc.body.setAttribute('contenteditable', 'true');
    setBody(html);
  }

  function onVisualLoad(e: React.SyntheticEvent<HTMLIFrameElement>) {
    const doc = e.currentTarget.contentDocument;
    if (!doc?.body) return;
    doc.body.setAttribute('contenteditable', 'true');
    doc.body.style.outline = 'none';
    doc.addEventListener('input', () => syncVisual(doc));
  }

  /** Commande WYSIWYG sur la sélection courante de l'iframe. */
  function execVisual(cmd: string, value?: string) {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.execCommand(cmd, false, value);
    syncVisual(doc);
  }

  function insertUbIcon(ch: string, label: string) {
    execVisual('insertHTML', `<span title="${label}" style="${UB_ICON_STYLE}">${ch}</span>&nbsp;`);
    setShowIcons(false);
  }

  // Ouverture directe d'un brouillon (?edit=<id>) — ex. depuis la Prospection.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const edit = params.get('edit');
    if (!edit) return;
    void loadDraft(edit);
    params.delete('edit');
    window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retour du callback OAuth Google (?google=connected:email | message d'erreur).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const g = params.get('google');
    if (!g) return;
    if (g.startsWith('connected')) {
      const email = decodeURIComponent(g.split(':')[1] ?? '');
      toast.success(`Gmail connecté${email ? ` : ${email}` : ''} — les campagnes partiront de ce compte.`);
    } else {
      toast.error(`Connexion Google échouée : ${decodeURIComponent(g)}`);
    }
    params.delete('google');
    window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  }, []);

  useEffect(() => {
    if (channel !== 'SOCIAL_DM') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/outreach/contacts?platform=${platform}`);
        const json = await res.json();
        if (!cancelled && res.ok) setContacts(json.data.contacts ?? []);
      } catch {
        if (!cancelled) setContacts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [channel, platform]);

  function toggleContact(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function createCampaign() {
    if (!name.trim() || !body.trim()) {
      toast.error('Nom et message sont requis.');
      return;
    }
    setBusy(true);
    try {
      const payload =
        channel === 'EMAIL'
          ? {
              channel, name: fixMojibake(name),
              subject: subject ? fixMojibake(subject) : undefined,
              body: fixMojibake(body),
              emails: emails.split(/[\n,;]+/).map((e) => e.trim()).filter(Boolean),
              attachments: attachments.map((a) => ({ name: a.filename, url: a.url, mimeType: a.contentType, sizeBytes: a.sizeBytes })),
            }
          : {
              channel, name, body, platform,
              contacts: contacts
                .filter((c) => selected.has(c.interactionId))
                .map((c) => ({ handle: c.handle, name: c.name ?? undefined, interactionId: c.interactionId })),
            };
      const res = await fetch(editingId ? `/api/outreach/${editingId}` : '/api/outreach', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json?.data?.error) throw new Error(json?.data?.error ?? json?.message ?? 'Enregistrement impossible');
      toast.success(editingId ? 'Brouillon mis à jour.' : 'Campagne créée — prête à envoyer.');
      resetForm();
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendCampaign(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/outreach/${id}/send`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Envoi impossible');
      const d = json.data as { sent: number; simulated: number; failed: number; skipped: number };
      toast.success(
        `Envoi terminé : ${d.sent} envoyé(s), ${d.simulated} simulé(s), ${d.failed} échec(s), ${d.skipped} ignoré(s).`,
      );
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function counts(o: Outreach) {
    const c: Record<RecipientStatus, number> = { PENDING: 0, SENT: 0, SIMULATED: 0, FAILED: 0, SKIPPED: 0 };
    for (const r of o.recipients) c[r.status] = (c[r.status] ?? 0) + 1;
    return (Object.entries(c) as [RecipientStatus, number][])
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `${n} ${RECIPIENT_LABEL[s]}`)
      .join(' · ');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Diffusion — Emailing & Messagerie</h1>
        <p className="text-sm text-muted-foreground">
          Envoie une campagne email (réelle via Resend) ou un message aux contacts de tes réseaux connectés.
        </p>
      </div>

      {gmail.connected ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            Gmail connecté : <strong>{gmail.email ?? 'compte Google'}</strong> — les campagnes email
            partent de ce compte.
          </span>
        </div>
      ) : gmail.configured ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
          <span>
            Connecte le Gmail de ton organisation pour envoyer les campagnes depuis ta propre adresse
            {emailConfigured ? ' (sinon envoi via Resend)' : ''}.
          </span>
          <Button asChild size="sm" variant="outline">
            <a href="/api/integrations/google/start">
              <Mail className="mr-2 h-4 w-4" /> Connecter Gmail (Google)
            </a>
          </Button>
        </div>
      ) : !emailConfigured ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Aucun canal email : configure GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (connexion Gmail, voir
          docs/GOOGLE_OAUTH.md) ou RESEND_API_KEY. Les envois échoueront avec le motif exact — aucun
          envoi simulé.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{editingId ? 'Modifier le brouillon' : 'Nouvelle campagne'}</CardTitle>
            {editingId && (
              <Button type="button" size="sm" variant="ghost" onClick={resetForm}>
                <X className="mr-1 h-4 w-4" /> Annuler l’édition
              </Button>
            )}
          </div>
          <CardDescription>
            Personnalisation : {'{{nom}}'} est remplacé par le nom du destinataire.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={channel === 'EMAIL' ? 'brand' : 'outline'}
              onClick={() => setChannel('EMAIL')}
            >
              <Mail className="mr-2 h-4 w-4" /> Email
            </Button>
            <Button
              type="button"
              variant={channel === 'SOCIAL_DM' ? 'brand' : 'outline'}
              onClick={() => setChannel('SOCIAL_DM')}
            >
              <MessageCircle className="mr-2 h-4 w-4" /> Messagerie réseaux
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="o-name">Nom de la campagne</Label>
              <Input id="o-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Lancement FabLab nomade" />
            </div>
            {channel === 'EMAIL' ? (
              <div className="space-y-2">
                <Label htmlFor="o-subject">Objet de l’email</Label>
                <Input id="o-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
                  placeholder="Ex: Découvre notre FabLab nomade 🚀" />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="o-platform">Plateforme</Label>
                <select
                  id="o-platform"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={platform}
                  onChange={(e) => { setPlatform(e.target.value); setSelected(new Set()); }}
                >
                  {DM_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="o-body">
                Message {bodyIsHtml ? <Badge variant="outline" className="ml-2">HTML — envoyé tel quel</Badge> : null}
              </Label>
              {channel === 'EMAIL' && (
                <div className="flex gap-2">
                  <input
                    ref={htmlFileRef}
                    type="file"
                    accept=".html,.htm"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void importHtmlFile(f);
                      e.target.value = '';
                    }}
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => htmlFileRef.current?.click()}>
                    <FileCode2 className="mr-2 h-4 w-4" /> Importer un email HTML
                  </Button>
                  {bodyIsHtml && (
                    <>
                      <Button
                        type="button" size="sm"
                        variant={htmlView === 'visual' ? 'secondary' : 'ghost'}
                        onClick={() => openVisual(body)}
                      >
                        <Eye className="mr-1 h-4 w-4" /> Visuel
                      </Button>
                      <Button
                        type="button" size="sm"
                        variant={htmlView === 'code' ? 'secondary' : 'ghost'}
                        onClick={() => setHtmlView('code')}
                      >
                        <FileCode2 className="mr-1 h-4 w-4" /> Code HTML
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
            {channel === 'EMAIL' && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="o-ai-brief" className="flex items-center gap-1 text-xs">
                    <Sparkles className="h-3 w-3" /> Générer un email HTML avec l’IA
                  </Label>
                  <Input
                    id="o-ai-brief"
                    value={aiBrief}
                    onChange={(e) => setAiBrief(e.target.value)}
                    placeholder="Brief : ex. « Présenter le FabLab nomade aux directions de CSS, CTA appel de cadrage »"
                  />
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => void generateHtmlEmail()} disabled={generating}>
                  {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {generating ? 'Génération…' : 'Générer'}
                </Button>
              </div>
            )}
            {channel === 'EMAIL' && bodyIsHtml ? (
              htmlView === 'code' ? (
                <Textarea id="o-body" rows={14} value={body} onChange={(e) => setBody(e.target.value)}
                  className="font-mono text-xs" />
              ) : (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-0.5 rounded-md border bg-slate-50 p-1">
                    {([
                      { icon: Bold, cmd: 'bold', title: 'Gras' },
                      { icon: Italic, cmd: 'italic', title: 'Italique' },
                      { icon: Underline, cmd: 'underline', title: 'Souligné' },
                      { icon: List, cmd: 'insertUnorderedList', title: 'Liste à puces' },
                    ] as const).map(({ icon: Icon, cmd, title }) => (
                      <button
                        key={cmd} type="button" title={title}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => execVisual(cmd)}
                        className="rounded p-1.5 hover:bg-slate-200"
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    ))}
                    <button
                      type="button" title="Insérer un lien sur la sélection"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const url = window.prompt('URL du lien :', 'https://');
                        if (url && url !== 'https://') execVisual('createLink', url);
                      }}
                      className="rounded p-1.5 hover:bg-slate-200"
                    >
                      <Link2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button" title="Couleur marque (bleu UbSkilled)"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => execVisual('foreColor', UB_ICON_COLOR)}
                      className="rounded p-1.5 hover:bg-slate-200"
                    >
                      <Baseline className="h-4 w-4" style={{ color: UB_ICON_COLOR }} />
                    </button>
                    <button
                      type="button" title="Annuler"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => execVisual('undo')}
                      className="rounded p-1.5 hover:bg-slate-200"
                    >
                      <Undo2 className="h-4 w-4" />
                    </button>
                    <div className="relative">
                      <button
                        type="button" title="Icônes UbSkilled"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowIcons((v) => !v)}
                        className={`flex items-center gap-1 rounded p-1.5 text-xs hover:bg-slate-200 ${showIcons ? 'bg-slate-200' : ''}`}
                      >
                        <Shapes className="h-4 w-4" style={{ color: UB_ICON_COLOR }} /> Icônes
                      </button>
                      {showIcons && (
                        <div className="absolute left-0 top-full z-20 mt-1 grid w-64 grid-cols-7 gap-0.5 rounded-md border bg-white p-2 shadow-lg">
                          {UB_ICONS.map((i) => (
                            <button
                              key={i.label} type="button" title={i.label}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => insertUbIcon(i.ch, i.label)}
                              className="rounded p-1 text-lg leading-none hover:bg-slate-100"
                              style={{ color: UB_ICON_COLOR }}
                            >
                              {i.ch}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <iframe
                    ref={iframeRef}
                    key={visualKey}
                    title="Édition visuelle de l’email"
                    sandbox="allow-same-origin"
                    srcDoc={visualBase}
                    onLoad={onVisualLoad}
                    className="h-[560px] w-full rounded-md border bg-white"
                  />
                  <p className="text-xs text-muted-foreground">
                    Sélectionne du texte puis utilise la barre d’outils (gras, lien, couleur…) ou insère
                    une icône UbSkilled au curseur — chaque changement est enregistré dans le brouillon.
                    Pour la structure (blocs, couleurs), passe en « Code HTML ».
                  </p>
                </div>
              )
            ) : channel === 'EMAIL' ? (
              <SocialTextEditor id="o-body" rows={6} value={body} onChange={setBody}
                placeholder={'Bonjour {{nom}},\n\n…'}
                onImprove={improveText} improving={improving} />
            ) : (
              <Textarea id="o-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)}
                placeholder={'Bonjour {{nom}},\n\n…'} />
            )}
            <p className="text-xs text-muted-foreground">
              Personnalisation : {'{{nom}}'} et [Nom du destinataire] sont remplacés par le nom du
              destinataire — et retirés proprement si le nom est inconnu (« Bonjour, »), jamais envoyés tels quels.
            </p>
          </div>

          {channel === 'EMAIL' && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Paperclip className="h-4 w-4" /> Pièces jointes
              </Label>
              <MediaUploader
                accept="*/*"
                multiple
                maxSizeMB={10}
                onUploaded={(m) => setAttachments((prev) => (prev.length >= 5 ? prev : [...prev, m]))}
              />
              {attachments.length > 0 && (
                <ul className="space-y-1">
                  {attachments.map((a, idx) => (
                    <li key={`${a.url}-${idx}`} className="flex items-center justify-between rounded-md border px-2 py-1 text-xs">
                      <span className="truncate">{a.filename}</span>
                      <button
                        type="button"
                        onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                        className="rounded p-1 hover:bg-slate-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">Max 5 fichiers, 10 Mo chacun.</p>
            </div>
          )}

          {channel === 'EMAIL' ? (
            <div className="space-y-2">
              <Label htmlFor="o-emails">Destinataires (une adresse par ligne)</Label>
              <Textarea id="o-emails" rows={4} value={emails} onChange={(e) => setEmails(e.target.value)}
                placeholder={'prenom@exemple.com\ncontact@ecole.qc.ca'} />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Contacts joignables ({contacts.length})</Label>
              <p className="text-xs text-muted-foreground">
                Seules les personnes ayant déjà une conversation avec toi sont joignables — l’envoi répond
                à leur dernier échange. Pas de message à froid.
              </p>
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune conversation sur {platform} pour l’instant.</p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                  {contacts.map((c) => (
                    <label key={c.interactionId} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(c.interactionId)}
                        onChange={() => toggleContact(c.interactionId)}
                      />
                      <span className="font-medium">@{c.handle}</span>
                      {c.name ? <span className="text-muted-foreground">— {c.name}</span> : null}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <Button onClick={createCampaign} disabled={busy} variant="brand">
            {editingId ? 'Enregistrer les modifications' : 'Créer la campagne'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Campagnes</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => void reload()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune campagne de diffusion pour l’instant.</p>
          ) : (
            <div className="space-y-3">
              {items.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {o.channel === 'EMAIL'
                        ? <Mail className="h-4 w-4 text-muted-foreground" />
                        : <MessageCircle className="h-4 w-4 text-muted-foreground" />}
                      <span className="font-medium">{o.name}</span>
                      <Badge variant={o.status === 'SENT' ? 'success' : o.status === 'FAILED' ? 'destructive' : 'secondary'}>
                        {STATUS_LABEL[o.status] ?? o.status}
                      </Badge>
                      {o.platform ? <Badge variant="outline">{o.platform}</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {o.recipients.length} destinataire(s){counts(o) ? ` — ${counts(o)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {(o.status === 'DRAFT' || o.status === 'PARTIAL' || o.status === 'FAILED') && (
                      <Button size="sm" variant="outline" onClick={() => void loadDraft(o.id)}>
                        <Pencil className="mr-1 h-3 w-3" /> Modifier
                      </Button>
                    )}
                    {(o.status === 'DRAFT' || o.status === 'PARTIAL' || o.status === 'FAILED') &&
                      o.recipients.some((r) => r.status === 'PENDING') && (() => {
                        // Création toujours possible ; seul le LANCEMENT d'envoi exige un canal.
                        const noChannel = o.channel === 'EMAIL' && !gmail.connected && !emailConfigured;
                        return (
                          <Button
                            size="sm"
                            onClick={() => void sendCampaign(o.id)}
                            disabled={busy || noChannel}
                            title={noChannel ? 'Aucun canal email configuré — connecte Gmail ou configure RESEND_API_KEY.' : undefined}
                          >
                            <Send className="mr-2 h-4 w-4" /> Envoyer
                          </Button>
                        );
                      })()}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void deleteCampaign(o.id)}
                      title="Supprimer la campagne"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

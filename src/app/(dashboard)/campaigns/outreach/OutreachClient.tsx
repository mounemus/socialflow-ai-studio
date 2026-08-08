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
import { useRef } from 'react';
import { Mail, MessageCircle, Send, RefreshCw, CheckCircle2, FileCode2, Eye } from 'lucide-react';

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
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const htmlFileRef = useRef<HTMLInputElement>(null);

  const bodyIsHtml = /^\s*(<!doctype|<html|<head|<body|<table|<div)/i.test(body);

  async function importHtmlFile(file: File) {
    const text = await file.text();
    const title = /<title>([^<]*)<\/title>/i.exec(text)?.[1]?.trim();
    setBody(text);
    if (title && !subject) setSubject(title);
    if (!name) setName(file.name.replace(/\.html?$/i, ''));
    setShowPreview(true);
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
              channel, name, subject: subject || undefined, body,
              emails: emails.split(/[\n,;]+/).map((e) => e.trim()).filter(Boolean),
            }
          : {
              channel, name, body, platform,
              contacts: contacts
                .filter((c) => selected.has(c.interactionId))
                .map((c) => ({ handle: c.handle, name: c.name ?? undefined, interactionId: c.interactionId })),
            };
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.data?.error ?? json?.message ?? 'Création impossible');
      toast.success('Campagne créée — prête à envoyer.');
      setName(''); setSubject(''); setBody(''); setEmails(''); setSelected(new Set());
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
          <CardTitle>Nouvelle campagne</CardTitle>
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
                    <Button type="button" size="sm" variant="ghost" onClick={() => setShowPreview((v) => !v)}>
                      <Eye className="mr-2 h-4 w-4" /> {showPreview ? 'Masquer' : 'Aperçu'}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <Textarea id="o-body" rows={bodyIsHtml ? 10 : 6} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder={'Bonjour {{nom}},\n\n…'}
              className={bodyIsHtml ? 'font-mono text-xs' : undefined} />
            {bodyIsHtml && showPreview && (
              <iframe
                title="Aperçu de l’email"
                sandbox=""
                srcDoc={body}
                className="h-96 w-full rounded-md border bg-white"
              />
            )}
            <p className="text-xs text-muted-foreground">
              Personnalisation : {'{{nom}}'} et [Nom du destinataire] sont remplacés par le nom du destinataire.
            </p>
          </div>

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
            Créer la campagne
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
                  {(o.status === 'DRAFT' || o.status === 'PARTIAL' || o.status === 'FAILED') &&
                    o.recipients.some((r) => r.status === 'PENDING') && (
                    <Button size="sm" onClick={() => void sendCampaign(o.id)} disabled={busy}>
                      <Send className="mr-2 h-4 w-4" /> Envoyer
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Play, Trash2, GitPullRequest, Clock } from 'lucide-react';

type Schedule = {
  id: string;
  name: string;
  cronExpression: string;
  promptTemplate: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

const CRON_PRESETS = [
  { value: 'every:30m', label: 'Toutes les 30 minutes' },
  { value: 'hourly', label: 'Toutes les heures' },
  { value: 'every:6h', label: 'Toutes les 6 heures' },
  { value: 'daily:09:00', label: 'Tous les jours à 9h' },
  { value: 'daily:18:00', label: 'Tous les jours à 18h' },
  { value: 'weekly:mon:09:00', label: 'Tous les lundis à 9h' },
];

export default function AdminAgentPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [creating, setCreating] = useState({ name: '', cronExpression: 'daily:09:00', promptTemplate: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [devForm, setDevForm] = useState({ instruction: '', context: '' });
  const [devResult, setDevResult] = useState<{ prUrl?: string; configured?: boolean; message?: string } | null>(null);

  async function load() {
    const res = await fetch('/api/agent/schedules');
    if (!res.ok) return;
    const { data } = await res.json();
    setSchedules(data);
  }
  useEffect(() => { load(); }, []);

  async function createSchedule(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create');
    const res = await fetch('/api/agent/schedules', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(creating),
    });
    setBusy(null);
    if (!res.ok) return toast.error('Erreur');
    toast.success('Schedule créée');
    setCreating({ name: '', cronExpression: 'daily:09:00', promptTemplate: '' });
    load();
  }

  async function runNow(id: string) {
    setBusy(id);
    const res = await fetch(`/api/agent/schedules/${id}/run`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) return toast.error('Erreur');
    const { data } = await res.json();
    toast.success(`Run terminé (${data.turns} tours)`);
  }

  async function remove(id: string) {
    if (!confirm('Supprimer cette schedule ?')) return;
    await fetch(`/api/agent/schedules/${id}`, { method: 'DELETE' });
    load();
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    await fetch(`/api/agent/schedules/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !enabled }),
    });
    load();
  }

  async function runDevAgent(e: React.FormEvent) {
    e.preventDefault();
    if (devForm.instruction.length < 20) return toast.error('Instruction trop courte');
    if (!confirm('Le Dev Agent va créer une vraie PR sur le repo. Continuer ?')) return;
    setBusy('dev');
    const res = await fetch('/api/admin/dev-agent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(devForm),
    });
    setBusy(null);
    const { data } = await res.json();
    setDevResult(data);
    if (data.prUrl) toast.success('PR créée !');
    else if (!data.configured) toast.warning(data.message);
    else toast.error('Échec');
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agents IA</h1>
        <p className="text-sm text-muted-foreground">Configure les agents autonomes et le dev agent.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Agent opérateur — planification</CardTitle>
          <CardDescription>L'agent s'exécute selon le planning et utilise les outils internes (veille, génération, schedule).</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createSchedule} className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label>Nom</Label>
              <Input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} placeholder="Veille hebdomadaire Lumen" required />
            </div>
            <div className="space-y-1">
              <Label>Fréquence</Label>
              <select className="h-10 w-full rounded-md border px-3 text-sm" value={creating.cronExpression} onChange={(e) => setCreating({ ...creating, cronExpression: e.target.value })}>
                {CRON_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Prompt</Label>
              <Textarea rows={4} value={creating.promptTemplate} onChange={(e) => setCreating({ ...creating, promptTemplate: e.target.value })} placeholder="Ex: Fais le tour des veilles actives, identifie les 3 sujets les plus chauds, génère 3 brouillons de posts Instagram pour Lumen Café avec saveAsDraft=true." required />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" variant="brand" disabled={busy === 'create'}>{busy === 'create' ? '...' : 'Créer'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Schedules ({schedules.length})</CardTitle></CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune schedule active.</p>
          ) : (
            <ul className="divide-y">
              {schedules.map((s) => (
                <li key={s.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">
                        <Badge variant={s.enabled ? 'success' : 'secondary'}>{s.enabled ? 'actif' : 'pause'}</Badge>
                        <span className="ml-2">{s.cronExpression}</span>
                        {s.nextRunAt ? <span className="ml-2">prochain : {new Date(s.nextRunAt).toLocaleString('fr-FR')}</span> : null}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => toggleEnabled(s.id, s.enabled)}>{s.enabled ? 'Pause' : 'Activer'}</Button>
                      <Button variant="brand" size="sm" onClick={() => runNow(s.id)} disabled={busy === s.id}>
                        <Play className="mr-1 h-3 w-3" /> {busy === s.id ? '...' : 'Run'}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(s.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <pre className="mt-2 line-clamp-2 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{s.promptTemplate}</pre>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><GitPullRequest className="h-5 w-5" /> Dev Agent — modification du code via PR GitHub</CardTitle>
          <CardDescription>⚠️ Crée une vraie PR sur le repo. Toujours review avant merge. Requiert GITHUB_TOKEN + ANTHROPIC_API_KEY + GITHUB_REPO.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={runDevAgent} className="space-y-3">
            <div className="space-y-1">
              <Label>Instruction</Label>
              <Textarea rows={4} value={devForm.instruction} onChange={(e) => setDevForm({ ...devForm, instruction: e.target.value })} placeholder="Ex: Ajoute un endpoint /api/health/db qui ping Prisma et renvoie OK ou KO. Min 20 caractères." />
            </div>
            <div className="space-y-1">
              <Label>Contexte (optionnel)</Label>
              <Input value={devForm.context} onChange={(e) => setDevForm({ ...devForm, context: e.target.value })} placeholder="Fichiers à regarder, contraintes spécifiques..." />
            </div>
            <Button type="submit" variant="destructive" disabled={busy === 'dev'}>
              <GitPullRequest className="mr-2 h-4 w-4" /> {busy === 'dev' ? 'Analyse en cours...' : 'Proposer une PR'}
            </Button>
          </form>
          {devResult ? (
            <div className="mt-4 rounded border p-3 text-sm">
              {devResult.prUrl ? (
                <a href={devResult.prUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
                  → Voir la PR : {devResult.prUrl}
                </a>
              ) : (
                <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(devResult, null, 2)}</pre>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

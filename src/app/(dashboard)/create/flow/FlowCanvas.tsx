'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Play, Loader2, Save, FileText, ImagePlus, Send, Target, ArrowRight, CheckCircle2, XCircle,
  Copy, Trash2, Plus, Clapperboard,
} from 'lucide-react';
import { PromptAssistButton } from '@/components/ai/PromptAssistButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorMessage } from '@/lib/client-api-error';
import {
  defaultGraph, VISUAL_PROVIDERS, TEXT_PROVIDERS, canConnect,
  type FlowGraph, type FlowNode, type FlowNodeKind,
} from '@/lib/contracts/flow';

interface Brand { id: string; name: string }

interface RunLog { nodeId: string; kind: string; status: 'ok' | 'skipped' | 'failed'; detail: string; ms: number }

/** Recette enregistrée (liste). */
interface SavedFlow { id: string; name: string; lastRunAt?: string | null; updatedAt?: string }

const NODE_META: Record<string, { label: string; icon: typeof FileText; color: string }> = {
  brief: { label: 'Brief', icon: Target, color: 'border-violet-300 bg-violet-50' },
  text: { label: 'Texte', icon: FileText, color: 'border-sky-300 bg-sky-50' },
  image: { label: 'Visuel', icon: ImagePlus, color: 'border-fuchsia-300 bg-fuchsia-50' },
  video: { label: 'Vidéo', icon: Clapperboard, color: 'border-amber-300 bg-amber-50' },
  publication: { label: 'Publication', icon: Send, color: 'border-emerald-300 bg-emerald-50' },
};

/** Données initiales d'un nœud ajouté depuis la barre d'outils. */
const NEW_NODE_DATA: Record<FlowNodeKind, Record<string, unknown>> = {
  brief: { platform: 'LINKEDIN', objective: '' },
  text: { instruction: '', language: 'fr', provider: 'auto' },
  image: { prompt: '', provider: 'flux', aspectRatio: '1:1' },
  video: { prompt: '', aspectRatio: '9:16' },
  publication: { status: 'DRAFT' },
};

const NODE_W = 210;
const NODE_H = 108;

/**
 * Éditeur nodal — étape 1 : un graphe Brief → Texte → Visuel → Publication,
 * déplaçable, exécutable, enregistrable.
 *
 * Chaque nœud consomme les sorties de ses parents (contrats partagés dans
 * `src/lib/contracts/flow.ts`) : plus de module qui ignore le travail d'un
 * autre — le lien est explicite et visible à l'écran.
 */
export function FlowCanvas({ brands, defaultBrandId }: { brands: Brand[]; defaultBrandId: string | null }) {
  const [graph, setGraph] = useState<FlowGraph>(() => defaultGraph(defaultBrandId ?? brands[0]?.id));
  const [name, setName] = useState('Nouveau flux');
  // Recettes enregistrées : c'est ce qui rend le graphe réutilisable.
  const [flows, setFlows] = useState<SavedFlow[]>([]);
  const [flowId, setFlowId] = useState<string | null>(null);
  // Sujet du jour : rejoue la MÊME recette sur un nouveau thème, sans toucher
  // au graphe (il remplace l'objectif du nœud Brief le temps de l'exécution).
  const [subject, setSubject] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>('brief');
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [postId, setPostId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<Record<string, Record<string, unknown>>>({});
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  // Connexion en cours : on tire un fil depuis la sortie d'un nœud.
  const [linking, setLinking] = useState<{ from: string; x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;

  const nodeById = useCallback(
    (id: string) => graph.nodes.find((n) => n.id === id) ?? null,
    [graph.nodes],
  );

  /** Ajoute un nœud, positionné sous le dernier de son type. */
  const addNode = useCallback((kind: FlowNodeKind) => {
    setGraph((g) => {
      const id = `${kind}_${Date.now().toString(36)}`;
      const sameKind = g.nodes.filter((n) => n.kind === kind);
      const ref = sameKind[sameKind.length - 1] ?? g.nodes[g.nodes.length - 1];
      const position = ref
        ? { x: ref.position.x, y: ref.position.y + NODE_H + 40 }
        : { x: 40, y: 60 };
      return { ...g, nodes: [...g.nodes, { id, kind, position, data: { ...NEW_NODE_DATA[kind] } }] };
    });
    toast.success(`Nœud ${NODE_META[kind]?.label ?? kind} ajouté — reliez-le au graphe.`);
  }, []);

  /** Duplique un nœud (utile pour comparer deux fournisseurs côte à côte). */
  const duplicateNode = useCallback((id: string) => {
    setGraph((g) => {
      const src = g.nodes.find((n) => n.id === id);
      if (!src) return g;
      const copyId = `${src.kind}_${Date.now().toString(36)}`;
      const copy: FlowNode = {
        ...src,
        id: copyId,
        position: { x: src.position.x, y: src.position.y + NODE_H + 40 },
        data: { ...src.data },
      };
      // On reprend les mêmes entrées : les deux nœuds reçoivent le même amont,
      // ce qui permet de comparer leurs sorties.
      const inherited = g.edges
        .filter((e) => e.target === id)
        .map((e, i) => ({ id: `e_${copyId}_${i}`, source: e.source, target: copyId }));
      return { ...g, nodes: [...g.nodes, copy], edges: [...g.edges, ...inherited] };
    });
    toast.success('Nœud dupliqué — changez son fournisseur pour comparer.');
  }, []);

  const deleteNode = useCallback((id: string) => {
    setGraph((g) => ({
      nodes: g.nodes.filter((n) => n.id !== id),
      edges: g.edges.filter((e) => e.source !== id && e.target !== id),
    }));
    setSelectedId(null);
  }, []);

  const removeEdge = useCallback((edgeId: string) => {
    setGraph((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== edgeId) }));
  }, []);

  /** Termine une connexion sur un nœud cible, si le lien est autorisé. */
  const finishLink = useCallback(
    (targetId: string) => {
      setLinking((cur) => {
        if (!cur || cur.from === targetId) return null;
        const from = nodeById(cur.from);
        const to = nodeById(targetId);
        if (!from || !to) return null;
        if (!canConnect(from.kind, to.kind)) {
          toast.error(
            `${NODE_META[from.kind]?.label} → ${NODE_META[to.kind]?.label} : connexion non exécutable.`,
          );
          return null;
        }
        setGraph((g) =>
          g.edges.some((e) => e.source === cur.from && e.target === targetId)
            ? g
            : { ...g, edges: [...g.edges, { id: `e_${cur.from}_${targetId}`, source: cur.from, target: targetId }] },
        );
        return null;
      });
    },
    [nodeById],
  );

  const patchNode = useCallback((id: string, data: Record<string, unknown>) => {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
    }));
  }, []);

  // --- déplacement des nœuds (souris) ---
  const onMouseDown = (e: React.MouseEvent, node: FlowNode) => {
    dragRef.current = { id: node.id, dx: e.clientX - node.position.x, dy: e.clientY - node.position.y };
    setSelectedId(node.id);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (linking) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        setLinking((l) =>
          l ? { ...l, x: e.clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0), y: e.clientY - rect.top } : l,
        );
      }
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const x = Math.max(0, e.clientX - d.dx);
    const y = Math.max(0, e.clientY - d.dy);
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === d.id ? { ...n, position: { x, y } } : n)) }));
  };
  const endDrag = () => {
    dragRef.current = null;
    // Relâcher dans le vide annule la connexion en cours.
    setLinking(null);
  };

  const edgePaths = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return graph.edges.flatMap((e) => {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) return [];
      const x1 = a.position.x + NODE_W;
      const y1 = a.position.y + NODE_H / 2;
      const x2 = b.position.x;
      const y2 = b.position.y + NODE_H / 2;
      const mid = (x1 + x2) / 2;
      return [{ id: e.id, d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}` }];
    });
  }, [graph]);

  const run = useCallback(async () => {
    setRunning(true);
    setLogs([]);
    setPostId(null);
    try {
      // Un sujet saisi remplace l'objectif du Brief pour CETTE exécution : la
      // recette reste intacte et rejouable sur un autre thème demain.
      const runGraph = subject.trim()
        ? {
            ...graph,
            nodes: graph.nodes.map((n) =>
              n.kind === 'brief' ? { ...n, data: { ...n.data, objective: subject.trim() } } : n,
            ),
          }
        : graph;
      const res = await fetch('/api/flows/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ graph: runGraph, ...(flowId ? { flowId } : {}) }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const { data } = await res.json();
      setLogs(data.logs ?? []);
      setOutputs(data.outputs ?? {});
      setPostId(data.postId ?? null);
      const failed = (data.logs ?? []).filter((l: RunLog) => l.status === 'failed').length;
      if (failed > 0) toast.warning(`${failed} nœud(s) en échec — voir le journal.`);
      else toast.success('Flux exécuté.');
    } catch (err) {
      toast.error((err as Error).message.slice(0, 140));
    } finally {
      setRunning(false);
    }
  }, [graph, subject, flowId]);

  /** Charge la liste des recettes enregistrées. */
  const loadFlows = useCallback(async () => {
    const rows = await fetch('/api/flows', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j?.data ?? []) as SavedFlow[])
      .catch(() => []);
    setFlows(rows);
  }, []);
  useEffect(() => {
    loadFlows();
  }, [loadFlows]);

  /**
   * Ouvre une recette enregistrée. On repart d'une exécution vierge : les
   * sorties de la fois précédente n'ont plus de sens pour un nouveau sujet.
   */
  const openFlow = useCallback(async (id: string) => {
    if (!id) return;
    const j = await fetch(`/api/flows/${id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const f = j?.data as { id: string; name: string; graph: FlowGraph } | undefined;
    if (!f?.graph) {
      toast.error('Recette introuvable');
      return;
    }
    setFlowId(f.id);
    setName(f.name);
    setGraph(f.graph);
    setLogs([]);
    setOutputs({});
    setPostId(null);
    setSelectedId(f.graph.nodes[0]?.id ?? null);
    toast.success(`Recette « ${f.name} » chargée.`);
  }, []);

  /** Enregistre : met à jour la recette ouverte, ou en crée une nouvelle. */
  const save = useCallback(
    async (asNew = false) => {
      setSaving(true);
      try {
        const briefBrand = (graph.nodes.find((n) => n.kind === 'brief')?.data?.brandId as string) || undefined;
        const useUpdate = !!flowId && !asNew;
        const res = await fetch(useUpdate ? `/api/flows/${flowId}` : '/api/flows', {
          method: useUpdate ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, brandId: briefBrand, graph }),
        });
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        const j = await res.json();
        if (!useUpdate) setFlowId(j?.data?.id ?? null);
        await loadFlows();
        toast.success(useUpdate ? 'Recette mise à jour.' : 'Recette enregistrée — réutilisable.');
      } catch (err) {
        toast.error((err as Error).message.slice(0, 140));
      } finally {
        setSaving(false);
      }
    },
    [graph, name, flowId, loadFlows],
  );

  /** Repart d'un graphe vierge. */
  const newFlow = useCallback(() => {
    setFlowId(null);
    setName('Nouveau flux');
    setGraph(defaultGraph(defaultBrandId ?? brands[0]?.id));
    setLogs([]);
    setOutputs({});
    setPostId(null);
    setSelectedId('brief');
  }, [defaultBrandId, brands]);

  const deleteFlow = useCallback(async () => {
    if (!flowId) return;
    if (!window.confirm(`Supprimer la recette « ${name} » ?`)) return;
    const res = await fetch(`/api/flows/${flowId}`, { method: 'DELETE' });
    if (!res.ok) return toast.error('Suppression impossible');
    toast.success('Recette supprimée.');
    await loadFlows();
    newFlow();
  }, [flowId, name, loadFlows, newFlow]);

  // Contexte de marque/plateforme (nœud Brief) — sert à l'assistance IA et à
  // l'aperçu final.
  const briefNodeRef = graph.nodes.find((n) => n.kind === 'brief');
  const briefBrandId = (briefNodeRef?.data.brandId as string | undefined) || undefined;
  const briefPlatform = (briefNodeRef?.data.platform as string | undefined) || undefined;

  /**
   * Aperçu final : la publication telle qu'elle sera composée. On lit d'abord
   * la sortie du nœud Publication (source de vérité) ; à défaut, on assemble
   * les dernières sorties Texte/Visuel pour prévisualiser avant de publier.
   */
  const finalPreview = useMemo(() => {
    if (Object.keys(outputs).length === 0) return null;
    const pubNode = graph.nodes.find((n) => n.kind === 'publication');
    const fromPub = pubNode ? outputs[pubNode.id] : undefined;
    const textOut = graph.nodes.filter((n) => n.kind === 'text').map((n) => outputs[n.id]).filter(Boolean).pop();
    const imgOut = graph.nodes.filter((n) => n.kind === 'image').map((n) => outputs[n.id]).filter(Boolean).pop();
    const vidOut = graph.nodes.filter((n) => n.kind === 'video').map((n) => outputs[n.id]).filter(Boolean).pop();
    const src = fromPub ?? textOut ?? imgOut;
    if (!src) return null;
    const brandId = (src.brandId as string | undefined) ?? briefBrandId;
    return {
      text: String((fromPub?.text ?? textOut?.text ?? '') || ''),
      hashtags: ((fromPub?.hashtags ?? textOut?.hashtags ?? []) as string[]) ?? [],
      imageUrl: (fromPub?.imageUrl ?? imgOut?.imageUrl) as string | undefined,
      platform: String(src.platform ?? briefPlatform ?? 'LINKEDIN'),
      brandName: brands.find((b) => b.id === brandId)?.name,
      videoPending: !!vidOut?.videoPredictionId,
    };
  }, [outputs, graph.nodes, brands, briefBrandId, briefPlatform]);

  const canvasHeight = Math.max(360, ...graph.nodes.map((n) => n.position.y + NODE_H + 40));

  return (
    <div className="space-y-4 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Éditeur nodal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Brief → Texte → Visuel → Publication. Chaque nœud alimente le suivant.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-48" />
          <Button variant="outline" onClick={() => save(false)} disabled={saving || running}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {flowId ? 'Mettre à jour' : 'Enregistrer'}
          </Button>
          <Button variant="brand" onClick={run} disabled={running}>
            {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
            Exécuter
          </Button>
        </div>
      </div>

      {/* ===== RECETTES : charger, rejouer sur un autre sujet ===== */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-3">
        <div className="space-y-1">
          <Label className="text-[11px]">Mes recettes</Label>
          <select
            className="w-56 rounded-md border bg-white px-2 py-1.5 text-sm"
            value={flowId ?? ''}
            onChange={(e) => (e.target.value ? openFlow(e.target.value) : newFlow())}
          >
            <option value="">— Nouvelle recette —</option>
            {flows.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>

        <div className="min-w-[240px] flex-1 space-y-1">
          <Label className="text-[11px]">Sujet de cette exécution (optionnel)</Label>
          <Input
            placeholder="Ex : notre nouvelle fonctionnalité d’analyse de CV"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <Button variant="outline" size="sm" onClick={() => save(true)} disabled={saving}>
          <Copy className="mr-1 h-3 w-3" /> Dupliquer la recette
        </Button>
        <Button variant="ghost" size="sm" onClick={newFlow}>
          Nouvelle
        </Button>
        {flowId ? (
          <Button variant="ghost" size="sm" className="text-slate-500 hover:text-rose-600" onClick={deleteFlow}>
            <Trash2 className="mr-1 h-3 w-3" /> Supprimer
          </Button>
        ) : null}
        <p className="w-full text-[11px] text-muted-foreground">
          Enregistrez une recette une fois, puis rejouez-la : saisissez un nouveau sujet et cliquez
          Exécuter — le graphe reste intact.
        </p>
      </div>

      {/* ===== BARRE D'OUTILS ===== */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2">
        <span className="text-xs font-medium text-slate-500">Ajouter :</span>
        {(['text', 'image', 'video', 'publication'] as FlowNodeKind[]).map((k) => {
          const Icon = NODE_META[k].icon;
          return (
            <Button key={k} variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => addNode(k)}>
              <Plus className="mr-1 h-3 w-3" />
              <Icon className="mr-1 h-3 w-3" />
              {NODE_META[k].label}
            </Button>
          );
        })}
        <span className="mx-1 h-4 w-px bg-slate-300" />
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          disabled={!selected}
          onClick={() => selected && duplicateNode(selected.id)}
        >
          <Copy className="mr-1 h-3 w-3" /> Dupliquer
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] text-slate-500 hover:text-rose-600"
          disabled={!selected || selected.kind === 'brief'}
          onClick={() => selected && deleteNode(selected.id)}
        >
          <Trash2 className="mr-1 h-3 w-3" /> Supprimer
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Tirez depuis le point droit d’un nœud vers un autre · cliquez un lien pour le retirer
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ===== CANVAS ===== */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div
              ref={canvasRef}
              className="relative w-full overflow-auto bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:18px_18px]"
              style={{ height: canvasHeight }}
              onMouseMove={onMouseMove}
              onMouseUp={endDrag}
              onMouseLeave={endDrag}
            >
              <svg className="absolute inset-0 h-full w-full">
                {edgePaths.map((p) => (
                  <g key={p.id}>
                    <path d={p.d} fill="none" stroke="#94a3b8" strokeWidth={2} />
                    {/* Trait épais invisible : cible de clic pour supprimer le lien */}
                    <path
                      d={p.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      className="cursor-pointer"
                      onClick={() => removeEdge(p.id)}
                    >
                      <title>Cliquer pour supprimer ce lien</title>
                    </path>
                  </g>
                ))}
                {linking
                  ? (() => {
                      const from = nodeById(linking.from);
                      if (!from) return null;
                      const x1 = from.position.x + NODE_W;
                      const y1 = from.position.y + NODE_H / 2;
                      return (
                        <path
                          d={`M ${x1} ${y1} L ${linking.x} ${linking.y}`}
                          fill="none"
                          stroke="#0ea5e9"
                          strokeWidth={2}
                          strokeDasharray="5 4"
                        />
                      );
                    })()
                  : null}
              </svg>

              {graph.nodes.map((node) => {
                const meta = NODE_META[node.kind] ?? NODE_META.brief;
                const Icon = meta.icon;
                const log = logs.find((l) => l.nodeId === node.id);
                return (
                  <div
                    key={node.id}
                    onMouseDown={(e) => onMouseDown(e, node)}
                    className={
                      'absolute cursor-grab select-none rounded-xl border-2 p-3 shadow-sm transition-shadow active:cursor-grabbing ' +
                      meta.color +
                      (selectedId === node.id ? ' ring-2 ring-slate-900/20' : '')
                    }
                    style={{ left: node.position.x, top: node.position.y, width: NODE_W }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                        <Icon className="h-4 w-4" /> {meta.label}
                      </span>
                      {log ? (
                        log.status === 'ok' ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : log.status === 'failed' ? (
                          <XCircle className="h-4 w-4 text-rose-600" />
                        ) : null
                      ) : null}
                    </div>
                    {/* Aperçu propre à chaque type de nœud : on voit ce que le
                        nœud contient AVANT exécution, et ce qu'il a produit APRÈS. */}
                    <p className="mt-1 line-clamp-2 text-[11px] text-slate-600">
                      {node.kind === 'brief'
                        ? `${String(node.data.platform ?? 'LINKEDIN')}${
                            brands.find((b) => b.id === node.data.brandId)?.name
                              ? ` · ${brands.find((b) => b.id === node.data.brandId)!.name}`
                              : ''
                          }${node.data.objective ? ` — ${String(node.data.objective)}` : ''}`
                        : node.kind === 'text'
                          ? String(outputs[node.id]?.text ?? node.data.instruction ?? 'Rédaction IA')
                          : node.kind === 'image'
                            ? String(node.data.provider ?? 'flux')
                            : node.kind === 'video'
                              ? outputs[node.id]?.videoPredictionId
                                ? 'Rendu lancé — en cours'
                                : `${String(node.data.aspectRatio ?? '9:16')} · ${String(node.data.prompt || 'prompt déduit du texte')}`
                              : outputs[node.id]?.postId
                                ? 'Publication créée ✓'
                                : 'Crée la publication'}
                    </p>
                    {/* Aperçu du texte produit, directement dans le nœud */}
                    {node.kind === 'text' && outputs[node.id]?.text ? (
                      <p className="mt-1 text-[10px] text-slate-400">
                        {String(outputs[node.id].text).length} caractères
                      </p>
                    ) : null}
                    {node.kind === 'image' && outputs[node.id]?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={String(outputs[node.id].imageUrl)}
                        alt=""
                        className="mt-2 h-12 w-full rounded object-cover"
                      />
                    ) : null}

                    {/* Poignée d'ENTRÉE : on relâche ici pour créer un lien */}
                    {node.kind !== 'brief' ? (
                      <span
                        title="Entrée"
                        onMouseUp={(e) => {
                          e.stopPropagation();
                          finishLink(node.id);
                        }}
                        className={
                          'absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white shadow ' +
                          (linking ? 'bg-sky-500 ring-2 ring-sky-300' : 'bg-slate-400')
                        }
                      />
                    ) : null}

                    {/* Poignée de SORTIE : on tire depuis ici */}
                    {node.kind !== 'publication' ? (
                      <span
                        title="Glisser vers un autre nœud"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          const rect = canvasRef.current?.getBoundingClientRect();
                          setLinking({
                            from: node.id,
                            x: node.position.x + NODE_W,
                            y: node.position.y + NODE_H / 2,
                          });
                          void rect;
                        }}
                        className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white bg-slate-500 shadow hover:bg-sky-500"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ===== INSPECTEUR ===== */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {selected ? (NODE_META[selected.kind]?.label ?? selected.kind) : 'Aucun nœud'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selected ? (
                <p className="text-xs text-muted-foreground">Cliquez un nœud pour le configurer.</p>
              ) : selected.kind === 'brief' ? (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Marque</Label>
                    <select
                      className="w-full rounded-md border px-2 py-1.5 text-sm"
                      value={String(selected.data.brandId ?? '')}
                      onChange={(e) => patchNode(selected.id, { brandId: e.target.value })}
                    >
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Plateforme</Label>
                    <select
                      className="w-full rounded-md border px-2 py-1.5 text-sm"
                      value={String(selected.data.platform ?? 'LINKEDIN')}
                      onChange={(e) => patchNode(selected.id, { platform: e.target.value })}
                    >
                      {['LINKEDIN', 'INSTAGRAM', 'FACEBOOK', 'TWITTER', 'TIKTOK', 'YOUTUBE', 'PINTEREST'].map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Objectif</Label>
                    <Textarea
                      rows={3}
                      placeholder="Ex : faire connaître notre méthode d’optimisation de CV"
                      value={String(selected.data.objective ?? '')}
                      onChange={(e) => patchNode(selected.id, { objective: e.target.value })}
                    />
                  </div>
                </>
              ) : selected.kind === 'text' ? (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Rédacteur</Label>
                    <select
                      className="w-full rounded-md border px-2 py-1.5 text-sm"
                      value={String(selected.data.provider ?? 'auto')}
                      onChange={(e) => patchNode(selected.id, { provider: e.target.value })}
                    >
                      {TEXT_PROVIDERS.map((p) => (
                        <option key={p} value={p}>
                          {p === 'anthropic' ? 'Claude (Anthropic)' : p === 'openai' ? 'GPT (OpenAI)' : p === 'gemini' ? 'Gemini' : 'Auto'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Consigne de rédaction</Label>
                    <Textarea
                      rows={4}
                      placeholder="Ton, angle, structure attendue…"
                      value={String(selected.data.instruction ?? '')}
                      onChange={(e) => patchNode(selected.id, { instruction: e.target.value })}
                    />
                    <PromptAssistButton
                      kind="text"
                      draft={String(selected.data.instruction ?? '')}
                      brandId={briefBrandId}
                      platform={briefPlatform}
                      onResult={(p) => patchNode(selected.id, { instruction: p })}
                      label="Rédiger la consigne avec l’IA"
                    />
                  </div>
                  {outputs[selected.id]?.text ? (
                    <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] text-slate-700">
                      {String(outputs[selected.id].text)}
                    </p>
                  ) : null}
                </>
              ) : selected.kind === 'image' ? (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Générateur</Label>
                    <select
                      className="w-full rounded-md border px-2 py-1.5 text-sm"
                      value={String(selected.data.provider ?? 'flux')}
                      onChange={(e) => patchNode(selected.id, { provider: e.target.value })}
                    >
                      {VISUAL_PROVIDERS.map((p) => (
                        <option key={p} value={p}>
                          {p === 'dalle' ? 'GPT Image (OpenAI)' : p === 'flux' ? 'FLUX' : p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Prompt (vide = déduit du texte)</Label>
                    <Textarea
                      rows={3}
                      value={String(selected.data.prompt ?? '')}
                      onChange={(e) => patchNode(selected.id, { prompt: e.target.value })}
                    />
                    <PromptAssistButton
                      kind="image"
                      draft={String(selected.data.prompt ?? '')}
                      brandId={briefBrandId}
                      platform={briefPlatform}
                      onResult={(p) => patchNode(selected.id, { prompt: p })}
                      label="Rédiger le prompt avec l’IA"
                    />
                  </div>
                </>
              ) : selected.kind === 'video' ? (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Format</Label>
                    <select
                      className="w-full rounded-md border px-2 py-1.5 text-sm"
                      value={String(selected.data.aspectRatio ?? '9:16')}
                      onChange={(e) => patchNode(selected.id, { aspectRatio: e.target.value })}
                    >
                      {['9:16', '16:9', '1:1'].map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Prompt vidéo (vide = déduit du texte)</Label>
                    <Textarea
                      rows={3}
                      value={String(selected.data.prompt ?? '')}
                      onChange={(e) => patchNode(selected.id, { prompt: e.target.value })}
                    />
                    <PromptAssistButton
                      kind="video"
                      draft={String(selected.data.prompt ?? '')}
                      brandId={briefBrandId}
                      platform={briefPlatform}
                      onResult={(p) => patchNode(selected.id, { prompt: p })}
                      label="Rédiger le prompt avec l’IA"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    La vidéo se génère en arrière-plan (plusieurs minutes) — le graphe rend la main
                    avec l’identifiant de rendu.
                  </p>
                </>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs">Statut à la création</Label>
                  <select
                    className="w-full rounded-md border px-2 py-1.5 text-sm"
                    value={String(selected.data.status ?? 'DRAFT')}
                    onChange={(e) => patchNode(selected.id, { status: e.target.value })}
                  >
                    <option value="DRAFT">Brouillon</option>
                    <option value="PENDING_APPROVAL">En validation</option>
                  </select>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ===== APERÇU FINAL : la publication assemblée ===== */}
          {finalPreview ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-sm">
                  Aperçu final
                  <Badge variant="info" className="text-[10px]">{finalPreview.platform}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-lg border bg-white">
                  <div className="flex items-center gap-2 border-b px-3 py-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">
                      {(finalPreview.brandName ?? 'M').charAt(0).toUpperCase()}
                    </div>
                    <span className="truncate text-xs font-semibold text-slate-800">
                      {finalPreview.brandName ?? 'Votre marque'}
                    </span>
                  </div>
                  {finalPreview.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={finalPreview.imageUrl} alt="" className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="flex h-28 items-center justify-center bg-slate-100 text-[11px] text-slate-400">
                      {finalPreview.videoPending ? 'Vidéo en cours de rendu…' : 'Pas de visuel'}
                    </div>
                  )}
                  <div className="space-y-1 p-3">
                    <p className="whitespace-pre-wrap text-[11px] text-slate-700">
                      {finalPreview.text || (
                        <span className="italic text-slate-400">Exécutez le flux pour voir le texte.</span>
                      )}
                    </p>
                    {finalPreview.hashtags.length > 0 ? (
                      <p className="text-[10px] font-medium text-sky-600">
                        {finalPreview.hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')}
                      </p>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Journal d'exécution */}
          {logs.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Exécution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {logs.map((l) => (
                  <div key={l.nodeId} className="flex items-start gap-2 text-xs">
                    <Badge
                      variant={l.status === 'ok' ? 'success' : l.status === 'failed' ? 'destructive' : 'secondary'}
                      className="mt-0.5 shrink-0 text-[10px]"
                    >
                      {NODE_META[l.kind]?.label ?? l.kind}
                    </Badge>
                    <span className="text-slate-600">{l.detail}</span>
                  </div>
                ))}
                {postId ? (
                  <Link href={`/posts/${postId}`}>
                    <Button variant="brand" size="sm" className="mt-2 w-full">
                      Ouvrir la publication <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default FlowCanvas;

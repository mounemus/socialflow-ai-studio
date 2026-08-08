import { z } from 'zod';
import { SOCIAL_PLATFORMS } from './post';

/**
 * Contrats de l'éditeur nodal — chaque nœud DÉCLARE ses entrées et ses sorties.
 *
 * C'est la réponse structurelle aux bugs rencontrés dans le Studio : les
 * modules y communiquaient par accident (un onglet ignorait la publication de
 * l'autre, un visuel n'était rattaché à rien). Ici, un lien entre deux nœuds
 * est explicite, typé, et validé des deux côtés (client et serveur).
 */

export const FLOW_NODE_KINDS = ['brief', 'text', 'image', 'video', 'publication'] as const;
export type FlowNodeKind = (typeof FLOW_NODE_KINDS)[number];

export const VISUAL_PROVIDERS = ['auto', 'flux', 'dalle', 'gemini', 'stability'] as const;
/** Fournisseurs de rédaction — 'auto' laisse le routeur choisir. */
export const TEXT_PROVIDERS = ['auto', 'anthropic', 'openai', 'gemini'] as const;

const position = z.object({ x: z.number(), y: z.number() });

/** Point de départ : la cible (marque + plateforme) et l'intention. */
export const briefNodeData = z.object({
  brandId: z.string().optional(),
  platform: z.enum(SOCIAL_PLATFORMS).default('LINKEDIN'),
  objective: z.string().default(''),
});

/** Rédaction : consomme le brief, produit le texte + les hashtags. */
export const textNodeData = z.object({
  instruction: z.string().default(''),
  language: z.string().default('fr'),
  provider: z.enum(TEXT_PROVIDERS).default('auto'),
  /** Rempli par l'exécution (sortie du nœud). */
  output: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
});

/** Vidéo : génération asynchrone (Replicate) déclenchée depuis le graphe. */
export const videoNodeData = z.object({
  prompt: z.string().default(''),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('9:16'),
  /** Sorties. */
  predictionId: z.string().optional(),
  outputUrl: z.string().optional(),
});

/** Visuel : consomme le texte, produit une image attachée à la publication. */
export const imageNodeData = z.object({
  prompt: z.string().default(''),
  provider: z.enum(VISUAL_PROVIDERS).default('flux'),
  aspectRatio: z.enum(['1:1', '4:5', '9:16', '16:9']).default('1:1'),
  /** Sorties. */
  outputUrl: z.string().optional(),
  mediaId: z.string().optional(),
});

/** Sortie : crée la publication à partir des nœuds amont. */
export const publicationNodeData = z.object({
  status: z.enum(['DRAFT', 'PENDING_APPROVAL']).default('DRAFT'),
  postId: z.string().optional(),
});

export const flowNode = z.object({
  id: z.string(),
  kind: z.enum(FLOW_NODE_KINDS),
  position,
  // Union permissive : chaque type de nœud valide sa forme à l'exécution.
  data: z.record(z.unknown()).default({}),
});
export type FlowNode = z.infer<typeof flowNode>;

export const flowEdge = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
});
export type FlowEdge = z.infer<typeof flowEdge>;

export const flowGraph = z.object({
  nodes: z.array(flowNode),
  edges: z.array(flowEdge),
});
export type FlowGraph = z.infer<typeof flowGraph>;

export const createFlowInput = z.object({
  name: z.string().min(1).default('Nouveau flux'),
  brandId: z.string().optional(),
  graph: flowGraph,
});

export const updateFlowInput = z.object({
  name: z.string().min(1).optional(),
  brandId: z.string().nullable().optional(),
  graph: flowGraph.optional(),
});

/** Connexions autorisées — empêche de câbler un graphe qui ne s'exécute pas. */
const ALLOWED: Record<FlowNodeKind, FlowNodeKind[]> = {
  brief: ['text', 'image', 'video'],
  text: ['image', 'video', 'publication'],
  image: ['video', 'publication'],
  video: ['publication'],
  publication: [],
};

export function canConnect(from: FlowNodeKind, to: FlowNodeKind): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/** Graphe par défaut : le parcours nominal Brief → Texte → Image → Publication. */
export function defaultGraph(brandId?: string): FlowGraph {
  return {
    nodes: [
      { id: 'brief', kind: 'brief', position: { x: 40, y: 60 }, data: { brandId, platform: 'LINKEDIN', objective: '' } },
      { id: 'text', kind: 'text', position: { x: 340, y: 60 }, data: { instruction: '', language: 'fr' } },
      { id: 'image', kind: 'image', position: { x: 640, y: 60 }, data: { prompt: '', provider: 'flux', aspectRatio: '1:1' } },
      { id: 'publication', kind: 'publication', position: { x: 940, y: 60 }, data: { status: 'DRAFT' } },
    ],
    edges: [
      { id: 'e1', source: 'brief', target: 'text' },
      { id: 'e2', source: 'text', target: 'image' },
      { id: 'e3', source: 'image', target: 'publication' },
    ],
  };
}

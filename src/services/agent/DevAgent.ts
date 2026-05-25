/**
 * DevAgent — receives a development instruction from a SUPER_ADMIN
 * and proposes code changes via a GitHub PR.
 *
 * Pattern:
 *  1. Read relevant files from the repo via GitHub API
 *  2. Send to Claude with the instruction + file contents
 *  3. Claude returns proposed edits as a structured list
 *  4. We create a branch + commits + PR via GitHub API
 *  5. Return PR URL to the operator — NEVER auto-merge
 *
 * Requires:
 *  - ANTHROPIC_API_KEY  (Claude)
 *  - GITHUB_TOKEN       (PAT with `repo` scope, or use OAuth token from gh)
 *  - GITHUB_REPO        (e.g., "mounemus/socialflow-ai-studio")
 *
 * Safety:
 *  - Restricted to SUPER_ADMIN
 *  - Always creates a NEW branch from main
 *  - Never auto-merges
 *  - Caps file changes per PR (default 10)
 */
import { ExternalApiError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const GITHUB_API = 'https://api.github.com';

interface FileChange {
  path: string;
  content: string;  // full new content (base64-encoded when sent)
  message?: string;
}

interface ProposedPR {
  branch: string;
  title: string;
  body: string;
  changes: FileChange[];
}

function getConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO ?? 'mounemus/socialflow-ai-studio';
  if (!token) throw new ExternalApiError('github', 'GITHUB_TOKEN missing');
  if (!repo.includes('/')) throw new ExternalApiError('github', 'GITHUB_REPO must be owner/name');
  return { token, repo };
}

async function ghFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = getConfig();
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new ExternalApiError('github', `${res.status} ${txt}`);
  }
  return res.json();
}

export const DevAgent = {
  isConfigured(): boolean {
    return !!process.env.GITHUB_TOKEN && !!process.env.ANTHROPIC_API_KEY;
  },

  async readFile(repoPath: string, ref = 'main'): Promise<string> {
    const { repo } = getConfig();
    const data = await ghFetch<{ content: string; encoding: string }>(
      `/repos/${repo}/contents/${encodeURIComponent(repoPath)}?ref=${ref}`,
    );
    return Buffer.from(data.content, data.encoding as BufferEncoding).toString('utf-8');
  },

  async listTree(ref = 'main'): Promise<{ path: string; type: string }[]> {
    const { repo } = getConfig();
    const data = await ghFetch<{ tree: { path: string; type: string }[] }>(
      `/repos/${repo}/git/trees/${ref}?recursive=1`,
    );
    return data.tree;
  },

  /**
   * High-level entry: take an instruction, ask Claude to propose changes,
   * create a PR with the result. Returns the PR URL.
   */
  async propose(instruction: string, contextHint?: string): Promise<{ prUrl: string; branch: string; filesChanged: number }> {
    if (!this.isConfigured()) {
      throw new ExternalApiError('dev-agent', 'GITHUB_TOKEN ou ANTHROPIC_API_KEY manquant');
    }

    // 1. Gather repo structure
    const tree = await this.listTree('main');
    const relevantFiles = tree
      .filter((t) => t.type === 'blob')
      .filter((t) => /\.(ts|tsx|prisma|md|json)$/.test(t.path))
      .filter((t) => !t.path.includes('node_modules/'))
      .map((t) => t.path)
      .slice(0, 200);

    // 2. Ask Claude to identify the files it needs
    const proposal = await this.askClaude(instruction, relevantFiles, contextHint);
    if (proposal.changes.length === 0) {
      throw new Error('Claude proposed no changes');
    }
    if (proposal.changes.length > 10) {
      proposal.changes = proposal.changes.slice(0, 10);
    }

    // 3. Create branch from main
    const { repo } = getConfig();
    const mainRef = await ghFetch<{ object: { sha: string } }>(`/repos/${repo}/git/refs/heads/main`);
    const branchName = proposal.branch || `dev-agent/${Date.now()}`;
    await ghFetch(`/repos/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: mainRef.object.sha }),
    });

    // 4. Commit each file change
    for (const change of proposal.changes) {
      // Get current sha if file exists
      let sha: string | undefined;
      try {
        const existing = await ghFetch<{ sha: string }>(
          `/repos/${repo}/contents/${encodeURIComponent(change.path)}?ref=${branchName}`,
        );
        sha = existing.sha;
      } catch {
        // file doesn't exist - create
      }
      await ghFetch(`/repos/${repo}/contents/${encodeURIComponent(change.path)}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: change.message ?? `chore(dev-agent): update ${change.path}`,
          content: Buffer.from(change.content, 'utf-8').toString('base64'),
          branch: branchName,
          sha,
        }),
      });
    }

    // 5. Open PR
    const pr = await ghFetch<{ html_url: string; number: number }>(`/repos/${repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: proposal.title,
        body: `${proposal.body}\n\n---\n🤖 Generated by SocialFlow Dev Agent.\n\n**Instruction**: ${instruction}\n\n⚠️ Review carefully before merging. No auto-merge.`,
        head: branchName,
        base: 'main',
      }),
    });

    logger.info('Dev agent PR created', { prUrl: pr.html_url, files: proposal.changes.length });
    return { prUrl: pr.html_url, branch: branchName, filesChanged: proposal.changes.length };
  },

  async askClaude(instruction: string, fileList: string[], contextHint?: string): Promise<ProposedPR> {
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    const systemPrompt = `Tu es un ingénieur logiciel senior travaillant sur le codebase SocialFlow AI Studio (Next.js 15 + TypeScript + Prisma + Tailwind).

Tu reçois une instruction et une liste de fichiers existants. Tu dois retourner du JSON valide structuré comme ceci :

{
  "branch": "feature/name-kebab",
  "title": "feat: short title",
  "body": "## Summary\\n...\\n\\n## Changes\\n...",
  "changes": [
    { "path": "src/foo.ts", "content": "<full new file content>", "message": "feat: add foo" }
  ]
}

Règles :
- Le contenu de chaque fichier doit être COMPLET (pas de diff)
- Reste minimal : ne change pas ce qui n'est pas demandé
- Si tu ne peux pas faire la modification sans plus d'info, retourne changes: [] et explique dans body
- Pas de commentaires sur ton processus de réflexion en dehors du JSON
- Ne crée jamais plus de 10 fichiers par PR

Réponds UNIQUEMENT avec le JSON, rien d'autre.`;

    const userPrompt = `Instruction: ${instruction}

${contextHint ? `Contexte additionnel: ${contextHint}\n\n` : ''}Liste des fichiers du repo (.ts/.tsx/.prisma/.md) :
${fileList.join('\n')}

Propose les changements de code.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new ExternalApiError('anthropic', `${res.status} ${txt}`);
    }
    const data = await res.json() as { content: { type: string; text: string }[] };
    const text = data.content.find((c) => c.type === 'text')?.text ?? '{}';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude did not return JSON');
    return JSON.parse(match[0]) as ProposedPR;
  },
};

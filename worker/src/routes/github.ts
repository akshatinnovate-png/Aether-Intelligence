import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { type AppEnv, type C, type Env, bad, body, canManageProject, decrypt, encrypt, forbidden, getSetting, hmacHex, HttpError, now, safeEqual, setSetting, token } from '../lib/core';
import { COOKIE, ctxOf, requireAuth, userFromRequest } from '../lib/auth';
import { type Ctx, publish, record } from '../lib/events';
import { taskSideEffects } from './work';

export const github = new Hono<AppEnv>();
const API = 'https://api.github.com';

export async function ghToken(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT github_token_enc FROM users WHERE id=?`).bind(userId).first<{ github_token_enc: string | null }>();
  return decrypt(env, row?.github_token_enc);
}

export async function gh<T = unknown>(tok: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'aether-lab-os',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return null as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (data as { message?: string })?.message ?? res.statusText;
    throw new HttpError(res.status === 401 ? 400 : res.status >= 500 ? 502 : res.status, `GitHub: ${msg}`);
  }
  return data as T;
}

async function requireToken(c: C) {
  const t = await ghToken(c.env, c.get('user').id);
  if (!t) throw new HttpError(412, 'Connect your GitHub account first (Settings → Integrations).');
  return t;
}

// ---------- OAuth (public callback, authenticated start) ----------
github.get('/connect', async (c) => {
  const found = await userFromRequest(c.env, getCookie(c, COOKIE));
  if (!found) return c.redirect('/login');
  const clientId = await getSetting(c.env, 'github_client_id');
  if (!clientId) return c.redirect('/settings/integrations?github=not_configured');
  const nonce = token(12);
  const payload = `${found.user.id}.${Date.now()}.${nonce}`;
  const sig = await hmacHex(await secretFor(c.env), payload);
  const state = `${payload}.${sig}`;
  const redirect = `${new URL(c.req.url).origin}/api/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent('repo read:user user:email workflow')}&state=${encodeURIComponent(state)}`;
  return c.redirect(url);
});
async function secretFor(env: Env) {
  const { appSecret } = await import('../lib/core');
  return appSecret(env);
}

github.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state') ?? '';
  const [uid, ts, nonce, sig] = state.split('.');
  if (!code || !uid || !sig) return c.redirect('/settings/integrations?github=error');
  const expect = await hmacHex(await secretFor(c.env), `${uid}.${ts}.${nonce}`);
  if (!safeEqual(expect, sig) || Date.now() - Number(ts) > 15 * 60_000) return c.redirect('/settings/integrations?github=expired');
  const found = await userFromRequest(c.env, getCookie(c, COOKIE));
  if (!found || found.user.id !== uid) return c.redirect('/login');
  const [clientId, clientSecret] = await Promise.all([getSetting(c.env, 'github_client_id'), getSetting(c.env, 'github_client_secret')]);
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'aether-lab-os' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: `${new URL(c.req.url).origin}/api/github/callback` }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!data.access_token) return c.redirect(`/settings/integrations?github=error&reason=${encodeURIComponent(data.error_description ?? 'token exchange failed')}`);
  const me = await gh<{ login: string }>(data.access_token, '/user');
  await c.env.DB.prepare(`UPDATE users SET github_token_enc=?, github_login=?, updated_at=? WHERE id=?`).bind(await encrypt(c.env, data.access_token), me.login, now(), uid).run();
  const ctx = ctxOf(c);
  await publish(ctx, 'users', [uid]);
  await record(ctx, { actorId: uid, verb: 'connected', entityType: 'user', entityId: uid, summary: `connected GitHub as @${me.login}` });
  return c.redirect('/code?connected=1');
});

// ---------- webhook (public, HMAC-verified) ----------
github.post('/webhook', async (c) => {
  const secret = await getSetting(c.env, 'github_webhook_secret');
  const raw = new Uint8Array(await c.req.arrayBuffer());
  const sig = c.req.header('x-hub-signature-256') ?? '';
  if (!secret || !safeEqual(`sha256=${await hmacHex(secret, raw)}`, sig)) throw new HttpError(401, 'Bad signature');
  const event = c.req.header('x-github-event');
  const payload = JSON.parse(new TextDecoder().decode(raw));
  const repo: string = payload.repository?.full_name ?? '';
  const project = await c.env.DB.prepare(`SELECT id, key, name, lead_id FROM projects WHERE repo_full_name=? COLLATE NOCASE`).bind(repo).first<{ id: string; key: string; name: string; lead_id: string | null }>();
  const ctx = ctxOf(c);
  if (event === 'ping') return c.json({ ok: true });
  if (event === 'push') await onPush(ctx, payload, project);
  else if (event === 'pull_request' && project) await onPullRequest(ctx, payload, project);
  else if (event === 'workflow_run' && project && payload.action === 'completed') {
    const run = payload.workflow_run;
    if (run.conclusion === 'failure') {
      await record(ctx, {
        actorId: null,
        verb: 'ci_failed',
        entityType: 'project',
        entityId: project.id,
        projectId: project.id,
        summary: `CI failed on ${repo}@${run.head_branch}: ${run.name}`,
        data: { url: run.html_url },
        notify: [{ userIds: [project.lead_id], kind: 'github', title: `CI failed: ${run.name} on ${run.head_branch}`, body: repo, link: `/code/${repo}?tab=actions`, dedupe: `ci:${run.id}` }],
      });
    }
  }
  return c.json({ ok: true });
});

const KEY_RE = /\b([A-Z][A-Z0-9]{1,6})-(\d+)\b/g;
const CLOSE_RE = /\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|done)\s+([A-Z][A-Z0-9]{1,6}-\d+)/gi;

async function linkCommits(ctx: Ctx, repo: string, commits: { id: string; message: string; url: string; author?: { name?: string; username?: string }; timestamp?: string }[], branch: string) {
  const db = ctx.env.DB;
  const touched = new Set<string>();
  for (const cm of commits) {
    const keys = new Set([...cm.message.matchAll(KEY_RE)].map((m) => `${m[1]}-${m[2]}`));
    const closes = new Set([...cm.message.matchAll(CLOSE_RE)].map((m) => m[1].toUpperCase()));
    for (const key of keys) {
      const [pkey, num] = key.split('-');
      const t = await db
        .prepare(`SELECT t.*, p.key AS pkey, p.name AS pname FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.key=? AND t.number=?`)
        .bind(pkey, Number(num))
        .first<{ id: string; project_id: string; number: number; title: string; status: string; assignee_id: string | null; reporter_id: string | null; due_date: string | null; priority: string; pkey: string; pname: string }>();
      if (!t) continue;
      await db
        .prepare(`INSERT OR IGNORE INTO task_commits (task_id, repo, sha, message, author, url, created_at) VALUES (?,?,?,?,?,?,?)`)
        .bind(t.id, repo, cm.id, cm.message.slice(0, 2000), cm.author?.username ?? cm.author?.name ?? 'unknown', cm.url, cm.timestamp ?? now())
        .run();
      touched.add(t.id);
      const author = cm.author?.username ? await db.prepare(`SELECT id, name FROM users WHERE github_login=? COLLATE NOCASE`).bind(cm.author.username).first<{ id: string; name: string }>() : null;
      if (closes.has(key) && t.status !== 'done') {
        await db.prepare(`UPDATE tasks SET status='done', completed_at=?, updated_at=? WHERE id=?`).bind(now(), now(), t.id).run();
        await taskSideEffects(ctx, { id: author?.id ?? null, name: author?.name ?? cm.author?.name ?? 'GitHub' }, t, { status: 'done' }, `via commit ${cm.id.slice(0, 7)} on ${branch}`);
      } else if (t.status === 'todo' || t.status === 'backlog') {
        await db.prepare(`UPDATE tasks SET status='in_progress', updated_at=? WHERE id=?`).bind(now(), t.id).run();
        await taskSideEffects(ctx, { id: author?.id ?? null, name: author?.name ?? 'GitHub' }, t, { status: 'in_progress' }, `via commit ${cm.id.slice(0, 7)}`);
      }
    }
  }
  if (touched.size) await publish(ctx, 'tasks', [...touched]);
}

async function onPush(ctx: Ctx, p: { ref: string; repository: { full_name: string }; commits: { id: string; message: string; url: string; author?: { name?: string; username?: string } }[]; pusher?: { name?: string }; compare?: string }, project: { id: string; key: string; name: string } | null) {
  const branch = p.ref.replace('refs/heads/', '');
  const commits = p.commits ?? [];
  if (!commits.length) return;
  await linkCommits(ctx, p.repository.full_name, commits, branch);
  if (project) {
    const actor = p.pusher?.name ? await ctx.env.DB.prepare(`SELECT id FROM users WHERE github_login=? COLLATE NOCASE`).bind(p.pusher.name).first<{ id: string }>() : null;
    await record(ctx, {
      actorId: actor?.id ?? null,
      verb: 'pushed',
      entityType: 'project',
      entityId: project.id,
      projectId: project.id,
      summary: `${actor ? '' : `@${p.pusher?.name ?? 'someone'} `}pushed ${commits.length} commit${commits.length > 1 ? 's' : ''} to ${p.repository.full_name}@${branch}`,
      data: { url: p.compare, messages: commits.slice(0, 5).map((c) => c.message.split('\n')[0]) },
    });
  }
}

async function onPullRequest(ctx: Ctx, p: { action: string; pull_request: { number: number; title: string; html_url: string; merged: boolean; user: { login: string }; body?: string }; repository: { full_name: string } }, project: { id: string; key: string; name: string; lead_id: string | null }) {
  const pr = p.pull_request;
  const verb = p.action === 'closed' ? (pr.merged ? 'merged' : 'closed') : p.action;
  if (!['opened', 'merged', 'closed', 'ready_for_review', 'reopened'].includes(verb)) return;
  const actor = await ctx.env.DB.prepare(`SELECT id FROM users WHERE github_login=? COLLATE NOCASE`).bind(pr.user.login).first<{ id: string }>();
  await record(ctx, {
    actorId: actor?.id ?? null,
    verb: `pr_${verb}`,
    entityType: 'project',
    entityId: project.id,
    projectId: project.id,
    summary: `${actor ? '' : `@${pr.user.login} `}${verb} PR #${pr.number} “${pr.title}” in ${p.repository.full_name}`,
    data: { url: pr.html_url },
    notify: verb === 'opened' ? [{ userIds: [project.lead_id], kind: 'github', title: `PR #${pr.number} opened: ${pr.title}`, body: p.repository.full_name, link: `/code/${p.repository.full_name}?tab=pulls&pr=${pr.number}` }] : [],
  });
  // Merging a PR that says "fixes ABC-12" completes the task.
  if (verb === 'merged') await linkCommits(ctx, p.repository.full_name, [{ id: `pr-${pr.number}`, message: `${pr.title}\n${pr.body ?? ''}`, url: pr.html_url, author: { username: pr.user.login } }], 'merged PR');
}

// ---------- authenticated API ----------
github.use('/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.endsWith('/callback') || path.endsWith('/webhook') || path.endsWith('/connect')) return next();
  return requireAuth(c, next);
});

github.get('/status', async (c) => {
  const me = c.get('user');
  const [clientId, row] = await Promise.all([
    getSetting(c.env, 'github_client_id'),
    c.env.DB.prepare(`SELECT github_login, github_token_enc FROM users WHERE id=?`).bind(me.id).first<{ github_login: string | null; github_token_enc: string | null }>(),
  ]);
  return c.json({ configured: !!clientId, connected: !!row?.github_token_enc, login: row?.github_login ?? null, callbackUrl: `${new URL(c.req.url).origin}/api/github/callback` });
});

github.post('/disconnect', async (c) => {
  const me = c.get('user');
  await c.env.DB.prepare(`UPDATE users SET github_token_enc=NULL, github_login=NULL WHERE id=?`).bind(me.id).run();
  await publish(ctxOf(c), 'users', [me.id]);
  return c.json({ ok: true });
});

/** Generic pass-through for reads and simple writes, scoped to the signed-in user's own token. */
github.all('/api/*', async (c) => {
  const tok = await requireToken(c);
  const url = new URL(c.req.url);
  const path = url.pathname.replace(/^\/api\/github\/api/, '') + url.search;
  if (!/^\/(user|repos|orgs|search|rate_limit|users)\b/.test(path)) throw forbidden('That GitHub endpoint is not available here.');
  const method = c.req.method;
  const init: RequestInit = { method };
  if (method !== 'GET' && method !== 'HEAD') {
    const b = await c.req.text();
    if (b) init.body = b;
  }
  const accept = c.req.header('x-gh-accept');
  if (accept) init.headers = { Accept: accept };
  if (accept && accept.includes('raw')) {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${tok}`, Accept: accept, 'User-Agent': 'aether-lab-os', 'X-GitHub-Api-Version': '2022-11-28' } });
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'text/plain' } });
  }
  const data = await gh(tok, path, init);
  if (method !== 'GET') {
    const me = c.get('user');
    const m = /^\/repos\/([^/]+\/[^/]+)\/(pulls|merges|git\/refs|branches)/.exec(path);
    if (m) await record(ctxOf(c), { actorId: me.id, verb: 'github', entityType: 'repo', entityId: m[1], summary: describeWrite(method, path, m[1], data) });
  }
  return c.json(data as object);
});

function describeWrite(method: string, path: string, repo: string, data: unknown): string {
  const d = data as { number?: number; title?: string; ref?: string; merged?: boolean };
  if (/\/pulls\/\d+\/merge$/.test(path)) return `merged a pull request in ${repo}`;
  if (/\/pulls$/.test(path) && method === 'POST') return `opened PR #${d?.number} “${d?.title}” in ${repo}`;
  if (/\/git\/refs$/.test(path) && method === 'POST') return `created branch ${String(d?.ref ?? '').replace('refs/heads/', '')} in ${repo}`;
  if (/\/git\/refs\//.test(path) && method === 'DELETE') return `deleted a branch in ${repo}`;
  return `updated ${repo} on GitHub`;
}

github.post('/repos', async (c) => {
  const me = c.get('user');
  if (me.role === 'guest') throw forbidden();
  const tok = await requireToken(c);
  const b = await body(c);
  const name = String(b.name ?? '').trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw bad('Repository names may use letters, numbers, ".", "-" and "_".');
  const payload = { name, description: String(b.description ?? '').slice(0, 300), private: !!b.private, auto_init: b.autoInit !== false, gitignore_template: b.gitignore || undefined, license_template: b.license || undefined };
  const repo = await gh<{ full_name: string; html_url: string }>(tok, b.org ? `/orgs/${encodeURIComponent(String(b.org))}/repos` : '/user/repos', { method: 'POST', body: JSON.stringify(payload) });
  await record(ctxOf(c), { actorId: me.id, verb: 'created', entityType: 'repo', entityId: repo.full_name, summary: `created repository ${repo.full_name}`, data: { url: repo.html_url } });
  if (b.projectId) await linkRepo(c, String(b.projectId), repo.full_name, tok);
  return c.json(repo);
});

interface FileChange {
  path: string;
  content?: string | null; // null = delete
  encoding?: 'utf-8' | 'base64';
}

/** One commit with any number of file changes, via the Git Data API. */
github.post('/commit', async (c) => {
  const me = c.get('user');
  if (me.role === 'guest') throw forbidden();
  const tok = await requireToken(c);
  const b = await body(c);
  const repo = String(b.repo ?? '');
  const branch = String(b.branch ?? '');
  const message = String(b.message ?? '').trim();
  const files = (b.files as FileChange[]) ?? [];
  if (!/^[^/]+\/[^/]+$/.test(repo)) throw bad('Bad repository.');
  if (!branch) throw bad('Branch is required.');
  if (!message) throw bad('Commit message is required.');
  if (!files.length) throw bad('No changes to commit.');
  const R = `/repos/${repo}`;
  let baseSha: string | null = null;
  let baseTree: string | null = null;
  try {
    const ref = await gh<{ object: { sha: string } }>(tok, `${R}/git/ref/heads/${encodeURIComponent(branch)}`);
    baseSha = ref.object.sha;
    const commit = await gh<{ tree: { sha: string } }>(tok, `${R}/git/commits/${baseSha}`);
    baseTree = commit.tree.sha;
  } catch (e) {
    if (!(e instanceof HttpError) || (e.status !== 404 && e.status !== 409)) throw e;
    if (b.fromBranch) {
      // Create the branch from another one first.
      const src = await gh<{ object: { sha: string } }>(tok, `${R}/git/ref/heads/${encodeURIComponent(String(b.fromBranch))}`);
      await gh(tok, `${R}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: src.object.sha }) });
      baseSha = src.object.sha;
      baseTree = (await gh<{ tree: { sha: string } }>(tok, `${R}/git/commits/${baseSha}`)).tree.sha;
    }
    // Otherwise: empty repository — first commit has no parent.
  }
  const tree = [];
  for (const f of files) {
    const path = f.path.replace(/^\/+/, '');
    if (!path || path.includes('..')) throw bad(`Bad path: ${f.path}`);
    if (f.content === null || f.content === undefined) {
      tree.push({ path, mode: '100644', type: 'blob', sha: null });
    } else {
      const blob = await gh<{ sha: string }>(tok, `${R}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: f.content, encoding: f.encoding ?? 'utf-8' }) });
      tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
  }
  const newTree = await gh<{ sha: string }>(tok, `${R}/git/trees`, { method: 'POST', body: JSON.stringify(baseTree ? { base_tree: baseTree, tree } : { tree: tree.filter((t) => t.sha) }) });
  const commit = await gh<{ sha: string; html_url: string }>(tok, `${R}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: baseSha ? [baseSha] : [] }),
  });
  if (baseSha) await gh(tok, `${R}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
  else await gh(tok, `${R}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) });
  const ctx = ctxOf(c);
  const login = (await c.env.DB.prepare(`SELECT github_login FROM users WHERE id=?`).bind(me.id).first<{ github_login: string }>())?.github_login;
  // Link task keys in the message immediately (the webhook will also arrive; inserts are idempotent).
  await linkCommits(ctx, repo, [{ id: commit.sha, message, url: commit.html_url, author: { username: login, name: me.name } }], branch);
  const project = await c.env.DB.prepare(`SELECT id FROM projects WHERE repo_full_name=? COLLATE NOCASE`).bind(repo).first<{ id: string }>();
  await record(ctx, { actorId: me.id, verb: 'committed', entityType: 'repo', entityId: repo, projectId: project?.id ?? null, summary: `committed “${message.split('\n')[0].slice(0, 80)}” to ${repo}@${branch}`, data: { url: commit.html_url, sha: commit.sha, files: files.length } });
  return c.json({ sha: commit.sha, url: commit.html_url });
});

/** Link a repository to a project and install the webhook that streams pushes, PRs and CI back. */
github.post('/link', async (c) => {
  const b = await body(c);
  const tok = await requireToken(c);
  const projectId = String(b.projectId ?? '');
  if (!(await canManageProject(c.env, c.get('user'), projectId))) throw forbidden('Only the project lead or an admin can link a repository.');
  return c.json(await linkRepo(c, projectId, String(b.repo ?? ''), tok));
});

async function linkRepo(c: C, projectId: string, repo: string, tok: string) {
  if (!/^[^/]+\/[^/]+$/.test(repo)) throw bad('Bad repository.');
  const me = c.get('user');
  const p = await c.env.DB.prepare(`SELECT name, webhook_id, repo_full_name FROM projects WHERE id=?`).bind(projectId).first<{ name: string; webhook_id: number | null; repo_full_name: string | null }>();
  if (!p) throw bad('Unknown project.');
  let secret = await getSetting(c.env, 'github_webhook_secret');
  if (!secret) {
    secret = token(24);
    await setSetting(c.env, 'github_webhook_secret', secret);
  }
  const origin = new URL(c.req.url).origin;
  let webhookId: number | null = null;
  let webhook = 'skipped';
  if (!/localhost|127\.0\.0\.1/.test(origin)) {
    try {
      const hook = await gh<{ id: number }>(tok, `/repos/${repo}/hooks`, {
        method: 'POST',
        body: JSON.stringify({ name: 'web', active: true, events: ['push', 'pull_request', 'workflow_run'], config: { url: `${origin}/api/github/webhook`, content_type: 'json', secret, insecure_ssl: '0' } }),
      });
      webhookId = hook.id;
      webhook = 'installed';
    } catch (e) {
      webhook = e instanceof Error && /already exists/i.test(e.message) ? 'installed' : `failed: ${e instanceof Error ? e.message : e}`;
    }
  }
  await c.env.DB.prepare(`UPDATE projects SET repo_full_name=?, webhook_id=?, updated_at=? WHERE id=?`).bind(repo, webhookId, now(), projectId).run();
  const ctx = ctxOf(c);
  await publish(ctx, 'projects', [projectId]);
  await record(ctx, { actorId: me.id, verb: 'linked', entityType: 'project', entityId: projectId, projectId, summary: `linked ${repo} to ${p.name}` });
  return { ok: true, webhook };
}

github.post('/unlink', async (c) => {
  const b = await body(c);
  const projectId = String(b.projectId ?? '');
  const me = c.get('user');
  if (!(await canManageProject(c.env, me, projectId))) throw forbidden();
  const p = await c.env.DB.prepare(`SELECT name, webhook_id, repo_full_name FROM projects WHERE id=?`).bind(projectId).first<{ name: string; webhook_id: number | null; repo_full_name: string | null }>();
  if (!p) throw bad('Unknown project.');
  const tok = await ghToken(c.env, me.id);
  if (tok && p.webhook_id && p.repo_full_name) await gh(tok, `/repos/${p.repo_full_name}/hooks/${p.webhook_id}`, { method: 'DELETE' }).catch(() => null);
  await c.env.DB.prepare(`UPDATE projects SET repo_full_name=NULL, webhook_id=NULL, updated_at=? WHERE id=?`).bind(now(), projectId).run();
  const ctx = ctxOf(c);
  await publish(ctx, 'projects', [projectId]);
  await record(ctx, { actorId: me.id, verb: 'unlinked', entityType: 'project', entityId: projectId, projectId, summary: `unlinked ${p.repo_full_name} from ${p.name}` });
  return c.json({ ok: true });
});

import type { Context } from 'hono';
import type { Hub } from '../hub';

export interface Env {
  DB: D1Database;
  HUB: DurableObjectNamespace<Hub>;
  ASSETS: Fetcher;
  APP_SECRET?: string;
  APP_URL?: string;
}

export type Role = 'owner' | 'admin' | 'lead' | 'member' | 'guest';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  prefs: Record<string, unknown>;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser; sessionId: string } };
export type C = Context<AppEnv>;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const bad = (msg: string) => new HttpError(400, msg);
export const forbidden = (msg = 'You do not have permission to do that.') => new HttpError(403, msg);
export const notFound = (what = 'Item') => new HttpError(404, `${what} not found.`);

// ---------- ids, time ----------
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export function id(prefix: string, len = 14): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 36];
  return `${prefix}_${s}`;
}
export const now = () => new Date().toISOString();
export function token(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// ---------- encoding ----------
export function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const enc = new TextEncoder();
const dec = new TextDecoder();

export async function sha256(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}
export async function hmacHex(secret: string, data: string | Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- passwords (PBKDF2-SHA256; Workers cap iterations at 100k) ----------
const PBKDF2_ITER = 100_000;
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(hash)}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split('$');
  if (algo !== 'pbkdf2') return false;
  const got = await pbkdf2(password, fromB64url(salt), Number(iter));
  return safeEqual(b64url(got), hash);
}
async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

// ---------- secret encryption (AES-GCM, key derived from APP_SECRET) ----------
let cachedKey: { secret: string; key: CryptoKey } | null = null;
async function aesKey(env: Env): Promise<CryptoKey> {
  const secret = await appSecret(env);
  if (cachedKey?.secret === secret) return cachedKey.key;
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`aether-aes:${secret}`));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  cachedKey = { secret, key };
  return key;
}
/** APP_SECRET is a Worker secret. If it is missing (first local run), one is generated and kept in D1. */
export async function appSecret(env: Env): Promise<string> {
  if (env.APP_SECRET && env.APP_SECRET.length >= 16) return env.APP_SECRET;
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key='_fallback_secret'`).first<{ value: string }>();
  if (row) return row.value;
  const s = token(32);
  await env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('_fallback_secret', ?, ?)`).bind(s, now()).run();
  const again = await env.DB.prepare(`SELECT value FROM settings WHERE key='_fallback_secret'`).first<{ value: string }>();
  return again!.value;
}
export async function encrypt(env: Env, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(plain));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}
export async function decrypt(env: Env, blob: string | null | undefined): Promise<string | null> {
  if (!blob) return null;
  try {
    const [, iv, ct] = blob.split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await aesKey(env), fromB64url(ct));
    return dec.decode(pt);
  } catch {
    return null;
  }
}

// ---------- settings ----------
const SECRET_SETTINGS = new Set(['smtp_pass', 'github_client_secret', 'github_webhook_secret']);
export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key=?`).bind(key).first<{ value: string }>();
  if (!row) return null;
  return SECRET_SETTINGS.has(key) ? decrypt(env, row.value) : row.value;
}
export async function setSetting(env: Env, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await env.DB.prepare(`DELETE FROM settings WHERE key=?`).bind(key).run();
    return;
  }
  const stored = SECRET_SETTINGS.has(key) ? await encrypt(env, value) : value;
  await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .bind(key, stored, now())
    .run();
}

// ---------- roles ----------
export const RANK: Record<Role, number> = { guest: 1, member: 2, lead: 3, admin: 4, owner: 5 };
export const isAdmin = (u: SessionUser) => RANK[u.role] >= RANK.admin;
export function requireRank(u: SessionUser, role: Role) {
  if (RANK[u.role] < RANK[role]) throw forbidden();
}

/** Projects a user may write tasks in. Admins: all. Others: projects they belong to or lead. Guests: none. */
export async function canWriteProject(env: Env, u: SessionUser, projectId: string): Promise<boolean> {
  if (isAdmin(u)) return true;
  if (u.role === 'guest') return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM projects p WHERE p.id=? AND (p.lead_id=? OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?))`,
  )
    .bind(projectId, u.id, u.id)
    .first();
  return !!row;
}
export async function assertWriteProject(env: Env, u: SessionUser, projectId: string) {
  if (!(await canWriteProject(env, u, projectId))) throw forbidden('Only members of this project can change it.');
}
export async function canManageProject(env: Env, u: SessionUser, projectId: string): Promise<boolean> {
  if (isAdmin(u)) return true;
  if (u.role !== 'lead') return false;
  const row = await env.DB.prepare(`SELECT 1 FROM projects WHERE id=? AND lead_id=?`).bind(projectId, u.id).first();
  return !!row;
}
/** For guests: the project ids they can see. null = no restriction. */
export async function visibleProjects(env: Env, u: SessionUser): Promise<string[] | null> {
  if (u.role !== 'guest') return null;
  const rs = await env.DB.prepare(`SELECT project_id FROM project_members WHERE user_id=?`).bind(u.id).all<{ project_id: string }>();
  return rs.results.map((r) => r.project_id);
}

// ---------- row shaping ----------
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export function toApi<T = Record<string, unknown>>(row: Record<string, unknown> | null, json: string[] = [], bools: string[] = [], omit: string[] = []): T {
  if (!row) return row as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (omit.includes(k)) continue;
    let val: unknown = v;
    if (json.includes(k)) {
      try {
        val = typeof v === 'string' ? JSON.parse(v) : v ?? null;
      } catch {
        val = null;
      }
    } else if (bools.includes(k)) val = !!v;
    out[camel(k)] = val;
  }
  return out as T;
}

// ---------- input specs ----------
type FieldType = 'string' | 'text' | 'int' | 'num' | 'bool' | 'json' | 'date' | 'datetime' | 'enum' | 'id';
export interface Field {
  col: string;
  type: FieldType;
  values?: readonly string[];
  max?: number;
  required?: boolean;
  nullable?: boolean;
}
export type Spec = Record<string, Field>;

export function coerce(key: string, f: Field, v: unknown): unknown {
  if (v === null || v === undefined || v === '') {
    if (f.required) throw bad(`${key} is required.`);
    if (f.type === 'string' || f.type === 'text') return f.nullable ? null : '';
    if (f.type === 'json') return f.nullable ? null : '[]';
    if (f.type === 'bool') return 0;
    return null;
  }
  switch (f.type) {
    case 'string':
    case 'text': {
      const s = String(v).trim();
      const max = f.max ?? (f.type === 'string' ? 300 : 100_000);
      if (s.length > max) throw bad(`${key} is too long (max ${max}).`);
      if (f.required && !s) throw bad(`${key} is required.`);
      return s;
    }
    case 'id':
      return String(v);
    case 'int': {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n)) throw bad(`${key} must be a number.`);
      return n;
    }
    case 'num': {
      const n = Number(v);
      if (!Number.isFinite(n)) throw bad(`${key} must be a number.`);
      return n;
    }
    case 'bool':
      return v === true || v === 1 || v === 'true' ? 1 : 0;
    case 'json':
      return JSON.stringify(v);
    case 'date': {
      const s = String(v).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad(`${key} must be a date (YYYY-MM-DD).`);
      return s;
    }
    case 'datetime': {
      const d = new Date(String(v));
      if (isNaN(d.getTime())) throw bad(`${key} must be a date-time.`);
      return d.toISOString();
    }
    case 'enum': {
      const s = String(v);
      if (!f.values!.includes(s)) throw bad(`${key} must be one of ${f.values!.join(', ')}.`);
      return s;
    }
  }
}

/** Pick known fields from body. On create, all spec fields with defaults are not required unless marked. */
export function pick(body: Record<string, unknown>, spec: Spec, mode: 'create' | 'update'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, f] of Object.entries(spec)) {
    if (key in body) out[f.col] = coerce(key, f, body[key]);
    else if (mode === 'create' && f.required) throw bad(`${key} is required.`);
  }
  return out;
}
export function insertSql(table: string, data: Record<string, unknown>): { sql: string; args: unknown[] } {
  const cols = Object.keys(data);
  return { sql: `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, args: cols.map((c) => data[c]) };
}
export function updateSql(table: string, idVal: string, data: Record<string, unknown>): { sql: string; args: unknown[] } | null {
  const cols = Object.keys(data);
  if (!cols.length) return null;
  return { sql: `UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`, args: [...cols.map((c) => data[c]), idVal] };
}
export async function run(db: D1Database, q: { sql: string; args: unknown[] } | null) {
  if (!q) return;
  await db.prepare(q.sql).bind(...q.args).run();
}
export async function body(c: C): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

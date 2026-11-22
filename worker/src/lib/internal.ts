import type { Hono } from 'hono';
import type { AppEnv, C } from './core';

/**
 * Lets server code (the assistant) call Aether's own API as the signed-in user, with the same
 * permission checks, side effects, notifications and realtime updates as a click in the app.
 */
let app: Hono<AppEnv> | null = null;
export const setInternalApp = (a: Hono<AppEnv>) => {
  app = a;
};

export async function callApi<T = unknown>(c: C, method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  if (!app) throw new Error('internal app not registered');
  const origin = new URL(c.req.url).origin;
  const headers: Record<string, string> = { 'x-aether': '1', cookie: c.req.header('cookie') ?? '' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, c.env, c.executionCtx);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

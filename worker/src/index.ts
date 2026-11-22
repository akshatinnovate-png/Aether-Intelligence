import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { type AppEnv, type Env, HttpError } from './lib/core';
import { COOKIE, requireAuth, userFromRequest } from './lib/auth';
import { hub } from './lib/events';
import { runSchedule } from './lib/cron';
import { auth } from './routes/auth';
import { team } from './routes/team';
import { work } from './routes/work';
import { lab } from './routes/lab';
import { chat } from './routes/chat';
import { github } from './routes/github';
import { system } from './routes/system';
import { deliver } from './routes/deliver';
import { assistant } from './routes/assistant';
import { setInternalApp } from './lib/internal';

export { Hub } from './hub';

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: 'Something went wrong on the server.' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

// Realtime: authenticate, then hand the socket to the Durable Object.
app.get('/api/ws', async (c) => {
  const found = await userFromRequest(c.env, getCookie(c, COOKIE));
  if (!found) return c.text('Unauthorized', 401);
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-user-id', found.user.id);
  headers.set('x-user-role', found.user.role);
  return hub(c.env).fetch(new Request(c.req.raw.url, { headers, method: 'GET' }));
});

app.route('/api/auth', auth);
app.route('/api/github', github);

const api = new Hono<AppEnv>();
api.use('*', requireAuth);
api.route('/', team);
api.route('/', work);
api.route('/', lab);
api.route('/', chat);
api.route('/', system);
api.route('/', deliver);
api.route('/', assistant);
app.route('/api', api);
setInternalApp(app);

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Everything else is the single-page app (served by the assets binding with SPA fallback).
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSchedule(env, ctx));
  },
} satisfies ExportedHandler<Env>;

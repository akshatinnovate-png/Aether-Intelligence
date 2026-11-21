import { DurableObject } from 'cloudflare:workers';
import type { Env } from './lib/core';

interface Attachment {
  userId: string;
  role: string;
}

/**
 * One Durable Object holds every live WebSocket for the lab. It uses the hibernation API, so idle
 * connections cost nothing. Workers call broadcast() over RPC after each write.
 */
export class Hub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const userId = request.headers.get('x-user-id');
    const role = request.headers.get('x-user-role') ?? 'member';
    if (!userId) return new Response('Unauthorized', { status: 401 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId, role } satisfies Attachment);
    server.send(JSON.stringify({ t: 'hello', online: this.online() }));
    this.sendPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  private online(): string[] {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a) ids.add(a.userId);
    }
    return [...ids];
  }

  private sendPresence() {
    const msg = JSON.stringify({ t: 'presence', online: this.online() });
    for (const ws of this.ctx.getWebSockets()) safeSend(ws, msg);
  }

  async broadcast(payload: string, opts: { to?: string[]; guests?: 'send' | 'skip' | 'refresh' } = {}): Promise<number> {
    const to = opts.to ? new Set(opts.to) : null;
    let refresh: string | null = null;
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a) continue;
      if (to && !to.has(a.userId)) continue;
      if (a.role === 'guest' && !to) {
        if (opts.guests === 'skip') continue;
        if (opts.guests === 'refresh') {
          refresh ??= JSON.stringify({ t: 'refresh', e: (JSON.parse(payload) as { e?: string }).e });
          safeSend(ws, refresh);
          continue;
        }
      }
      safeSend(ws, payload);
      sent++;
    }
    return sent;
  }

  async onlineUsers(): Promise<string[]> {
    return this.online();
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 2000) return;
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a) return;
    let msg: { t?: string; channelId?: string };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg.t === 'ping') safeSend(ws, JSON.stringify({ t: 'pong' }));
    else if (msg.t === 'typing' && typeof msg.channelId === 'string') {
      const out = JSON.stringify({ t: 'typing', channelId: msg.channelId, userId: a.userId });
      for (const other of this.ctx.getWebSockets()) if (other !== ws) safeSend(other, out);
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    const a = ws.deserializeAttachment() as Attachment | null;
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
    if (a) {
      await this.env.DB.prepare(`UPDATE users SET last_seen_at=? WHERE id=?`).bind(new Date().toISOString(), a.userId).run().catch(() => {});
    }
    this.sendPresence();
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1011);
  }
}

function safeSend(ws: WebSocket, msg: string) {
  try {
    ws.send(msg);
  } catch {
    /* socket closing */
  }
}

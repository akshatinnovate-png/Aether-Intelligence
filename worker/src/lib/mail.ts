import { connect } from 'cloudflare:sockets';
import { type Env, getSetting } from './core';

/**
 * A small SMTP client over Cloudflare TCP sockets. Built for Gmail (smtp.gmail.com:465 with an App Password)
 * but works with any SMTP server that offers implicit TLS (465) or STARTTLS (587).
 */
export interface MailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

export async function mailConfig(env: Env): Promise<MailConfig | null> {
  const [host, port, user, pass, fromName, fromEmail] = await Promise.all([
    getSetting(env, 'smtp_host'),
    getSetting(env, 'smtp_port'),
    getSetting(env, 'smtp_user'),
    getSetting(env, 'smtp_pass'),
    getSetting(env, 'smtp_from_name'),
    getSetting(env, 'smtp_from_email'),
  ]);
  if (!user || !pass) return null;
  return {
    host: host || 'smtp.gmail.com',
    port: Number(port || 465),
    user,
    pass,
    fromName: fromName || 'Aether',
    fromEmail: fromEmail || user,
  };
}
export async function mailConfigured(env: Env) {
  return !!(await mailConfig(env));
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

class SmtpConn {
  private buf = '';
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private dec = new TextDecoder();
  private enc = new TextEncoder();
  constructor(public socket: Socket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }
  release() {
    this.reader.releaseLock();
    this.writer.releaseLock();
  }
  async read(): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    for (;;) {
      let nl: number;
      while ((nl = this.buf.indexOf('\r\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 2);
        lines.push(line);
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          return { code: Number(line.slice(0, 3)), text: lines.join('\n') };
        }
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error(`SMTP connection closed: ${lines.join(' ') || this.buf}`);
      this.buf += this.dec.decode(value, { stream: true });
    }
  }
  async write(s: string) {
    await this.writer.write(this.enc.encode(s));
  }
  async cmd(line: string, expect: number[], redact = false): Promise<string> {
    await this.write(`${line}\r\n`);
    const r = await this.read();
    if (!expect.includes(r.code)) throw new Error(`SMTP ${redact ? '(auth)' : line.split(' ')[0]} failed: ${r.text}`);
    return r.text;
  }
}

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const wrap76 = (s: string) => s.replace(/.{1,76}/g, '$&\r\n');
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

export async function sendMail(env: Env, mail: Mail, cfgOverride?: MailConfig): Promise<void> {
  const cfg = cfgOverride ?? (await mailConfig(env));
  if (!cfg) throw new Error('Email is not configured. An administrator can add SMTP details in Settings → Email.');
  const implicit = cfg.port === 465;
  let socket = connect({ hostname: cfg.host, port: cfg.port }, { secureTransport: implicit ? 'on' : 'starttls', allowHalfOpen: false });
  let conn = new SmtpConn(socket);
  const timeout = setTimeout(() => socket.close().catch(() => {}), 20_000);
  try {
    const greet = await conn.read();
    if (greet.code !== 220) throw new Error(`SMTP greeting failed: ${greet.text}`);
    let ehlo = await conn.cmd('EHLO aether.local', [250]);
    if (!implicit) {
      if (!/STARTTLS/i.test(ehlo)) throw new Error('SMTP server does not offer STARTTLS on this port.');
      await conn.cmd('STARTTLS', [220]);
      conn.release();
      socket = socket.startTls();
      conn = new SmtpConn(socket);
      ehlo = await conn.cmd('EHLO aether.local', [250]);
    }
    await conn.cmd(`AUTH PLAIN ${b64(`\u0000${cfg.user}\u0000${cfg.pass}`)}`, [235], true);
    await conn.cmd(`MAIL FROM:<${cfg.fromEmail}>`, [250]);
    await conn.cmd(`RCPT TO:<${mail.to}>`, [250, 251]);
    await conn.cmd('DATA', [354]);

    const boundary = `aether-${crypto.randomUUID()}`;
    const domain = cfg.fromEmail.split('@')[1] ?? 'aether.local';
    const headers = [
      `From: ${encodeHeader(cfg.fromName)} <${cfg.fromEmail}>`,
      `To: <${mail.to}>`,
      `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${domain}>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ];
    const parts = [
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(mail.text))}`,
    ];
    if (mail.html) parts.push(`--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(mail.html))}`);
    const data = `${headers.join('\r\n')}\r\n\r\n${parts.join('')}--${boundary}--\r\n`;
    // base64 bodies never start a line with '.', so no dot-stuffing is needed beyond the terminator.
    await conn.write(data);
    await conn.cmd('.', [250]);
    await conn.cmd('QUIT', [221]).catch(() => '');
  } finally {
    clearTimeout(timeout);
    socket.close().catch(() => {});
  }
}

export function emailLayout(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#0b0b0c;padding:32px 16px;font-family:Inter,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e8e8e6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;border:1px solid #262628;background:#121214">
<tr><td style="padding:20px 28px;border-bottom:1px solid #262628;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#9a9a96">Aether · Lab OS</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:26px;line-height:1.25;color:#f4f4f2">${title}</h1>
<div style="font-size:15px;line-height:1.6;color:#c9c9c5">${bodyHtml}</div>
${cta ? `<p style="margin:28px 0 8px"><a href="${cta.url}" style="display:inline-block;background:#d4ff3a;color:#0b0b0c;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px">${cta.label}</a></p><p style="font-size:12px;color:#7a7a76;word-break:break-all">${cta.url}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
}

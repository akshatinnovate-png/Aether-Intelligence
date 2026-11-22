import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Mic, Send, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { qc, useMe } from '../lib/data';
import { can } from '../lib/derive';
import { useUI } from '../lib/store';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  actions?: { label: string; link?: string }[];
  error?: boolean;
}

const SUGGESTIONS = [
  'Ask Soumya to make the pitch deck by Friday and submit me the Google Drive link',
  'What do I need to review?',
  'What is overdue in the lab?',
  'Schedule a team review tomorrow at 5pm with everyone',
  'What is Saharsh working on?',
];

const storeKey = (uid: string) => `aether-assistant:${uid}`;
function load(uid: string): Msg[] {
  try {
    return JSON.parse(localStorage.getItem(storeKey(uid)) ?? '[]');
  } catch {
    return [];
  }
}

type Rec = { start(): void; stop(): void; onresult: ((e: { results: { 0: { transcript: string } }[] & { length: number } }) => void) | null; onend: (() => void) | null; interimResults: boolean; lang: string; continuous: boolean };
const SpeechRec = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

export function AssistantPanel() {
  const open = useUI((s) => s.assistantOpen);
  const setOpen = useUI((s) => s.setAssistant);
  const me = useMe();
  const nav = useNavigate();
  const status = useQuery({ queryKey: ['assistant-status'], queryFn: () => api.get<{ configured: boolean; model: string | null }>('/api/assistant/status'), enabled: open });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const rec = useRef<Rec | null>(null);

  useEffect(() => {
    if (me) setMsgs(load(me.id));
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!me) return;
    try {
      localStorage.setItem(storeKey(me.id), JSON.stringify(msgs.slice(-40)));
    } catch {
      /* storage blocked */
    }
  }, [msgs, me]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 60);
  }, [open]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && open && setOpen(false);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, setOpen]);

  if (!open || !me) return null;
  const send = async (q?: string) => {
    const content = (q ?? text).trim();
    if (!content || busy) return;
    const next: Msg[] = [...msgs, { role: 'user', content }];
    setMsgs(next);
    setText('');
    setBusy(true);
    try {
      const r = await api.post<{ reply: string; actions: Msg['actions'] }>('/api/assistant', { messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) });
      setMsgs([...next, { role: 'assistant', content: r.reply, actions: r.actions }]);
      if (r.actions?.length) qc.invalidateQueries({ queryKey: ['submissions'] });
    } catch (e) {
      setMsgs([...next, { role: 'assistant', content: e instanceof Error ? e.message : String(e), error: true }]);
    } finally {
      setBusy(false);
    }
  };
  const mic = () => {
    if (!SpeechRec) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new SpeechRec();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => setText(Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join(''));
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };
  const notReady = status.data && !status.data.configured;
  return createPortal(
    <aside className="assistant-panel" role="dialog" aria-label="Ask Aether">
      <div className="assistant-head">
        <Sparkles size={15} className="accent-text" />
        <div className="grow">
          <div style={{ fontWeight: 600 }}>Ask Aether</div>
          <div className="xs muted">Say what you need. It assigns, schedules, messages and reviews for you.</div>
        </div>
        {msgs.length > 0 && (
          <button className="btn ghost icon sm" title="Clear conversation" onClick={() => setMsgs([])}>
            <Trash2 />
          </button>
        )}
        <button className="btn ghost icon sm" onClick={() => setOpen(false)} aria-label="Close">
          <X />
        </button>
      </div>
      <div className="assistant-body" ref={box}>
        {notReady ? (
          <div className="empty">
            <Sparkles />
            <div className="h2">Not set up yet</div>
            {can(me.role, 'admin') ? (
              <div>
                Add a free Groq API key in{' '}
                <Link to="/settings/assistant" className="accent-text" onClick={() => setOpen(false)}>
                  Settings → Assistant
                </Link>
                . It takes a minute.
              </div>
            ) : (
              <div>Ask an administrator to add a Groq API key in Settings → Assistant.</div>
            )}
          </div>
        ) : msgs.length === 0 ? (
          <div className="col gap-12" style={{ padding: 16 }}>
            <div className="serif" style={{ fontSize: 22, lineHeight: 1.25 }}>What should happen next?</div>
            <div className="small muted">Talk to Aether like you would to a lab manager. Try:</div>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="assistant-suggestion" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : (
          msgs.map((m, i) => (
            <div key={i} className={`amsg ${m.role === 'user' ? 'from-user' : 'from-bot'}${m.error ? ' err' : ''}`}>
              <div className="bubble">{m.content}</div>
              {m.actions?.map((a, j) =>
                a.link ? (
                  <button
                    key={j}
                    className="aaction"
                    onClick={() => {
                      nav(a.link!);
                      if (window.innerWidth < 900) setOpen(false);
                    }}
                  >
                    <span className="dot" style={{ background: 'var(--accent)' }} />
                    <span className="grow" style={{ textAlign: 'left' }}>{a.label}</span>
                    <ArrowUpRight size={13} />
                  </button>
                ) : (
                  <div key={j} className="aaction">
                    {a.label}
                  </div>
                ),
              )}
            </div>
          ))
        )}
        {busy && (
          <div className="amsg from-bot">
            <div className="bubble typing-dots">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>
      <div className="assistant-input">
        <textarea
          ref={input}
          rows={2}
          value={text}
          disabled={!!notReady}
          placeholder={listening ? 'Listening…' : 'e.g. Ask Soumya to make the pitch deck by Friday and submit the Drive link'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="row between" style={{ padding: '0 8px 8px' }}>
          <span className="xs faint">{status.data?.model ? `Groq · ${status.data.model}` : 'Enter to send · Shift+Enter new line'}</span>
          <div className="row gap-4">
            {SpeechRec && (
              <button className={`btn icon sm${listening ? ' on' : ' ghost'}`} title="Speak" onClick={mic} disabled={!!notReady}>
                <Mic style={listening ? { color: 'var(--red)' } : undefined} />
              </button>
            )}
            <button className="btn primary sm" disabled={!text.trim() || busy || !!notReady} onClick={() => send()}>
              <Send /> Send
            </button>
          </div>
        </div>
      </div>
    </aside>,
    document.body,
  );
}

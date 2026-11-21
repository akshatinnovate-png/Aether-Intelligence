import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useUsers } from '../lib/data';
import { Avatar } from './ui';
import type { User } from '../types';

export interface ComposerHandle {
  focus(): void;
  clear(): void;
}

/** Converts "@Full Name" for known people into <@usr_id> tokens. */
export function encodeMentions(text: string, users: User[]) {
  const sorted = [...users].sort((a, b) => b.name.length - a.name.length);
  let out = text;
  for (const u of sorted) {
    const esc = u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`@${esc}(?![\\w])`, 'g'), `<@${u.id}>`);
  }
  return out;
}
export function decodeMentions(text: string, users: User[]) {
  const names = new Map(users.map((u) => [u.id, u.name]));
  return text.replace(/<@(usr_[a-z0-9]+)>/g, (_, id) => `@${names.get(id) ?? 'someone'}`);
}

/** Textarea with @mention autocomplete. Enter sends (Shift+Enter for a new line) unless multiline. */
export const Composer = forwardRef<
  ComposerHandle,
  { value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder?: string; onTyping?: () => void; footer?: ReactNode; multilineEnter?: boolean; autoFocus?: boolean; onPaste?: (e: React.ClipboardEvent) => void }
>(function Composer({ value, onChange, onSubmit, placeholder, onTyping, footer, multilineEnter, autoFocus, onPaste }, ref) {
  const users = useUsers().filter((u) => u.status === 'active');
  const ta = useRef<HTMLTextAreaElement>(null);
  const [mq, setMq] = useState<string | null>(null);
  const [hl, setHl] = useState(0);
  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus(), clear: () => onChange('') }));
  const matches = mq !== null ? users.filter((u) => u.name.toLowerCase().includes(mq.toLowerCase())).slice(0, 6) : [];

  const detect = (v: string, caret: number) => {
    const before = v.slice(0, caret);
    const m = /(?:^|\s)@([\w.-]{0,30})$/.exec(before);
    setMq(m ? m[1] : null);
    setHl(0);
  };
  const pick = (u: User) => {
    const el = ta.current!;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([\w.-]{0,30})$/, `@${u.name} `);
    const next = before + value.slice(caret);
    onChange(next);
    setMq(null);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = before.length;
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') return e.preventDefault(), setHl((h) => (h + 1) % matches.length);
      if (e.key === 'ArrowUp') return e.preventDefault(), setHl((h) => (h - 1 + matches.length) % matches.length);
      if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), pick(matches[hl]);
      if (e.key === 'Escape') return setMq(null);
    }
    const submit = multilineEnter ? e.key === 'Enter' && (e.metaKey || e.ctrlKey) : e.key === 'Enter' && !e.shiftKey;
    if (submit) {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
  };
  return (
    <div className="composer">
      {matches.length > 0 && (
        <div className="pop" style={{ position: 'absolute', bottom: '100%', left: 8, marginBottom: 6, top: 'auto' }}>
          {matches.map((u, i) => (
            <button key={u.id} type="button" className={`mi${i === hl ? ' hl' : ''}`} onMouseDown={(e) => (e.preventDefault(), pick(u))}>
              <Avatar user={u} size={18} />
              {u.name}
              <span className="faint xs" style={{ marginLeft: 'auto' }}>{u.title}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ta}
        rows={1}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onPaste={onPaste}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
          onTyping?.();
          e.target.style.height = 'auto';
          e.target.style.height = `${Math.min(220, e.target.scrollHeight)}px`;
        }}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => setMq(null), 150)}
      />
      {footer && <div className="composer-bar">{footer}</div>}
    </div>
  );
});

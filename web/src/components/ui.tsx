import { type ReactNode, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useUI } from '../lib/store';
import { useUsers } from '../lib/data';
import { initials, PRIORITY, PRIORITY_LABEL, STATUS, STATUS_LABEL } from '../lib/derive';
import type { Priority, TaskStatus, User } from '../types';
import { useNavigate } from 'react-router-dom';

// ---------- avatar ----------
export function Avatar({ user, size = 22, online, square, title }: { user?: Pick<User, 'name' | 'avatarColor'> | null; size?: number; online?: boolean; square?: boolean; title?: string }) {
  if (!user)
    return (
      <span className="avatar empty" style={{ '--s': `${size}px` } as CSSProperties} title={title ?? 'Unassigned'}>
        ·
      </span>
    );
  return (
    <span className={`avatar${square ? ' sq' : ''}`} style={{ '--s': `${size}px`, background: user.avatarColor } as CSSProperties} title={title ?? user.name}>
      {initials(user.name)}
      {online && <i className="online" />}
    </span>
  );
}
export function AvatarStack({ ids, max = 4, size = 20 }: { ids: string[]; max?: number; size?: number }) {
  const users = useUsers();
  const online = useUI((s) => s.online);
  const list = ids.map((i) => users.find((u) => u.id === i)).filter(Boolean) as User[];
  return (
    <span className="avatars">
      {list.slice(0, max).map((u) => (
        <Avatar key={u.id} user={u} size={size} online={online.includes(u.id)} />
      ))}
      {list.length > max && (
        <span className="avatar" style={{ '--s': `${size}px`, background: 'var(--line-2)', color: 'var(--text-2)' } as CSSProperties}>
          +{list.length - max}
        </span>
      )}
    </span>
  );
}

// ---------- glyphs ----------
export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const s = size;
  const c = s / 2;
  const r = s / 2 - 1.5;
  const color = status === 'done' ? 'var(--accent)' : status === 'review' ? 'var(--green)' : status === 'in_progress' ? 'var(--amber)' : status === 'todo' ? 'var(--text-2)' : 'var(--faint)';
  const frac = { backlog: 0, todo: 0, in_progress: 0.5, review: 0.75, done: 1 }[status];
  return (
    <svg className="status-ico" width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-label={STATUS_LABEL[status]}>
      <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={status === 'backlog' ? '2 2' : undefined} />
      {status === 'done' ? (
        <>
          <circle cx={c} cy={c} r={r} fill={color} />
          <path d={`M${s * 0.3} ${c} l${s * 0.14} ${s * 0.14} l${s * 0.26} -${s * 0.28}`} fill="none" stroke="var(--accent-ink)" strokeWidth="1.6" />
        </>
      ) : frac > 0 ? (
        <path d={arc(c, c, r - 2, frac)} fill={color} />
      ) : null}
    </svg>
  );
}
function arc(cx: number, cy: number, r: number, frac: number) {
  const a = frac * 2 * Math.PI - Math.PI / 2;
  const x = cx + r * Math.cos(a);
  const y = cy + r * Math.sin(a);
  return `M${cx} ${cy} L${cx} ${cy - r} A${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x} ${y} Z`;
}
export function PriorityIcon({ p }: { p: Priority }) {
  if (p === 'urgent')
    return (
      <span className="prio-urgent" title="Urgent">
        !
      </span>
    );
  const on = { high: 3, medium: 2, low: 1, none: 0 }[p];
  return (
    <span className={`prio on${on}`} title={PRIORITY_LABEL[p]}>
      <i />
      <i />
      <i />
    </span>
  );
}

export function Bar({ pct, tone = '', thick }: { pct: number; tone?: '' | 'accent' | 'warn' | 'over'; thick?: boolean }) {
  return (
    <span className={`bar${tone === 'accent' ? ' accent' : ''}${thick ? ' thick' : ''}`}>
      <i className={tone === 'warn' ? 'warn' : tone === 'over' ? 'over' : ''} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}
export function Ring({ pct, size = 34, stroke = 3 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="ring">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth={stroke} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--accent)" strokeWidth={stroke} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, pct) / 100)} style={{ transition: 'stroke-dashoffset .6s var(--ease)' }} />
    </svg>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div className="h2">{title}</div>
      {children && <div style={{ maxWidth: 420 }}>{children}</div>}
      {action}
    </div>
  );
}
export const Spinner = () => <span className="spin" />;

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} aria-label={label} />;
}
export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: ReactNode; icon?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.id} type="button" className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

// ---------- overlays ----------
function useEsc(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}
export function Modal({ title, sub, onClose, children, footer, size }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'lg' }) {
  useEsc(onClose);
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className={`modal${size ? ` ${size}` : ''}`} role="dialog" aria-modal="true">
          <div className="modal-head row between start">
            <div>
              <div className="h2">{title}</div>
              {sub && <div className="muted small" style={{ marginTop: 4 }}>{sub}</div>}
            </div>
            <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
              <X />
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </>,
    document.body,
  );
}
export function Drawer({ onClose, children, head, wide }: { onClose: () => void; children: ReactNode; head: ReactNode; wide?: boolean }) {
  useEsc(onClose);
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <aside className={`drawer${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="row grow">{head}</div>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>,
    document.body,
  );
}

// ---------- confirm ----------
interface ConfirmState {
  open: { title: string; body?: string; danger?: boolean; ok?: string; resolve: (v: boolean) => void } | null;
}
const useConfirmStore = create<ConfirmState>(() => ({ open: null }));
export function confirmDialog(title: string, body?: string, opts: { danger?: boolean; ok?: string } = {}) {
  return new Promise<boolean>((resolve) => useConfirmStore.setState({ open: { title, body, ...opts, resolve } }));
}
export function ConfirmHost() {
  const open = useConfirmStore((s) => s.open);
  if (!open) return null;
  const done = (v: boolean) => {
    open.resolve(v);
    useConfirmStore.setState({ open: null });
  };
  return (
    <Modal
      title={open.title}
      onClose={() => done(false)}
      footer={
        <>
          <button className="btn ghost" onClick={() => done(false)}>
            Cancel
          </button>
          <button className={`btn ${open.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => done(true)}>
            {open.ok ?? 'Confirm'}
          </button>
        </>
      }
    >
      {open.body && <p className="t2" style={{ margin: 0 }}>{open.body}</p>}
    </Modal>
  );
}

// ---------- popover menu ----------
export function Popover({ anchor, onClose, children, width, align = 'start' }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: number; align?: 'start' | 'end' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = width ?? Math.max(220, r.width);
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 4;
    const h = ref.current?.offsetHeight ?? 280;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    setPos({ top, left });
  }, [anchor, width, align]);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose();
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    window.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      window.removeEventListener('keydown', k);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="pop" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: width ?? undefined }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

export interface Option<T> {
  value: T;
  label: string;
  icon?: ReactNode;
  hint?: string;
}
/** A button that opens a searchable option list. The building block for every picker. */
export function Picker<T extends string | null>({
  value,
  options,
  onChange,
  children,
  className = 'btn sm',
  search = options.length > 7,
  width,
  disabled,
  title,
}: {
  value: T | T[];
  options: Option<T>[];
  onChange: (v: T) => void;
  children: ReactNode;
  className?: string;
  search?: boolean;
  width?: number;
  disabled?: boolean;
  title?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const list = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const selected = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  const close = () => {
    setAnchor(null);
    setQ('');
  };
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(anchor ? null : e.currentTarget);
          setHl(0);
        }}
      >
        {children}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} width={width}>
          {search && (
            <div className="row" style={{ padding: '2px 2px 4px' }}>
              <input
                autoFocus
                className="input sm"
                placeholder="Filter…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setHl(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') setHl((h) => Math.min(list.length - 1, h + 1));
                  if (e.key === 'ArrowUp') setHl((h) => Math.max(0, h - 1));
                  if (e.key === 'Enter' && list[hl]) {
                    onChange(list[hl].value);
                    if (!Array.isArray(value)) close();
                  }
                }}
              />
            </div>
          )}
          {list.map((o, i) => (
            <button
              key={String(o.value)}
              type="button"
              className={`mi${i === hl && search ? ' hl' : ''}`}
              onMouseEnter={() => setHl(i)}
              onClick={() => {
                onChange(o.value);
                if (!Array.isArray(value)) close();
              }}
            >
              {o.icon}
              <span className="trunc">{o.label}</span>
              {o.hint && <span className="faint xs" style={{ marginLeft: 'auto' }}>{o.hint}</span>}
              {selected(o.value) && <Check className="check-mark" />}
            </button>
          ))}
          {!list.length && <div className="muted small" style={{ padding: 10 }}>No matches</div>}
        </Popover>
      )}
    </>
  );
}

export function StatusPicker({ value, onChange, compact, disabled }: { value: TaskStatus; onChange: (v: TaskStatus) => void; compact?: boolean; disabled?: boolean }) {
  return (
    <Picker value={value} disabled={disabled} className={compact ? 'btn ghost icon xs' : 'btn sm'} title={STATUS_LABEL[value]} options={STATUS.map((s) => ({ value: s.id, label: s.label, icon: <StatusIcon status={s.id} /> }))} onChange={(v) => onChange(v as TaskStatus)} width={180}>
      <StatusIcon status={value} />
      {!compact && STATUS_LABEL[value]}
    </Picker>
  );
}
export function PriorityPicker({ value, onChange, compact, disabled }: { value: Priority; onChange: (v: Priority) => void; compact?: boolean; disabled?: boolean }) {
  return (
    <Picker value={value} disabled={disabled} className={compact ? 'btn ghost icon xs' : 'btn sm'} title={PRIORITY_LABEL[value]} options={PRIORITY.map((s) => ({ value: s.id, label: s.label, icon: <PriorityIcon p={s.id} /> }))} onChange={(v) => onChange(v as Priority)} width={180}>
      <PriorityIcon p={value} />
      {!compact && PRIORITY_LABEL[value]}
    </Picker>
  );
}
export function UserPicker({ value, onChange, compact, disabled, allowNone = true, label = 'Assignee', pool }: { value: string | null; onChange: (v: string | null) => void; compact?: boolean; disabled?: boolean; allowNone?: boolean; label?: string; pool?: string[] }) {
  const users = useUsers().filter((u) => u.status === 'active' && (!pool || pool.includes(u.id) || u.id === value));
  const cur = users.find((u) => u.id === value) ?? null;
  const options: Option<string | null>[] = [...(allowNone ? [{ value: null, label: 'Unassigned', icon: <Avatar user={null} size={18} /> }] : []), ...users.map((u) => ({ value: u.id, label: u.name, hint: u.title, icon: <Avatar user={u} size={18} /> }))];
  return (
    <Picker value={value} disabled={disabled} search options={options} onChange={onChange} className={compact ? 'btn ghost icon xs' : 'btn sm'} title={cur ? cur.name : label} width={260}>
      <Avatar user={cur} size={compact ? 18 : 18} />
      {!compact && <span className="trunc">{cur ? cur.name : 'Unassigned'}</span>}
    </Picker>
  );
}
export function MultiUserPicker({ value, onChange, label = 'Add people', disabled }: { value: string[]; onChange: (v: string[]) => void; label?: string; disabled?: boolean }) {
  const users = useUsers().filter((u) => u.status === 'active');
  return (
    <Picker
      value={value}
      disabled={disabled}
      search
      width={260}
      options={users.map((u) => ({ value: u.id, label: u.name, hint: u.title, icon: <Avatar user={u} size={18} /> }))}
      onChange={(v) => v && onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])}
      className="btn sm"
    >
      {value.length ? <AvatarStack ids={value} max={5} size={18} /> : null}
      <span>{value.length ? `${value.length}` : label}</span>
      <ChevronDown />
    </Picker>
  );
}

// ---------- toasts ----------
export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismiss);
  const nav = useNavigate();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast${t.kind === 'error' ? ' err' : ''}`}
          onClick={() => {
            if (t.link) nav(t.link);
            dismiss(t.id);
          }}
        >
          <span className="bar-l" />
          <div className="grow">
            <div style={{ fontWeight: 500 }}>{t.title}</div>
            {t.body && <div className="muted small clamp2">{t.body}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', width = 240 }: { value: string; onChange: (v: string) => void; placeholder?: string; width?: number | string }) {
  return (
    <div className="row" style={{ position: 'relative', width, maxWidth: '100%' }}>
      <Search style={{ position: 'absolute', left: 9, width: 13, height: 13, color: 'var(--faint)' }} />
      <input className="input sm" style={{ paddingLeft: 28 }} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button className="btn ghost icon xs" style={{ position: 'absolute', right: 2 }} onClick={() => onChange('')} aria-label="Clear">
          <X />
        </button>
      )}
    </div>
  );
}

export function Sparkline({ values, w = 72, h = 22 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(' ');
  return (
    <svg width={w} height={h} className="spark" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.25" />
    </svg>
  );
}

/** GitHub's mark (lucide no longer ships brand icons). */
export function GithubMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden style={{ flex: 'none' }}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

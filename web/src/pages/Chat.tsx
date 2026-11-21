import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, isToday, isYesterday } from 'date-fns';
import { AtSign, Hash, Lock, MessageSquare, MessagesSquare, Paperclip, Pencil, Plus, Send, SmilePlus, Trash2, X, FolderKanban } from 'lucide-react';
import { api } from '../lib/api';
import { qc, sendTyping, setCurrentChannel, useChannels, useMe, useProjects, useUsers } from '../lib/data';
import { bytes, d } from '../lib/derive';
import { toastError, useUI } from '../lib/store';
import { Avatar, confirmDialog, Empty, Field, Modal, MultiUserPicker } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { Composer, decodeMentions, encodeMentions } from '../components/Composer';
import type { Channel, Message } from '../types';

const EMOJI = ['👍', '✅', '🎉', '👀', '❤️', '🔥', '🙏', '😂'];

export default function Chat() {
  const { channelId } = useParams();
  const channels = useChannels();
  const me = useMe()!;
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const thread = params.get('thread');
  const [showSide, setShowSide] = useState(!channelId);
  useEffect(() => {
    if (!channelId && channels.length) {
      const general = channels.find((c) => c.name === 'general') ?? channels[0];
      if (window.innerWidth > 820) nav(`/chat/${general.id}`, { replace: true });
    }
  }, [channelId, channels, nav]);
  useEffect(() => {
    setCurrentChannel(channelId ?? null);
    setShowSide(false);
    return () => {
      setCurrentChannel(null);
    };
  }, [channelId]);
  const channel = channels.find((c) => c.id === channelId);
  return (
    <div className="page full">
      <div className={`chat${thread ? ' with-thread' : ''}${showSide || !channelId ? ' show-side' : ''}`}>
        <ChannelList current={channelId} />
        <div className="chat-main">
          {channel ? (
            <ChannelView key={channel.id} channel={channel} meId={me.id} onBack={() => setShowSide(true)} />
          ) : (
            <Empty icon={<MessagesSquare />} title="Pick a conversation">
              Channels for the lab, one per project, and direct messages. Delivered live.
            </Empty>
          )}
        </div>
        {thread && channel && <ThreadPane channel={channel} parentId={thread} onClose={() => (params.delete('thread'), setParams(params))} />}
      </div>
    </div>
  );
}

function channelLabel(c: Channel, meId: string, users: ReturnType<typeof useUsers>) {
  if (c.kind === 'dm') {
    const others = c.members.filter((m) => m !== meId).map((m) => users.find((u) => u.id === m)?.name ?? 'Someone');
    return others.join(', ') || 'Just you';
  }
  return c.name;
}

function ChannelList({ current }: { current?: string }) {
  const channels = useChannels();
  const users = useUsers();
  const me = useMe()!;
  const online = useUI((s) => s.online);
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const [dm, setDm] = useState(false);
  const groups: [string, Channel[]][] = [
    ['Channels', channels.filter((c) => c.kind === 'channel')],
    ['Projects', channels.filter((c) => c.kind === 'project')],
    ['Direct messages', channels.filter((c) => c.kind === 'dm').sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))],
  ];
  return (
    <aside className="chat-side">
      {groups.map(([label, list]) => (
        <div key={label} style={{ marginBottom: 14 }}>
          <div className="row between" style={{ padding: '6px 8px' }}>
            <span className="eyebrow">{label}</span>
            {label === 'Channels' && me.role !== 'guest' && (
              <button className="btn ghost icon xs" title="New channel" onClick={() => setCreating(true)}>
                <Plus />
              </button>
            )}
            {label === 'Direct messages' && (
              <button className="btn ghost icon xs" title="New message" onClick={() => setDm(true)}>
                <Plus />
              </button>
            )}
          </div>
          {list.map((c) => {
            const other = c.kind === 'dm' ? users.find((u) => u.id === c.members.find((m) => m !== me.id)) : null;
            return (
              <div key={c.id} className={`ch${c.id === current ? ' active' : ''}${c.unread && c.id !== current ? ' unread' : ''}`} onClick={() => nav(`/chat/${c.id}`)}>
                {c.kind === 'dm' ? <Avatar user={other} size={16} online={!!other && online.includes(other.id)} /> : c.kind === 'project' ? <FolderKanban size={13} className="muted" /> : c.isPrivate ? <Lock size={13} className="muted" /> : <Hash size={13} className="muted" />}
                <span className="trunc grow">{channelLabel(c, me.id, users)}</span>
                {c.mentions > 0 && c.id !== current ? (
                  <span className="badge solid mono">@{c.mentions}</span>
                ) : c.unread > 0 && c.id !== current ? (
                  <span className="mono xs muted">{c.unread}</span>
                ) : null}
              </div>
            );
          })}
          {!list.length && <div className="xs faint" style={{ padding: '2px 8px' }}>None yet</div>}
        </div>
      ))}
      {creating && <NewChannel onClose={() => setCreating(false)} />}
      {dm && <NewDM onClose={() => setDm(false)} />}
    </aside>
  );
}

function NewChannel({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', topic: '', isPrivate: false, members: [] as string[] });
  return (
    <Modal
      title="New channel"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!f.name.trim()}
            onClick={async () => {
              try {
                const r = await api.post<{ id: string }>('/api/channels', f);
                await qc.invalidateQueries({ queryKey: ['channels'] });
                onClose();
                nav(`/chat/${r.id}`);
              } catch (e) {
                toastError(e);
              }
            }}
          >
            Create
          </button>
        </>
      }
    >
      <Field label="Name">
        <input className="input mono" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase().replace(/\s+/g, '-') })} placeholder="ml-reading-group" />
      </Field>
      <Field label="Topic">
        <input className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} />
      </Field>
      <label className="check small">
        <input type="checkbox" checked={f.isPrivate} onChange={(e) => setF({ ...f, isPrivate: e.target.checked })} /> Private — only invited members can see it
      </label>
      {f.isPrivate && (
        <Field label="Members">
          <MultiUserPicker value={f.members} onChange={(members) => setF({ ...f, members })} />
        </Field>
      )}
    </Modal>
  );
}

function NewDM({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [ids, setIds] = useState<string[]>([]);
  return (
    <Modal
      title="New message"
      sub="Pick one person, or several for a group conversation."
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          disabled={!ids.length}
          onClick={async () => {
            try {
              const r = await api.post<{ id: string }>('/api/dm', { userIds: ids });
              await qc.invalidateQueries({ queryKey: ['channels'] });
              onClose();
              nav(`/chat/${r.id}`);
            } catch (e) {
              toastError(e);
            }
          }}
        >
          Open conversation
        </button>
      }
    >
      <MultiUserPicker value={ids} onChange={setIds} label="Choose people" />
    </Modal>
  );
}

function useMessages(channelId: string) {
  return useQuery({ queryKey: ['messages', channelId], queryFn: () => api.get<Message[]>(`/api/channels/${channelId}/messages`), staleTime: Infinity });
}

function markRead(c: Channel) {
  if (!c.unread && !c.mentions) return;
  qc.setQueryData<Channel[]>(['channels'], (old) => old?.map((x) => (x.id === c.id ? { ...x, unread: 0, mentions: 0 } : x)));
  api.post(`/api/channels/${c.id}/read`).catch(() => {});
}

function ChannelView({ channel, meId, onBack }: { channel: Channel; meId: string; onBack: () => void }) {
  const users = useUsers();
  const projects = useProjects();
  const me = useMe()!;
  const msgs = useMessages(channel.id);
  const typing = useUI((s) => s.typing[channel.id]);
  const online = useUI((s) => s.online);
  const box = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const list = msgs.data ?? [];
  const project = projects.find((p) => p.id === channel.projectId);

  useEffect(() => markRead(channel), [channel.id, list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (atBottom && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOlder = async () => {
    if (loadingOlder || noMore || !list.length) return;
    setLoadingOlder(true);
    const el = box.current!;
    const prevH = el.scrollHeight;
    try {
      const older = await api.get<Message[]>(`/api/channels/${channel.id}/messages?before=${encodeURIComponent(list[0].createdAt)}`);
      if (!older.length) setNoMore(true);
      qc.setQueryData<Message[]>(['messages', channel.id], (old) => [...older, ...(old ?? [])]);
      requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - prevH));
    } finally {
      setLoadingOlder(false);
    }
  };
  const typers = Object.entries(typing ?? {})
    .filter(([, exp]) => exp > Date.now())
    .map(([u]) => users.find((x) => x.id === u)?.name.split(' ')[0])
    .filter(Boolean);
  const title = channelLabel(channel, meId, users);
  const other = channel.kind === 'dm' ? users.find((u) => u.id === channel.members.find((m) => m !== meId)) : null;
  return (
    <>
      <div className="chat-head">
        <button className="btn ghost icon sm mobile-only" onClick={onBack}>
          <MessagesSquare />
        </button>
        {channel.kind === 'dm' ? <Avatar user={other} size={22} online={!!other && online.includes(other.id)} /> : channel.isPrivate ? <Lock size={15} /> : <Hash size={15} />}
        <div style={{ minWidth: 0 }} className="grow">
          <div style={{ fontWeight: 600 }} className="trunc">{title}</div>
          <div className="xs muted trunc">
            {project ? (
              <Link to={`/projects/${project.key}`} className="row gap-4" style={{ display: 'inline-flex' }}>
                <span className="swatch" style={{ background: project.color }} /> {project.name} workspace →
              </Link>
            ) : (
              channel.topic || (channel.kind === 'dm' ? 'Direct message' : '')
            )}
          </div>
        </div>
        {channel.kind === 'channel' && channel.name !== 'general' && (channel.createdBy === me.id || me.role === 'owner' || me.role === 'admin') && (
          <button
            className="btn ghost icon sm"
            title="Delete channel"
            onClick={async () => {
              if (await confirmDialog(`Delete #${channel.name}?`, 'All messages in it are deleted.', { danger: true, ok: 'Delete' })) {
                await api.del(`/api/channels/${channel.id}`).catch(toastError);
                qc.invalidateQueries({ queryKey: ['channels'] });
              }
            }}
          >
            <Trash2 />
          </button>
        )}
      </div>
      <div
        className="msgs"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
          if (el.scrollTop < 60) loadOlder();
        }}
      >
        {msgs.isLoading && <div className="empty"><span className="spin" /></div>}
        {!msgs.isLoading && !list.length && (
          <div className="empty" style={{ marginTop: 'auto' }}>
            <div className="h2">{channel.kind === 'dm' ? `This is the start of your conversation with ${title}.` : `Welcome to #${channel.name}`}</div>
            <div>Messages are stored in the lab database and delivered live to everyone here.</div>
          </div>
        )}
        {noMore && list.length > 0 && <div className="xs faint" style={{ textAlign: 'center', padding: 10 }}>Beginning of the conversation</div>}
        <MessageList messages={list} channel={channel} />
      </div>
      <div className="typing">{typers.length ? `${typers.join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing…` : ''}</div>
      {me.role === 'guest' && !channel.projectId ? null : <MessageComposer channel={channel} placeholder={`Message ${channel.kind === 'dm' ? title : `#${channel.name}`}`} onSent={() => setAtBottom(true)} />}
    </>
  );
}

function MessageList({ messages, channel, inThread }: { messages: Message[]; channel: Channel; inThread?: boolean }) {
  let lastDay = '';
  let lastUser = '';
  let lastTime = 0;
  return (
    <>
      {messages.map((m) => {
        const day = m.createdAt.slice(0, 10);
        const showDay = day !== lastDay;
        const t = Date.parse(m.createdAt);
        const cont = !showDay && m.userId === lastUser && t - lastTime < 5 * 60_000;
        lastDay = day;
        lastUser = m.userId ?? '';
        lastTime = t;
        const dd = d(m.createdAt)!;
        return (
          <div key={m.id}>
            {showDay && (
              <div className="day-sep">
                <span className="eyebrow">{isToday(dd) ? 'Today' : isYesterday(dd) ? 'Yesterday' : format(dd, 'EEEE d MMMM')}</span>
              </div>
            )}
            <MessageRow m={m} cont={cont} channel={channel} inThread={inThread} />
          </div>
        );
      })}
    </>
  );
}

function MessageRow({ m, cont, channel, inThread }: { m: Message; cont: boolean; channel: Channel; inThread?: boolean }) {
  const users = useUsers();
  const me = useMe()!;
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const u = users.find((x) => x.id === m.userId);
  const mine = m.userId === me.id;
  const react = (e: string) => api.patch(`/api/messages/${m.id}`, { reaction: e }).catch(toastError);
  return (
    <div className={`msg${cont ? ' cont' : ''}`}>
      <div>{!cont && <Avatar user={u} size={32} square />}</div>
      <div style={{ minWidth: 0 }}>
        {!cont && (
          <div className="row gap-6">
            <span style={{ fontWeight: 600 }}>{u?.name ?? 'Former member'}</span>
            <span className="xs faint">{format(d(m.createdAt)!, 'HH:mm')}</span>
          </div>
        )}
        {m.deleted ? (
          <div className="body faint" style={{ fontStyle: 'italic' }}>Message deleted</div>
        ) : editing ? (
          <div className="col gap-4" style={{ marginTop: 4 }}>
            <textarea className="textarea" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                api.patch(`/api/messages/${m.id}`, { body: encodeMentions(text, users) }).then(() => setEditing(false), toastError);
              }
              if (e.key === 'Escape') setEditing(false);
            }} />
            <span className="xs faint">Enter to save · Esc to cancel</span>
          </div>
        ) : (
          <div className="body">
            {m.body && <Markdown text={m.body} className="md" />}
            {m.editedAt && <span className="xs faint"> (edited)</span>}
          </div>
        )}
        {m.attachment && !m.deleted && <Attachment a={m.attachment} />}
        {Object.keys(m.reactions).length > 0 && (
          <div className="reactions">
            {Object.entries(m.reactions).map(([e, ids]) => (
              <button key={e} className={`reaction${ids.includes(me.id) ? ' mine' : ''}`} onClick={() => react(e)} title={ids.map((i) => users.find((x) => x.id === i)?.name).join(', ')}>
                {e} <span className="mono xs">{ids.length}</span>
              </button>
            ))}
          </div>
        )}
        {!inThread && m.replyCount > 0 && (
          <button className="btn ghost xs" style={{ marginTop: 4, color: 'var(--accent-text)' }} onClick={() => (params.set('thread', m.id), setParams(params))}>
            <MessageSquare /> {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>
      {!m.deleted && !editing && (
        <div className="tools">
          <div style={{ position: 'relative' }}>
            <button className="btn ghost icon xs" title="React" onClick={() => setEmoji(!emoji)}>
              <SmilePlus />
            </button>
            {emoji && (
              <div className="pop" style={{ position: 'absolute', right: 0, top: 26, display: 'flex', minWidth: 0, padding: 4, gap: 2 }} onMouseLeave={() => setEmoji(false)}>
                {EMOJI.map((e) => (
                  <button key={e} className="btn ghost icon xs" onClick={() => (react(e), setEmoji(false))}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
          {!inThread && (
            <button className="btn ghost icon xs" title="Reply in thread" onClick={() => (params.set('thread', m.id), setParams(params))}>
              <MessageSquare />
            </button>
          )}
          {mine && (
            <button className="btn ghost icon xs" title="Edit" onClick={() => (setText(decodeMentions(m.body, users)), setEditing(true))}>
              <Pencil />
            </button>
          )}
          {(mine || me.role === 'owner' || me.role === 'admin') && (
            <button className="btn ghost icon xs" title="Delete" onClick={async () => (await confirmDialog('Delete this message?', undefined, { danger: true, ok: 'Delete' })) && api.del(`/api/messages/${m.id}`).catch(toastError)}>
              <Trash2 />
            </button>
          )}
        </div>
      )}
      <span className="hidden">{channel.id}</span>
    </div>
  );
}

function Attachment({ a }: { a: NonNullable<Message['attachment']> }) {
  const url = `/api/files/${a.id}`;
  if (a.mime.startsWith('image/'))
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={a.name} style={{ maxWidth: 360, maxHeight: 280, border: '1px solid var(--line)', marginTop: 6, display: 'block' }} />
      </a>
    );
  return (
    <a href={url} target="_blank" rel="noreferrer" className="row" style={{ marginTop: 6, border: '1px solid var(--line-2)', padding: '8px 10px', maxWidth: 360, background: 'var(--panel)' }}>
      <Paperclip size={14} />
      <span className="small trunc grow">{a.name}</span>
      <span className="xs muted">{bytes(a.size)}</span>
    </a>
  );
}

function MessageComposer({ channel, parentId, placeholder, onSent }: { channel: Channel; parentId?: string; placeholder: string; onSent?: () => void }) {
  const users = useUsers();
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(`draft:${channel.id}:${parentId ?? ''}`) ?? '';
    } catch {
      return '';
    }
  });
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const lastTyping = useRef(0);
  useEffect(() => {
    try {
      text ? localStorage.setItem(`draft:${channel.id}:${parentId ?? ''}`, text) : localStorage.removeItem(`draft:${channel.id}:${parentId ?? ''}`);
    } catch {
      /* ignore */
    }
  }, [text, channel.id, parentId]);
  const upload = async (f: File) => {
    setUploading(true);
    try {
      const r = await api.upload(f);
      setFile({ id: r.id, name: r.name });
    } catch (e) {
      toastError(e);
    } finally {
      setUploading(false);
    }
  };
  const send = async () => {
    const body = encodeMentions(text.trim(), users);
    if (!body && !file) return;
    const att = file;
    setText('');
    setFile(null);
    try {
      const msg = await api.post<Message>(`/api/channels/${channel.id}/messages`, { body, parentId, attachmentId: att?.id });
      const key = parentId ? ['thread', parentId] : ['messages', channel.id];
      qc.setQueryData<Message[]>(key, (old) => (old && !old.some((x) => x.id === msg.id) ? [...old, msg] : old));
      onSent?.();
    } catch (e) {
      setText(text);
      setFile(att);
      toastError(e);
    }
  };
  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) upload(f);
    }}>
      <Composer
        value={text}
        onChange={setText}
        onSubmit={send}
        placeholder={`${placeholder} — @ to mention, Shift+Enter for a new line`}
        autoFocus={!parentId}
        onTyping={() => {
          if (Date.now() - lastTyping.current > 2500) {
            lastTyping.current = Date.now();
            sendTyping(channel.id);
          }
        }}
        onPaste={(e) => {
          const f = e.clipboardData.files[0];
          if (f) {
            e.preventDefault();
            upload(f);
          }
        }}
        footer={
          <>
            <label className="btn ghost icon xs" title="Attach a file (max 10 MB)">
              <Paperclip />
              <input type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
            <button className="btn ghost icon xs" title="Mention someone" onClick={() => setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@`)}>
              <AtSign />
            </button>
            {uploading && <span className="spin" />}
            {file && (
              <span className="badge">
                <Paperclip size={10} /> {file.name}
                <button className="btn ghost icon xs" onClick={() => setFile(null)}>
                  <X />
                </button>
              </span>
            )}
            <span className="grow" />
            <button className="btn primary xs" disabled={!text.trim() && !file} onClick={send}>
              <Send /> Send
            </button>
          </>
        }
      />
    </div>
  );
}

function ThreadPane({ channel, parentId, onClose }: { channel: Channel; parentId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['thread', parentId], queryFn: () => api.get<Message[]>(`/api/channels/${channel.id}/messages?parent=${parentId}`), staleTime: Infinity });
  const box = useRef<HTMLDivElement>(null);
  const list = useMemo(() => q.data ?? [], [q.data]);
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [list.length]);
  return (
    <aside className="thread-pane">
      <div className="chat-head">
        <MessageSquare size={15} />
        <span style={{ fontWeight: 600 }} className="grow">Thread</span>
        <button className="btn ghost icon sm" onClick={onClose}>
          <X />
        </button>
      </div>
      <div className="msgs" ref={box}>
        <MessageList messages={list} channel={channel} inThread />
      </div>
      <MessageComposer channel={channel} parentId={parentId} placeholder="Reply" />
    </aside>
  );
}

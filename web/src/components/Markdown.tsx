import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useMemo } from 'react';
import { useUsers } from '../lib/data';

marked.setOptions({ gfm: true, breaks: true });

/** Renders markdown safely. <@usr_x> mention tokens become highlighted names. */
export function Markdown({ text, className = 'md', inline }: { text: string; className?: string; inline?: boolean }) {
  const users = useUsers();
  const html = useMemo(() => {
    const names = new Map(users.map((u) => [u.id, u.name]));
    const withMentions = text.replace(/<@(usr_[a-z0-9]+)>/g, (_, id) => `@@MENTION:${id}@@`);
    const raw = inline ? (marked.parseInline(withMentions) as string) : (marked.parse(withMentions) as string);
    const out = raw.replace(/@@MENTION:(usr_[a-z0-9]+)@@/g, (_, id) => `<span class="mention">@${escapeHtml(names.get(id) ?? 'someone')}</span>`);
    return DOMPurify.sanitize(out, { ADD_ATTR: ['target'] });
  }, [text, users, inline]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} onClick={openLinksExternally} />;
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
function openLinksExternally(e: React.MouseEvent) {
  const a = (e.target as HTMLElement).closest('a');
  if (a && a.href && !a.href.startsWith(location.origin)) {
    e.preventDefault();
    window.open(a.href, '_blank', 'noopener');
  }
}

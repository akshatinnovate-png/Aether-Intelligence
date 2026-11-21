import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { save, useMe, useProjects } from '../lib/data';
import { useUI, toastError } from '../lib/store';
import { Field, Modal, MultiUserPicker, UserPicker } from './ui';
import type { Project } from '../types';

export const PROJECT_COLORS = ['#d4ff3a', '#7dd3fc', '#f9a8d4', '#fdba74', '#a5b4fc', '#86efac', '#fca5a5', '#e9d5ff', '#fde68a', '#e8e8e4'];

export function CreateProjectModal() {
  const { createProject, setCreateProject } = useUI();
  if (!createProject) return null;
  return <ProjectForm onClose={() => setCreateProject(false)} />;
}

export function ProjectForm({ onClose, initial }: { onClose: () => void; initial?: Project }) {
  const me = useMe()!;
  const projects = useProjects();
  const nav = useNavigate();
  const [f, setF] = useState({
    name: initial?.name ?? '',
    key: initial?.key ?? '',
    description: initial?.description ?? '',
    kind: initial?.kind ?? 'engineering',
    status: initial?.status ?? 'active',
    priority: initial?.priority ?? 'medium',
    color: initial?.color ?? PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
    leadId: initial?.leadId ?? me.id,
    startDate: initial?.startDate ?? new Date().toISOString().slice(0, 10),
    dueDate: initial?.dueDate ?? '',
    members: initial?.members ?? [me.id],
    deps: initial?.deps ?? [],
  });
  const [busy, setBusy] = useState(false);
  const suggestedKey = f.name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 4);
  const submit = async () => {
    if (!f.name.trim()) return;
    setBusy(true);
    try {
      const body = { ...f, dueDate: f.dueDate || null, startDate: f.startDate || null };
      const row = initial ? await save('projects', `/api/projects/${initial.id}`, 'patch', { ...body, key: undefined }) : await save('projects', '/api/projects', 'post', body);
      onClose();
      if (!initial) nav(`/projects/${row.key}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={initial ? 'Project settings' : 'New project'}
      sub={initial ? undefined : 'A project gets its own workspace, board, timeline and chat channel.'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !f.name.trim()} onClick={submit}>
            {initial ? 'Save' : 'Create project'}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Name">
          <input autoFocus className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Saathi-Alexa" />
        </Field>
        <Field label="Key" hint={initial ? 'Task keys use this prefix. It cannot be changed.' : 'Prefix for task keys, e.g. SAA-12'}>
          <input className="input mono" disabled={!!initial} value={f.key} maxLength={6} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder={suggestedKey || 'KEY'} />
        </Field>
      </div>
      <Field label="Description">
        <textarea className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What is this project, and what does done look like?" />
      </Field>
      <div className="grid-3">
        <Field label="Type">
          <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Project['kind'] })}>
            <option value="engineering">Engineering</option>
            <option value="research">Research</option>
            <option value="competition">Competition</option>
            <option value="operations">Operations</option>
          </select>
        </Field>
        <Field label="Status">
          <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Project['status'] })}>
            <option value="planning">Planning</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="done">Done</option>
          </select>
        </Field>
        <Field label="Priority">
          <select className="select" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Project['priority'] })}>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </Field>
        <Field label="Start">
          <input type="date" className="input" value={f.startDate ?? ''} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </Field>
        <Field label="Deadline">
          <input type="date" className="input" value={f.dueDate ?? ''} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        </Field>
        <Field label="Colour">
          <div className="row gap-4 wrap" style={{ minHeight: 32 }}>
            {PROJECT_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setF({ ...f, color: c })} style={{ width: 20, height: 20, background: c, border: f.color === c ? '2px solid var(--text)' : '1px solid var(--line)', borderRadius: 2, cursor: 'pointer' }} aria-label={c} />
            ))}
          </div>
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Lead">
          <UserPicker value={f.leadId} allowNone={false} onChange={(leadId) => setF({ ...f, leadId: leadId!, members: f.members.includes(leadId!) ? f.members : [...f.members, leadId!] })} />
        </Field>
        <Field label="Members">
          <MultiUserPicker value={f.members} onChange={(members) => setF({ ...f, members })} />
        </Field>
      </div>
      <Field label="Depends on" hint="This project cannot finish before these do. Shown on the dashboard and timeline.">
        <div className="row wrap gap-4">
          {projects
            .filter((p) => p.id !== initial?.id && !p.archived)
            .map((p) => (
              <button key={p.id} type="button" className={`chip${f.deps.includes(p.id) ? ' on' : ''}`} onClick={() => setF({ ...f, deps: f.deps.includes(p.id) ? f.deps.filter((d) => d !== p.id) : [...f.deps, p.id] })}>
                <span className="swatch" style={{ background: p.color }} />
                {p.name}
              </button>
            ))}
          {projects.length === 0 && <span className="faint small">No other projects yet.</span>}
        </div>
      </Field>
    </Modal>
  );
}

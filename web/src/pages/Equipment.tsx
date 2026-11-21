import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { addDays, differenceInMinutes, format, startOfDay } from 'date-fns';
import { Boxes, CalendarClock, ChevronLeft, ChevronRight, List, Plus, Trash2, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { destroy, qc, save, useBookings, useEquipment, useMe, useProjects, useUsers } from '../lib/data';
import { ago, can, d, EQUIP_CAT, equipmentState, fmtDate, fmtDateTime, fromLocalInput, today } from '../lib/derive';
import { toast, toastError } from '../lib/store';
import { Avatar, confirmDialog, Drawer, Empty, Field, Modal, SearchInput, Seg, UserPicker } from '../components/ui';
import type { Booking, Equipment as Eq } from '../types';

const TONE: Record<string, string> = { green: 'green', blue: 'blue', amber: 'amber', red: 'red', muted: '' };

export default function Equipment() {
  const equipment = useEquipment();
  const bookings = useBookings();
  const users = useUsers();
  const me = useMe()!;
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'inventory' | 'bookings'>('inventory');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [bookFor, setBookFor] = useState<{ equipmentId: string; start?: Date } | null>(null);
  const cat = params.get('cat');
  const open = params.get('e');
  const setP = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    v ? n.set(k, v) : n.delete(k);
    setParams(n);
  };
  const rows = equipment
    .filter((e) => !cat || e.category === cat)
    .filter((e) => !q || `${e.name} ${e.tag} ${e.serial} ${e.location} ${e.specs}`.toLowerCase().includes(q.toLowerCase()))
    .map((e) => ({ e, s: equipmentState(e, bookings) }));
  const all = equipment.map((e) => equipmentState(e, bookings));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Inventory & resources</div>
          <h1 className="h-display">Equipment</h1>
          <p>Computers, servers, components, electronics and licences. Booking something changes its availability everywhere, instantly.</p>
        </div>
        <div className="row gap-6">
          <Seg value={view} onChange={setView} options={[{ id: 'inventory', label: 'Inventory', icon: <List /> }, { id: 'bookings', label: 'Booking board', icon: <CalendarClock /> }]} />
          {can(me.role, 'lead') && (
            <button className="btn primary sm" onClick={() => setAdding(true)}>
              <Plus /> Add item
            </button>
          )}
        </div>
      </div>
      <div className="stats" style={{ marginBottom: 14 }}>
        {[
          ['Items', equipment.filter((e) => e.condition !== 'retired').length, `${equipment.reduce((s, e) => s + e.quantity, 0)} units`],
          ['Available now', all.filter((s) => s.state === 'available').length, 'free to book'],
          ['In use', all.filter((s) => s.state === 'in_use' || s.state === 'assigned').length, 'booked or assigned'],
          ['Maintenance', all.filter((s) => s.state === 'maintenance' || s.state === 'broken').length, 'unavailable'],
          ['Bookings today', bookings.filter((b) => b.startsAt.slice(0, 10) <= today() && b.endsAt.slice(0, 10) >= today()).length, `${bookings.filter((b) => b.userId === me.id && b.endsAt > new Date().toISOString()).length} of them yours`],
          ['Licences', equipment.filter((e) => e.category === 'license').length, `${equipment.filter((e) => e.licenseExpiry && e.licenseExpiry <= format(addDays(new Date(), 30), 'yyyy-MM-dd')).length} expiring in 30d`],
        ].map(([l, v, dd]) => (
          <div key={l as string} className="stat">
            <div className="eyebrow">{l}</div>
            <div className="v">{v}</div>
            <div className="d">{dd}</div>
          </div>
        ))}
      </div>
      <div className="row wrap gap-6" style={{ marginBottom: 12 }}>
        <SearchInput value={q} onChange={setQ} placeholder="Name, tag, serial, location" />
        <button className={`chip${!cat ? ' on' : ''}`} onClick={() => setP('cat', null)}>
          All
        </button>
        {(Object.keys(EQUIP_CAT) as Eq['category'][]).map((c) => (
          <button key={c} className={`chip${cat === c ? ' on' : ''}`} onClick={() => setP('cat', cat === c ? null : c)}>
            {EQUIP_CAT[c]} <span className="mono faint">{equipment.filter((e) => e.category === c).length}</span>
          </button>
        ))}
      </div>
      {!equipment.length ? (
        <div className="panel">
          <Empty icon={<Boxes />} title="No equipment yet" action={can(me.role, 'lead') ? <button className="btn primary" onClick={() => setAdding(true)}>Add the first item</button> : undefined}>
            Track what the lab owns, who has it, and when it is free.
          </Empty>
        </div>
      ) : view === 'inventory' ? (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Item</th>
                <th>Tag</th>
                <th>Category</th>
                <th>Location</th>
                <th>Availability</th>
                <th>With / next</th>
                <th className="num">Qty</th>
                <th>Maintenance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, s }) => {
                const who = s.active[0] ? users.find((u) => u.id === s.active[0].userId) : e.assignedTo ? users.find((u) => u.id === e.assignedTo) : null;
                return (
                  <tr key={e.id} className="clickable" onClick={() => setP('e', e.id)}>
                    <td style={{ fontWeight: 500 }}>{e.name}</td>
                    <td className="mono xs muted">{e.tag || '—'}</td>
                    <td className="muted">{EQUIP_CAT[e.category]}</td>
                    <td className="muted">{e.location || '—'}</td>
                    <td>
                      <span className={`badge ${TONE[s.tone]}`}>
                        <span className="dot" style={{ background: 'currentColor' }} />
                        {s.label}
                      </span>
                    </td>
                    <td className="small">
                      {who ? (
                        <span className="row gap-6">
                          <Avatar user={who} size={16} /> {who.name}
                          {s.active[0] && <span className="xs faint">until {format(d(s.active[0].endsAt)!, 'd MMM HH:mm')}</span>}
                        </span>
                      ) : s.next ? (
                        <span className="xs muted">next {fmtDateTime(s.next.startsAt)}</span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td className="num mono">{e.category === 'license' ? `${e.licenseSeats ?? '—'} seats` : e.quantity}</td>
                    <td className="mono xs muted">{e.category === 'license' ? (e.licenseExpiry ? `exp ${fmtDate(e.licenseExpiry)}` : '—') : e.nextMaintenance ? fmtDate(e.nextMaintenance) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <BookingBoard items={rows.map((r) => r.e).filter((e) => e.bookable && e.condition !== 'retired')} onSlot={(equipmentId, start) => setBookFor({ equipmentId, start })} onOpen={(id) => setP('e', id)} />
      )}
      {open && <EquipmentDrawer id={open} onClose={() => setP('e', null)} onBook={(equipmentId) => setBookFor({ equipmentId })} />}
      {adding && <EquipmentForm onClose={() => setAdding(false)} />}
      {bookFor && <BookingForm equipmentId={bookFor.equipmentId} start={bookFor.start} onClose={() => setBookFor(null)} />}
    </div>
  );
}

function BookingBoard({ items, onSlot, onOpen }: { items: Eq[]; onSlot: (id: string, start: Date) => void; onOpen: (id: string) => void }) {
  const bookings = useBookings();
  const users = useUsers();
  const [from, setFrom] = useState(startOfDay(new Date()));
  const DAYS = 7;
  const W = 140;
  const days = [...Array(DAYS)].map((_, i) => addDays(from, i));
  const end = addDays(from, DAYS);
  const nowX = (differenceInMinutes(new Date(), from) / 1440) * W;
  return (
    <div className="panel">
      <div className="panel-head">
        <button className="btn ghost icon sm" onClick={() => setFrom(addDays(from, -7))}>
          <ChevronLeft />
        </button>
        <span className="small">
          {format(from, 'd MMM')} – {format(addDays(from, DAYS - 1), 'd MMM yyyy')}
        </span>
        <button className="btn ghost icon sm" onClick={() => setFrom(addDays(from, 7))}>
          <ChevronRight />
        </button>
        <button className="btn ghost sm" onClick={() => setFrom(startOfDay(new Date()))}>
          Today
        </button>
        <span className="grow" />
        <span className="xs muted">Click an empty day to book it</span>
      </div>
      <div className="scroll">
        <div style={{ minWidth: 240 + W * DAYS }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', background: 'var(--panel-2)' }}>
            <div style={{ width: 240, flex: 'none', padding: '8px 12px', position: 'sticky', left: 0, background: 'var(--panel-2)', zIndex: 2 }} className="eyebrow">
              Resource
            </div>
            {days.map((day) => (
              <div key={day.toISOString()} style={{ width: W, flex: 'none', padding: '8px 10px', borderLeft: '1px solid var(--line)' }} className={`mono xs ${format(day, 'yyyy-MM-dd') === today() ? 'accent-text' : 'muted'}`}>
                {format(day, 'EEE d')}
              </div>
            ))}
          </div>
          {items.map((e) => {
            const bs = bookings.filter((b) => b.equipmentId === e.id && b.endsAt > from.toISOString() && b.startsAt < end.toISOString());
            const lanes: Booking[][] = [];
            for (const b of bs.sort((a, c) => a.startsAt.localeCompare(c.startsAt))) {
              const lane = lanes.find((l) => l[l.length - 1].endsAt <= b.startsAt);
              lane ? lane.push(b) : lanes.push([b]);
            }
            const h = Math.max(1, lanes.length) * 24 + 12;
            return (
              <div key={e.id} style={{ display: 'flex', borderBottom: '1px solid var(--line)', minHeight: h }}>
                <div style={{ width: 240, flex: 'none', padding: '8px 12px', position: 'sticky', left: 0, background: 'var(--panel)', zIndex: 2, cursor: 'pointer' }} onClick={() => onOpen(e.id)}>
                  <div className="small trunc">{e.name}</div>
                  <div className="xs faint">
                    {e.tag} {e.quantity > 1 ? `· ×${e.quantity}` : ''}
                  </div>
                </div>
                <div style={{ position: 'relative', width: W * DAYS, flex: 'none' }}>
                  {days.map((day, i) => (
                    <div key={i} onClick={() => onSlot(e.id, new Date(day.getTime() + 9 * 3600e3))} style={{ position: 'absolute', left: i * W, width: W, top: 0, bottom: 0, borderLeft: '1px solid var(--line)', cursor: 'copy' }} className="slot" />
                  ))}
                  {nowX > 0 && nowX < W * DAYS && <div className="today-line" style={{ left: nowX }} />}
                  {lanes.map((lane, li) =>
                    lane.map((b) => {
                      const s = Math.max(0, differenceInMinutes(d(b.startsAt)!, from));
                      const en = Math.min(DAYS * 1440, differenceInMinutes(d(b.endsAt)!, from));
                      const u = users.find((x) => x.id === b.userId);
                      return (
                        <div key={b.id} title={`${u?.name}: ${b.purpose || 'booking'}\n${fmtDateTime(b.startsAt)} → ${fmtDateTime(b.endsAt)}`} onClick={() => onOpen(e.id)} style={{ position: 'absolute', left: (s / 1440) * W, width: Math.max(6, ((en - s) / 1440) * W - 2), top: 6 + li * 24, height: 20, background: 'color-mix(in srgb, var(--green) 22%, var(--panel))', borderLeft: '2px solid var(--green)', fontSize: 11, padding: '2px 6px', overflow: 'hidden', whiteSpace: 'nowrap', cursor: 'pointer', zIndex: 1 }}>
                          {u?.name.split(' ')[0]} · {b.purpose}
                        </div>
                      );
                    }),
                  )}
                </div>
              </div>
            );
          })}
          {!items.length && <div className="empty">Nothing bookable here.</div>}
        </div>
      </div>
      <style>{`.slot:hover { background: var(--accent-soft); }`}</style>
    </div>
  );
}

function EquipmentDrawer({ id, onClose, onBook }: { id: string; onClose: () => void; onBook: (id: string) => void }) {
  const equipment = useEquipment();
  const bookings = useBookings();
  const users = useUsers();
  const projects = useProjects();
  const me = useMe()!;
  const e = equipment.find((x) => x.id === id);
  const log = useQuery({ queryKey: ['eq-log', id], queryFn: () => api.get<{ id: string; userId: string; note: string; createdAt: string }[]>(`/api/equipment/${id}/log`) });
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  if (!e) return <Drawer onClose={onClose} head={<span className="muted">Equipment</span>}><div className="empty">Not found.</div></Drawer>;
  const s = equipmentState(e, bookings);
  const manage = can(me.role, 'lead');
  const upcoming = bookings.filter((b) => b.equipmentId === e.id && b.endsAt > new Date().toISOString()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const set = (patch: Partial<Eq>) => save('equipment', `/api/equipment/${e.id}`, 'patch', patch).then(() => qc.invalidateQueries({ queryKey: ['eq-log', id] }), toastError);
  return (
    <Drawer
      onClose={onClose}
      head={
        <>
          <Boxes size={15} className="muted" />
          <span className="small muted">{EQUIP_CAT[e.category]}</span>
          <span className="grow" />
          {manage && (
            <>
              <button className="btn ghost sm" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button
                className="btn ghost icon sm"
                onClick={async () => {
                  if (await confirmDialog(`Remove ${e.name} from inventory?`, 'Its bookings and log are removed too. Mark it retired to keep history.', { danger: true, ok: 'Remove' })) {
                    await destroy('equipment', `/api/equipment/${e.id}`, e.id).catch(toastError);
                    onClose();
                  }
                }}
              >
                <Trash2 />
              </button>
            </>
          )}
        </>
      }
    >
      <div style={{ padding: '22px 24px 40px' }} className="col gap-24">
        <div>
          <div className="eyebrow">
            {e.tag} {e.serial && `· S/N ${e.serial}`}
          </div>
          <h2 className="h1" style={{ marginTop: 8 }}>{e.name}</h2>
          <div className="row gap-6" style={{ marginTop: 10 }}>
            <span className={`badge ${TONE[s.tone]}`}>
              <span className="dot" style={{ background: 'currentColor' }} />
              {s.label}
            </span>
            {e.location && <span className="badge">{e.location}</span>}
            {e.quantity > 1 && <span className="badge mono">×{e.quantity}</span>}
          </div>
        </div>
        {e.bookable && e.condition === 'operational' && me.role !== 'guest' && (
          <button className="btn primary" onClick={() => onBook(e.id)}>
            <CalendarClock /> Book this
          </button>
        )}
        {e.specs && (
          <section>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Specifications</div>
            <div className="code-box" style={{ whiteSpace: 'pre-wrap' }}>{e.specs}</div>
          </section>
        )}
        <section className="col gap-12">
          <div className="eyebrow">Status</div>
          <div className="row gap-6 wrap">
            {(['operational', 'maintenance', 'broken', 'retired'] as const).map((c) => (
              <button key={c} className={`btn sm${e.condition === c ? ' on' : ''}`} disabled={!manage} onClick={() => set({ condition: c })}>
                {c === 'operational' ? 'Operational' : c === 'maintenance' ? 'In maintenance' : c === 'broken' ? 'Out of order' : 'Retired'}
              </button>
            ))}
          </div>
          <div className="grid-2">
            <Field label="Assigned to" hint="A long-term owner (separate from bookings).">
              <UserPicker value={e.assignedTo} disabled={!manage} onChange={(assignedTo) => set({ assignedTo })} />
            </Field>
            <Field label={e.category === 'license' ? 'Licence expiry' : 'Next maintenance'}>
              <input type="date" className="input sm" disabled={!manage} value={(e.category === 'license' ? e.licenseExpiry : e.nextMaintenance) ?? ''} onChange={(ev) => set(e.category === 'license' ? { licenseExpiry: ev.target.value || null } : { nextMaintenance: ev.target.value || null })} />
            </Field>
          </div>
        </section>
        {e.bookable && (
          <section>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Upcoming bookings</div>
            <div className="panel">
              <div className="list">
                {upcoming.map((b) => {
                  const u = users.find((x) => x.id === b.userId);
                  const p = projects.find((x) => x.id === b.projectId);
                  const live = b.startsAt <= new Date().toISOString();
                  return (
                    <div key={b.id} className="li">
                      <Avatar user={u} size={20} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="small">
                          {fmtDateTime(b.startsAt)} → {fmtDateTime(b.endsAt)} {live && <span className="badge green">now</span>}
                        </div>
                        <div className="xs muted trunc">
                          {u?.name} · {b.purpose || 'No purpose given'}
                          {p ? ` · ${p.name}` : ''}
                        </div>
                      </div>
                      {(b.userId === me.id || can(me.role, 'admin')) && (
                        <button
                          className="btn ghost xs"
                          onClick={async () => {
                            if (await confirmDialog('Cancel this booking?', undefined, { ok: 'Cancel booking', danger: true })) destroy('bookings', `/api/bookings/${b.id}`, b.id).catch(toastError);
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  );
                })}
                {!upcoming.length && <div className="li faint small">No upcoming bookings — it is free.</div>}
              </div>
            </div>
          </section>
        )}
        <section>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Maintenance log</div>
          <div className="panel">
            <div className="list">
              {me.role !== 'guest' && (
                <div className="li gap-6">
                  <Wrench size={13} className="muted" />
                  <input className="input bare sm grow" placeholder="Log a note: fan replaced, firmware updated…" value={note} onChange={(ev) => setNote(ev.target.value)} onKeyDown={async (ev) => {
                    if (ev.key === 'Enter' && note.trim()) {
                      await api.post(`/api/equipment/${e.id}/log`, { note }).catch(toastError);
                      setNote('');
                      qc.invalidateQueries({ queryKey: ['eq-log', id] });
                    }
                  }} />
                </div>
              )}
              {(log.data ?? []).map((l) => (
                <div key={l.id} className="li">
                  <Avatar user={users.find((u) => u.id === l.userId)} size={16} />
                  <span className="small grow">{l.note}</span>
                  <span className="xs faint">{ago(l.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        {e.notes && (
          <section>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Notes</div>
            <p className="t2 small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{e.notes}</p>
          </section>
        )}
      </div>
      {editing && <EquipmentForm initial={e} onClose={() => setEditing(false)} />}
    </Drawer>
  );
}

function EquipmentForm({ onClose, initial }: { onClose: () => void; initial?: Eq }) {
  const [f, setF] = useState({
    name: initial?.name ?? '',
    category: initial?.category ?? 'computer',
    tag: initial?.tag ?? '',
    serial: initial?.serial ?? '',
    location: initial?.location ?? '',
    specs: initial?.specs ?? '',
    notes: initial?.notes ?? '',
    quantity: initial?.quantity ?? 1,
    bookable: initial?.bookable ?? true,
    licenseSeats: initial?.licenseSeats ?? ('' as number | ''),
    licenseExpiry: initial?.licenseExpiry ?? '',
    nextMaintenance: initial?.nextMaintenance ?? '',
    purchaseDate: initial?.purchaseDate ?? '',
  });
  const lic = f.category === 'license';
  const submit = async () => {
    const body = { ...f, licenseSeats: f.licenseSeats || null, licenseExpiry: f.licenseExpiry || null, nextMaintenance: f.nextMaintenance || null, purchaseDate: f.purchaseDate || null, bookable: lic ? false : f.bookable };
    try {
      initial ? await save('equipment', `/api/equipment/${initial.id}`, 'patch', body) : await save('equipment', '/api/equipment', 'post', body);
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Modal title={initial ? 'Edit item' : 'Add equipment'} size="lg" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.name.trim()} onClick={submit}>Save</button></>}>
      <div className="grid-2">
        <Field label="Name">
          <input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Category">
          <select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Eq['category'] })}>
            {Object.entries(EQUIP_CAT).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid-3">
        <Field label="Asset tag">
          <input className="input mono" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="GPU-02" />
        </Field>
        <Field label="Serial">
          <input className="input mono" value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} />
        </Field>
        <Field label="Location">
          <input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </Field>
      </div>
      {lic ? (
        <div className="grid-2">
          <Field label="Seats">
            <input type="number" className="input" value={f.licenseSeats} onChange={(e) => setF({ ...f, licenseSeats: e.target.value ? Number(e.target.value) : '' })} />
          </Field>
          <Field label="Expires">
            <input type="date" className="input" value={f.licenseExpiry} onChange={(e) => setF({ ...f, licenseExpiry: e.target.value })} />
          </Field>
        </div>
      ) : (
        <div className="grid-3">
          <Field label="Quantity" hint="Units that can be booked at once">
            <input type="number" min={1} className="input" value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} />
          </Field>
          <Field label="Next maintenance">
            <input type="date" className="input" value={f.nextMaintenance} onChange={(e) => setF({ ...f, nextMaintenance: e.target.value })} />
          </Field>
          <Field label="Bookable">
            <label className="check small" style={{ height: 32 }}>
              <input type="checkbox" checked={f.bookable} onChange={(e) => setF({ ...f, bookable: e.target.checked })} /> Members can book it
            </label>
          </Field>
        </div>
      )}
      <Field label="Specifications">
        <textarea className="textarea mono" style={{ fontSize: 12.5 }} value={f.specs} onChange={(e) => setF({ ...f, specs: e.target.value })} />
      </Field>
      <Field label="Notes">
        <textarea className="textarea" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

function BookingForm({ equipmentId, start, onClose }: { equipmentId: string; start?: Date; onClose: () => void }) {
  const equipment = useEquipment();
  const projects = useProjects();
  const me = useMe()!;
  const e = equipment.find((x) => x.id === equipmentId);
  const s0 = start ?? new Date(Math.ceil(Date.now() / 3600e3) * 3600e3);
  const [f, setF] = useState({ startsAt: format(s0, "yyyy-MM-dd'T'HH:mm"), endsAt: format(new Date(s0.getTime() + 3 * 3600e3), "yyyy-MM-dd'T'HH:mm"), purpose: '', projectId: '' });
  const [err, setErr] = useState('');
  const myProjects = useMemo(() => projects.filter((p) => !p.archived && p.members.includes(me.id)), [projects, me.id]);
  const submit = async () => {
    setErr('');
    try {
      await save('bookings', '/api/bookings', 'post', { equipmentId, startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt), purpose: f.purpose, projectId: f.projectId || null });
      toast({ title: `Booked ${e?.name}`, body: `${format(new Date(f.startsAt), 'd MMM HH:mm')} → ${format(new Date(f.endsAt), 'd MMM HH:mm')}` });
      onClose();
    } catch (er) {
      setErr(er instanceof Error ? er.message : String(er));
    }
  };
  return (
    <Modal title={`Book ${e?.name ?? ''}`} sub="Conflicts with existing bookings are checked on the server." onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit}>Confirm booking</button></>}>
      {err && <div className="err-box">{err}</div>}
      <div className="grid-2">
        <Field label="From">
          <input type="datetime-local" className="input" value={f.startsAt} onChange={(ev) => setF({ ...f, startsAt: ev.target.value })} />
        </Field>
        <Field label="Until">
          <input type="datetime-local" className="input" value={f.endsAt} onChange={(ev) => setF({ ...f, endsAt: ev.target.value })} />
        </Field>
      </div>
      <div className="row gap-4 wrap">
        {[1, 3, 8, 24, 72].map((h) => (
          <button key={h} className="chip" onClick={() => setF({ ...f, endsAt: format(new Date(new Date(f.startsAt).getTime() + h * 3600e3), "yyyy-MM-dd'T'HH:mm") })}>
            {h < 24 ? `${h}h` : `${h / 24}d`}
          </button>
        ))}
      </div>
      <Field label="Purpose">
        <input className="input" value={f.purpose} onChange={(ev) => setF({ ...f, purpose: ev.target.value })} placeholder="Training run, demo, soldering…" />
      </Field>
      <Field label="For project">
        <select className="select" value={f.projectId} onChange={(ev) => setF({ ...f, projectId: ev.target.value })}>
          <option value="">None</option>
          {myProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}

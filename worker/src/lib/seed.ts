import { type Env, id, now } from './core';

/**
 * Optional starter content chosen at setup. It belongs to the owner only (no fake people);
 * everything is editable and deletable. Dates are relative to today so the dashboard is alive.
 */
export async function seedWorkspace(env: Env, ownerId: string) {
  const db = env.DB;
  const t = now();
  const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
  const at = (offset: number, hour: number) => {
    const d = new Date(Date.now() + offset * 864e5);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const stmts: D1PreparedStatement[] = [];
  const projects = [
    { key: 'SAA', name: 'Saathi-Alexa', kind: 'engineering', color: '#d4ff3a', priority: 'high', start: -40, due: 35, desc: 'Voice companion built on Alexa skills: conversational memory, multilingual intents and a caregiver dashboard.' },
    { key: 'GRS', name: 'Gridsphere', kind: 'engineering', color: '#7dd3fc', priority: 'medium', start: -20, due: 60, desc: 'Simulation and visualisation of a campus micro-grid: load forecasting, solar input and battery dispatch.' },
    { key: 'TSG', name: 'TS-GLDC', kind: 'research', color: '#f9a8d4', priority: 'high', start: -10, due: 80, desc: 'Research track. Define the problem statement, collect the dataset, reproduce baselines, then write up.' },
    { key: 'SUB', name: 'Hackathon submission', kind: 'competition', color: '#fdba74', priority: 'urgent', start: -5, due: 12, desc: 'Sample competition project — linked to the entry in the Competition tracker.' },
  ];
  const pid: Record<string, string> = {};
  for (const p of projects) {
    pid[p.key] = id('prj');
    stmts.push(
      db.prepare(`INSERT INTO projects (id, key, name, description, kind, status, priority, color, lead_id, start_date, due_date, created_by, created_at, updated_at) VALUES (?,?,?,?,?, 'active', ?,?,?,?,?,?,?,?)`)
        .bind(pid[p.key], p.key, p.name, p.desc, p.kind, p.priority, p.color, ownerId, day(p.start), day(p.due), ownerId, t, t),
      db.prepare(`INSERT INTO project_members (project_id, user_id, added_at) VALUES (?,?,?)`).bind(pid[p.key], ownerId, t),
      db.prepare(`INSERT INTO channels (id, name, kind, topic, project_id, created_by, created_at) VALUES (?,?, 'project', ?, ?, ?, ?)`).bind(id('chn'), p.key.toLowerCase(), `Project channel for ${p.name}`, pid[p.key], ownerId, t),
    );
  }
  stmts.push(db.prepare(`INSERT INTO project_deps (project_id, depends_on_id) VALUES (?,?)`).bind(pid.SUB, pid.SAA));

  const ms: Record<string, string> = {};
  const milestones: [string, string, string, number][] = [
    ['SAA', 'm1', 'Alpha: core intents', -3],
    ['SAA', 'm2', 'Beta with 10 families', 30],
    ['GRS', 'm3', 'Forecasting model v1', 14],
    ['TSG', 'm4', 'Baselines reproduced', 28],
    ['SUB', 'm5', 'Submission frozen', 11],
  ];
  for (const [k, m, name, due] of milestones) {
    ms[m] = id('mil');
    stmts.push(db.prepare(`INSERT INTO milestones (id, project_id, name, due_date, done, created_at) VALUES (?,?,?,?,?,?)`).bind(ms[m], pid[k], name, day(due), due < 0 ? 1 : 0, t));
  }

  const tasks: [string, string, string, string, number, number, number, string | null, string[]][] = [
    // project, title, status, priority, start, due, estimate, milestone, labels
    ['SAA', 'Wake-word latency under 300 ms', 'done', 'high', -30, -12, 5, 'm1', ['audio']],
    ['SAA', 'Hindi and English intent model', 'done', 'high', -28, -8, 8, 'm1', ['nlp']],
    ['SAA', 'Conversation memory store', 'in_progress', 'high', -6, 4, 5, 'm2', ['backend']],
    ['SAA', 'Caregiver dashboard: daily summary', 'todo', 'medium', 2, 14, 5, 'm2', ['ui']],
    ['SAA', 'Medication reminder skill', 'review', 'urgent', -4, 1, 3, 'm2', ['skill']],
    ['SAA', 'Privacy review of stored transcripts', 'todo', 'high', 5, 18, 2, 'm2', ['security']],
    ['GRS', 'Ingest 12 months of meter data', 'done', 'medium', -18, -6, 3, 'm3', ['data']],
    ['GRS', 'Load forecasting baseline (LightGBM)', 'in_progress', 'high', -5, 7, 5, 'm3', ['ml']],
    ['GRS', 'Battery dispatch optimiser', 'backlog', 'medium', 10, 40, 8, null, ['optimisation']],
    ['GRS', '3D campus grid visualisation', 'todo', 'low', 15, 45, 5, null, ['ui']],
    ['TSG', 'Write the problem statement', 'in_progress', 'high', -8, 3, 2, null, ['writing']],
    ['TSG', 'Literature survey: 20 core papers', 'todo', 'medium', 0, 20, 5, 'm4', ['research']],
    ['TSG', 'Reproduce baseline A', 'todo', 'high', 10, 28, 8, 'm4', ['experiments']],
    ['SUB', 'Demo video script', 'todo', 'urgent', 0, 6, 2, 'm5', ['pitch']],
    ['SUB', 'Pitch deck', 'in_progress', 'urgent', -3, 8, 3, 'm5', ['pitch']],
    ['SUB', 'Deployable demo build', 'todo', 'urgent', 1, 10, 5, 'm5', ['release']],
    ['SUB', 'Register team on portal', 'done', 'high', -5, -2, 1, null, ['admin']],
  ];
  const seq: Record<string, number> = {};
  const tid: string[] = [];
  let pos = 1024;
  for (const [k, title, status, priority, s, d, est, m, labels] of tasks) {
    seq[k] = (seq[k] ?? 0) + 1;
    const taskId = id('tsk');
    tid.push(taskId);
    stmts.push(
      db.prepare(
        `INSERT INTO tasks (id, project_id, number, title, status, priority, assignee_id, reporter_id, milestone_id, labels, estimate, start_date, due_date, position, completed_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(taskId, pid[k], seq[k], title, status, priority, ownerId, ownerId, m ? ms[m] : null, JSON.stringify(labels), est, day(s), day(d), (pos += 1024), status === 'done' ? at(d, 12) : null, t, t),
    );
  }
  for (const k of Object.keys(seq)) stmts.push(db.prepare(`UPDATE projects SET task_seq=? WHERE id=?`).bind(seq[k], pid[k]));
  // Demo build is blocked by the memory store.
  stmts.push(db.prepare(`INSERT INTO task_deps (task_id, blocked_by_id) VALUES (?,?)`).bind(tid[15], tid[2]));

  const col1 = id('col');
  const col2 = id('col');
  stmts.push(
    db.prepare(`INSERT INTO collections (id, name, description, created_by, created_at) VALUES (?,?,?,?,?)`).bind(col1, 'Foundations', 'Papers everyone in the lab should read.', ownerId, t),
    db.prepare(`INSERT INTO collections (id, name, description, created_by, created_at) VALUES (?,?,?,?,?)`).bind(col2, 'Speech & voice', 'For Saathi-Alexa.', ownerId, t),
  );
  const papers = [
    { title: 'Attention Is All You Need', authors: 'Vaswani, Shazeer, Parmar, Uszkoreit, Jones, Gomez, Kaiser, Polosukhin', venue: 'NeurIPS', year: 2017, tags: ['transformers', 'nlp'], col: col1, url: 'https://arxiv.org/abs/1706.03762', status: 'read', abstract: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. The paper proposes the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.' },
    { title: 'Deep Residual Learning for Image Recognition', authors: 'He, Zhang, Ren, Sun', venue: 'CVPR', year: 2016, tags: ['vision', 'architectures'], col: col1, url: 'https://arxiv.org/abs/1512.03385', status: 'reading', abstract: 'Introduces residual learning to ease the training of networks that are substantially deeper than those used previously.' },
    { title: 'Robust Speech Recognition via Large-Scale Weak Supervision', authors: 'Radford, Kim, Xu, Brockman, McLeavey, Sutskever', venue: 'ICML', year: 2023, tags: ['speech', 'asr'], col: col2, url: 'https://arxiv.org/abs/2212.04356', status: 'to_read', abstract: 'Studies speech processing systems trained to predict large amounts of transcripts of audio on the internet, approaching human robustness and accuracy.' },
  ];
  for (const p of papers) {
    stmts.push(
      db.prepare(`INSERT INTO papers (id, kind, title, authors, abstract, body, url, venue, year, tags, status, collection_id, added_by, created_at, updated_at) VALUES (?, 'paper', ?,?,?, '', ?,?,?,?,?,?,?,?,?)`)
        .bind(id('pap'), p.title, p.authors, p.abstract, p.url, p.venue, p.year, JSON.stringify(p.tags), p.status, p.col, ownerId, t, t),
    );
  }
  stmts.push(
    db.prepare(`INSERT INTO papers (id, kind, title, authors, abstract, body, tags, status, project_id, added_by, created_at, updated_at) VALUES (?, 'note', ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`).bind(
      id('pap'),
      'TS-GLDC — working notes',
      'Lab',
      'Running notes for the TS-GLDC research track.',
      `## Problem\n\nState the question in one paragraph. What is measured, on what data, against which baseline?\n\n## Open questions\n\n- Which dataset split matches prior work?\n- What compute budget do the baselines assume?\n\n## Decisions\n\n| Date | Decision | Why |\n|---|---|---|\n| ${day(0)} | Start with baseline A | Cheapest to reproduce |\n`,
      JSON.stringify(['notes']),
      pid.TSG,
      ownerId,
      t,
      t,
    ),
  );

  const comp = id('cmp');
  stmts.push(
    db.prepare(
      `INSERT INTO competitions (id, name, organizer, url, stage, description, registration_deadline, deadline, event_date, requirements, submission_links, prize, project_id, created_by, created_at, updated_at)
       VALUES (?,?,?,?, 'building', ?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      comp,
      'Sample: National AI Hackathon',
      'Replace with the real organiser',
      '',
      'Sample entry — edit or delete it. Shows how a competition links to a project, a deadline and the calendar.',
      at(-3, 18),
      at(12, 18),
      day(25),
      JSON.stringify([
        { id: 'r1', text: 'Team registered', done: true },
        { id: 'r2', text: 'Abstract (300 words)', done: true },
        { id: 'r3', text: 'Demo video ≤ 3 min', done: false },
        { id: 'r4', text: 'Public repository', done: false },
        { id: 'r5', text: 'Pitch deck PDF', done: false },
      ]),
      JSON.stringify([]),
      '',
      pid.SUB,
      ownerId,
      t,
      t,
    ),
    db.prepare(`INSERT INTO competition_members (competition_id, user_id) VALUES (?,?)`).bind(comp, ownerId),
    db.prepare(`INSERT INTO competitions (id, name, organizer, stage, description, deadline, requirements, submission_links, created_by, created_at, updated_at) VALUES (?,?,?, 'discovered', ?, ?, '[]', '[]', ?, ?, ?)`).bind(id('cmp'), 'Sample: Robotics design challenge', 'Replace with the real organiser', 'Found it, not registered yet.', at(40, 18), ownerId, t, t),
  );

  const equipment: [string, string, string, string, string, number][] = [
    ['GPU workstation A', 'computer', 'GPU-01', 'Lab bench 1', 'RTX-class GPU, 24 GB VRAM, 64 GB RAM', 1],
    ['Training server', 'server', 'SRV-01', 'Rack', '2× GPUs, 128 GB RAM, 4 TB NVMe', 1],
    ['Raspberry Pi 5 kit', 'component', 'RPI5', 'Cabinet B', '8 GB, case, power supply', 6],
    ['Oscilloscope', 'electronics', 'OSC-01', 'Bench 2', '100 MHz, 4 channels', 1],
    ['Echo smart speaker', 'electronics', 'ECHO', 'Cabinet A', 'For Saathi-Alexa testing', 3],
  ];
  const eqIds: string[] = [];
  for (const [name, cat, tag, loc, specs, qty] of equipment) {
    const eid = id('eqp');
    eqIds.push(eid);
    stmts.push(
      db.prepare(`INSERT INTO equipment (id, name, category, tag, location, specs, quantity, condition, bookable, next_maintenance, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'operational', 1, ?, ?, ?)`)
        .bind(eid, name, cat, tag, loc, specs, qty, cat === 'server' ? day(21) : null, t, t),
    );
  }
  stmts.push(
    db.prepare(`INSERT INTO equipment (id, name, category, tag, condition, bookable, license_seats, license_expiry, notes, created_at, updated_at) VALUES (?, 'Design tool licence', 'license', 'LIC-01', 'operational', 0, 5, ?, 'Team plan', ?, ?)`).bind(id('eqp'), day(45), t, t),
    db.prepare(`INSERT INTO bookings (id, equipment_id, user_id, project_id, starts_at, ends_at, purpose, created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(id('bkg'), eqIds[1], ownerId, pid.GRS, at(0, 9), at(2, 18), 'Forecasting training run', t),
    db.prepare(`INSERT INTO calendar_events (id, title, kind, starts_at, ends_at, location, description, attendees, created_by, created_at) VALUES (?,?, 'meeting', ?, ?, 'Lab', 'Weekly progress round: each project, 5 minutes.', ?, ?, ?)`).bind(id('evt'), 'Weekly lab stand-up', at(nextMonday(), 10), at(nextMonday(), 11), JSON.stringify([ownerId]), ownerId, t),
  );
  await db.batch(stmts);
}

function nextMonday() {
  const d = new Date();
  const diff = (8 - d.getUTCDay()) % 7 || 7;
  return diff;
}

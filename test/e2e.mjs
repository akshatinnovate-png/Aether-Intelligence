// End-to-end smoke test: first-run setup, every module, cross-module effects, invites, realtime between two browsers.
// Usage: node test/e2e.mjs [baseUrl] [screenshotDir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const SHOTS = process.argv[3] ?? null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];
const results = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/favicon|401|Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
const shot = async (name, p = page) => SHOTS && p.screenshot({ path: `${SHOTS}/${name}.png` });
const api = async (p, method = 'GET', body) =>
  page.evaluate(async ([p, method, body]) => {
    const r = await fetch(p, { method, headers: { 'content-type': 'application/json', 'x-aether': '1' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [p, method, body]);

// 1. Setup
await page.goto(BASE);
await page.waitForURL(/\/setup/);
await page.getByLabel('Lab name').fill('Aether AI Lab');
await page.getByLabel('Your name').fill('Akshat Lead');
await page.getByLabel('Email').fill('lead@example.com');
await page.getByLabel('Password').fill('password123');
await shot('01-setup');
await page.getByRole('button', { name: 'Create workspace' }).click();
await page.waitForURL(BASE + '/');
await page.getByText('Active projects · health').waitFor();
await page.waitForTimeout(800);
ok('setup → dashboard', await page.getByText('Saathi-Alexa').first().isVisible());
await shot('02-dashboard');

// 2. Projects, board, list, timeline
await page.goto(`${BASE}/projects`);
await page.getByText('Gridsphere').first().waitFor();
await shot('03-projects');
await page.goto(`${BASE}/projects/SAA/board`);
await page.locator('.lane').first().waitFor();
const lanes = await page.locator('.lane').count();
ok('board has 5 lanes', lanes === 5, String(lanes));
await shot('04-board');

// Drag a card from To do to Done and check project progress moves.
const before = (await api('/api/tasks')).json.filter((t) => t.status === 'done').length;
const card = page.locator('.lane').nth(1).locator('.card').first();
const target = page.locator('.lane').nth(4).locator('.lane-body');
const cb = await card.boundingBox();
const tb = await target.boundingBox();
await page.mouse.move(cb.x + 30, cb.y + 20);
await page.mouse.down();
await page.mouse.move(cb.x + 60, cb.y + 40, { steps: 5 });
await page.mouse.move(tb.x + 60, tb.y + tb.height - 20, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(1200);
const after = (await api('/api/tasks')).json.filter((t) => t.status === 'done').length;
ok('drag to Done persists', after === before + 1, `${before} → ${after}`);

await page.goto(`${BASE}/projects/SAA/list`);
await page.locator('table.t').waitFor();
await shot('05-list');
await page.goto(`${BASE}/projects/SAA/timeline`);
await page.locator('.gantt-bar').first().waitFor();
ok('timeline renders bars', (await page.locator('.gantt-bar').count()) > 3);
await shot('06-timeline');
await page.goto(`${BASE}/projects/SAA/overview`);
await page.getByText('Dependencies').waitFor();
await shot('07-overview');

// 3. Create a task through the UI with keyboard shortcut, assign to self → workload changes.
const me = (await api('/api/auth/me')).json;
const loadBefore = (await api('/api/tasks')).json.filter((t) => t.assigneeId === me.id && t.status !== 'done' && t.status !== 'backlog').reduce((s, t) => s + t.estimate, 0);
await page.keyboard.press('c');
await page.getByPlaceholder('Task title').fill('Integration test task');
await page.getByRole('button', { name: 'Create task', exact: true }).click();
await page.waitForTimeout(800);
const tasks = (await api('/api/tasks')).json;
const created = tasks.find((t) => t.title === 'Integration test task');
ok('create task via C shortcut', !!created);
const loadAfter = tasks.filter((t) => t.assigneeId === me.id && t.status !== 'done' && t.status !== 'backlog').reduce((s, t) => s + t.estimate, 0);
ok('assigning a task raises workload', loadAfter > loadBefore, `${loadBefore} → ${loadAfter} pts`);

// Task drawer + comment
await page.goto(`${BASE}/projects/SAA?task=${created.id}`);
await page.locator('.drawer').waitFor();
await page.getByPlaceholder(/Write a comment/).fill('Looks good **so far**');
await page.getByRole('button', { name: 'Comment' }).click();
await page.waitForTimeout(800);
ok('comment posted', await page.locator('.drawer').getByText('so far').isVisible());
await shot('08-task-drawer');
await page.keyboard.press('Escape');

// 4. Members, skills
await page.goto(`${BASE}/members/${me.id}`);
await page.getByRole('button', { name: 'Edit profile' }).click();
await page.getByPlaceholder('Add a skill').fill('Python');
await page.getByPlaceholder('Add a skill').press('Enter');
await page.getByPlaceholder('Add a skill').fill('Rust');
await page.getByPlaceholder('Add a skill').press('Enter');
await page.getByRole('button', { name: 'Save profile' }).click();
await page.waitForTimeout(600);
await shot('09-profile');
await page.goto(`${BASE}/members/skills`);
await page.locator('table.matrix').waitFor();
ok('skills matrix shows skills', (await page.locator('.matrix thead th').count()) >= 3);
await shot('10-skills');

// 5. Research
await page.goto(`${BASE}/research`);
await page.getByText('Attention Is All You Need').waitFor();
await shot('11-research');
await page.getByText('Attention Is All You Need').click();
await page.locator('.reader').waitFor();
await shot('12-reader');

// 6. Competitions: move stage → calendar & activity
await page.goto(`${BASE}/competitions`);
await page.locator('.pipeline').waitFor();
await shot('13-competitions');
const comp = (await api('/api/competitions')).json.find((c) => c.stage === 'discovered');
await page.goto(`${BASE}/competitions?c=${comp.id}`);
await page.locator('.drawer .step').nth(1).click();
await page.waitForTimeout(600);
ok('competition stage change saved', (await api('/api/competitions')).json.find((c) => c.id === comp.id).stage === 'registered');
await shot('14-competition-drawer');
await page.keyboard.press('Escape');

// 7. Equipment booking changes availability
await page.goto(`${BASE}/equipment`);
await page.locator('table.t').waitFor();
const eq = (await api('/api/equipment')).json.find((e) => e.name === 'GPU workstation A');
const now = new Date(Date.now() - 60_000).toISOString();
const later = new Date(Date.now() + 3 * 3600e3).toISOString();
const bk = await api('/api/bookings', 'POST', { equipmentId: eq.id, startsAt: now, endsAt: later, purpose: 'e2e' });
ok('booking created', bk.status === 200);
await page.waitForTimeout(800);
const row = page.locator('tr', { hasText: 'GPU workstation A' });
ok('booked item shows In use', (await row.innerText()).includes('In use'));
const clash = await api('/api/bookings', 'POST', { equipmentId: eq.id, startsAt: now, endsAt: later, purpose: 'clash' });
ok('double booking rejected', clash.status === 409, clash.json?.error);
await shot('15-equipment');
await page.getByRole('button', { name: 'Booking board' }).click();
await shot('16-booking-board');

// 8. Calendar
await page.goto(`${BASE}/calendar`);
await page.locator('.cal').waitFor();
ok('calendar has items', (await page.locator('.cal-ev').count()) > 3);
await shot('17-calendar');

// 9. Invite a teammate, accept in a second browser, chat in realtime.
const inv = await api('/api/invites', 'POST', { email: 'mate@example.com', role: 'member' });
ok('invite link issued', !!inv.json?.link, inv.json?.emailStatus);
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push(`p2 pageerror: ${e.message}`));
await p2.goto(inv.json.link.replace(/^https?:\/\/[^/]+/, BASE));
await p2.getByLabel('Full name').fill('Riya Mate');
await p2.getByLabel('Choose a password').fill('password456');
await p2.getByRole('button', { name: 'Join the lab' }).click();
await p2.waitForURL(BASE + '/');
ok('invitee joined', await p2.getByText(/Good (morning|afternoon|evening)/).first().waitFor().then(() => true, () => false));
await page.waitForTimeout(1000);
const users = (await api('/api/users')).json;
ok('new member visible to lead', users.some((u) => u.name === 'Riya Mate'));

await page.goto(`${BASE}/chat`);
await page.waitForURL(/\/chat\/chn_/);
const chUrl = page.url();
await p2.goto(chUrl);
await p2.locator('.composer textarea').waitFor();
await page.locator('.composer textarea').fill('Hello team, realtime check');
await page.locator('.composer textarea').press('Enter');
await p2.getByText('Hello team, realtime check').waitFor({ timeout: 8000 }).then(() => ok('chat delivered live to second user', true)).catch(() => ok('chat delivered live to second user', false));
await shot('18-chat');

// Assign a task to the teammate → they get a live notification.
const riya = users.find((u) => u.name === 'Riya Mate');
await api(`/api/tasks/${created.id}`, 'PATCH', { assigneeId: riya.id });
await p2.waitForTimeout(1500);
const n2 = await p2.evaluate(async () => (await (await fetch('/api/notifications')).json()).map((n) => n.title));
ok('assignment notifies assignee', n2.some((t) => /assigned you/.test(t)), n2[0]);
await p2.goto(`${BASE}/inbox`);
await shot('19-inbox-teammate', p2);

// 10. Search
const s = await api('/api/search?q=Gridsphere');
ok('global search finds project', s.json.some((h) => h.type === 'project'));
await page.keyboard.press('Control+k');
await page.locator('[cmdk-input]').fill('SAA-2');
await page.waitForTimeout(400);
await shot('20-palette');
await page.keyboard.press('Escape');

// 11. Settings, code, mobile
for (const sct of ['team', 'email', 'integrations', 'preferences']) {
  await page.goto(`${BASE}/settings/${sct}`);
  await page.waitForTimeout(400);
  await shot(`21-settings-${sct}`);
}
await page.goto(`${BASE}/code`);
await page.waitForTimeout(500);
await shot('22-code');

const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await m.newPage();
await mp.context().addCookies(await ctx.cookies());
await mp.goto(BASE);
await mp.getByText('Active projects').first().waitFor();
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
ok('mobile: no horizontal page scroll', !overflow);
await shot('23-mobile-dashboard', mp);
await mp.goto(`${BASE}/projects/SAA/board`);
await mp.waitForTimeout(600);
await shot('24-mobile-board', mp);

// Light theme
await api('/api/me/prefs', 'PUT', { theme: 'light' });
await page.goto(BASE);
await page.waitForTimeout(800);
await shot('25-light-dashboard');
await api('/api/me/prefs', 'PUT', { theme: 'dark' });

ok('no runtime errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

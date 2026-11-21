import { type Env, toApi } from './core';

/**
 * Every collection the client keeps in its cache is described here once. The same SQL serves
 * the list endpoint and the realtime "upsert" broadcast, so a row looks identical whichever way it arrives.
 */
interface EntityDef {
  sql: string; // SELECT ... FROM table alias x
  alias: string;
  json?: string[];
  bools?: string[];
  omit?: string[];
  order?: string;
  /** Column that ties rows to a project, used to scope guests. */
  projectCol?: string;
}

export const ENTITIES = {
  users: {
    alias: 'x',
    sql: `SELECT x.id, x.email, x.name, x.role, x.title, x.bio, x.avatar_color, x.skills, x.responsibilities, x.capacity, x.status,
                 x.github_login, x.last_seen_at, x.created_at FROM users x`,
    json: ['skills', 'responsibilities'],
    order: 'x.name COLLATE NOCASE',
  },
  projects: {
    alias: 'x',
    sql: `SELECT x.*,
            (SELECT json_group_array(user_id) FROM project_members m WHERE m.project_id=x.id) AS members,
            (SELECT json_group_array(depends_on_id) FROM project_deps d WHERE d.project_id=x.id) AS deps
          FROM projects x`,
    json: ['members', 'deps'],
    bools: ['archived'],
    omit: ['webhook_id'],
    order: 'x.created_at',
    projectCol: 'x.id',
  },
  milestones: {
    alias: 'x',
    sql: `SELECT x.* FROM milestones x`,
    bools: ['done'],
    order: 'x.due_date',
    projectCol: 'x.project_id',
  },
  tasks: {
    alias: 'x',
    sql: `SELECT x.*,
            (SELECT json_group_array(blocked_by_id) FROM task_deps d WHERE d.task_id=x.id) AS blocked_by,
            (SELECT COUNT(*) FROM task_commits k WHERE k.task_id=x.id) AS commit_count,
            (SELECT COUNT(*) FROM task_comments k WHERE k.task_id=x.id) AS comment_count
          FROM tasks x`,
    json: ['labels', 'blocked_by'],
    order: 'x.position',
    projectCol: 'x.project_id',
  },
  competitions: {
    alias: 'x',
    sql: `SELECT x.*, (SELECT json_group_array(user_id) FROM competition_members m WHERE m.competition_id=x.id) AS members FROM competitions x`,
    json: ['requirements', 'submission_links', 'members'],
    order: 'x.deadline',
  },
  equipment: {
    alias: 'x',
    sql: `SELECT x.* FROM equipment x`,
    bools: ['bookable'],
    order: 'x.name COLLATE NOCASE',
  },
  bookings: {
    alias: 'x',
    sql: `SELECT x.* FROM bookings x`,
    order: 'x.starts_at',
  },
  events: {
    alias: 'x',
    sql: `SELECT x.* FROM calendar_events x`,
    json: ['attendees'],
    bools: ['all_day'],
    order: 'x.starts_at',
  },
  papers: {
    alias: 'x',
    sql: `SELECT x.id, x.kind, x.title, x.authors, x.abstract, x.url, x.doi, x.venue, x.year, x.tags, x.status, x.collection_id,
                 x.project_id, x.attachment_id, x.added_by, x.created_at, x.updated_at, length(x.body) AS body_length,
                 (SELECT json_group_object(user_id, progress) FROM paper_progress p WHERE p.paper_id=x.id) AS progress
          FROM papers x`,
    json: ['tags', 'progress'],
    order: 'x.updated_at DESC',
  },
  collections: {
    alias: 'x',
    sql: `SELECT x.*, (SELECT COUNT(*) FROM papers p WHERE p.collection_id=x.id) AS count FROM collections x`,
    order: 'x.name COLLATE NOCASE',
  },
  achievements: {
    alias: 'x',
    sql: `SELECT x.* FROM achievements x`,
    order: 'x.date DESC',
  },
} satisfies Record<string, EntityDef>;

export type EntityName = keyof typeof ENTITIES;
/** Entities scoped to projects: guests only receive the rows of projects they belong to. */
export const PROJECT_SCOPED: EntityName[] = ['projects', 'milestones', 'tasks'];

export async function list(env: Env, name: EntityName, where = '', args: unknown[] = []) {
  const def = ENTITIES[name] as EntityDef;
  const sql = `${def.sql} ${where ? `WHERE ${where}` : ''} ${def.order ? `ORDER BY ${def.order}` : ''}`;
  const rs = await env.DB.prepare(sql).bind(...args).all();
  return rs.results.map((r) => toApi(r as Record<string, unknown>, def.json, def.bools, def.omit));
}

export async function listForProjects(env: Env, name: EntityName, projectIds: string[] | null) {
  const def = ENTITIES[name] as EntityDef;
  if (projectIds === null || !def.projectCol) return list(env, name);
  if (!projectIds.length) return [];
  return list(env, name, `${def.projectCol} IN (${projectIds.map(() => '?').join(',')})`, projectIds);
}

export async function byIds(env: Env, name: EntityName, ids: string[]) {
  if (!ids.length) return [];
  return list(env, name, `x.id IN (${ids.map(() => '?').join(',')})`, ids);
}

export async function one<T = Record<string, unknown>>(env: Env, name: EntityName, idVal: string): Promise<T | null> {
  const rows = await byIds(env, name, [idVal]);
  return (rows[0] as T) ?? null;
}

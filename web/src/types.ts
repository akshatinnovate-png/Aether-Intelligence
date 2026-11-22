export type Role = 'owner' | 'admin' | 'lead' | 'member' | 'guest';
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type Stage = 'discovered' | 'registered' | 'building' | 'submitted' | 'finalist' | 'result';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  title: string;
  bio: string;
  avatarColor: string;
  skills: Record<string, number>;
  responsibilities: string[];
  capacity: number;
  status: 'active' | 'disabled';
  githubLogin: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}
export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  prefs: Prefs;
}
export interface Prefs {
  theme?: 'dark' | 'light' | 'system';
  density?: 'compact' | 'comfortable';
  motion?: 'full' | 'reduce';
  sidebarCollapsed?: boolean;
  dashboard?: { hidden?: string[]; order?: string[] };
  notify?: Record<string, boolean>;
  email?: Record<string, boolean>;
  weekStart?: 0 | 1;
  defaultProjectView?: 'board' | 'list' | 'timeline';
}
export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: 'engineering' | 'research' | 'competition' | 'operations';
  status: 'planning' | 'active' | 'paused' | 'done';
  priority: Priority;
  color: string;
  leadId: string | null;
  startDate: string | null;
  dueDate: string | null;
  repoFullName: string | null;
  taskSeq: number;
  archived: boolean;
  members: string[];
  deps: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description: string;
  dueDate: string | null;
  done: boolean;
  createdAt: string;
}
export interface Task {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assigneeId: string | null;
  reporterId: string | null;
  milestoneId: string | null;
  labels: string[];
  estimate: number;
  startDate: string | null;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  blockedBy: string[];
  commitCount: number;
  commentCount: number;
  deliverable: boolean;
  deliverableNote: string;
  submission: Submission | null;
}
export interface Submission {
  id: string;
  taskId?: string;
  url: string;
  title: string;
  note: string;
  status: 'pending' | 'approved' | 'changes_requested';
  userId: string | null;
  reviewerId: string | null;
  reviewNote: string;
  createdAt: string;
  reviewedAt: string | null;
}
export interface Competition {
  id: string;
  name: string;
  organizer: string;
  url: string;
  stage: Stage;
  description: string;
  registrationDeadline: string | null;
  deadline: string | null;
  eventDate: string | null;
  requirements: { id: string; text: string; done: boolean }[];
  submissionLinks: { label: string; url: string }[];
  prize: string;
  result: string;
  outcome: '' | 'won' | 'placed' | 'finalist' | 'not_selected';
  projectId: string | null;
  members: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Equipment {
  id: string;
  name: string;
  category: 'computer' | 'server' | 'component' | 'electronics' | 'license' | 'other';
  tag: string;
  serial: string;
  location: string;
  specs: string;
  notes: string;
  condition: 'operational' | 'maintenance' | 'broken' | 'retired';
  quantity: number;
  assignedTo: string | null;
  bookable: boolean;
  licenseSeats: number | null;
  licenseExpiry: string | null;
  nextMaintenance: string | null;
  purchaseDate: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Booking {
  id: string;
  equipmentId: string;
  userId: string;
  projectId: string | null;
  startsAt: string;
  endsAt: string;
  purpose: string;
  createdAt: string;
}
export interface CalEvent {
  id: string;
  title: string;
  kind: 'meeting' | 'deadline' | 'event' | 'review';
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string;
  description: string;
  projectId: string | null;
  attendees: string[];
  createdBy: string | null;
  createdAt: string;
}
export interface Paper {
  id: string;
  kind: 'paper' | 'document' | 'note' | 'reference';
  title: string;
  authors: string;
  abstract: string;
  url: string;
  doi: string;
  venue: string;
  year: number | null;
  tags: string[];
  status: 'to_read' | 'reading' | 'read' | 'draft' | 'published' | 'archived';
  collectionId: string | null;
  projectId: string | null;
  attachmentId: string | null;
  addedBy: string | null;
  createdAt: string;
  updatedAt: string;
  bodyLength: number;
  progress: Record<string, number>;
}
export interface Collection {
  id: string;
  name: string;
  description: string;
  count: number;
  createdAt: string;
}
export interface Achievement {
  id: string;
  userId: string;
  title: string;
  description: string;
  kind: string;
  date: string;
  createdAt: string;
}
export interface Activity {
  id: string;
  actorId: string | null;
  verb: string;
  entityType: string;
  entityId: string;
  projectId: string | null;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}
export interface Notification {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}
export interface Channel {
  id: string;
  name: string;
  kind: 'channel' | 'project' | 'dm';
  topic: string;
  projectId: string | null;
  isPrivate: boolean;
  members: string[];
  createdBy: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  lastReadAt: string | null;
  unread: number;
  mentions: number;
}
export interface Message {
  id: string;
  channelId: string;
  userId: string | null;
  parentId: string | null;
  body: string;
  attachment: { id: string; name: string; mime: string; size: number } | null;
  reactions: Record<string, string[]>;
  editedAt: string | null;
  deleted: boolean;
  createdAt: string;
  replyCount: number;
  lastReplyAt: string | null;
}
export interface SearchHit {
  type: 'project' | 'task' | 'member' | 'paper' | 'competition' | 'equipment' | 'event' | 'message';
  id: string;
  title: string;
  sub: string | null;
  detail: string | null;
}

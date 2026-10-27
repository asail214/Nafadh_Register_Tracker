export type HasAccount = 'yes' | 'no' | 'problem' | 'unsure';
export type ProfileStatus = 'complete' | 'partial' | 'not_started' | 'unsure';
export type TicketKind = 'issue' | 'suggestion';
export type TicketStatus = 'new' | 'in_review' | 'resolved';

export interface Target {
  id: number;
  full_name: string;
  email: string;
  registered_verified: boolean | null;
  profile_verified: boolean | null;
  admin_note: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface StatusUpdate {
  id: number;
  email: string;
  full_name: string;
  has_account: HasAccount;
  profile_status: ProfileStatus;
  missing_parts: string[];
  notes: string | null;
  created_at: string;
  /** null = not yet reviewed by an admin; undefined when migration 002 is not applied */
  seen_at?: string | null;
}

export interface Ticket {
  id: number;
  kind: TicketKind;
  email: string;
  full_name: string;
  category: string | null;
  title: string;
  description: string;
  blocking: boolean | null;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  seen_at?: string | null;
  attachments: string[];
}

export interface VisitStats {
  total: number;
  unique: number;
  since: string | null;
}

export type FeedKind = 'status' | 'ticket';

export interface Dataset {
  targets: Target[];
  statuses: StatusUpdate[];
  tickets: Ticket[];
}

interface Common {
  full_name: string;
  email: string;
}

export type Submission =
  | (Common & {
      kind: 'status';
      has_account: HasAccount;
      profile_status: ProfileStatus;
      missing_parts: string[];
      notes: string;
    })
  | (Common & {
      kind: 'issue';
      category: string;
      title: string;
      description: string;
      blocking: boolean;
      images: Blob[];
    })
  | (Common & {
      kind: 'suggestion';
      title: string;
      description: string;
      images: Blob[];
    });

export type TargetPatch = Partial<
  Pick<Target, 'full_name' | 'registered_verified' | 'profile_verified' | 'admin_note'>
>;

export interface Api {
  mode: 'demo' | 'cloud';
  submit(s: Submission): Promise<string>;
  getSessionEmail(): Promise<string | null>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  isAdmin(): Promise<boolean>;
  loadAll(): Promise<Dataset>;
  addTargets(rows: { full_name: string; email: string }[]): Promise<number>;
  updateTarget(id: number, patch: TargetPatch): Promise<void>;
  deleteTarget(id: number): Promise<void>;
  setTicketStatus(id: number, status: TicketStatus): Promise<void>;
  attachmentUrls(paths: string[]): Promise<string[]>;
  recordVisit(visitorId: string): Promise<void>;
  /** null when visit analytics is not available (e.g. migration 002 not applied) */
  visitStats(): Promise<VisitStats | null>;
  markSeen(kind: FeedKind, ids: number[]): Promise<void>;
  /** Calls onChange when new entries arrive; returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void;
}

export const ticketRef = (id: number) => 'NF-' + String(id).padStart(4, '0');

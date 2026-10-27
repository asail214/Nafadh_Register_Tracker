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
  attachments: string[];
}

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
}

export const ticketRef = (id: number) => 'NF-' + String(id).padStart(4, '0');

import api from './authService';

/**
 * PDPA data-subject rights requests (task F3).
 *
 * Backend: `backend-rust/src/routes/privacy.rs`. The member half is mounted
 * at `/api/privacy`; the desk half at `/api/admin/privacy`.
 */

/** The four rights, matching `chk_privacy_requests_kind`. */
export const REQUEST_KINDS = ['access', 'erasure', 'rectification', 'objection'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** Matching `chk_privacy_requests_status`. */
export type RequestStatus = 'open' | 'in_progress' | 'done' | 'refused';

/** Statuses that mean the desk still owes an answer. */
export const LIVE_STATUSES: readonly RequestStatus[] = ['open', 'in_progress'];

/** The PDPA s.30-s.32 default turnaround, mirrored from the backend. */
export const RESPONSE_WINDOW_DAYS = 30;

export interface PrivacyRequest {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  note: string | null;
  requestedAt: string;
  /** `requestedAt + 30 days`, computed server-side. */
  dueAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface AdminPrivacyRequest extends PrivacyRequest {
  userId: string;
  /** NULL once an erasure has completed — the address is what it destroyed. */
  email: string | null;
  membershipId: string | null;
  /** Derived server-side from `dueAt`; never stored. */
  overdue: boolean;
  resolvedBy: string | null;
}

export interface MyRequestsResponse {
  requests: PrivacyRequest[];
  responseWindowDays: number;
}

export interface AdminRequestsResponse {
  requests: AdminPrivacyRequest[];
  openCount: number;
  overdueCount: number;
  responseWindowDays: number;
}

/** What an admin may move a request to. `open` is not among them. */
export type ResolutionStatus = 'in_progress' | 'done' | 'refused';

export const privacyService = {
  /** File a request. 409 when one of this kind is already open. */
  async createRequest(kind: RequestKind, note?: string): Promise<PrivacyRequest> {
    const response = await api.post<PrivacyRequest>('/privacy/requests', {
      kind,
      note: note && note.trim().length > 0 ? note.trim() : undefined,
    });
    return response.data;
  },

  /** The member's own requests, newest first. */
  async listMyRequests(): Promise<MyRequestsResponse> {
    const response = await api.get<MyRequestsResponse>('/privacy/requests');
    return response.data;
  },

  /** The desk queue. `all` includes closed requests; the default is live work. */
  async listRequests(status: 'open' | 'all' = 'open'): Promise<AdminRequestsResponse> {
    const response = await api.get<AdminRequestsResponse>('/admin/privacy/requests', {
      params: { status },
    });
    return response.data;
  },

  /**
   * Resolve a request. A resolution note is required on `done` and
   * `refused` — the backend refuses without one, and so does the form.
   */
  async resolveRequest(
    id: string,
    status: ResolutionStatus,
    resolutionNote?: string,
  ): Promise<void> {
    await api.patch(`/admin/privacy/requests/${id}`, {
      status,
      resolutionNote: resolutionNote && resolutionNote.trim().length > 0
        ? resolutionNote.trim()
        : undefined,
    });
  },

  /**
   * The s.30 access export. Admin-only, and slip images are never in it —
   * the payload says so itself in `slipImages.included`.
   */
  async getExport(id: string): Promise<unknown> {
    const response = await api.get(`/admin/privacy/requests/${id}/export`);
    return response.data;
  },
};

export default privacyService;

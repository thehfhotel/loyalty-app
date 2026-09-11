import axios from 'axios';
import api from './authService';
import { API_BASE_URL } from '../utils/apiConfig';
import { DEPOSIT_TOKEN_HEADER } from '../utils/depositToken';
import type { Property } from './channelBookingService';
import type { SlipOkStatusValue } from '../types/slipok';

/**
 * Deposit request links (B1).
 *
 * Reception issues one link for a booking it already took by phone, LINE or
 * at the desk. The guest opens `https://loyalty.saichon.com/d#<token>`, sees
 * the amount and a PromptPay QR, and uploads the slip. No login: the token
 * is the capability.
 *
 * The token travels in the `X-Deposit-Token` **header**, never in the path
 * or the query string, and the link carries it in a **fragment**, which the
 * browser never sends. Both halves exist for one reason: a path is written
 * to the nginx access log and to Cloudflare's HTTP logs on every request,
 * and a bearer credential for a payment sitting in two log stores is a
 * payment page anyone with log access can open. See `utils/depositToken`.
 *
 * Every shape here is hand-written against the locked API contract in
 * `hf-tasks/tasks/direct-booking-designs/b1-deposit-link-spec.md` §2 — the
 * agreement between this bundle and `routes/deposit_links.rs` /
 * `routes/admin_deposit_links.rs`. Do NOT regenerate it from the OpenAPI
 * spec and do not "fix" a field name here without changing the spec: the
 * two halves ship in separate PRs and the contract is what keeps them
 * meeting.
 */

export type { Property };

/**
 * The only vocabulary the guest page branches on. Derived by the backend,
 * never stored: revoked beats expired beats confirmed beats checking.
 */
export const DEPOSIT_LINK_STATES = [
  'awaiting_payment',
  'checking',
  'confirmed',
  'expired',
  'revoked',
] as const;

export type DepositLinkState = (typeof DEPOSIT_LINK_STATES)[number];

const STATE_SET = new Set<string>(DEPOSIT_LINK_STATES);

export function isDepositLinkState(value: string | null | undefined): value is DepositLinkState {
  return typeof value === 'string' && STATE_SET.has(value);
}

/**
 * States that can never change again without staff action, so the page
 * stops polling once it sees one. `expired` and `revoked` are terminal for
 * the *link*, not the booking — the guest is told to call the desk.
 */
export const TERMINAL_DEPOSIT_LINK_STATES: readonly DepositLinkState[] = [
  'confirmed',
  'expired',
  'revoked',
];

export function isTerminalDepositLinkState(state: DepositLinkState | undefined | null): boolean {
  return state ? TERMINAL_DEPOSIT_LINK_STATES.includes(state) : false;
}

/** `GET /api/deposit` with `X-Deposit-Token` — public, no session. */
export interface DepositPage {
  property: Property;
  /** Given name only. The contract carries no phone, email or booking id. */
  guestGivenName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomTypeName: string;
  totalAmount: number;
  amountDueNow: number;
  currency: string;
  /** EMVCo payload for the *property's* receiving account, amount filled in. */
  promptpayQrPayload: string;
  expiresAt: string;
  state: DepositLinkState;
  slipokStatus: SlipOkStatusValue | null;
  /** Locked `SlipOkReason` in practice; typed loosely for a newer backend. */
  slipokReason: string | null;
}

/** `POST /api/deposit/slip` with `X-Deposit-Token` — multipart, `file`. */
export interface DepositSlipUploadResult {
  slipId: string;
  state: DepositLinkState;
  slipokStatus: SlipOkStatusValue | null;
}

/** `POST /api/admin/deposit-links` request body. */
export interface CreateDepositLinkRequest {
  property: Property;
  guestName: string;
  guestPhone: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  roomTypeId: string;
  totalPrice: number;
  /** Omitted = backend computes 50% of the total, rounded half up. */
  amountDueNow?: number;
  /** iHOTEL number as free text. Never goes in `pms_booking_id`. */
  pmsRef?: string;
  expiresInHours?: number;
  note?: string;
}

/**
 * `POST /api/admin/deposit-links` and `.../:id/reissue` response.
 *
 * `token` is shown exactly once. Losing it means Reissue — the backend
 * stores only its SHA-256.
 */
export interface IssuedDepositLink {
  linkId: string;
  bookingId: string;
  token: string;
  url: string;
  lineShareUrl: string;
  totalAmount: number;
  amountDueNow: number;
  expiresAt: string;
}

/** `?status=` filter on the admin list. Not the guest `state` vocabulary. */
export type DepositLinkListFilter = 'open' | 'paid' | 'expired' | 'revoked';

export interface DepositLinkListItem {
  linkId: string;
  bookingId: string;
  /**
   * Nullable on the wire: the backend serialises both of these as
   * `Option<String>` (the columns are nullable), and create-time validation
   * is the only thing keeping them filled today. Typed honestly so the
   * table renders a gap rather than the literal string `property.null`.
   */
  property: Property | null;
  guestName: string | null;
  /**
   * The number reception dialled to take the booking, or `null` for a row
   * whose booking never carried one.
   *
   * On the wire so the panel's search can answer a phone-shaped query — the
   * number is what the guest gave on the call and what reception types an
   * hour later. Matched on digits only, because what is stored and what is
   * typed disagree about spaces and dashes.
   */
  guestPhone: string | null;
  amountDueNow: number;
  state: DepositLinkState;
  expiresAt: string;
  issuedByName: string;
  issuedAt: string;
  /**
   * When the guest's most recent viewing SESSION started, or `null` when
   * they have never opened the link.
   *
   * Not a request count: the backend writes this at most once every 30
   * minutes, so the guest page polling itself every 5 seconds does not
   * read as "just now" forever. The null is the useful half — "issued
   * yesterday, never opened" is a link to resend, while "opened ten
   * minutes ago, still awaiting payment" is a guest mid-transfer.
   */
  lastOpenedAt: string | null;
  slipokStatus: SlipOkStatusValue | null;
}

/**
 * There is no `url` on a list row, and there never can be.
 *
 * The backend stores only the SHA-256 of the token, so the plain link
 * exists exactly once — in the create/reissue response. Copy and LINE
 * share are therefore actions on an [`IssuedDepositLink`] the desk is
 * holding from this session, not on a list row; a row whose token is gone
 * offers Reissue instead. See `pages/admin/DepositLinkListPanel`.
 */

export interface DepositLinkListResponse {
  links: DepositLinkListItem[];
  total: number;
}

export interface ListDepositLinksParams {
  status?: DepositLinkListFilter;
  page?: number;
  limit?: number;
}

/** `GET /api/admin/bookings/room-types` — the room-type dropdown source. */
export interface DepositLinkRoomType {
  id: string;
  name: string;
}

/**
 * A session-less axios instance for the two public endpoints.
 *
 * Deliberately NOT the shared `api` from `authService`: that one carries the
 * auth-token interceptor, and the global response interceptor redirects a
 * 401 to `/login`. A guest on `/d` has no account, so any redirect
 * dance would drop them out of a payment page. Interceptors registered on
 * `axios.interceptors` do not apply to instances made with `axios.create`,
 * so this instance stays clean.
 *
 * No default `Content-Type` either — the slip upload passes a `FormData`
 * body and the browser must be free to set the multipart boundary.
 */
const publicApi = axios.create({
  baseURL: API_BASE_URL,
});

export const depositLinkService = {
  // --- public, no session -------------------------------------------------

  async getDepositPage(token: string): Promise<DepositPage> {
    const response = await publicApi.get<DepositPage>('/deposit', {
      headers: { [DEPOSIT_TOKEN_HEADER]: token },
    });
    return response.data;
  },

  async uploadSlip(token: string, file: File): Promise<DepositSlipUploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await publicApi.post<DepositSlipUploadResult>('/deposit/slip', formData, {
      headers: { [DEPOSIT_TOKEN_HEADER]: token },
    });
    return response.data;
  },

  // --- admin --------------------------------------------------------------

  async createLink(data: CreateDepositLinkRequest): Promise<IssuedDepositLink> {
    const response = await api.post<IssuedDepositLink>('/admin/deposit-links', data);
    return response.data;
  },

  async listLinks(params: ListDepositLinksParams = {}): Promise<DepositLinkListResponse> {
    const response = await api.get<DepositLinkListResponse>('/admin/deposit-links', {
      params,
    });
    return response.data;
  },

  async revokeLink(linkId: string): Promise<{ state: DepositLinkState }> {
    const response = await api.post<{ state: DepositLinkState }>(
      `/admin/deposit-links/${encodeURIComponent(linkId)}/revoke`,
      {},
    );
    return response.data;
  },

  async reissueLink(linkId: string, expiresInHours?: number): Promise<IssuedDepositLink> {
    const response = await api.post<IssuedDepositLink>(
      `/admin/deposit-links/${encodeURIComponent(linkId)}/reissue`,
      expiresInHours === undefined ? {} : { expiresInHours },
    );
    return response.data;
  },

  async listRoomTypes(): Promise<DepositLinkRoomType[]> {
    const response = await api.get<DepositLinkRoomType[]>('/admin/bookings/room-types');
    return response.data;
  },
};

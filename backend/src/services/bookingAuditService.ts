/**
 * Booking Audit Service
 * Provides an audit trail for booking payment and verification changes.
 *
 * This service logs all significant changes to booking payment status,
 * slip uploads, and verification states for compliance and debugging.
 */

import { query } from '../config/database';
import { logger } from '../utils/logger';
import { sanitizeLogValue, sanitizeUserId } from '../utils/logSanitizer';
import { AppError } from '../middleware/errorHandler';

/**
 * Audit action types for booking verification
 */
export type BookingAuditAction =
  | 'slip_uploaded'
  | 'slip_added'
  | 'slip_verified'
  | 'slip_needs_action'
  | 'slipok_verified'
  | 'slipok_failed'
  | 'slipok_quota_exceeded'
  | 'admin_verified'
  | 'admin_needs_action'
  | 'slip_replaced'
  | 'discount_applied'
  | 'booking_updated'
  | 'payment_type_changed'
  | 'booking_cancelled_by_admin';

/**
 * Audit record structure
 */
export interface BookingAuditRecord {
  id: string;
  bookingId: string;
  action: BookingAuditAction;
  performedBy: string | null;
  performedAt: Date;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  notes: string | null;
}

/**
 * Input for creating an audit record
 */
export interface CreateAuditInput {
  bookingId: string;
  action: BookingAuditAction;
  performedBy?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  notes?: string | null;
}

/**
 * Booking Audit Service Class
 * Manages the audit trail for booking verification changes.
 */
export class BookingAuditService {
  /**
   * Log an audit action for a booking
   *
   * @param bookingId - The booking ID
   * @param action - The action being performed
   * @param performedBy - User ID who performed the action (null for system actions)
   * @param oldValue - Previous state before the change
   * @param newValue - New state after the change
   * @param notes - Optional notes about the action
   * @returns The created audit record
   *
   * @example
   * await bookingAuditService.logAction(
   *   'booking-uuid',
   *   'slip_uploaded',
   *   'user-uuid',
   *   null,
   *   { slipImageUrl: 'https://...' },
   *   'Initial slip upload'
   * );
   */
  async logAction(
    bookingId: string,
    action: BookingAuditAction,
    performedBy: string | null,
    oldValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null,
    notes?: string | null
  ): Promise<BookingAuditRecord> {
    try {
      const [record] = await query<BookingAuditRecord>(
        `INSERT INTO booking_verification_audit (
          booking_id, action, performed_by, old_value, new_value, notes
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          booking_id as "bookingId",
          action,
          performed_by as "performedBy",
          performed_at as "performedAt",
          old_value as "oldValue",
          new_value as "newValue",
          notes`,
        [
          bookingId,
          action,
          performedBy,
          oldValue ? JSON.stringify(oldValue) : null,
          newValue ? JSON.stringify(newValue) : null,
          notes ?? null,
        ]
      );

      if (!record) {
        throw new AppError(500, 'Failed to create audit record');
      }

      const performerLog = performedBy
        ? `by user ${sanitizeUserId(performedBy)}`
        : 'by system';
      logger.info(`Audit: ${action} for booking ${sanitizeLogValue(bookingId)} ${performerLog}`);

      return record;
    } catch (error) {
      logger.error('Error creating audit record:', error);
      throw error;
    }
  }

  /**
   * Create an audit record from input object
   *
   * @param input - Audit input data
   * @returns The created audit record
   */
  async createAuditRecord(input: CreateAuditInput): Promise<BookingAuditRecord> {
    return this.logAction(
      input.bookingId,
      input.action,
      input.performedBy ?? null,
      input.oldValue ?? null,
      input.newValue ?? null,
      input.notes
    );
  }

  /**
   * Get the full audit history for a booking
   *
   * @param bookingId - The booking ID
   * @returns Array of audit records, ordered by time (newest first)
   *
   * @example
   * const history = await bookingAuditService.getAuditHistory('booking-uuid');
   * for (const record of history) {
   *   console.log(`${record.action} at ${record.performedAt}`);
   * }
   */
  async getAuditHistory(bookingId: string): Promise<BookingAuditRecord[]> {
    try {
      const records = await query<BookingAuditRecord>(
        `SELECT
          id,
          booking_id as "bookingId",
          action,
          performed_by as "performedBy",
          performed_at as "performedAt",
          old_value as "oldValue",
          new_value as "newValue",
          notes
        FROM booking_verification_audit
        WHERE booking_id = $1
        ORDER BY performed_at DESC`,
        [bookingId]
      );

      return records;
    } catch (error) {
      logger.error('Error fetching audit history:', error);
      throw new AppError(500, 'Failed to fetch audit history');
    }
  }

  /**
   * Get audit records by action type
   *
   * @param action - The action type to filter by
   * @param limit - Maximum number of records to return
   * @param offset - Number of records to skip
   * @returns Array of audit records
   */
  async getAuditByAction(
    action: BookingAuditAction,
    limit = 50,
    offset = 0
  ): Promise<BookingAuditRecord[]> {
    try {
      const records = await query<BookingAuditRecord>(
        `SELECT
          id,
          booking_id as "bookingId",
          action,
          performed_by as "performedBy",
          performed_at as "performedAt",
          old_value as "oldValue",
          new_value as "newValue",
          notes
        FROM booking_verification_audit
        WHERE action = $1
        ORDER BY performed_at DESC
        LIMIT $2 OFFSET $3`,
        [action, limit, offset]
      );

      return records;
    } catch (error) {
      logger.error('Error fetching audit by action:', error);
      throw new AppError(500, 'Failed to fetch audit records');
    }
  }

  /**
   * Get recent audit records for admin dashboard
   *
   * @param limit - Maximum number of records to return
   * @param offset - Number of records to skip
   * @returns Array of audit records with booking info
   */
  async getRecentAuditRecords(
    limit = 50,
    offset = 0
  ): Promise<(BookingAuditRecord & { bookingStatus?: string; userEmail?: string })[]> {
    try {
      const records = await query<BookingAuditRecord & { bookingStatus?: string; userEmail?: string }>(
        `SELECT
          a.id,
          a.booking_id as "bookingId",
          a.action,
          a.performed_by as "performedBy",
          a.performed_at as "performedAt",
          a.old_value as "oldValue",
          a.new_value as "newValue",
          a.notes,
          b.status as "bookingStatus",
          u.email as "userEmail"
        FROM booking_verification_audit a
        JOIN bookings b ON a.booking_id = b.id
        JOIN users u ON b.user_id = u.id
        ORDER BY a.performed_at DESC
        LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      return records;
    } catch (error) {
      logger.error('Error fetching recent audit records:', error);
      throw new AppError(500, 'Failed to fetch audit records');
    }
  }

  /**
   * Get audit count for a booking
   *
   * @param bookingId - The booking ID
   * @returns Number of audit records
   */
  async getAuditCount(bookingId: string): Promise<number> {
    try {
      const [result] = await query<{ count: string }>(
        'SELECT COUNT(*) as count FROM booking_verification_audit WHERE booking_id = $1',
        [bookingId]
      );

      return parseInt(result?.count ?? '0', 10);
    } catch (error) {
      logger.error('Error counting audit records:', error);
      throw new AppError(500, 'Failed to count audit records');
    }
  }

  /**
   * Delete old audit records (for data retention compliance)
   *
   * @param olderThanDays - Delete records older than this many days
   * @returns Number of records deleted
   */
  async purgeOldRecords(olderThanDays: number): Promise<number> {
    try {
      const result = await query<{ count: string }>(
        `WITH deleted AS (
          DELETE FROM booking_verification_audit
          WHERE performed_at < CURRENT_TIMESTAMP - INTERVAL '1 day' * $1
          RETURNING id
        )
        SELECT COUNT(*) as count FROM deleted`,
        [olderThanDays]
      );

      const deletedCount = parseInt(result[0]?.count ?? '0', 10);
      if (deletedCount > 0) {
        logger.info(`Purged ${deletedCount} old audit records (older than ${olderThanDays} days)`);
      }

      return deletedCount;
    } catch (error) {
      logger.error('Error purging old audit records:', error);
      throw new AppError(500, 'Failed to purge audit records');
    }
  }
}

// Export singleton instance
export const bookingAuditService = new BookingAuditService();

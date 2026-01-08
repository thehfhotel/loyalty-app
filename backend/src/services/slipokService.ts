/**
 * SlipOK Service
 * Handles payment slip verification via SlipOK API
 */

import { logger } from '../utils/logger';
import { sanitizeLogValue } from '../utils/logSanitizer';

// Types
export interface SlipVerificationResult {
  success: boolean;
  status: 'verified' | 'failed' | 'quota_exceeded';
  transactionId?: string;
  amount?: number;
  sender?: string;
  receiver?: string;
  timestamp?: Date;
  errorCode?: string;
  errorMessage?: string;
  rawResponse?: Record<string, unknown>;
}

export interface SlipOKResponse {
  success: boolean;
  message?: string;
  // Transaction details (when success=true)
  transRef?: string;
  transDate?: string; // yyyyMMdd format
  transTime?: string; // HH:mm:ss format
  transTimestamp?: string; // ISO 8601
  amount?: number;
  sendingBank?: string; // 3-char bank code
  receivingBank?: string; // 3-char bank code
  sender?: {
    displayName?: string;
    name?: string;
    proxy?: { type?: string; value?: string };
    account?: { type?: string; value?: string };
  };
  receiver?: {
    displayName?: string;
    name?: string;
    proxy?: { type?: string; value?: string };
    account?: { type?: string; value?: string };
  };
  ref1?: string;
  ref2?: string;
  ref3?: string;
  paidLocalAmount?: number;
  paidLocalCurrency?: string;
  countryCode?: string;
  transFeeAmount?: string;
  // Error details (when success=false)
  code?: number;
}

export class SlipOKService {
  private apiKey: string;
  private branchId: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.SLIPOK_API_KEY ?? '';
    this.branchId = process.env.SLIPOK_BRANCH_ID ?? '';
    this.baseUrl = 'https://api.slipok.com/api/line/apikey';
  }

  /**
   * Get the full API URL for slip verification
   */
  private getApiUrl(): string {
    return `${this.baseUrl}/${this.branchId}`;
  }

  /**
   * Verify a payment slip via SlipOK API
   * @param slipImageUrlOrBookingId - Either the slip image URL (when called with 1 arg) or booking ID (when called with 2 args)
   * @param slipImageUrl - The slip image URL (optional, when called with 2 args)
   */
  async verifySlip(slipImageUrlOrBookingId: string, slipImageUrl?: string): Promise<SlipVerificationResult> {
    // Handle both 1-arg and 2-arg calls for backward compatibility
    const actualSlipUrl = slipImageUrl ?? slipImageUrlOrBookingId;
    const bookingId = slipImageUrl ? slipImageUrlOrBookingId : 'unknown';
    try {
      if (!this.apiKey || !this.branchId) {
        logger.warn('SlipOK API key or branch ID not configured, skipping verification');
        return {
          success: false,
          status: 'failed',
          errorCode: 'NOT_CONFIGURED',
          errorMessage: 'SlipOK API key or branch ID not configured',
        };
      }

      logger.info(`Starting SlipOK verification for booking ${sanitizeLogValue(bookingId)}`);

      // Call SlipOK API - POST to /api/line/apikey/{branchId}
      const response = await fetch(this.getApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-authorization': this.apiKey,
        },
        body: JSON.stringify({
          url: actualSlipUrl,
          log: true, // Enable logging for duplicate detection
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`SlipOK API error: ${response.status} - ${errorText}`);

        // Check for quota exceeded (HTTP 429 or specific error)
        if (response.status === 429) {
          return {
            success: false,
            status: 'quota_exceeded',
            errorCode: 'QUOTA_EXCEEDED',
            errorMessage: 'SlipOK monthly quota exceeded',
          };
        }

        return {
          success: false,
          status: 'failed',
          errorCode: `HTTP_${response.status}`,
          errorMessage: errorText,
        };
      }

      const data = await response.json() as SlipOKResponse;

      if (data.success) {
        // Verification successful - parse response fields
        const timestamp = data.transTimestamp
          ? new Date(data.transTimestamp)
          : data.transDate && data.transTime
            ? this.parseThaiDateTime(data.transDate, data.transTime)
            : undefined;

        const result: SlipVerificationResult = {
          success: true,
          status: 'verified',
          transactionId: data.transRef,
          amount: data.amount,
          sender: data.sender?.displayName ?? data.sender?.name,
          receiver: data.receiver?.displayName ?? data.receiver?.name,
          timestamp,
          rawResponse: data as unknown as Record<string, unknown>,
        };

        logger.info(`SlipOK verification successful for booking ${sanitizeLogValue(bookingId)}, transRef: ${data.transRef}`);
        return result;
      } else {
        // Verification failed - check for quota exceeded
        if (data.code === 1008) {
          return {
            success: false,
            status: 'quota_exceeded',
            errorCode: 'QUOTA_EXCEEDED',
            errorMessage: data.message ?? 'SlipOK monthly quota exceeded',
            rawResponse: data as unknown as Record<string, unknown>,
          };
        }

        const result: SlipVerificationResult = {
          success: false,
          status: 'failed',
          errorCode: data.code?.toString() ?? 'VERIFICATION_FAILED',
          errorMessage: data.message ?? 'Slip verification failed',
          rawResponse: data as unknown as Record<string, unknown>,
        };

        logger.warn(`SlipOK verification failed for booking ${sanitizeLogValue(bookingId)}: ${result.errorMessage}`);
        return result;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`SlipOK verification error for booking ${sanitizeLogValue(bookingId)}:`, error);

      return {
        success: false,
        status: 'failed',
        errorCode: 'INTERNAL_ERROR',
        errorMessage,
      };
    }
  }

  /**
   * Parse Thai date/time format from SlipOK response
   * @param dateStr - Date in yyyyMMdd format
   * @param timeStr - Time in HH:mm:ss format
   */
  private parseThaiDateTime(dateStr: string, timeStr: string): Date {
    // Parse yyyyMMdd format
    const year = parseInt(dateStr.substring(0, 4), 10);
    const month = parseInt(dateStr.substring(4, 6), 10) - 1; // JS months are 0-indexed
    const day = parseInt(dateStr.substring(6, 8), 10);

    // Parse HH:mm:ss format
    const [hours, minutes, seconds] = timeStr.split(':').map(n => parseInt(n, 10));

    // Create date in Thailand timezone (UTC+7)
    const date = new Date(year, month, day, hours, minutes, seconds);
    return date;
  }

  /**
   * Check if SlipOK service is configured
   */
  isConfigured(): boolean {
    return !!(this.apiKey && this.branchId);
  }

  /**
   * Check API quota status
   * Note: SlipOK quota is tracked on their dashboard. This method
   * can only detect quota_exceeded status from verification responses.
   */
  async checkQuota(): Promise<{ exceeded: boolean; remaining?: number }> {
    // SlipOK doesn't have a separate quota endpoint
    // Quota exceeded is detected from verification responses (error code 1008)
    return { exceeded: false };
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    configured: boolean;
    apiUrl: string;
    branchId: string;
    canConnect: boolean;
  }> {
    const configured = this.isConfigured();
    let canConnect = false;

    if (configured) {
      try {
        // SlipOK doesn't have a health endpoint, so we just check if configured
        // Actual connectivity is tested during verification
        canConnect = true;
      } catch {
        canConnect = false;
      }
    }

    return {
      configured,
      apiUrl: this.getApiUrl(),
      branchId: this.branchId,
      canConnect,
    };
  }
}

export const slipokService = new SlipOKService();

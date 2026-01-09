import { EventEmitter } from 'events';

interface SlipUploadedEvent {
  bookingId: string;
  slipId: string;
  timestamp: number;
}

/**
 * Server-Sent Events (SSE) Service
 * Provides real-time event broadcasting to connected admin clients
 */
class SSEService extends EventEmitter {
  private static instance: SSEService;

  private constructor() {
    super();
    // Increase max listeners to support multiple admin connections
    this.setMaxListeners(100);
  }

  static getInstance(): SSEService {
    if (!SSEService.instance) {
      SSEService.instance = new SSEService();
    }
    return SSEService.instance;
  }

  /**
   * Emit slip uploaded event to all connected admin clients
   */
  emitSlipUploaded(bookingId: string, slipId: string): void {
    const event: SlipUploadedEvent = {
      bookingId,
      slipId,
      timestamp: Date.now(),
    };
    this.emit('slip-uploaded', event);
  }
}

export const sseService = SSEService.getInstance();

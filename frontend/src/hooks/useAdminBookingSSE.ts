import { useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../store/authStore';

interface SlipUploadedEvent {
  bookingId: string;
  slipId: string;
  timestamp: number;
}

/**
 * Hook to subscribe to real-time admin booking updates via Server-Sent Events (SSE)
 *
 * @param onSlipUploaded - Callback fired when a slip is uploaded (< 1 second latency)
 */
export function useAdminBookingSSE(onSlipUploaded: (data: SlipUploadedEvent) => void) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const callbackRef = useRef(onSlipUploaded);

  // Keep callback ref updated
  useEffect(() => {
    callbackRef.current = onSlipUploaded;
  }, [onSlipUploaded]);

  const handleSlipUploaded = useCallback((data: SlipUploadedEvent) => {
    callbackRef.current(data);
  }, []);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    // EventSource doesn't support custom headers, so pass token as query param
    const eventSource = new EventSource(
      `/api/sse/admin/bookings?token=${encodeURIComponent(accessToken)}`
    );

    eventSource.addEventListener('slip-uploaded', (event) => {
      try {
        const data = JSON.parse(event.data) as SlipUploadedEvent;
        handleSlipUploaded(data);
      } catch (error) {
        console.error('Failed to parse SSE slip-uploaded event:', error);
      }
    });

    eventSource.addEventListener('connected', (event) => {
      console.log('SSE connected:', event.data);
    });

    eventSource.onerror = (error) => {
      // EventSource auto-reconnects on error
      console.warn('SSE connection error, will auto-reconnect:', error);
    };

    return () => {
      eventSource.close();
    };
  }, [accessToken, handleSlipUploaded]);
}

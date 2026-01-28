import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import SessionManager from '../SessionManager';
import { useAuthStore } from '../../../store/authStore';
import * as notificationManager from '../../../utils/notificationManager';

// Mock dependencies
vi.mock('../../../store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('../../../utils/notificationManager', () => ({
  notify: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('SessionManager', () => {
  const mockLogout = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.clearAllTimers();

    // Default authenticated state
    (useAuthStore as any).mockImplementation((selector: any) => {
      const state = {
        isAuthenticated: true,
        logout: mockLogout,
      };
      return selector(state);
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Component Rendering', () => {
    it('should render without errors', () => {
      const { container } = render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );
      expect(container).toBeInTheDocument();
    });

    it('should render null (no visible UI)', () => {
      const { container } = render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );
      expect(container.firstChild).toBeNull();
    });

    it('should not crash when authenticated', () => {
      expect(() => {
        render(
          <BrowserRouter>
            <SessionManager />
          </BrowserRouter>
        );
      }).not.toThrow();
    });

    it('should not crash when not authenticated', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isAuthenticated: false,
          logout: mockLogout,
        };
        return selector(state);
      });

      expect(() => {
        render(
          <BrowserRouter>
            <SessionManager />
          </BrowserRouter>
        );
      }).not.toThrow();
    });
  });

  describe('Session Timeout Warning', () => {
    it('should show warning notification after 25 minutes of inactivity', () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // Fast-forward 25 minutes (30 min timeout - 5 min warning)
      vi.advanceTimersByTime(25 * 60 * 1000);

      expect(notificationManager.notify.error).toHaveBeenCalledWith(
        'Your session will expire in 5 minutes due to inactivity.',
        {
          duration: 10000,
          id: 'session-warning',
        }
      );
    });

    it('should not show warning when user is active', () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // User activity at 20 minutes
      vi.advanceTimersByTime(20 * 60 * 1000);
      document.dispatchEvent(new MouseEvent('mousedown'));

      // Advance to what would have been warning time
      vi.advanceTimersByTime(5 * 60 * 1000);

      expect(notificationManager.notify.error).not.toHaveBeenCalled();
    });

    it('should show warning with proper notification ID to prevent duplicates', () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      vi.advanceTimersByTime(25 * 60 * 1000);

      expect(notificationManager.notify.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          id: 'session-warning',
        })
      );
    });
  });

  describe('Session Expiration', () => {
    it('should logout user after 30 minutes of inactivity', async () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // Fast-forward full 30 minutes
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

      expect(mockLogout).toHaveBeenCalled();
    });

    it('should show expiration notification before logout', async () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

      expect(notificationManager.notify.error).toHaveBeenCalledWith(
        'Your session has expired due to inactivity.',
        {
          id: 'session-expired-timeout',
        }
      );
    });

    it('should show both warning and expiration notifications in sequence', async () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // Warning at 25 minutes
      vi.advanceTimersByTime(25 * 60 * 1000);
      expect(notificationManager.notify.error).toHaveBeenCalledTimes(1);
      expect(notificationManager.notify.error).toHaveBeenCalledWith(
        expect.stringContaining('will expire in 5 minutes'),
        expect.any(Object)
      );

      // Expiration at 30 minutes
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(notificationManager.notify.error).toHaveBeenCalledTimes(2);
      expect(notificationManager.notify.error).toHaveBeenCalledWith(
        expect.stringContaining('has expired'),
        expect.any(Object)
      );
    });
  });

  describe('Activity Detection', () => {
    it('should reset timers on mouse down activity', () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // Advance partway
      vi.advanceTimersByTime(20 * 60 * 1000);

      // User activity
      document.dispatchEvent(new MouseEvent('mousedown'));

      // Advance to what would have been warning time without reset
      vi.advanceTimersByTime(10 * 60 * 1000);

      // Should not have warned yet because timer was reset
      expect(notificationManager.notify.error).not.toHaveBeenCalled();
    });

    it('should reset timers on keyboard activity', () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      vi.advanceTimersByTime(28 * 60 * 1000);

      // Clear any notifications that may have fired (warning at 25min)
      vi.clearAllMocks();

      document.dispatchEvent(new KeyboardEvent('keydown'));
      vi.advanceTimersByTime(3 * 60 * 1000);

      // No NEW notifications after activity reset
      expect(notificationManager.notify.error).not.toHaveBeenCalled();
    });

    it('should reset timers on scroll activity', () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      vi.advanceTimersByTime(28 * 60 * 1000);
      vi.clearAllMocks(); // Clear warning notification at 25min

      document.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(3 * 60 * 1000);

      expect(notificationManager.notify.error).not.toHaveBeenCalled();
    });

    it('should reset timers on touch activity', () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      vi.advanceTimersByTime(28 * 60 * 1000);
      vi.clearAllMocks(); // Clear warning notification at 25min

      document.dispatchEvent(new TouchEvent('touchstart'));
      vi.advanceTimersByTime(3 * 60 * 1000);

      expect(notificationManager.notify.error).not.toHaveBeenCalled();
    });

    it('should reset timers on mouse move activity', () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      vi.advanceTimersByTime(28 * 60 * 1000);
      vi.clearAllMocks(); // Clear warning notification at 25min

      document.dispatchEvent(new MouseEvent('mousemove'));
      vi.advanceTimersByTime(3 * 60 * 1000);

      expect(notificationManager.notify.error).not.toHaveBeenCalled();
    });

    it('should handle multiple activity events', () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // Multiple activities over time
      vi.advanceTimersByTime(10 * 60 * 1000);
      document.dispatchEvent(new MouseEvent('mousedown'));

      vi.advanceTimersByTime(10 * 60 * 1000);
      document.dispatchEvent(new KeyboardEvent('keydown'));

      vi.advanceTimersByTime(10 * 60 * 1000);
      document.dispatchEvent(new Event('scroll'));

      // No warnings should have appeared
      expect(notificationManager.notify.error).not.toHaveBeenCalled();
    });
  });

  describe('Unauthenticated State', () => {
    it('should not set timers when user is not authenticated', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isAuthenticated: false,
          logout: mockLogout,
        };
        return selector(state);
      });

      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // Fast-forward past timeout period
      vi.advanceTimersByTime(35 * 60 * 1000);

      expect(notificationManager.notify.error).not.toHaveBeenCalled();
      expect(mockLogout).not.toHaveBeenCalled();
    });

    it('should clear timers when user logs out', () => {
      const { rerender } = render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // Start with authenticated state and timers running
      vi.advanceTimersByTime(20 * 60 * 1000);

      // Change to unauthenticated
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isAuthenticated: false,
          logout: mockLogout,
        };
        return selector(state);
      });

      rerender(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // Advance past what would have been warning time
      vi.advanceTimersByTime(15 * 60 * 1000);

      expect(notificationManager.notify.error).not.toHaveBeenCalled();
    });
  });

  describe('Timer Cleanup', () => {
    it('should clean up event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const { unmount } = render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      unmount();

      // Should remove all 5 event listeners
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });

    it('should clear timers on unmount', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const { unmount } = render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should not leak timers after multiple mount/unmount cycles', () => {
      for (let i = 0; i < 5; i++) {
        const { unmount } = render(
          <BrowserRouter>
            <SessionManager />
          </BrowserRouter>
        );
        unmount();
      }

      // Advance time and verify no notifications fire from leaked timers
      vi.advanceTimersByTime(35 * 60 * 1000);
      expect(notificationManager.notify.error).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle activity at the exact warning threshold', () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // Activity right at 25 minute mark
      vi.advanceTimersByTime(25 * 60 * 1000 - 100);
      document.dispatchEvent(new MouseEvent('mousedown'));

      // Advance past original warning time
      vi.advanceTimersByTime(200);

      // Warning should not appear because timer was reset just before
      expect(notificationManager.notify.error).not.toHaveBeenCalled();
    });

    it('should handle rapid successive activities', () => {
      render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // Rapid fire activities
      for (let i = 0; i < 10; i++) {
        document.dispatchEvent(new MouseEvent('mousedown'));
        vi.advanceTimersByTime(100);
      }

      // Should still work normally
      vi.advanceTimersByTime(24 * 60 * 1000);
      expect(notificationManager.notify.error).not.toHaveBeenCalled();
    });

    it('should handle state changes during timer execution', async () => {
      const { rerender } = render(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // Advance to just before warning
      vi.advanceTimersByTime(24 * 60 * 1000);

      // Change authentication state
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = {
          isAuthenticated: true,
          logout: vi.fn(), // New logout function
        };
        return selector(state);
      });

      rerender(
        <BrowserRouter>
          <SessionManager />
        </BrowserRouter>
      );

      // Timers should be reset with new state
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

      // Should not trigger old timers
      expect(notificationManager.notify.error).not.toHaveBeenCalled();
    });
  });
});

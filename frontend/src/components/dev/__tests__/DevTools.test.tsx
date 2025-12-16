import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DevTools from '../DevTools';

// Mock sessionStorage
const sessionStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
});

describe('DevTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorageMock.clear();
    delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  });

  describe('Development Mode (Default Test Environment)', () => {
    it('should render in development mode when import.meta.env.DEV is true', () => {
      // In test environment, import.meta.env.DEV is true by default
      // This test validates the component renders in dev mode
      const { container } = render(<DevTools />);
      expect(container.firstChild).not.toBeNull();
    });

    it('should check sessionStorage in development mode', () => {
      render(<DevTools />);
      expect(sessionStorageMock.getItem('react-devtools-info-shown')).toBe('true');
    });

    it('should set sessionStorage after rendering', () => {
      render(<DevTools />);
      expect(sessionStorageMock.getItem('react-devtools-info-shown')).toBe('true');
    });
  });

  describe('Development Mode - React DevTools Installed', () => {

    it('should render nothing when React DevTools is installed', () => {
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {};

      const { container } = render(<DevTools />);
      expect(container.firstChild).toBeNull();
    });

    it('should not set sessionStorage when React DevTools is installed', () => {
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {};

      render(<DevTools />);
      expect(sessionStorageMock.getItem('react-devtools-info-shown')).toBeNull();
    });

    it('should not show notification when React DevTools is installed', () => {
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {};

      render(<DevTools />);
      expect(screen.queryByText('React DevTools')).not.toBeInTheDocument();
    });
  });

  describe('Development Mode - React DevTools Not Installed', () => {

    it('should render notification when React DevTools is not installed', () => {
      render(<DevTools />);
      expect(screen.getByText('React DevTools')).toBeInTheDocument();
    });

    it('should display installation message', () => {
      render(<DevTools />);
      expect(
        screen.getByText(
          'Install React DevTools browser extension for better development experience'
        )
      ).toBeInTheDocument();
    });

    it('should show React atom emoji', () => {
      render(<DevTools />);
      expect(screen.getByText('⚛️')).toBeInTheDocument();
    });

    it('should set sessionStorage after showing notification', () => {
      render(<DevTools />);
      expect(sessionStorageMock.getItem('react-devtools-info-shown')).toBe('true');
    });

    it('should apply correct styling classes', () => {
      const { container } = render(<DevTools />);
      const notification = container.querySelector('.fixed.bottom-4.right-4');
      expect(notification).toBeInTheDocument();
      expect(notification?.className).toContain('bg-blue-600');
      expect(notification?.className).toContain('text-white');
      expect(notification?.className).toContain('p-4');
      expect(notification?.className).toContain('rounded-lg');
      expect(notification?.className).toContain('shadow-lg');
      expect(notification?.className).toContain('z-50');
    });
  });

  describe('Session Storage - Already Shown', () => {

    it('should not render notification when already shown this session', () => {
      sessionStorageMock.setItem('react-devtools-info-shown', 'true');

      const { container } = render(<DevTools />);
      expect(container.firstChild).toBeNull();
    });

    it('should not show notification on subsequent renders', () => {
      // First render - sets sessionStorage
      const { unmount } = render(<DevTools />);
      expect(screen.getByText('React DevTools')).toBeInTheDocument();
      unmount();

      // Second render - should not show
      const { container } = render(<DevTools />);
      expect(container.firstChild).toBeNull();
    });

    it('should respect sessionStorage flag even if React DevTools is not installed', () => {
      sessionStorageMock.setItem('react-devtools-info-shown', 'true');
      delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;

      render(<DevTools />);
      expect(screen.queryByText('React DevTools')).not.toBeInTheDocument();
    });
  });

  describe('Install Link', () => {

    it('should render install link with correct href', () => {
      render(<DevTools />);
      const link = screen.getByRole('link', { name: /install/i });
      expect(link).toHaveAttribute('href', 'https://reactjs.org/link/react-devtools');
    });

    it('should open install link in new tab', () => {
      render(<DevTools />);
      const link = screen.getByRole('link', { name: /install/i });
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('should have proper security attributes', () => {
      render(<DevTools />);
      const link = screen.getByRole('link', { name: /install/i });
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should have correct styling classes', () => {
      render(<DevTools />);
      const link = screen.getByRole('link', { name: /install/i });
      expect(link.className).toContain('text-xs');
      expect(link.className).toContain('bg-blue-500');
      expect(link.className).toContain('hover:bg-blue-400');
      expect(link.className).toContain('px-2');
      expect(link.className).toContain('py-1');
      expect(link.className).toContain('rounded');
    });

    it('should display "Install" text', () => {
      render(<DevTools />);
      expect(screen.getByRole('link', { name: /install/i })).toHaveTextContent('Install');
    });
  });

  describe('Dismiss Button', () => {

    it('should render dismiss button', () => {
      render(<DevTools />);
      expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('should hide notification when dismiss is clicked', async () => {
      const user = userEvent.setup();
      render(<DevTools />);

      const dismissButton = screen.getByRole('button', { name: /dismiss/i });
      await user.click(dismissButton);

      expect(screen.queryByText('React DevTools')).not.toBeInTheDocument();
    });

    it('should hide notification with fireEvent click', () => {
      render(<DevTools />);

      const dismissButton = screen.getByRole('button', { name: /dismiss/i });
      fireEvent.click(dismissButton);

      expect(screen.queryByText('React DevTools')).not.toBeInTheDocument();
    });

    it('should have correct styling classes', () => {
      render(<DevTools />);
      const button = screen.getByRole('button', { name: /dismiss/i });
      expect(button.className).toContain('text-xs');
      expect(button.className).toContain('bg-gray-600');
      expect(button.className).toContain('hover:bg-gray-500');
      expect(button.className).toContain('px-2');
      expect(button.className).toContain('py-1');
      expect(button.className).toContain('rounded');
    });

    it('should display "Dismiss" text', () => {
      render(<DevTools />);
      expect(screen.getByRole('button', { name: /dismiss/i })).toHaveTextContent('Dismiss');
    });

    it('should not affect sessionStorage when dismissed', async () => {
      const user = userEvent.setup();
      render(<DevTools />);

      // Notification is shown, sessionStorage is set
      expect(sessionStorageMock.getItem('react-devtools-info-shown')).toBe('true');

      const dismissButton = screen.getByRole('button', { name: /dismiss/i });
      await user.click(dismissButton);

      // SessionStorage should remain set
      expect(sessionStorageMock.getItem('react-devtools-info-shown')).toBe('true');
    });

    it('should stay dismissed after dismiss click', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<DevTools />);

      const dismissButton = screen.getByRole('button', { name: /dismiss/i });
      await user.click(dismissButton);

      // Rerender
      rerender(<DevTools />);

      expect(screen.queryByText('React DevTools')).not.toBeInTheDocument();
    });
  });

  describe('Component Structure', () => {

    it('should render with proper flex layout', () => {
      const { container } = render(<DevTools />);
      const flexContainer = container.querySelector('.flex.items-start.space-x-2');
      expect(flexContainer).toBeInTheDocument();
    });

    it('should render emoji in flex-shrink-0 container', () => {
      const { container } = render(<DevTools />);
      const emojiContainer = container.querySelector('.flex-shrink-0');
      expect(emojiContainer).toBeInTheDocument();
      expect(emojiContainer?.textContent).toContain('⚛️');
    });

    it('should render content in flex-1 container', () => {
      const { container } = render(<DevTools />);
      const contentContainer = container.querySelector('.flex-1');
      expect(contentContainer).toBeInTheDocument();
    });

    it('should render title as h4 with correct styling', () => {
      const { container } = render(<DevTools />);
      const title = container.querySelector('h4');
      expect(title).toBeInTheDocument();
      expect(title?.className).toContain('font-semibold');
      expect(title?.className).toContain('text-sm');
      expect(title?.textContent).toBe('React DevTools');
    });

    it('should render description paragraph', () => {
      const { container } = render(<DevTools />);
      const description = container.querySelector('p');
      expect(description).toBeInTheDocument();
      expect(description?.className).toContain('text-xs');
      expect(description?.className).toContain('mt-1');
      expect(description?.className).toContain('opacity-90');
    });

    it('should render buttons in flex container with spacing', () => {
      const { container } = render(<DevTools />);
      const buttonContainer = container.querySelector('.mt-2.flex.space-x-2');
      expect(buttonContainer).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {

    it('should handle React DevTools hook with various truthy values', () => {
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { some: 'property' };

      const { container } = render(<DevTools />);
      expect(container.firstChild).toBeNull();
    });

    it('should handle multiple rapid dismiss clicks', async () => {
      const user = userEvent.setup();
      render(<DevTools />);

      const dismissButton = screen.getByRole('button', { name: /dismiss/i });
      await user.click(dismissButton);

      // Try clicking again (button should be gone)
      expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
    });

    it('should handle sessionStorage being set to other values', () => {
      sessionStorageMock.setItem('react-devtools-info-shown', 'false');

      render(<DevTools />);
      // Any truthy string value should prevent showing
      expect(screen.queryByText('React DevTools')).not.toBeInTheDocument();
    });

    it('should work correctly after clearing sessionStorage mid-session', () => {
      // First render - sets sessionStorage
      const { unmount } = render(<DevTools />);
      expect(screen.getByText('React DevTools')).toBeInTheDocument();
      unmount();

      // Clear sessionStorage
      sessionStorageMock.clear();

      // Second render - should show again
      render(<DevTools />);
      expect(screen.getByText('React DevTools')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {

    it('should have semantic button element', () => {
      render(<DevTools />);
      const button = screen.getByRole('button', { name: /dismiss/i });
      expect(button.tagName).toBe('BUTTON');
    });

    it('should have semantic link element', () => {
      render(<DevTools />);
      const link = screen.getByRole('link', { name: /install/i });
      expect(link.tagName).toBe('A');
    });

    it('should have semantic heading', () => {
      render(<DevTools />);
      const heading = screen.getByRole('heading', { level: 4 });
      expect(heading).toHaveTextContent('React DevTools');
    });

    it('should be keyboard navigable', async () => {
      const user = userEvent.setup();
      render(<DevTools />);

      const dismissButton = screen.getByRole('button', { name: /dismiss/i });
      dismissButton.focus();

      await user.keyboard('{Enter}');
      expect(screen.queryByText('React DevTools')).not.toBeInTheDocument();
    });
  });

  describe('Component Lifecycle', () => {

    it('should clean up properly on unmount', () => {
      const { unmount } = render(<DevTools />);
      expect(() => unmount()).not.toThrow();
    });

    it('should handle multiple mount/unmount cycles', () => {
      for (let i = 0; i < 5; i++) {
        const { unmount } = render(<DevTools />);
        unmount();
      }

      // Should still work on final render
      render(<DevTools />);
      expect(screen.queryByText('React DevTools')).not.toBeInTheDocument();
    });

    it('should only run useEffect once on mount', () => {
      const setItemSpy = vi.spyOn(sessionStorageMock, 'setItem');

      render(<DevTools />);

      // Should only set sessionStorage once
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      expect(setItemSpy).toHaveBeenCalledWith('react-devtools-info-shown', 'true');

      setItemSpy.mockRestore();
    });

    it('should not re-run useEffect on re-render', () => {
      const setItemSpy = vi.spyOn(sessionStorageMock, 'setItem');

      const { rerender } = render(<DevTools />);
      expect(setItemSpy).toHaveBeenCalledTimes(1);

      rerender(<DevTools />);
      // Should still only be called once
      expect(setItemSpy).toHaveBeenCalledTimes(1);

      setItemSpy.mockRestore();
    });
  });

  describe('Positioning and Z-Index', () => {

    it('should be positioned fixed', () => {
      const { container } = render(<DevTools />);
      const notification = container.querySelector('.fixed');
      expect(notification).toBeInTheDocument();
    });

    it('should be positioned at bottom-right', () => {
      const { container } = render(<DevTools />);
      const notification = container.querySelector('.bottom-4.right-4');
      expect(notification).toBeInTheDocument();
    });

    it('should have high z-index for visibility', () => {
      const { container } = render(<DevTools />);
      const notification = container.querySelector('.z-50');
      expect(notification).toBeInTheDocument();
    });

    it('should have max-width constraint', () => {
      const { container } = render(<DevTools />);
      const notification = container.querySelector('.max-w-sm');
      expect(notification).toBeInTheDocument();
    });
  });
});

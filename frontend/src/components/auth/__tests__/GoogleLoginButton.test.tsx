import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GoogleLoginButton from '../GoogleLoginButton';
import * as pwaUtils from '../../../utils/pwaUtils';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'auth.signInWithGoogle': 'Sign in with Google',
        'auth.continueWithGoogle': 'Continue with Google',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock pwaUtils
vi.mock('../../../utils/pwaUtils', () => ({
  initiateOAuth: vi.fn(),
  checkPWAInstallPrompt: vi.fn(),
}));

describe('GoogleLoginButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render button with default "Sign in with Google" text', () => {
      render(<GoogleLoginButton />);
      expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
    });

    it('should render button with "Continue with Google" text when variant is continue', () => {
      render(<GoogleLoginButton variant="continue" />);
      expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    });

    it('should render button with "Sign in with Google" text when variant is signIn', () => {
      render(<GoogleLoginButton variant="signIn" />);
      expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
    });

    it('should render Google logo SVG', () => {
      const { container } = render(<GoogleLoginButton />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg?.getAttribute('width')).toBe('20');
      expect(svg?.getAttribute('height')).toBe('20');
    });

    it('should render all four Google logo color paths', () => {
      const { container } = render(<GoogleLoginButton />);
      const paths = container.querySelectorAll('path');
      expect(paths).toHaveLength(4);

      // Verify Google brand colors are present
      const fills = Array.from(paths).map(p => p.getAttribute('fill'));
      expect(fills).toContain('#4285F4'); // Blue
      expect(fills).toContain('#34A853'); // Green
      expect(fills).toContain('#FBBC05'); // Yellow
      expect(fills).toContain('#EA4335'); // Red
    });
  });

  describe('Styling', () => {
    it('should have w-full class for full width', () => {
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('w-full');
    });

    it('should have flex layout classes', () => {
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('flex');
      expect(button.className).toContain('justify-center');
      expect(button.className).toContain('items-center');
    });

    it('should have focus ring classes for accessibility', () => {
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('focus:outline-none');
      expect(button.className).toContain('focus:ring-2');
      expect(button.className).toContain('focus:ring-offset-2');
      expect(button.className).toContain('focus:ring-blue-500');
    });

    it('should have transition classes for smooth hover effects', () => {
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('transition-all');
      expect(button.className).toContain('duration-200');
    });

    it('should have Roboto font family', () => {
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');
      expect(button.style.fontFamily).toContain('Roboto');
    });

    it('should have correct button height', () => {
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');
      expect(button.style.height).toBe('44px');
    });

    it('should have correct font size and weight', () => {
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');
      expect(button.style.fontSize).toBe('14px');
      expect(button.style.fontWeight).toBe('500');
    });
  });

  describe('Theme Variants', () => {
    describe('Light Theme (Default)', () => {
      it('should have white background by default', () => {
        render(<GoogleLoginButton />);
        const button = screen.getByRole('button');
        expect(button.style.backgroundColor).toBe('rgb(255, 255, 255)');
      });

      it('should have dark text color', () => {
        render(<GoogleLoginButton theme="light" />);
        const button = screen.getByRole('button');
        expect(button.style.color).toBe('rgb(31, 31, 31)');
      });

      it('should have border with proper color', () => {
        render(<GoogleLoginButton theme="light" />);
        const button = screen.getByRole('button');
        // Border color can be in hex or rgb format depending on browser
        const border = button.style.border;
        expect(border).toBeTruthy();
        expect(border).toMatch(/1px solid/);
      });
    });

    describe('Dark Theme', () => {
      it('should have dark background', () => {
        render(<GoogleLoginButton theme="dark" />);
        const button = screen.getByRole('button');
        expect(button.style.backgroundColor).toBe('rgb(19, 19, 20)');
      });

      it('should have light text color', () => {
        render(<GoogleLoginButton theme="dark" />);
        const button = screen.getByRole('button');
        expect(button.style.color).toBe('rgb(227, 227, 227)');
      });

      it('should have border with proper color', () => {
        render(<GoogleLoginButton theme="dark" />);
        const button = screen.getByRole('button');
        // Border color can be in hex or rgb format depending on browser
        const border = button.style.border;
        expect(border).toBeTruthy();
        expect(border).toMatch(/1px solid/);
      });
    });

    describe('Neutral Theme', () => {
      it('should have neutral gray background', () => {
        render(<GoogleLoginButton theme="neutral" />);
        const button = screen.getByRole('button');
        expect(button.style.backgroundColor).toBe('rgb(242, 242, 242)');
      });

      it('should have dark text color', () => {
        render(<GoogleLoginButton theme="neutral" />);
        const button = screen.getByRole('button');
        expect(button.style.color).toBe('rgb(31, 31, 31)');
      });

      it('should have transparent border', () => {
        render(<GoogleLoginButton theme="neutral" />);
        const button = screen.getByRole('button');
        expect(button.style.border).toContain('transparent');
      });
    });
  });

  describe('User Interactions', () => {
    it('should call checkPWAInstallPrompt when button is clicked', async () => {
      const user = userEvent.setup();
      render(<GoogleLoginButton />);

      await user.click(screen.getByRole('button'));

      expect(pwaUtils.checkPWAInstallPrompt).toHaveBeenCalledTimes(1);
    });

    it('should call initiateOAuth with "google" when button is clicked', async () => {
      const user = userEvent.setup();
      render(<GoogleLoginButton />);

      await user.click(screen.getByRole('button'));

      expect(pwaUtils.initiateOAuth).toHaveBeenCalledWith('google');
      expect(pwaUtils.initiateOAuth).toHaveBeenCalledTimes(1);
    });

    it('should call PWA utilities in correct order on click', async () => {
      const callOrder: string[] = [];
      vi.mocked(pwaUtils.checkPWAInstallPrompt).mockImplementation(() => {
        callOrder.push('checkPWAInstallPrompt');
      });
      vi.mocked(pwaUtils.initiateOAuth).mockImplementation(() => {
        callOrder.push('initiateOAuth');
      });

      const user = userEvent.setup();
      render(<GoogleLoginButton />);

      await user.click(screen.getByRole('button'));

      expect(callOrder).toEqual(['checkPWAInstallPrompt', 'initiateOAuth']);
    });

    it('should change background color on mouse over (light theme)', () => {
      render(<GoogleLoginButton theme="light" />);
      const button = screen.getByRole('button');

      const initialBackground = button.style.backgroundColor;
      fireEvent.mouseOver(button);

      expect(button.style.backgroundColor).not.toBe(initialBackground);
      expect(button.style.backgroundColor).toBe('rgb(248, 249, 250)'); // hover color
    });

    it('should restore background color on mouse out (light theme)', () => {
      render(<GoogleLoginButton theme="light" />);
      const button = screen.getByRole('button');

      const initialBackground = button.style.backgroundColor;
      fireEvent.mouseOver(button);
      fireEvent.mouseOut(button);

      expect(button.style.backgroundColor).toBe(initialBackground);
    });

    it('should change background color on mouse over (dark theme)', () => {
      render(<GoogleLoginButton theme="dark" />);
      const button = screen.getByRole('button');

      fireEvent.mouseOver(button);
      expect(button.style.backgroundColor).toBe('rgb(41, 42, 45)'); // dark hover
    });

    it('should change background color on mouse over (neutral theme)', () => {
      render(<GoogleLoginButton theme="neutral" />);
      const button = screen.getByRole('button');

      fireEvent.mouseOver(button);
      expect(button.style.backgroundColor).toBe('rgb(232, 232, 232)'); // neutral hover
    });
  });

  describe('Accessibility', () => {
    it('should be keyboard accessible (button role)', () => {
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');
      expect(button.tagName).toBe('BUTTON');
    });

    it('should have accessible name from text content', () => {
      render(<GoogleLoginButton variant="signIn" />);
      expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
    });

    it('should be focusable', () => {
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');
      button.focus();
      expect(document.activeElement).toBe(button);
    });

    it('should trigger click on Enter key', async () => {
      const user = userEvent.setup();
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');

      button.focus();
      await user.keyboard('{Enter}');

      expect(pwaUtils.initiateOAuth).toHaveBeenCalledWith('google');
    });

    it('should trigger click on Space key', async () => {
      const user = userEvent.setup();
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');

      button.focus();
      await user.keyboard(' ');

      expect(pwaUtils.initiateOAuth).toHaveBeenCalledWith('google');
    });
  });

  describe('Google Logo', () => {
    it('should render logo with proper sizing', () => {
      const { container } = render(<GoogleLoginButton />);
      const svg = container.querySelector('svg');
      expect(svg?.style.flexShrink).toBe('0');
    });

    it('should have margin spacing between logo and text', () => {
      const { container } = render(<GoogleLoginButton />);
      const svg = container.querySelector('svg');
      // SVG className is accessed differently in tests
      const svgClass = svg?.getAttribute('class') || '';
      expect(svgClass).toContain('mr-3');
    });

    it('should render logo SVG with correct viewBox', () => {
      const { container } = render(<GoogleLoginButton />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    });
  });

  describe('Prop Combinations', () => {
    it('should handle all theme and variant combinations', () => {
      const themes: Array<'light' | 'dark' | 'neutral'> = ['light', 'dark', 'neutral'];
      const variants: Array<'signIn' | 'continue'> = ['signIn', 'continue'];

      themes.forEach(theme => {
        variants.forEach(variant => {
          const { unmount } = render(<GoogleLoginButton theme={theme} variant={variant} />);
          const button = screen.getByRole('button');
          expect(button).toBeInTheDocument();
          unmount();
        });
      });
    });

    it('should maintain functionality across all theme variants', async () => {
      const user = userEvent.setup();
      const themes: Array<'light' | 'dark' | 'neutral'> = ['light', 'dark', 'neutral'];

      for (const theme of themes) {
        vi.clearAllMocks();
        const { unmount } = render(<GoogleLoginButton theme={theme} />);

        await user.click(screen.getByRole('button'));

        expect(pwaUtils.initiateOAuth).toHaveBeenCalledWith('google');
        unmount();
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid clicks without errors', async () => {
      const user = userEvent.setup();
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');

      await user.tripleClick(button);

      expect(pwaUtils.initiateOAuth).toHaveBeenCalledTimes(3);
    });

    it('should handle mouse over and out cycles', () => {
      render(<GoogleLoginButton />);
      const button = screen.getByRole('button');

      const initialBackground = button.style.backgroundColor;

      // Multiple hover cycles
      fireEvent.mouseOver(button);
      fireEvent.mouseOut(button);
      fireEvent.mouseOver(button);
      fireEvent.mouseOut(button);

      expect(button.style.backgroundColor).toBe(initialBackground);
    });

    it('should maintain button styling after interactions', async () => {
      const user = userEvent.setup();
      render(<GoogleLoginButton theme="dark" />);
      const button = screen.getByRole('button');

      await user.click(button);
      fireEvent.mouseOver(button);
      fireEvent.mouseOut(button);

      expect(button.className).toContain('w-full');
      expect(button.style.height).toBe('44px');
    });
  });
});

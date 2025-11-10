import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LineLoginButton from '../LineLoginButton';
import * as pwaUtils from '../../../utils/pwaUtils';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'auth.signInWithLine': 'Sign in with LINE',
        'auth.continueWithLine': 'Continue with LINE',
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

describe('LineLoginButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render button with default "Sign in with LINE" text', () => {
      render(<LineLoginButton />);
      expect(screen.getByRole('button', { name: /sign in with line/i })).toBeInTheDocument();
    });

    it('should render button with "Continue with LINE" text when variant is continue', () => {
      render(<LineLoginButton variant="continue" />);
      expect(screen.getByRole('button', { name: /continue with line/i })).toBeInTheDocument();
    });

    it('should render button with "Sign in with LINE" text when variant is signIn', () => {
      render(<LineLoginButton variant="signIn" />);
      expect(screen.getByRole('button', { name: /sign in with line/i })).toBeInTheDocument();
    });

    it('should render LINE logo SVG', () => {
      const { container } = render(<LineLoginButton />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    });

    it('should render LINE logo with white fill', () => {
      const { container } = render(<LineLoginButton />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('fill')).toBe('white');
    });

    it('should render LINE logo path element', () => {
      const { container } = render(<LineLoginButton />);
      const path = container.querySelector('path');
      expect(path).toBeInTheDocument();
      expect(path?.getAttribute('d')).toBeTruthy();
    });
  });

  describe('Styling', () => {
    it('should have w-full class for full width', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('w-full');
    });

    it('should have flex layout classes', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('flex');
      expect(button.className).toContain('justify-center');
      expect(button.className).toContain('items-center');
    });

    it('should have focus ring classes for accessibility', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('focus:outline-none');
      expect(button.className).toContain('focus:ring-2');
      expect(button.className).toContain('focus:ring-offset-2');
      expect(button.className).toContain('focus:ring-green-500');
    });

    it('should have transition classes for smooth effects', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');
      expect(button.className).toContain('transition-all');
      expect(button.className).toContain('duration-200');
    });

    it('should have LINE brand green background color', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');
      expect(button.style.backgroundColor).toBe('rgb(6, 199, 85)'); // #06C755
    });

    it('should have white text color', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');
      expect(button.style.color).toBe('rgb(255, 255, 255)');
    });

    it('should have border style specified', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');
      // Border can be computed as 'none' or 'medium' depending on browser
      const inlineStyle = button.getAttribute('style');
      expect(inlineStyle).toContain('border');
    });

    it('should have font weight 600', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');
      expect(button.style.fontWeight).toBe('600');
    });

    it('should have horizontal padding', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');
      expect(button.style.padding).toContain('16px');
    });
  });

  describe('Size Variants', () => {
    describe('Small Size', () => {
      it('should have correct height for small size', () => {
        render(<LineLoginButton size="small" />);
        const button = screen.getByRole('button');
        expect(button.style.height).toBe('36px');
      });

      it('should have correct font size for small size', () => {
        render(<LineLoginButton size="small" />);
        const button = screen.getByRole('button');
        expect(button.style.fontSize).toBe('12px');
      });

      it('should have correct icon size for small size', () => {
        const { container } = render(<LineLoginButton size="small" />);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('width')).toBe('16');
        expect(svg?.getAttribute('height')).toBe('16');
      });
    });

    describe('Medium Size (Default)', () => {
      it('should have correct height for medium size', () => {
        render(<LineLoginButton size="medium" />);
        const button = screen.getByRole('button');
        expect(button.style.height).toBe('44px');
      });

      it('should have correct font size for medium size', () => {
        render(<LineLoginButton size="medium" />);
        const button = screen.getByRole('button');
        expect(button.style.fontSize).toBe('14px');
      });

      it('should have correct icon size for medium size', () => {
        const { container } = render(<LineLoginButton size="medium" />);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('width')).toBe('20');
        expect(svg?.getAttribute('height')).toBe('20');
      });

      it('should use medium size by default', () => {
        render(<LineLoginButton />);
        const button = screen.getByRole('button');
        expect(button.style.height).toBe('44px');
        expect(button.style.fontSize).toBe('14px');
      });
    });

    describe('Large Size', () => {
      it('should have correct height for large size', () => {
        render(<LineLoginButton size="large" />);
        const button = screen.getByRole('button');
        expect(button.style.height).toBe('52px');
      });

      it('should have correct font size for large size', () => {
        render(<LineLoginButton size="large" />);
        const button = screen.getByRole('button');
        expect(button.style.fontSize).toBe('16px');
      });

      it('should have correct icon size for large size', () => {
        const { container } = render(<LineLoginButton size="large" />);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('width')).toBe('24');
        expect(svg?.getAttribute('height')).toBe('24');
      });
    });
  });

  describe('User Interactions', () => {
    it('should call checkPWAInstallPrompt when button is clicked', async () => {
      const user = userEvent.setup();
      render(<LineLoginButton />);

      await user.click(screen.getByRole('button'));

      expect(pwaUtils.checkPWAInstallPrompt).toHaveBeenCalledTimes(1);
    });

    it('should call initiateOAuth with "line" when button is clicked', async () => {
      const user = userEvent.setup();
      render(<LineLoginButton />);

      await user.click(screen.getByRole('button'));

      expect(pwaUtils.initiateOAuth).toHaveBeenCalledWith('line');
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
      render(<LineLoginButton />);

      await user.click(screen.getByRole('button'));

      expect(callOrder).toEqual(['checkPWAInstallPrompt', 'initiateOAuth']);
    });

    it('should change background color on mouse over', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');

      const initialBackground = button.style.backgroundColor;
      fireEvent.mouseOver(button);

      expect(button.style.backgroundColor).not.toBe(initialBackground);
      expect(button.style.backgroundColor).toBe('rgb(5, 176, 74)'); // hover color
    });

    it('should restore background color on mouse out', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');

      const initialBackground = button.style.backgroundColor;
      fireEvent.mouseOver(button);
      fireEvent.mouseOut(button);

      expect(button.style.backgroundColor).toBe(initialBackground);
    });

    it('should change to pressed color on mouse down', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');

      fireEvent.mouseDown(button);
      expect(button.style.backgroundColor).toBe('rgb(4, 138, 61)'); // pressed color
    });

    it('should change to hover color on mouse up', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');

      fireEvent.mouseDown(button);
      fireEvent.mouseUp(button);
      expect(button.style.backgroundColor).toBe('rgb(5, 176, 74)'); // hover color
    });

    it('should handle full mouse interaction cycle', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');

      const initialBackground = 'rgb(6, 199, 85)';

      // Initial state
      expect(button.style.backgroundColor).toBe(initialBackground);

      // Hover
      fireEvent.mouseOver(button);
      expect(button.style.backgroundColor).toBe('rgb(5, 176, 74)');

      // Press
      fireEvent.mouseDown(button);
      expect(button.style.backgroundColor).toBe('rgb(4, 138, 61)');

      // Release
      fireEvent.mouseUp(button);
      expect(button.style.backgroundColor).toBe('rgb(5, 176, 74)');

      // Leave
      fireEvent.mouseOut(button);
      expect(button.style.backgroundColor).toBe(initialBackground);
    });
  });

  describe('Accessibility', () => {
    it('should be keyboard accessible (button role)', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');
      expect(button.tagName).toBe('BUTTON');
    });

    it('should have accessible name from text content', () => {
      render(<LineLoginButton variant="signIn" />);
      expect(screen.getByRole('button', { name: /sign in with line/i })).toBeInTheDocument();
    });

    it('should be focusable', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');
      button.focus();
      expect(document.activeElement).toBe(button);
    });

    it('should trigger click on Enter key', async () => {
      const user = userEvent.setup();
      render(<LineLoginButton />);
      const button = screen.getByRole('button');

      button.focus();
      await user.keyboard('{Enter}');

      expect(pwaUtils.initiateOAuth).toHaveBeenCalledWith('line');
    });

    it('should trigger click on Space key', async () => {
      const user = userEvent.setup();
      render(<LineLoginButton />);
      const button = screen.getByRole('button');

      button.focus();
      await user.keyboard(' ');

      expect(pwaUtils.initiateOAuth).toHaveBeenCalledWith('line');
    });
  });

  describe('LINE Logo', () => {
    it('should render logo with proper sizing and flexShrink', () => {
      const { container } = render(<LineLoginButton />);
      const svg = container.querySelector('svg');
      expect(svg?.style.flexShrink).toBe('0');
    });

    it('should have margin spacing between logo and text', () => {
      const { container } = render(<LineLoginButton />);
      const svg = container.querySelector('svg');
      const svgClass = svg?.getAttribute('class') || '';
      expect(svgClass).toContain('mr-2');
    });

    it('should render logo SVG with correct viewBox', () => {
      const { container } = render(<LineLoginButton />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    });

    it('should scale logo based on size prop', () => {
      const sizes: Array<'small' | 'medium' | 'large'> = ['small', 'medium', 'large'];
      const expectedSizes = ['16', '20', '24'];

      sizes.forEach((size, index) => {
        const { container, unmount } = render(<LineLoginButton size={size} />);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('width')).toBe(expectedSizes[index]);
        expect(svg?.getAttribute('height')).toBe(expectedSizes[index]);
        unmount();
      });
    });
  });

  describe('Prop Combinations', () => {
    it('should handle all size and variant combinations', () => {
      const sizes: Array<'small' | 'medium' | 'large'> = ['small', 'medium', 'large'];
      const variants: Array<'signIn' | 'continue'> = ['signIn', 'continue'];

      sizes.forEach(size => {
        variants.forEach(variant => {
          const { unmount } = render(<LineLoginButton size={size} variant={variant} />);
          const button = screen.getByRole('button');
          expect(button).toBeInTheDocument();
          unmount();
        });
      });
    });

    it('should maintain functionality across all size variants', async () => {
      const user = userEvent.setup();
      const sizes: Array<'small' | 'medium' | 'large'> = ['small', 'medium', 'large'];

      for (const size of sizes) {
        vi.clearAllMocks();
        const { unmount } = render(<LineLoginButton size={size} />);

        await user.click(screen.getByRole('button'));

        expect(pwaUtils.initiateOAuth).toHaveBeenCalledWith('line');
        unmount();
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid clicks without errors', async () => {
      const user = userEvent.setup();
      render(<LineLoginButton />);
      const button = screen.getByRole('button');

      await user.tripleClick(button);

      expect(pwaUtils.initiateOAuth).toHaveBeenCalledTimes(3);
    });

    it('should handle multiple mouse interaction cycles', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');

      const initialBackground = button.style.backgroundColor;

      // Multiple cycles
      for (let i = 0; i < 3; i++) {
        fireEvent.mouseOver(button);
        fireEvent.mouseDown(button);
        fireEvent.mouseUp(button);
        fireEvent.mouseOut(button);
      }

      expect(button.style.backgroundColor).toBe(initialBackground);
    });

    it('should maintain button styling after interactions', async () => {
      const user = userEvent.setup();
      render(<LineLoginButton size="large" />);
      const button = screen.getByRole('button');

      await user.click(button);
      fireEvent.mouseOver(button);
      fireEvent.mouseOut(button);

      expect(button.className).toContain('w-full');
      expect(button.style.height).toBe('52px');
      expect(button.style.fontWeight).toBe('600');
    });

    it('should handle focus and blur events', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');

      button.focus();
      expect(document.activeElement).toBe(button);

      button.blur();
      expect(document.activeElement).not.toBe(button);
    });
  });

  describe('Brand Compliance', () => {
    it('should use official LINE brand green color', () => {
      render(<LineLoginButton />);
      const button = screen.getByRole('button');
      expect(button.style.backgroundColor).toBe('rgb(6, 199, 85)');
    });

    it('should have white text and logo for contrast', () => {
      const { container } = render(<LineLoginButton />);
      const button = screen.getByRole('button');
      const svg = container.querySelector('svg');

      expect(button.style.color).toBe('rgb(255, 255, 255)');
      expect(svg?.getAttribute('fill')).toBe('white');
    });

    it('should maintain brand colors across all sizes', () => {
      const sizes: Array<'small' | 'medium' | 'large'> = ['small', 'medium', 'large'];

      sizes.forEach(size => {
        const { unmount } = render(<LineLoginButton size={size} />);
        const button = screen.getByRole('button');
        expect(button.style.backgroundColor).toBe('rgb(6, 199, 85)');
        unmount();
      });
    });
  });
});

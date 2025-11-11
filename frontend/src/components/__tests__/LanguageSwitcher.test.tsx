import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LanguageSwitcher from '../LanguageSwitcher';

// Mock dependencies
const mockChangeLanguage = vi.fn();
const mockI18n = {
  language: 'en',
  changeLanguage: mockChangeLanguage,
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: mockI18n,
  }),
}));

vi.mock('react-icons/fi', () => ({
  FiGlobe: () => <span data-testid="globe-icon">🌐</span>,
  FiCheck: () => <span data-testid="check-icon">✓</span>,
}));

// Mock localStorage
const localStorageMock = (() => {
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

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockI18n.language = 'en';
  });

  describe('Basic Rendering', () => {
    it('should render the language switcher button', () => {
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      expect(button).toBeInTheDocument();
    });

    it('should render globe icon', () => {
      render(<LanguageSwitcher />);

      expect(screen.getByTestId('globe-icon')).toBeInTheDocument();
    });

    it('should render current language flag and name', () => {
      render(<LanguageSwitcher />);

      expect(screen.getByText('🇬🇧')).toBeInTheDocument();
      expect(screen.getByText(/English/)).toBeInTheDocument();
    });

    it('should not render dropdown menu initially', () => {
      render(<LanguageSwitcher />);

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<LanguageSwitcher />);

      expect(container).toBeTruthy();
    });
  });

  describe('Current Language Display', () => {
    it('should display English as current language', () => {
      mockI18n.language = 'en';

      render(<LanguageSwitcher />);

      expect(screen.getByText('🇬🇧')).toBeInTheDocument();
      expect(screen.getByText(/English/)).toBeInTheDocument();
    });

    it('should display Thai as current language', () => {
      mockI18n.language = 'th';

      render(<LanguageSwitcher />);

      expect(screen.getByText('🇹🇭')).toBeInTheDocument();
      expect(screen.getByText(/ไทย/)).toBeInTheDocument();
    });

    it('should display Chinese as current language', () => {
      mockI18n.language = 'zh-CN';

      render(<LanguageSwitcher />);

      expect(screen.getByText('🇨🇳')).toBeInTheDocument();
      expect(screen.getByText(/中文\(简体\)/)).toBeInTheDocument();
    });

    it('should fallback to English for unknown language', () => {
      mockI18n.language = 'unknown';

      render(<LanguageSwitcher />);

      expect(screen.getByText('🇬🇧')).toBeInTheDocument();
      expect(screen.getByText(/English/)).toBeInTheDocument();
    });
  });

  describe('Dropdown Toggle Behavior', () => {
    it('should open dropdown when button is clicked', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('should close dropdown when button is clicked again', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });

      // Open
      await user.click(button);
      expect(screen.getByRole('menu')).toBeInTheDocument();

      // Close
      await user.click(button);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('should toggle dropdown multiple times', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });

      // First toggle
      await user.click(button);
      expect(screen.getByRole('menu')).toBeInTheDocument();

      await user.click(button);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();

      // Second toggle
      await user.click(button);
      expect(screen.getByRole('menu')).toBeInTheDocument();

      await user.click(button);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('Dropdown Menu Content', () => {
    it('should render all three language options', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      const menuItems = screen.getAllByRole('menuitem');
      expect(menuItems).toHaveLength(3);
    });

    it('should display language flags in dropdown', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      expect(screen.getAllByText('🇬🇧')).toBeTruthy();
      expect(screen.getByText('🇹🇭')).toBeInTheDocument();
      expect(screen.getByText('🇨🇳')).toBeInTheDocument();
    });

    it('should display language names in dropdown', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      expect(screen.getAllByText('English')).toBeTruthy();
      expect(screen.getByText('ไทย')).toBeInTheDocument();
      expect(screen.getByText('中文(简体)')).toBeInTheDocument();
    });

    it('should show check icon for current language', async () => {
      const user = userEvent.setup();
      mockI18n.language = 'en';

      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      expect(screen.getByTestId('check-icon')).toBeInTheDocument();
    });

    it('should only show one check icon', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      const checkIcons = screen.getAllByTestId('check-icon');
      expect(checkIcons).toHaveLength(1);
    });
  });

  describe('Language Selection', () => {
    it('should change language when a language option is clicked', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      const thaiOption = screen.getByRole('menuitem', { name: /ไทย/i });
      await user.click(thaiOption);

      expect(mockChangeLanguage).toHaveBeenCalledWith('th');
    });

    it('should close dropdown after selecting a language', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      const thaiOption = screen.getByRole('menuitem', { name: /ไทย/i });
      await user.click(thaiOption);

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('should store language preference in localStorage', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      const chineseOption = screen.getByRole('menuitem', { name: /中文\(简体\)/i });
      await user.click(chineseOption);

      expect(localStorageMock.getItem('i18nextLng')).toBe('zh-CN');
    });

    it('should handle selecting each language option', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });

      // Select Thai
      await user.click(button);
      const thaiOption = screen.getByRole('menuitem', { name: /ไทย/i });
      await user.click(thaiOption);
      expect(mockChangeLanguage).toHaveBeenCalledWith('th');

      mockChangeLanguage.mockClear();

      // Select Chinese
      await user.click(button);
      const chineseOption = screen.getByRole('menuitem', { name: /中文\(简体\)/i });
      await user.click(chineseOption);
      expect(mockChangeLanguage).toHaveBeenCalledWith('zh-CN');

      mockChangeLanguage.mockClear();

      // Select English
      await user.click(button);
      const englishOption = screen.getByRole('menuitem', { name: /English/i });
      await user.click(englishOption);
      expect(mockChangeLanguage).toHaveBeenCalledWith('en');
    });
  });

  describe('Click Outside to Close', () => {
    it('should close dropdown when clicking outside', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <div data-testid="outside">Outside Element</div>
          <LanguageSwitcher />
        </div>
      );

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      expect(screen.getByRole('menu')).toBeInTheDocument();

      const outsideElement = screen.getByTestId('outside');
      fireEvent.mouseDown(outsideElement);

      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      });
    });

    it('should not close dropdown when clicking inside', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      const menu = screen.getByRole('menu');
      fireEvent.mouseDown(menu);

      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('should clean up event listener on unmount', async () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
      const { unmount } = render(<LanguageSwitcher />);

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
    });
  });

  describe('Responsive Behavior', () => {
    it('should render full language name on larger screens', () => {
      render(<LanguageSwitcher />);

      const fullName = screen.getByText(/English/);
      expect(fullName).toHaveClass('hidden', 'sm:inline');
    });

    it('should render flag-only version for small screens', () => {
      render(<LanguageSwitcher />);

      const flagOnly = screen.getAllByText('🇬🇧');
      const smallScreenFlag = flagOnly.find(el => el.classList.contains('sm:hidden'));
      expect(smallScreenFlag).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have accessible button label', () => {
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      expect(button).toHaveAttribute('aria-label', 'Change language');
    });

    it('should have proper menu role', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      const menu = screen.getByRole('menu');
      expect(menu).toHaveAttribute('role', 'menu');
      expect(menu).toHaveAttribute('aria-orientation', 'vertical');
    });

    it('should have menuitem role for language options', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      const menuItems = screen.getAllByRole('menuitem');
      menuItems.forEach(item => {
        expect(item).toHaveAttribute('role', 'menuitem');
      });
    });

    it('should be keyboard navigable', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });

      // Focus and activate with Enter
      button.focus();
      await user.keyboard('{Enter}');

      expect(screen.getByRole('menu')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid toggle clicks', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });

      // Rapid clicks
      await user.click(button);
      await user.click(button);
      await user.click(button);
      await user.click(button);

      // Should be closed (even number of clicks)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('should handle language selection without errors', async () => {
      const user = userEvent.setup();
      mockChangeLanguage.mockImplementation(() => {
        mockI18n.language = 'th';
      });

      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      const thaiOption = screen.getByRole('menuitem', { name: /ไทย/i });
      await user.click(thaiOption);

      expect(mockChangeLanguage).toHaveBeenCalled();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('should handle empty localStorage', async () => {
      const user = userEvent.setup();
      localStorageMock.clear();

      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      const thaiOption = screen.getByRole('menuitem', { name: /ไทย/i });
      await user.click(thaiOption);

      expect(localStorageMock.getItem('i18nextLng')).toBe('th');
    });

    it('should handle multiple language switches', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });

      // Switch to Thai
      await user.click(button);
      await user.click(screen.getByRole('menuitem', { name: /ไทย/i }));
      expect(localStorageMock.getItem('i18nextLng')).toBe('th');

      // Switch to Chinese
      await user.click(button);
      await user.click(screen.getByRole('menuitem', { name: /中文\(简体\)/i }));
      expect(localStorageMock.getItem('i18nextLng')).toBe('zh-CN');

      // Switch back to English
      await user.click(button);
      await user.click(screen.getByRole('menuitem', { name: /English/i }));
      expect(localStorageMock.getItem('i18nextLng')).toBe('en');
    });
  });

  describe('Component State', () => {
    it('should maintain closed state after language selection', async () => {
      const user = userEvent.setup();
      render(<LanguageSwitcher />);

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      const thaiOption = screen.getByRole('menuitem', { name: /ไทย/i });
      await user.click(thaiOption);

      // Dropdown should stay closed
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();

      // Can be reopened
      await user.click(button);
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('should update displayed language after selection', async () => {
      const user = userEvent.setup();
      mockChangeLanguage.mockImplementation((lang) => {
        mockI18n.language = lang;
      });

      const { rerender } = render(<LanguageSwitcher />);

      // Initially English
      expect(screen.getByText(/English/)).toBeInTheDocument();

      const button = screen.getByRole('button', { name: /change language/i });
      await user.click(button);

      const thaiOption = screen.getByRole('menuitem', { name: /ไทย/i });
      await user.click(thaiOption);

      // Rerender to see updated language
      rerender(<LanguageSwitcher />);

      expect(screen.getByText(/ไทย/)).toBeInTheDocument();
    });
  });
});

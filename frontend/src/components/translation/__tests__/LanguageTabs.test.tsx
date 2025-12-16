import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LanguageTabs from '../LanguageTabs';
import { SupportedLanguage } from '../../../types/multilingual';

// Mock dependencies
const mockTranslate = vi.fn((key: string) => {
  const translations: Record<string, string> = {
    'translation.original': 'Original',
    'translation.translated': 'Translated',
    'translation.pending': 'Pending',
    'translation.error': 'Error',
    'translation.statusLegend': 'Status Legend',
    'translation.languages': 'languages',
    'translation.language': 'language',
    'translation.originalDescription': 'Original content',
    'translation.translatedDescription': 'Translation completed',
    'translation.pendingDescription': 'Translation in progress',
    'translation.errorDescription': 'Translation failed',
    'translation.progress': 'Progress',
  };
  return translations[key] || key;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

vi.mock('react-icons/fi', () => ({
  FiCheck: () => <span data-testid="check-icon">✓</span>,
  FiClock: () => <span data-testid="clock-icon">⏰</span>,
  FiAlertCircle: () => <span data-testid="alert-icon">⚠</span>,
  FiFile: () => <span data-testid="file-icon">📄</span>,
}));

describe('LanguageTabs', () => {
  const mockOnLanguageChange = vi.fn();
  const defaultLanguages: SupportedLanguage[] = ['en', 'th', 'zh-CN'];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

    it('should render all provided language tabs', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3);
    });

    it('should render without crashing', () => {
      const { container } = render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      expect(container).toBeTruthy();
    });

    it('should render with custom className', () => {
      const { container } = render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          className="custom-class"
        />
      );

      const wrapper = container.querySelector('.border-b.border-gray-200');
      expect(wrapper).toHaveClass('custom-class');
    });

    it('should render with custom aria-label', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          aria-label="Custom language selection"
        />
      );

      const tablist = screen.getByRole('tablist');
      expect(tablist).toHaveAttribute('aria-label', 'Custom language selection');
    });
  });

  describe('Tab Display Names', () => {
    it('should display English as "English"', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      expect(screen.getByText('English')).toBeInTheDocument();
    });

    it('should display Thai as "ไทย"', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      expect(screen.getByText('ไทย')).toBeInTheDocument();
    });

    it('should display Chinese as "中文"', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      expect(screen.getByText('中文')).toBeInTheDocument();
    });
  });

  describe('Active Tab Styling', () => {
    it('should apply active styles to current language tab', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const englishTab = screen.getByRole('tab', { name: /switch to english/i });
      expect(englishTab).toHaveClass('border-blue-500', 'text-blue-600', 'bg-blue-50');
    });

    it('should apply inactive styles to non-current language tabs', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const thaiTab = screen.getByRole('tab', { name: /switch to ไทย/i });
      expect(thaiTab).toHaveClass('border-transparent', 'text-gray-500');
    });

    it('should update active tab when current language changes', () => {
      const { rerender } = render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      let englishTab = screen.getByRole('tab', { name: /switch to english/i });
      expect(englishTab).toHaveClass('border-blue-500');

      rerender(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="th"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      englishTab = screen.getByRole('tab', { name: /switch to english/i });
      const thaiTab = screen.getByRole('tab', { name: /switch to ไทย/i });
      expect(englishTab).toHaveClass('border-transparent');
      expect(thaiTab).toHaveClass('border-blue-500');
    });

    it('should set aria-pressed to true for active tab', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const englishTab = screen.getByRole('tab', { name: /switch to english/i });
      expect(englishTab).toHaveAttribute('aria-pressed', 'true');
    });

    it('should set aria-pressed to false for inactive tabs', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const thaiTab = screen.getByRole('tab', { name: /switch to ไทย/i });
      expect(thaiTab).toHaveAttribute('aria-pressed', 'false');
    });

    it('should set tabIndex to 0 for active tab', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const englishTab = screen.getByRole('tab', { name: /switch to english/i });
      expect(englishTab).toHaveAttribute('tabIndex', '0');
    });

    it('should set tabIndex to -1 for inactive tabs', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const thaiTab = screen.getByRole('tab', { name: /switch to ไทย/i });
      expect(thaiTab).toHaveAttribute('tabIndex', '-1');
    });
  });

  describe('Tab Selection', () => {
    it('should call onLanguageChange when clicking inactive tab', async () => {
      const user = userEvent.setup();
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const thaiTab = screen.getByRole('tab', { name: /switch to ไทย/i });
      await user.click(thaiTab);

      expect(mockOnLanguageChange).toHaveBeenCalledWith('th');
    });

    it('should not call onLanguageChange when clicking active tab', async () => {
      const user = userEvent.setup();
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const englishTab = screen.getByRole('tab', { name: /switch to english/i });
      await user.click(englishTab);

      expect(mockOnLanguageChange).not.toHaveBeenCalled();
    });

    it('should handle clicking different tabs', async () => {
      const user = userEvent.setup();
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const thaiTab = screen.getByRole('tab', { name: /switch to ไทย/i });
      await user.click(thaiTab);
      expect(mockOnLanguageChange).toHaveBeenCalledWith('th');

      const chineseTab = screen.getByRole('tab', { name: /switch to 中文/i });
      await user.click(chineseTab);
      expect(mockOnLanguageChange).toHaveBeenCalledWith('zh-CN');
    });
  });

  describe('Loading State', () => {
    it('should disable all tabs when loading', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          isLoading={true}
        />
      );

      const tabs = screen.getAllByRole('tab');
      tabs.forEach(tab => {
        expect(tab).toBeDisabled();
      });
    });

    it('should not call onLanguageChange when clicking tab while loading', async () => {
      const user = userEvent.setup();
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          isLoading={true}
        />
      );

      const thaiTab = screen.getByRole('tab', { name: /switch to ไทย/i });
      await user.click(thaiTab);

      expect(mockOnLanguageChange).not.toHaveBeenCalled();
    });

    it('should show loading spinner on active tab when loading', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          isLoading={true}
        />
      );

      const englishTab = screen.getByRole('tab', { name: /switch to english/i });
      const spinner = englishTab.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should not show loading spinner on inactive tabs', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          isLoading={true}
        />
      );

      const thaiTab = screen.getByRole('tab', { name: /switch to ไทย/i });
      const spinner = thaiTab.querySelector('.animate-spin');
      expect(spinner).not.toBeInTheDocument();
    });

    it('should apply disabled opacity when loading', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          isLoading={true}
        />
      );

      const tabs = screen.getAllByRole('tab');
      tabs.forEach(tab => {
        expect(tab).toHaveClass('disabled:opacity-50');
      });
    });
  });

  describe('Translation Status Indicators', () => {
    it('should not show status indicators when translationStatus is empty', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{}}
        />
      );

      const statusElements = screen.queryAllByRole('status');
      expect(statusElements).toHaveLength(0);
    });

    it('should show status indicator for original language', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{ en: 'original' }}
        />
      );

      const statusElements = screen.getAllByRole('status');
      expect(statusElements.length).toBeGreaterThan(0);
    });

    it('should show status indicator for translated language', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{ th: 'translated' }}
        />
      );

      const statusElements = screen.getAllByRole('status');
      expect(statusElements.length).toBeGreaterThan(0);
    });

    it('should show status indicator for pending translation', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{ 'zh-CN': 'pending' }}
        />
      );

      const statusElements = screen.getAllByRole('status');
      expect(statusElements.length).toBeGreaterThan(0);
    });

    it('should show status indicator for error state', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{ th: 'error' }}
        />
      );

      const statusElements = screen.getAllByRole('status');
      expect(statusElements.length).toBeGreaterThan(0);
    });

    it('should show multiple status indicators for multiple languages', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{ en: 'original', th: 'translated', 'zh-CN': 'pending' }}
        />
      );

      const statusElements = screen.getAllByRole('status');
      expect(statusElements.length).toBeGreaterThan(2);
    });

    it('should apply correct color class for original status', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{ en: 'original' }}
        />
      );

      const statusElement = screen.getByRole('status', { name: /original/i });
      expect(statusElement).toHaveClass('text-blue-600');
    });

    it('should apply correct color class for translated status', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{ th: 'translated' }}
        />
      );

      const statusElement = screen.getByRole('status', { name: /translated/i });
      expect(statusElement).toHaveClass('text-green-600');
    });

    it('should apply correct color class for pending status', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{ 'zh-CN': 'pending' }}
        />
      );

      const statusElement = screen.getByRole('status', { name: /pending/i });
      expect(statusElement).toHaveClass('text-yellow-600', 'animate-pulse');
    });

    it('should apply correct color class for error status', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{ th: 'error' }}
        />
      );

      const statusElement = screen.getByRole('status', { name: /error/i });
      expect(statusElement).toHaveClass('text-red-600');
    });
  });

  describe('Status Legend', () => {
    it('should render status legend when translationStatus has values', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{ en: 'original', th: 'translated' }}
        />
      );

      expect(screen.getByText('Status Legend')).toBeInTheDocument();
    });

    it('should not render status legend when translationStatus is empty', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{}}
        />
      );

      expect(screen.queryByText('Status Legend')).not.toBeInTheDocument();
    });

    it('should not render status legend when translationStatus is not provided', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      expect(screen.queryByText('Status Legend')).not.toBeInTheDocument();
    });

    it('should render progress bar when both translated and pending statuses exist', () => {
      const { container } = render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
          translationStatus={{ en: 'translated', th: 'pending' }}
        />
      );

      const progressBar = container.querySelector('.bg-green-500');
      expect(progressBar).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper tablist role', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const tablist = screen.getByRole('tablist');
      expect(tablist).toHaveAttribute('role', 'tablist');
    });

    it('should have proper tab roles', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const tabs = screen.getAllByRole('tab');
      tabs.forEach(tab => {
        expect(tab).toHaveAttribute('role', 'tab');
      });
    });

    it('should have descriptive aria-label for each tab', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      expect(screen.getByRole('tab', { name: /switch to english/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /switch to ไทย/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /switch to 中文/i })).toBeInTheDocument();
    });

    it('should have focus ring on tabs', () => {
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const tabs = screen.getAllByRole('tab');
      tabs.forEach(tab => {
        expect(tab).toHaveClass('focus:outline-none', 'focus:ring-2', 'focus:ring-blue-500');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle single language', () => {
      render(
        <LanguageTabs
          languages={['en']}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(1);
    });

    it('should handle two languages', () => {
      render(
        <LanguageTabs
          languages={['en', 'th']}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(2);
    });

    it('should handle unknown language gracefully', () => {
      render(
        <LanguageTabs
          languages={['en', 'th', 'unknown' as SupportedLanguage]}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3);
    });

    it('should handle rapid tab clicks', async () => {
      const user = userEvent.setup();
      render(
        <LanguageTabs
          languages={defaultLanguages}
          currentLanguage="en"
          onLanguageChange={mockOnLanguageChange}
        />
      );

      const thaiTab = screen.getByRole('tab', { name: /switch to ไทย/i });
      const chineseTab = screen.getByRole('tab', { name: /switch to 中文/i });

      await user.click(thaiTab);
      await user.click(chineseTab);

      expect(mockOnLanguageChange).toHaveBeenCalledTimes(2);
      expect(mockOnLanguageChange).toHaveBeenCalledWith('th');
      expect(mockOnLanguageChange).toHaveBeenCalledWith('zh-CN');
    });
  });
});

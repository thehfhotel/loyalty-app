import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TranslationButton from '../TranslationButton';
import { SupportedLanguage } from '../../../types/multilingual';

// Mock dependencies
vi.mock('react-icons/fi', () => ({
  FiGlobe: () => <span data-testid="globe-icon">🌐</span>,
  FiRefreshCw: () => <span data-testid="refresh-icon">↻</span>,
}));

// Translation flow temporarily skipped per request; re-enable after form translation is restored.
describe.skip('TranslationButton', () => {
  const mockOnTranslate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      expect(container).toBeTruthy();
    });

    it('should render globe icon when not translating', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      expect(screen.getByTestId('globe-icon')).toBeInTheDocument();
    });

    it('should render "Translate" text for first translation', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en']}
        />
      );

      expect(screen.getByText('Translate')).toBeInTheDocument();
    });

    it('should render "Update Translations" text when translations exist', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en', 'th']}
        />
      );

      expect(screen.getByText('Update Translations')).toBeInTheDocument();
    });
  });

  describe('Button State', () => {
    it('should not be disabled by default', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      expect(screen.getByRole('button')).not.toBeDisabled();
    });

    it('should be disabled when disabled prop is true', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          disabled={true}
          originalLanguage="en"
        />
      );

      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('should be disabled when isTranslating is true', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={true}
          originalLanguage="en"
        />
      );

      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('should apply disabled styles when disabled', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          disabled={true}
          originalLanguage="en"
        />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveClass('disabled:opacity-50', 'disabled:cursor-not-allowed');
    });
  });

  describe('Loading State', () => {
    it('should show loading text when translating', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={true}
          originalLanguage="en"
        />
      );

      expect(screen.getByText('Translating...')).toBeInTheDocument();
    });

    it('should show refresh icon when translating', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={true}
          originalLanguage="en"
        />
      );

      const refreshIcon = screen.getByTestId('refresh-icon');
      expect(refreshIcon).toBeInTheDocument();
      expect(refreshIcon).toHaveClass('animate-spin');
    });

    it('should not show globe icon when translating', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={true}
          originalLanguage="en"
        />
      );

      expect(screen.queryByTestId('globe-icon')).not.toBeInTheDocument();
    });
  });

  describe('Language Selection UI', () => {
    it('should show language selection when button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      expect(screen.getByText('Select languages to translate to:')).toBeInTheDocument();
    });

    it('should show different header for updates', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en', 'th']}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      expect(screen.getByText('Select languages to update:')).toBeInTheDocument();
    });

    it('should show language checkboxes', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it('should show Thai language option', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      expect(screen.getByText('ไทย')).toBeInTheDocument();
    });

    it('should show Chinese language option', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      expect(screen.getByText('中文')).toBeInTheDocument();
    });

    it('should not show original language in selection', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const allText = screen.queryAllByText('English');
      expect(allText).toHaveLength(0);
    });

    it('should mark translated languages with indicator', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en', 'th']}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      expect(screen.getByText('(translated)')).toBeInTheDocument();
    });

    it('should pre-select untranslated languages', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en', 'th']}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const chineseCheckbox = checkboxes.find(cb => {
        const label = cb.parentElement?.textContent;
        return label?.includes('中文');
      });

      expect(chineseCheckbox?.checked).toBe(true);
    });

    it('should not pre-select already translated languages', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en', 'th']}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const thaiCheckbox = checkboxes.find(cb => {
        const label = cb.parentElement?.textContent;
        return label?.includes('ไทย');
      });

      expect(thaiCheckbox?.checked).toBe(false);
    });
  });

  describe('Language Selection Interaction', () => {
    it('should toggle checkbox when clicked', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en']}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const thaiCheckbox = checkboxes.find(cb => {
        const label = cb.parentElement?.textContent;
        return label?.includes('ไทย');
      });

      expect(thaiCheckbox?.checked).toBe(true);

      if (thaiCheckbox) {
        await user.click(thaiCheckbox);
        expect(thaiCheckbox.checked).toBe(false);

        await user.click(thaiCheckbox);
        expect(thaiCheckbox.checked).toBe(true);
      }
    });

    it('should enable confirm button when languages selected', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en']}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const confirmButton = screen.getByRole('button', { name: /translate/i });
      expect(confirmButton).not.toBeDisabled();
    });

    it('should disable confirm button when no languages selected', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en', 'th', 'zh-CN']}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const confirmButton = screen.getByRole('button', { name: /update translations/i });
      expect(confirmButton).toBeDisabled();
    });
  });

  describe('Confirmation Actions', () => {
    it('should call onTranslate with selected languages', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en']}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const confirmButton = screen.getByRole('button', { name: /translate/i });
      await user.click(confirmButton);

      expect(mockOnTranslate).toHaveBeenCalledWith(['th', 'zh-CN']);
    });

    it('should hide selection UI after confirmation', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en']}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const confirmButton = screen.getByRole('button', { name: /translate/i });
      await user.click(confirmButton);

      expect(screen.queryByText('Select languages to translate to:')).not.toBeInTheDocument();
    });

    it('should reset selection after confirmation', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en']}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const confirmButton = screen.getByRole('button', { name: /translate/i });
      await user.click(confirmButton);

      await user.click(button);
      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const checkedCount = checkboxes.filter(cb => cb.checked).length;
      expect(checkedCount).toBe(2);
    });
  });

  describe('Cancel Actions', () => {
    it('should hide selection UI when cancel is clicked', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(screen.queryByText('Select languages to translate to:')).not.toBeInTheDocument();
    });

    it('should not call onTranslate when cancel is clicked', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(mockOnTranslate).not.toHaveBeenCalled();
    });

    it('should reset selection when cancel is clicked', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en']}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const thaiCheckbox = checkboxes.find(cb => {
        const label = cb.parentElement?.textContent;
        return label?.includes('ไทย');
      });

      if (thaiCheckbox) {
        await user.click(thaiCheckbox);
      }

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      await user.click(button);

      const newCheckboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const newThaiCheckbox = newCheckboxes.find(cb => {
        const label = cb.parentElement?.textContent;
        return label?.includes('ไทย');
      });

      expect(newThaiCheckbox?.checked).toBe(true);
    });
  });

  describe('Different Original Languages', () => {
    it('should exclude Thai when it is the original language', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="th"
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      expect(screen.queryByText('ไทย')).not.toBeInTheDocument();
      expect(screen.getByText('English')).toBeInTheDocument();
      expect(screen.getByText('中文')).toBeInTheDocument();
    });

    it('should exclude Chinese when it is the original language', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="zh-CN"
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      expect(screen.queryByText('中文')).not.toBeInTheDocument();
      expect(screen.getByText('English')).toBeInTheDocument();
      expect(screen.getByText('ไทย')).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('should apply proper button styles', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveClass('inline-flex', 'items-center', 'px-3', 'py-2', 'border');
    });

    it('should apply proper focus styles', () => {
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
        />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveClass('focus:outline-none', 'focus:ring-2', 'focus:ring-blue-500');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty availableLanguages array', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={[]}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it('should handle selecting and deselecting all languages', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          originalLanguage="en"
          availableLanguages={['en']}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const checkboxes = screen.getAllByRole('checkbox');
      for (const checkbox of checkboxes) {
        await user.click(checkbox);
      }

      const confirmButton = screen.getByRole('button', { name: /translate/i });
      expect(confirmButton).toBeDisabled();
    });

    it('should not crash when clicking disabled button', async () => {
      const user = userEvent.setup();
      render(
        <TranslationButton
          onTranslate={mockOnTranslate}
          isTranslating={false}
          disabled={true}
          originalLanguage="en"
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      expect(screen.queryByText('Select languages to translate to:')).not.toBeInTheDocument();
    });
  });
});

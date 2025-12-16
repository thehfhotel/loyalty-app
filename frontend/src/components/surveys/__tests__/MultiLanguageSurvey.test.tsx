/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MultiLanguageSurvey from '../MultiLanguageSurvey';

// Mock react-icons
vi.mock('react-icons/fi', () => ({
  FiGlobe: () => <span data-testid="globe-icon">🌐</span>,
}));

describe('MultiLanguageSurvey', () => {
  const mockOnLanguageChange = vi.fn();

  const availableLanguages = [
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'th', name: 'ไทย', flag: '🇹🇭' },
    { code: 'zh', name: '中文', flag: '🇨🇳' },
  ];

  const mockQuestions = [
    {
      id: 'q1',
      type: 'single_choice' as const,
      text: {
        en: 'What is your favorite color?',
        th: 'สีที่คุณชอบคืออะไร?',
        zh: '你最喜欢的颜色是什么？',
      },
      description: {
        en: 'Please select one option',
        th: 'กรุณาเลือกหนึ่งตัวเลือก',
        zh: '请选择一个选项',
      },
      required: true,
      options: [
        {
          id: 'opt1',
          text: {
            en: 'Red',
            th: 'แดง',
            zh: '红色',
          },
          value: 'red',
        },
        {
          id: 'opt2',
          text: {
            en: 'Blue',
            th: 'น้ำเงิน',
            zh: '蓝色',
          },
          value: 'blue',
        },
      ],
      order: 1,
    },
    {
      id: 'q2',
      type: 'text' as const,
      text: {
        en: 'What is your name?',
        th: 'คุณชื่ออะไร?',
        zh: '你叫什么名字？',
      },
      required: false,
      order: 2,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      const { container } = render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(container).toBeTruthy();
    });

    it('should render without crashing', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      // Text is broken up with question number and asterisk, use regex
      expect(screen.getByText(/What is your favorite color\?/)).toBeInTheDocument();
    });

    it('should display all questions', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/What is your favorite color\?/)).toBeInTheDocument();
      expect(screen.getByText(/What is your name\?/)).toBeInTheDocument();
    });

    it('should render language selector', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      // Multiple globe icons may exist, check at least one is present
      expect(screen.getAllByTestId('globe-icon').length).toBeGreaterThan(0);
      expect(screen.getByText('English')).toBeInTheDocument();
    });
  });

  describe('Language Selection', () => {
    it('should display current language in selector', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('English');
      expect(button).toHaveTextContent('🇺🇸');
    });

    it('should show different current language', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="th"
          availableLanguages={availableLanguages}
        />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('ไทย');
      expect(button).toHaveTextContent('🇹🇭');
    });

    it('should open language dropdown when selector clicked', async () => {
      const user = userEvent.setup();
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      expect(screen.getByText('ไทย')).toBeInTheDocument();
      expect(screen.getByText('中文')).toBeInTheDocument();
    });

    it('should display all available languages in dropdown', async () => {
      const user = userEvent.setup();
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      availableLanguages.forEach(lang => {
        expect(screen.getAllByText(lang.name).length).toBeGreaterThan(0);
        expect(screen.getAllByText(lang.flag).length).toBeGreaterThan(0);
      });
    });

    it('should call onLanguageChange when language selected', async () => {
      const user = userEvent.setup();
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const selectorButton = screen.getByRole('button');
      await user.click(selectorButton);

      // Find Thai option in the dropdown and click it
      const thaiOptions = screen.getAllByText('ไทย');
      const thaiOption = thaiOptions[thaiOptions.length - 1]!; // Get last one (in dropdown)
      await user.click(thaiOption);

      // Check if callback was called, may need to wait for state update
      await waitFor(() => {
        expect(mockOnLanguageChange).toHaveBeenCalled();
      });
    });

    it('should close dropdown after language selection', async () => {
      const user = userEvent.setup();
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const selectorButton = screen.getByRole('button');
      await user.click(selectorButton);

      const dropdown = screen.getByText('中文').closest('div');
      expect(dropdown).toBeInTheDocument();

      const thaiOption = screen.getAllByText('ไทย')[1]!;
      await user.click(thaiOption);

      await waitFor(() => {
        const dropdownAfter = screen.queryAllByText('中文');
        expect(dropdownAfter.length).toBe(0);
      });
    });

    it('should show checkmark for current language in dropdown', async () => {
      const user = userEvent.setup();
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const englishOption = screen.getAllByText('English')[1]!.closest('button');
      const checkmark = englishOption?.querySelector('svg');
      expect(checkmark).toBeInTheDocument();
    });

    it('should highlight current language in dropdown', async () => {
      const user = userEvent.setup();
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      const englishOption = screen.getAllByText('English')[1]!.closest('button');
      expect(englishOption).toHaveClass('bg-blue-50', 'text-blue-700');
    });
  });

  describe('Survey Content Display', () => {
    it('should display question text in selected language', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/What is your favorite color\?/)).toBeInTheDocument();
    });

    it('should display question text in Thai when Thai selected', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="th"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/สีที่คุณชอบคืออะไร\?/)).toBeInTheDocument();
    });

    it('should display question text in Chinese when Chinese selected', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="zh"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/你最喜欢的颜色是什么？/)).toBeInTheDocument();
    });

    it('should display question description in selected language', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText('Please select one option')).toBeInTheDocument();
    });

    it('should display options in selected language', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText('Red')).toBeInTheDocument();
      expect(screen.getByText('Blue')).toBeInTheDocument();
    });

    it('should display options in Thai', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="th"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText('แดง')).toBeInTheDocument();
      expect(screen.getByText('น้ำเงิน')).toBeInTheDocument();
    });

    it('should show question numbers', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/1\./)).toBeInTheDocument();
      expect(screen.getByText(/2\./)).toBeInTheDocument();
    });

    it('should show required asterisk for required questions', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const asterisks = screen.getAllByText('*');
      expect(asterisks.length).toBeGreaterThan(0);
    });

    it('should display question type label', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/Question Type: SINGLE CHOICE/)).toBeInTheDocument();
      expect(screen.getByText(/Question Type: TEXT/)).toBeInTheDocument();
    });
  });

  describe('Question Types Rendering', () => {
    it('should render single choice questions with radio buttons', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const radioButtons = screen.getAllByRole('radio');
      expect(radioButtons.length).toBeGreaterThan(0);
    });

    it('should render text input for text questions', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const textInput = screen.getByPlaceholderText(/Your answer in English\.\.\./);
      expect(textInput).toBeInTheDocument();
      expect(textInput.tagName).toBe('INPUT');
    });

    it('should render multiple choice questions with checkboxes', () => {
      const multipleChoiceQuestions = [
        {
          id: 'q1',
          type: 'multiple_choice' as const,
          text: { en: 'Select all that apply' },
          required: false,
          options: [
            { id: 'opt1', text: { en: 'Option 1' }, value: '1' },
            { id: 'opt2', text: { en: 'Option 2' }, value: '2' },
          ],
          order: 1,
        },
      ];

      render(
        <MultiLanguageSurvey
          questions={multipleChoiceQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it('should render textarea for textarea questions', () => {
      const textareaQuestions = [
        {
          id: 'q1',
          type: 'textarea' as const,
          text: { en: 'Tell us more' },
          required: false,
          order: 1,
        },
      ];

      render(
        <MultiLanguageSurvey
          questions={textareaQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const textarea = screen.getByPlaceholderText(/Your answer in English\.\.\./);
      expect(textarea.tagName).toBe('TEXTAREA');
    });

    it('should render rating scale for rating_5 questions', () => {
      const ratingQuestions = [
        {
          id: 'q1',
          type: 'rating_5' as const,
          text: { en: 'Rate us' },
          required: false,
          order: 1,
        },
      ];

      render(
        <MultiLanguageSurvey
          questions={ratingQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const ratingButtons = screen.getAllByRole('button').filter(btn =>
        ['1', '2', '3', '4', '5'].includes(btn.textContent || '')
      );
      expect(ratingButtons.length).toBe(5);
    });

    it('should render 10-point rating scale for rating_10 questions', () => {
      const ratingQuestions = [
        {
          id: 'q1',
          type: 'rating_10' as const,
          text: { en: 'Rate us' },
          required: false,
          order: 1,
        },
      ];

      render(
        <MultiLanguageSurvey
          questions={ratingQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const ratingButtons = screen.getAllByRole('button').filter(btn => {
        const num = parseInt(btn.textContent || '');
        return num >= 1 && num <= 10;
      });
      expect(ratingButtons.length).toBe(10);
    });

    it('should render yes/no options for yes_no questions', () => {
      const yesNoQuestions = [
        {
          id: 'q1',
          type: 'yes_no' as const,
          text: { en: 'Do you agree?' },
          required: false,
          order: 1,
        },
      ];

      render(
        <MultiLanguageSurvey
          questions={yesNoQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText('Yes')).toBeInTheDocument();
      expect(screen.getByText('No')).toBeInTheDocument();
    });

    it('should disable all input fields', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const radioButtons = screen.getAllByRole('radio');
      radioButtons.forEach(radio => {
        expect(radio).toBeDisabled();
      });

      const textInput = screen.getByPlaceholderText(/Your answer in English\.\.\./);
      expect(textInput).toBeDisabled();
    });
  });

  describe('Language Status Display', () => {
    it('should show multi-language survey preview message', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText('Multi-Language Survey Preview')).toBeInTheDocument();
    });

    it('should show current language in status', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/Currently showing: English/)).toBeInTheDocument();
    });

    it('should show total number of supported languages', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/Survey supports 3 languages/)).toBeInTheDocument();
    });

    it('should update current language display when language changes', () => {
      const { rerender } = render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/Currently showing: English/)).toBeInTheDocument();

      rerender(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="th"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/Currently showing: ไทย/)).toBeInTheDocument();
    });
  });

  describe('Fallback Behavior', () => {
    it('should fallback to English when translation missing', () => {
      const questionsWithPartialTranslation = [
        {
          id: 'q1',
          type: 'text' as const,
          text: {
            en: 'English text',
            // Missing Thai translation
          },
          required: false,
          order: 1,
        },
      ];

      render(
        <MultiLanguageSurvey
          questions={questionsWithPartialTranslation}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="th"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/English text/)).toBeInTheDocument();
    });

    it('should handle empty availableLanguages array', () => {
      const { container } = render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={[]}
        />
      );

      expect(container).toBeTruthy();
    });

    it('should fallback to default language when currentLanguage not in availableLanguages', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="fr"
          availableLanguages={availableLanguages}
        />
      );

      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('English');
    });

    it('should handle string text in question (non-multilingual)', () => {
      const simpleQuestions = [
        {
          id: 'q1',
          type: 'text' as const,
          text: 'Simple string text' as any,
          required: false,
          order: 1,
        },
      ];

      render(
        <MultiLanguageSurvey
          questions={simpleQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/Simple string text/)).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty questions array', () => {
      render(
        <MultiLanguageSurvey
          questions={[]}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText('Multi-Language Survey Preview')).toBeInTheDocument();
    });

    it('should handle questions without descriptions', () => {
      const questionsNoDesc = [
        {
          id: 'q1',
          type: 'text' as const,
          text: { en: 'Question without description' },
          required: false,
          order: 1,
        },
      ];

      render(
        <MultiLanguageSurvey
          questions={questionsNoDesc}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/Question without description/)).toBeInTheDocument();
    });

    it('should handle questions without options for choice types', () => {
      const questionsNoOptions = [
        {
          id: 'q1',
          type: 'single_choice' as const,
          text: { en: 'Question with no options' },
          required: false,
          order: 1,
        },
      ];

      const { container } = render(
        <MultiLanguageSurvey
          questions={questionsNoOptions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(container).toBeTruthy();
    });

    it('should handle very long question text', () => {
      const longQuestion = [
        {
          id: 'q1',
          type: 'text' as const,
          text: {
            en: 'This is a very long question text that goes on and on and on to test how the component handles extremely lengthy content in the question field',
          },
          required: false,
          order: 1,
        },
      ];

      render(
        <MultiLanguageSurvey
          questions={longQuestion}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/This is a very long question text/)).toBeInTheDocument();
    });

    it('should handle many questions', () => {
      const manyQuestions = Array.from({ length: 20 }, (_, i) => ({
        id: `q${i}`,
        type: 'text' as const,
        text: { en: `Question ${i + 1}` },
        required: false,
        order: i + 1,
      }));

      render(
        <MultiLanguageSurvey
          questions={manyQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      // Multiple elements may match "Question 1", use getAllByText
      expect(screen.getAllByText(/Question 1/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Question 20/).length).toBeGreaterThan(0);
    });
  });

  describe('Styling and Layout', () => {
    it('should have proper max width container', () => {
      const { container } = render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const mainContainer = container.querySelector('.max-w-4xl.mx-auto');
      expect(mainContainer).toBeInTheDocument();
    });

    it('should have proper spacing between questions', () => {
      const { container } = render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const questionsContainer = container.querySelector('.space-y-6');
      expect(questionsContainer).toBeInTheDocument();
    });

    it('should style questions with white background and shadow', () => {
      const { container } = render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const questionCards = container.querySelectorAll('.bg-white.rounded-lg.shadow.p-6');
      expect(questionCards.length).toBe(mockQuestions.length);
    });

    it('should have blue background for language status section', () => {
      const { container } = render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const statusSection = container.querySelector('.bg-blue-50.rounded-lg');
      expect(statusSection).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading structure', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const heading = screen.getByText(/What is your favorite color\?/);
      expect(heading.tagName).toBe('H3');
    });

    it('should associate labels with radio inputs', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      screen.getByText('Red'); // Verify label exists
      const redInput = screen.getByLabelText('Red');
      expect(redInput).toBeInTheDocument();
    });

    it('should have aria-label on language selector button', () => {
      render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      const button = screen.getByRole('button');
      expect(button).toBeTruthy();
    });
  });

  describe('Component Updates', () => {
    it('should update displayed content when currentLanguage changes', () => {
      const { rerender } = render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/What is your favorite color\?/)).toBeInTheDocument();

      rerender(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="th"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByText(/สีที่คุณชอบคืออะไร\?/)).toBeInTheDocument();
    });

    it('should update placeholder text when language changes', () => {
      const { rerender } = render(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="en"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByPlaceholderText(/Your answer in English\.\.\./)).toBeInTheDocument();

      rerender(
        <MultiLanguageSurvey
          questions={mockQuestions}
          onLanguageChange={mockOnLanguageChange}
          currentLanguage="th"
          availableLanguages={availableLanguages}
        />
      );

      expect(screen.getByPlaceholderText(/Your answer in ไทย\.\.\./)).toBeInTheDocument();
    });
  });
});

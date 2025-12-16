/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuestionRenderer from '../QuestionRenderer';
import { SurveyQuestion } from '../../../types/survey';

// Mock dependencies
const mockTranslate = vi.fn((key: string, fallback?: string) => {
  const translations: Record<string, string> = {
    'surveys.enterAnswer': 'Enter your answer...',
    'surveys.unknownQuestionType': 'Unknown question type',
    'common.yes': 'Yes',
    'common.no': 'No',
  };
  return translations[key] || fallback || key;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

describe('QuestionRenderer', () => {
  const mockOnAnswerChange = vi.fn();

  const singleChoiceQuestion: SurveyQuestion = {
    id: 'q1',
    type: 'single_choice',
    text: 'What is your favorite color?',
    description: 'Please select one option',
    required: true,
    order: 1,
    options: [
      { id: 'opt1', text: 'Red', value: '1' },
      { id: 'opt2', text: 'Blue', value: '2' },
      { id: 'opt3', text: 'Green', value: '3' },
    ],
  };

  const multipleChoiceQuestion: SurveyQuestion = {
    id: 'q2',
    type: 'multiple_choice',
    text: 'Select all that apply',
    required: false,
    order: 2,
    options: [
      { id: 'opt1', text: 'Option A', value: '1' },
      { id: 'opt2', text: 'Option B', value: '2' },
      { id: 'opt3', text: 'Option C', value: '3' },
    ],
  };

  const textQuestion: SurveyQuestion = {
    id: 'q3',
    type: 'text',
    text: 'What is your name?',
    required: true,
    order: 3,
  };

  const textareaQuestion: SurveyQuestion = {
    id: 'q4',
    type: 'textarea',
    text: 'Tell us more about yourself',
    required: false,
    order: 4,
  };

  const rating5Question: SurveyQuestion = {
    id: 'q5',
    type: 'rating_5',
    text: 'How satisfied are you?',
    required: true,
    order: 5,
    min_rating: 1,
    max_rating: 5,
  };

  const rating10Question: SurveyQuestion = {
    id: 'q6',
    type: 'rating_10',
    text: 'Rate your experience',
    required: true,
    order: 6,
    min_rating: 1,
    max_rating: 10,
  };

  const yesNoQuestion: SurveyQuestion = {
    id: 'q7',
    type: 'yes_no',
    text: 'Do you agree?',
    required: true,
    order: 7,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      const { container } = render(
        <QuestionRenderer
          question={singleChoiceQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(container).toBeTruthy();
    });

    it('should display question text', () => {
      render(
        <QuestionRenderer
          question={singleChoiceQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(screen.getByText('What is your favorite color?')).toBeInTheDocument();
    });

    it('should display required asterisk for required questions', () => {
      render(
        <QuestionRenderer
          question={singleChoiceQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      // The asterisk is rendered inline with the question text, not as a separate sibling
      expect(screen.getByText(/What is your favorite color/)).toBeInTheDocument();
      expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('should not display asterisk for optional questions', () => {
      const { container } = render(
        <QuestionRenderer
          question={multipleChoiceQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const questionText = container.querySelector('h3');
      expect(questionText?.textContent).not.toContain('*');
    });

    it('should display question description when provided', () => {
      render(
        <QuestionRenderer
          question={singleChoiceQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(screen.getByText('Please select one option')).toBeInTheDocument();
    });

    it('should not display description section when not provided', () => {
      render(
        <QuestionRenderer
          question={textQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(screen.queryByText(/Please select/)).not.toBeInTheDocument();
    });
  });

  describe('Single Choice Question', () => {
    it('should render all options as radio buttons', () => {
      render(
        <QuestionRenderer
          question={singleChoiceQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(screen.getByText('Red')).toBeInTheDocument();
      expect(screen.getByText('Blue')).toBeInTheDocument();
      expect(screen.getByText('Green')).toBeInTheDocument();

      const radioButtons = screen.getAllByRole('radio');
      expect(radioButtons).toHaveLength(3);
    });

    it('should check the selected option', () => {
      render(
        <QuestionRenderer
          question={singleChoiceQuestion}
          answer={'2'}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const radioButtons = screen.getAllByRole('radio') as HTMLInputElement[];
      expect(radioButtons[0]).not.toBeChecked(); // Red
      expect(radioButtons[1]).toBeChecked();     // Blue
      expect(radioButtons[2]).not.toBeChecked(); // Green
    });

    it('should call onAnswerChange when option selected', async () => {
      const user = userEvent.setup();

      render(
        <QuestionRenderer
          question={singleChoiceQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const radioButtons = screen.getAllByRole('radio');
      await user.click(radioButtons[1]!); // Click Blue

      expect(mockOnAnswerChange).toHaveBeenCalledWith('q1', '2');
    });

    it('should handle numeric answer values', () => {
      render(
        <QuestionRenderer
          question={singleChoiceQuestion}
          answer={2}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const radioButtons = screen.getAllByRole('radio') as HTMLInputElement[];
      expect(radioButtons[1]!).toBeChecked();
    });

    it('should apply hover styling to option labels', () => {
      const { container } = render(
        <QuestionRenderer
          question={singleChoiceQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const labels = container.querySelectorAll('label');
      labels.forEach(label => {
        expect(label).toHaveClass('hover:bg-gray-50');
      });
    });

    it('should highlight selected option with blue text', () => {
      render(
        <QuestionRenderer
          question={singleChoiceQuestion}
          answer={'2'}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const blueLabel = screen.getByText('Blue');
      expect(blueLabel).toHaveClass('text-blue-700');
    });
  });

  describe('Multiple Choice Question', () => {
    it('should render all options as checkboxes', () => {
      render(
        <QuestionRenderer
          question={multipleChoiceQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(screen.getByText('Option A')).toBeInTheDocument();
      expect(screen.getByText('Option B')).toBeInTheDocument();
      expect(screen.getByText('Option C')).toBeInTheDocument();

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes).toHaveLength(3);
    });

    it('should check selected options', () => {
      render(
        <QuestionRenderer
          question={multipleChoiceQuestion}
          answer={['1', '3']}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      expect(checkboxes[0]).toBeChecked();     // Option A
      expect(checkboxes[1]).not.toBeChecked(); // Option B
      expect(checkboxes[2]).toBeChecked();     // Option C
    });

    it('should call onAnswerChange when checkbox checked', async () => {
      const user = userEvent.setup();

      render(
        <QuestionRenderer
          question={multipleChoiceQuestion}
          answer={[]}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[0]!); // Check Option A

      expect(mockOnAnswerChange).toHaveBeenCalledWith('q2', ['1']);
    });

    it('should add to existing selections', async () => {
      const user = userEvent.setup();

      render(
        <QuestionRenderer
          question={multipleChoiceQuestion}
          answer={['1']}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[1]!); // Check Option B

      expect(mockOnAnswerChange).toHaveBeenCalledWith('q2', ['1', '2']);
    });

    it('should remove from selections when unchecked', async () => {
      const user = userEvent.setup();

      render(
        <QuestionRenderer
          question={multipleChoiceQuestion}
          answer={['1', '2', '3']}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[1]!); // Uncheck Option B

      expect(mockOnAnswerChange).toHaveBeenCalledWith('q2', ['1', '3']);
    });

    it('should handle non-array answer values gracefully', async () => {
      const user = userEvent.setup();

      render(
        <QuestionRenderer
          question={multipleChoiceQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[0]!);

      expect(mockOnAnswerChange).toHaveBeenCalledWith('q2', ['1']);
    });

    it('should highlight selected options with blue text', () => {
      render(
        <QuestionRenderer
          question={multipleChoiceQuestion}
          answer={['2']}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const optionB = screen.getByText('Option B');
      expect(optionB).toHaveClass('text-blue-700');
    });
  });

  describe('Text Question', () => {
    it('should render text input', () => {
      render(
        <QuestionRenderer
          question={textQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const input = screen.getByPlaceholderText('Enter your answer...');
      expect(input).toBeInTheDocument();
      expect(input.tagName).toBe('INPUT');
    });

    it('should display current answer value', () => {
      render(
        <QuestionRenderer
          question={textQuestion}
          answer={'John Doe'}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const input = screen.getByDisplayValue('John Doe');
      expect(input).toBeInTheDocument();
    });

    it('should call onAnswerChange when text entered', async () => {
      const user = userEvent.setup();

      render(
        <QuestionRenderer
          question={textQuestion}
          answer={''}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const input = screen.getByPlaceholderText('Enter your answer...');
      await user.type(input, 'Jane');

      // onAnswerChange is called for each keystroke, check it was called multiple times
      expect(mockOnAnswerChange).toHaveBeenCalled();
      expect(mockOnAnswerChange).toHaveBeenCalledTimes(4); // Once for each letter
    });

    it('should handle numeric answer values', () => {
      render(
        <QuestionRenderer
          question={textQuestion}
          answer={42}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const input = screen.getByDisplayValue('42');
      expect(input).toBeInTheDocument();
    });

    it('should handle null answer value', () => {
      render(
        <QuestionRenderer
          question={textQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const input = screen.getByPlaceholderText('Enter your answer...') as HTMLInputElement;
      expect(input.value).toBe('');
    });
  });

  describe('Textarea Question', () => {
    it('should render textarea element', () => {
      render(
        <QuestionRenderer
          question={textareaQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const textarea = screen.getByPlaceholderText('Enter your answer...');
      expect(textarea).toBeInTheDocument();
      expect(textarea.tagName).toBe('TEXTAREA');
    });

    it('should display current answer value', () => {
      render(
        <QuestionRenderer
          question={textareaQuestion}
          answer={'This is a long answer with multiple sentences.'}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const textarea = screen.getByDisplayValue('This is a long answer with multiple sentences.');
      expect(textarea).toBeInTheDocument();
    });

    it('should call onAnswerChange when text entered', async () => {
      const user = userEvent.setup();

      render(
        <QuestionRenderer
          question={textareaQuestion}
          answer={''}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const textarea = screen.getByPlaceholderText('Enter your answer...');
      await user.type(textarea, 'Long text');

      // onAnswerChange is called for each keystroke
      expect(mockOnAnswerChange).toHaveBeenCalled();
      expect(mockOnAnswerChange).toHaveBeenCalledTimes(9); // Once for each character including space
    });

    it('should have 4 rows', () => {
      render(
        <QuestionRenderer
          question={textareaQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const textarea = screen.getByPlaceholderText('Enter your answer...') as HTMLTextAreaElement;
      expect(textarea.rows).toBe(4);
    });
  });

  describe('Rating 5 Question', () => {
    it('should render 5 rating buttons', () => {
      render(
        <QuestionRenderer
          question={rating5Question}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const buttons = screen.getAllByRole('button');
      const ratingButtons = buttons.filter(btn => ['1', '2', '3', '4', '5'].includes(btn.textContent || ''));
      expect(ratingButtons).toHaveLength(5);
    });

    it('should display rating labels', () => {
      render(
        <QuestionRenderer
          question={rating5Question}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      // Multiple elements may have "1" (label and button), so check they exist
      expect(screen.getAllByText('1').length).toBeGreaterThan(0);
      expect(screen.getAllByText('5').length).toBeGreaterThan(0);
    });

    it('should highlight selected rating', () => {
      render(
        <QuestionRenderer
          question={rating5Question}
          answer={3}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const buttons = screen.getAllByRole('button');
      const rating3Button = buttons.find(btn => btn.textContent === '3');
      expect(rating3Button).toHaveClass('bg-blue-600', 'text-white');
    });

    it('should call onAnswerChange when rating clicked', async () => {
      const user = userEvent.setup();

      render(
        <QuestionRenderer
          question={rating5Question}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const buttons = screen.getAllByRole('button');
      const rating4Button = buttons.find(btn => btn.textContent === '4');

      if (rating4Button) {
        await user.click(rating4Button);
        expect(mockOnAnswerChange).toHaveBeenCalledWith('q5', 4);
      }
    });

    it('should style unselected ratings differently', () => {
      render(
        <QuestionRenderer
          question={rating5Question}
          answer={3}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const buttons = screen.getAllByRole('button');
      const rating1Button = buttons.find(btn => btn.textContent === '1');
      expect(rating1Button).toHaveClass('bg-white', 'text-gray-700');
    });

    it('should apply hover effect to rating buttons', () => {
      render(
        <QuestionRenderer
          question={rating5Question}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const buttons = screen.getAllByRole('button');
      const ratingButtons = buttons.filter(btn => ['1', '2', '3', '4', '5'].includes(btn.textContent || ''));

      ratingButtons.forEach(button => {
        expect(button).toHaveClass('hover:border-blue-300');
      });
    });
  });

  describe('Rating 10 Question', () => {
    it('should render 10 rating buttons', () => {
      render(
        <QuestionRenderer
          question={rating10Question}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const buttons = screen.getAllByRole('button');
      const ratingButtons = buttons.filter(btn => {
        const text = btn.textContent || '';
        return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(text);
      });
      expect(ratingButtons).toHaveLength(10);
    });

    it('should display all rating numbers', () => {
      render(
        <QuestionRenderer
          question={rating10Question}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      for (let i = 1; i <= 10; i++) {
        const button = screen.getByText(i.toString());
        expect(button).toBeInTheDocument();
      }
    });

    it('should highlight selected rating', () => {
      render(
        <QuestionRenderer
          question={rating10Question}
          answer={7}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const buttons = screen.getAllByRole('button');
      const rating7Button = buttons.find(btn => btn.textContent === '7');
      expect(rating7Button).toHaveClass('bg-blue-600', 'text-white');
    });

    it('should call onAnswerChange when rating clicked', async () => {
      const user = userEvent.setup();

      render(
        <QuestionRenderer
          question={rating10Question}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const buttons = screen.getAllByRole('button');
      const rating8Button = buttons.find(btn => btn.textContent === '8');

      if (rating8Button) {
        await user.click(rating8Button);
        expect(mockOnAnswerChange).toHaveBeenCalledWith('q6', 8);
      }
    });

    it('should use grid layout', () => {
      const { container } = render(
        <QuestionRenderer
          question={rating10Question}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const grid = container.querySelector('.grid-cols-5');
      expect(grid).toBeInTheDocument();
    });
  });

  describe('Yes/No Question', () => {
    it('should render yes and no options', () => {
      render(
        <QuestionRenderer
          question={yesNoQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(screen.getByText('Yes')).toBeInTheDocument();
      expect(screen.getByText('No')).toBeInTheDocument();
    });

    it('should render as radio buttons', () => {
      render(
        <QuestionRenderer
          question={yesNoQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const radioButtons = screen.getAllByRole('radio');
      expect(radioButtons).toHaveLength(2);
    });

    it('should check yes when answer is yes', () => {
      render(
        <QuestionRenderer
          question={yesNoQuestion}
          answer={'yes'}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const radioButtons = screen.getAllByRole('radio') as HTMLInputElement[];
      expect(radioButtons[0]).toBeChecked(); // Yes
      expect(radioButtons[1]).not.toBeChecked(); // No
    });

    it('should check no when answer is no', () => {
      render(
        <QuestionRenderer
          question={yesNoQuestion}
          answer={'no'}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const radioButtons = screen.getAllByRole('radio') as HTMLInputElement[];
      expect(radioButtons[0]).not.toBeChecked(); // Yes
      expect(radioButtons[1]).toBeChecked(); // No
    });

    it('should call onAnswerChange when yes clicked', async () => {
      const user = userEvent.setup();

      render(
        <QuestionRenderer
          question={yesNoQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const radioButtons = screen.getAllByRole('radio');
      await user.click(radioButtons[0]!); // Click Yes

      expect(mockOnAnswerChange).toHaveBeenCalledWith('q7', 'yes');
    });

    it('should call onAnswerChange when no clicked', async () => {
      const user = userEvent.setup();

      render(
        <QuestionRenderer
          question={yesNoQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const radioButtons = screen.getAllByRole('radio');
      await user.click(radioButtons[1]!); // Click No

      expect(mockOnAnswerChange).toHaveBeenCalledWith('q7', 'no');
    });

    it('should highlight selected option with blue text', () => {
      render(
        <QuestionRenderer
          question={yesNoQuestion}
          answer={'yes'}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const yesLabel = screen.getByText('Yes');
      expect(yesLabel).toHaveClass('text-blue-700');
    });
  });

  describe('Error Display', () => {
    it('should not display error message when error is undefined', () => {
      render(
        <QuestionRenderer
          question={textQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const errorText = screen.queryByText(/error/i);
      expect(errorText).not.toBeInTheDocument();
    });

    it('should display error message when error is provided', () => {
      render(
        <QuestionRenderer
          question={textQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
          error="This field is required"
        />
      );

      expect(screen.getByText('This field is required')).toBeInTheDocument();
    });

    it('should style error message with red text', () => {
      render(
        <QuestionRenderer
          question={textQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
          error="This field is required"
        />
      );

      const errorMessage = screen.getByText('This field is required');
      expect(errorMessage).toHaveClass('text-red-600');
    });
  });

  describe('Unknown Question Type', () => {
    it('should display error for unknown question type', () => {
      const unknownQuestion: SurveyQuestion = {
        id: 'q_unknown',
        type: 'unknown_type' as any,
        text: 'Unknown question',
        required: false,
        order: 1,
      };

      render(
        <QuestionRenderer
          question={unknownQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(screen.getByText(/Unknown question type/)).toBeInTheDocument();
      expect(screen.getByText(/unknown_type/)).toBeInTheDocument();
    });

    it('should style unknown type error with red text', () => {
      const unknownQuestion: SurveyQuestion = {
        id: 'q_unknown',
        type: 'invalid' as any,
        text: 'Unknown question',
        required: false,
        order: 1,
      };

      const { container } = render(
        <QuestionRenderer
          question={unknownQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const errorDiv = container.querySelector('.text-red-500');
      expect(errorDiv).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      render(
        <QuestionRenderer
          question={textQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const heading = screen.getByText('What is your name?');
      expect(heading.tagName).toBe('H3');
    });

    it('should have accessible form controls', () => {
      render(
        <QuestionRenderer
          question={singleChoiceQuestion}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const radioButtons = screen.getAllByRole('radio');
      expect(radioButtons.length).toBeGreaterThan(0);
    });

    it('should have focusable rating buttons', () => {
      render(
        <QuestionRenderer
          question={rating5Question}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const buttons = screen.getAllByRole('button');
      buttons.forEach(button => {
        expect(button.tagName).toBe('BUTTON');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle question without options', () => {
      const questionNoOptions = { ...singleChoiceQuestion, options: undefined };

      render(
        <QuestionRenderer
          question={questionNoOptions}
          answer={null}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(screen.getByText('What is your favorite color?')).toBeInTheDocument();
    });

    it('should handle empty string answer for text input', () => {
      render(
        <QuestionRenderer
          question={textQuestion}
          answer={''}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const input = screen.getByPlaceholderText('Enter your answer...') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    it('should handle array answer for text question gracefully', () => {
      render(
        <QuestionRenderer
          question={textQuestion}
          answer={['not', 'a', 'string'] as any}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const input = screen.getByPlaceholderText('Enter your answer...') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    it('should handle boolean answer for text question', () => {
      render(
        <QuestionRenderer
          question={textQuestion}
          answer={true as any}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const input = screen.getByPlaceholderText('Enter your answer...') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    it('should handle string answer for multiple choice as empty array', async () => {
      const user = userEvent.setup();

      render(
        <QuestionRenderer
          question={multipleChoiceQuestion}
          answer={'not-an-array' as any}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[0]!);

      expect(mockOnAnswerChange).toHaveBeenCalledWith('q2', ['1']);
    });
  });
});

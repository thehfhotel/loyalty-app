/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuestionEditor from '../QuestionEditor';
import { SurveyQuestion, QuestionOption } from '../../../types/survey';
import { surveyService } from '../../../services/surveyService';

// Mock dependencies
const mockTranslate = vi.fn((key: string, options?: { number?: number }) => {
  const translations: Record<string, string> = {
    'surveys.admin.questionEditor.questionNumber': `Question ${options?.number ?? 1}`,
    'surveys.admin.questionEditor.questionTypes.singleChoice': 'Single Choice',
    'surveys.admin.questionEditor.questionTypes.multipleChoice': 'Multiple Choice',
    'surveys.admin.questionEditor.questionTypes.text': 'Short Text',
    'surveys.admin.questionEditor.questionTypes.textarea': 'Long Text',
    'surveys.admin.questionEditor.questionTypes.rating5': 'Rating (1-5)',
    'surveys.admin.questionEditor.questionTypes.rating10': 'Rating (1-10)',
    'surveys.admin.questionEditor.questionTypes.yesNo': 'Yes/No',
    'surveys.admin.questionEditor.questionText': 'Question Text',
    'surveys.admin.questionEditor.questionTextPlaceholder': 'Enter your question...',
    'surveys.admin.questionEditor.fieldRequired': 'This field is required',
    'surveys.admin.questionEditor.description': 'Description (Optional)',
    'surveys.admin.questionEditor.descriptionPlaceholder': 'Add a helpful description...',
    'surveys.admin.questionEditor.answerOptions': 'Answer Options',
    'surveys.admin.questionEditor.optionTextPlaceholder': 'Enter option text...',
    'surveys.admin.questionEditor.newOptionText': `Option ${options?.number ?? 1}`,
    'surveys.admin.questionEditor.addOption': 'Add Option',
    'surveys.admin.questionEditor.minRating': 'Minimum Rating',
    'surveys.admin.questionEditor.maxRating': 'Maximum Rating',
    'surveys.admin.questionEditor.requiredQuestion': 'Required question',
    'surveys.admin.questionEditor.preview': 'PREVIEW',
    'surveys.admin.questionEditor.previewPlaceholder': 'Your question text will appear here',
    'surveys.admin.questionEditor.textInputPlaceholder': 'Your answer...',
    'surveys.admin.questionEditor.longTextInputPlaceholder': 'Your detailed answer...',
    'common.yes': 'Yes',
    'common.no': 'No',
  };
  return translations[key] || key;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

vi.mock('../../../services/surveyService', () => ({
  surveyService: {
    generateOptionId: vi.fn(),
  },
}));

describe('QuestionEditor', () => {
  const mockOnUpdate = vi.fn();
  const mockOnRemove = vi.fn();
  const mockOnReorder = vi.fn();

  const baseSingleChoiceQuestion: SurveyQuestion = {
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

  const baseTextQuestion: SurveyQuestion = {
    id: 'q2',
    type: 'text',
    text: 'What is your name?',
    required: false,
    order: 2,
  };

  const baseRatingQuestion: SurveyQuestion = {
    id: 'q3',
    type: 'rating_5',
    text: 'How satisfied are you?',
    required: true,
    order: 3,
    min_rating: 1,
    max_rating: 5,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(surveyService.generateOptionId).mockReturnValue('opt_new_123');
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      const { container } = render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(container).toBeTruthy();
    });

    it('should display question number', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('Question 1')).toBeInTheDocument();
    });

    it('should display question type badge', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('Single Choice')).toBeInTheDocument();
    });

    it('should display move handle when canMove is true', () => {
      const { container } = render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const moveButton = container.querySelector('.cursor-move');
      expect(moveButton).toBeInTheDocument();
    });

    it('should not display move handle when canMove is false', () => {
      const { container } = render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={false}
        />
      );

      const moveButton = container.querySelector('.cursor-move');
      expect(moveButton).not.toBeInTheDocument();
    });

    it('should display remove button', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const removeButton = screen.getByRole('button', { name: /trash/i }) ||
                          document.querySelector('[class*="hover:text-red-600"]');
      expect(removeButton).toBeInTheDocument();
    });
  });

  describe('Question Type Display', () => {
    it('should display correct badge for single_choice type', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('Single Choice')).toBeInTheDocument();
    });

    it('should display correct badge for multiple_choice type', () => {
      const question = { ...baseSingleChoiceQuestion, type: 'multiple_choice' as const };

      render(
        <QuestionEditor
          question={question}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('Multiple Choice')).toBeInTheDocument();
    });

    it('should display correct badge for rating_5 type', () => {
      render(
        <QuestionEditor
          question={baseRatingQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('Rating (1-5)')).toBeInTheDocument();
    });

    it('should display correct badge for yes_no type', () => {
      const question: SurveyQuestion = {
        id: 'q4',
        type: 'yes_no',
        text: 'Do you agree?',
        required: true,
        order: 1,
      };

      render(
        <QuestionEditor
          question={question}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('Yes/No')).toBeInTheDocument();
    });
  });

  describe('Question Text Editing', () => {
    it('should display question text in textarea', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const textarea = screen.getByDisplayValue('What is your favorite color?');
      expect(textarea).toBeInTheDocument();
    });

    it('should call onUpdate when question text changes', async () => {
      const user = userEvent.setup();

      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const textarea = screen.getByDisplayValue('What is your favorite color?');
      await user.clear(textarea);
      await user.type(textarea, 'New question text');

      expect(mockOnUpdate).toHaveBeenCalledWith({ text: 'New question text' });
    });

    it('should show validation error for empty question text', () => {
      const emptyQuestion = { ...baseSingleChoiceQuestion, text: '' };

      render(
        <QuestionEditor
          question={emptyQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('This field is required')).toBeInTheDocument();
    });

    it('should apply error styling for empty question text', () => {
      const emptyQuestion = { ...baseSingleChoiceQuestion, text: '' };

      render(
        <QuestionEditor
          question={emptyQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const textarea = screen.getByPlaceholderText('Enter your question...');
      expect(textarea).toHaveClass('border-red-300');
    });
  });

  describe('Question Description Editing', () => {
    it('should display description input', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const input = screen.getByDisplayValue('Please select one option');
      expect(input).toBeInTheDocument();
    });

    it('should call onUpdate when description changes', async () => {
      const user = userEvent.setup();

      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const input = screen.getByDisplayValue('Please select one option');
      await user.clear(input);
      await user.type(input, 'New description');

      expect(mockOnUpdate).toHaveBeenCalledWith({ description: 'New description' });
    });

    it('should handle undefined description', () => {
      const question = { ...baseSingleChoiceQuestion, description: undefined };

      render(
        <QuestionEditor
          question={question}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const input = screen.getByPlaceholderText('Add a helpful description...');
      expect(input).toHaveValue('');
    });
  });

  describe('Choice Question Options', () => {
    it('should display all options for single_choice question', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByDisplayValue('Red')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Blue')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Green')).toBeInTheDocument();
    });

    it('should not display options section for text question', () => {
      render(
        <QuestionEditor
          question={baseTextQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.queryByText('Answer Options')).not.toBeInTheDocument();
    });

    it('should display add option button for choice questions', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('Add Option')).toBeInTheDocument();
    });

    it('should add new option when add button clicked', async () => {
      const user = userEvent.setup();

      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const addButton = screen.getByText('Add Option');
      await user.click(addButton);

      expect(mockOnUpdate).toHaveBeenCalledWith({
        options: [
          ...baseSingleChoiceQuestion.options!,
          { id: 'opt_new_123', text: 'Option 4', value: '4' },
        ],
      });
    });

    it('should update option text when edited', async () => {
      const user = userEvent.setup();

      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const optionInput = screen.getByDisplayValue('Red');
      await user.clear(optionInput);
      await user.type(optionInput, 'Purple');

      expect(mockOnUpdate).toHaveBeenCalled();
      const lastCall = mockOnUpdate.mock.calls[mockOnUpdate.mock.calls.length - 1][0];
      expect(lastCall.options).toBeDefined();
      expect(lastCall.options![0].text).toBe('Purple');
    });

    it('should remove option when X button clicked', async () => {
      const user = userEvent.setup();

      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const removeButtons = screen.getAllByRole('button');
      const xButton = removeButtons.find(btn => btn.textContent?.includes('×') ||
                                                btn.querySelector('svg'));

      if (xButton) {
        await user.click(xButton);
        expect(mockOnUpdate).toHaveBeenCalled();
      }
    });

    it('should not allow removing option when only 2 options remain', () => {
      const questionWith2Options = {
        ...baseSingleChoiceQuestion,
        options: [
          { id: 'opt1', text: 'Red', value: '1' },
          { id: 'opt2', text: 'Blue', value: '2' },
        ],
      };

      render(
        <QuestionEditor
          question={questionWith2Options}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      // With only 2 options, X buttons should not be displayed
      const allButtons = screen.getAllByRole('button');
      const xButtons = allButtons.filter(btn =>
        btn.textContent?.includes('×') && btn.className.includes('hover:text-red-600')
      );

      expect(xButtons.length).toBe(0);
    });
  });

  describe('Rating Question Settings', () => {
    it('should display min/max rating inputs for rating_5 question', () => {
      render(
        <QuestionEditor
          question={baseRatingQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('Minimum Rating')).toBeInTheDocument();
      expect(screen.getByText('Maximum Rating')).toBeInTheDocument();
    });

    it('should display correct min/max values for rating_5 question', () => {
      render(
        <QuestionEditor
          question={baseRatingQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      expect(inputs[0]).toHaveValue(1);
      expect(inputs[1]).toHaveValue(5);
    });

    it('should not display rating inputs for non-rating questions', () => {
      render(
        <QuestionEditor
          question={baseTextQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.queryByText('Minimum Rating')).not.toBeInTheDocument();
    });

    it('should call onUpdate when min rating changes', async () => {
      const user = userEvent.setup();

      render(
        <QuestionEditor
          question={baseRatingQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const minInput = screen.getAllByRole('spinbutton')[0];
      await user.clear(minInput);
      await user.type(minInput, '2');

      expect(mockOnUpdate).toHaveBeenCalledWith({ min_rating: 2 });
    });

    it('should call onUpdate when max rating changes', async () => {
      const user = userEvent.setup();

      render(
        <QuestionEditor
          question={baseRatingQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const maxInput = screen.getAllByRole('spinbutton')[1];
      await user.clear(maxInput);
      await user.type(maxInput, '4');

      expect(mockOnUpdate).toHaveBeenCalledWith({ max_rating: 4 });
    });
  });

  describe('Required Toggle', () => {
    it('should display required checkbox', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('Required question')).toBeInTheDocument();
    });

    it('should check required checkbox when question is required', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const checkbox = screen.getByRole('checkbox', { name: /required question/i });
      expect(checkbox).toBeChecked();
    });

    it('should uncheck required checkbox when question is optional', () => {
      render(
        <QuestionEditor
          question={baseTextQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const checkbox = screen.getByRole('checkbox', { name: /required question/i });
      expect(checkbox).not.toBeChecked();
    });

    it('should call onUpdate when required checkbox toggled', async () => {
      const user = userEvent.setup();

      render(
        <QuestionEditor
          question={baseTextQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const checkbox = screen.getByRole('checkbox', { name: /required question/i });
      await user.click(checkbox);

      expect(mockOnUpdate).toHaveBeenCalledWith({ required: true });
    });
  });

  describe('Preview Section', () => {
    it('should display preview section', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('PREVIEW')).toBeInTheDocument();
    });

    it('should show question text in preview', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const previewSection = screen.getByText('PREVIEW').closest('div');
      expect(previewSection).toHaveTextContent('What is your favorite color?');
    });

    it('should show required asterisk in preview for required questions', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const previewSection = screen.getByText('PREVIEW').closest('div');
      expect(previewSection).toHaveTextContent('*');
    });

    it('should show placeholder when question text is empty', () => {
      const emptyQuestion = { ...baseSingleChoiceQuestion, text: '' };

      render(
        <QuestionEditor
          question={emptyQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('Your question text will appear here')).toBeInTheDocument();
    });

    it('should show radio buttons in preview for single_choice', () => {
      const { container } = render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const previewSection = screen.getByText('PREVIEW').closest('div');
      const radioInputs = previewSection?.querySelectorAll('input[type="radio"]');
      expect(radioInputs?.length).toBeGreaterThan(0);
    });

    it('should show checkboxes in preview for multiple_choice', () => {
      const multipleChoiceQuestion = { ...baseSingleChoiceQuestion, type: 'multiple_choice' as const };
      const { container } = render(
        <QuestionEditor
          question={multipleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const previewSection = screen.getByText('PREVIEW').closest('div');
      const checkboxInputs = previewSection?.querySelectorAll('input[type="checkbox"]');
      expect(checkboxInputs?.length).toBeGreaterThan(0);
    });
  });

  describe('Disabled State', () => {
    it('should disable all inputs when disabled prop is true', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
          disabled={true}
        />
      );

      const textareas = screen.getAllByRole('textbox');
      textareas.forEach(textarea => {
        expect(textarea).toBeDisabled();
      });
    });

    it('should disable remove button when disabled', () => {
      const { container } = render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
          disabled={true}
        />
      );

      const removeButton = container.querySelector('[class*="disabled:opacity-50"]');
      expect(removeButton).toBeDisabled();
    });

    it('should disable add option button when disabled', () => {
      render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
          disabled={true}
        />
      );

      const addButton = screen.getByText('Add Option');
      expect(addButton).toBeDisabled();
    });
  });

  describe('Drag and Drop', () => {
    it('should be draggable when canMove is true', () => {
      const { container } = render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const questionCard = container.querySelector('[data-question-id="q1"]');
      expect(questionCard).toHaveAttribute('draggable', 'true');
    });

    it('should not be draggable when canMove is false', () => {
      const { container } = render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={false}
        />
      );

      const questionCard = container.querySelector('[data-question-id="q1"]');
      expect(questionCard).toHaveAttribute('draggable', 'false');
    });

    it('should call onReorder when dropped on different position', () => {
      const { container } = render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={1}
          questionNumber={2}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const questionCard = container.querySelector('[data-question-id="q1"]') as HTMLElement;

      // Simulate drag start
      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        dataTransfer: new DataTransfer(),
      });
      questionCard.dispatchEvent(dragStartEvent);
      dragStartEvent.dataTransfer?.setData('text/plain', '0');

      // Simulate drop
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        dataTransfer: dragStartEvent.dataTransfer,
      });
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          getData: () => '0',
        },
      });
      questionCard.dispatchEvent(dropEvent);

      expect(mockOnReorder).toHaveBeenCalledWith(0, 1);
    });
  });

  describe('Button Actions', () => {
    it('should call onRemove when remove button clicked', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <QuestionEditor
          question={baseSingleChoiceQuestion}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const removeButton = container.querySelector('[class*="hover:text-red-600"]') as HTMLElement;
      await user.click(removeButton);

      expect(mockOnRemove).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle question without options', () => {
      const questionNoOptions = { ...baseSingleChoiceQuestion, options: undefined };

      const { container } = render(
        <QuestionEditor
          question={questionNoOptions}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(container).toBeTruthy();
    });

    it('should handle empty options array', () => {
      const questionEmptyOptions = { ...baseSingleChoiceQuestion, options: [] };

      render(
        <QuestionEditor
          question={questionEmptyOptions}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      expect(screen.getByText('Add Option')).toBeInTheDocument();
    });

    it('should handle rating question without min/max values', () => {
      const ratingNoValues = {
        ...baseRatingQuestion,
        min_rating: undefined,
        max_rating: undefined,
      };

      render(
        <QuestionEditor
          question={ratingNoValues}
          index={0}
          questionNumber={1}
          onUpdate={mockOnUpdate}
          onRemove={mockOnRemove}
          onReorder={mockOnReorder}
          canMove={true}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      expect(inputs[0]).toHaveValue(1);
      expect(inputs[1]).toHaveValue(5);
    });
  });
});

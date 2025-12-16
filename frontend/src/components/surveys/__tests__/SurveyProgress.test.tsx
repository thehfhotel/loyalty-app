import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SurveyProgress from '../SurveyProgress';

// Mock dependencies
const mockTranslate = vi.fn((key: string, fallback?: string, params?: any) => {
  const translations: Record<string, string> = {
    'surveys.progress': 'Progress',
    'surveys.of': 'of',
    'surveys.progressSaved': 'Your progress is automatically saved',
  };

  if (params) {
    let text = translations[key] || fallback || key;
    Object.keys(params).forEach(param => {
      text = text.replace(`{${param}}`, params[param]);
    });
    return text;
  }

  return translations[key] || fallback || key;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

describe('SurveyProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      const { container } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      expect(container).toBeTruthy();
    });

    it('should render without crashing', () => {
      render(<SurveyProgress current={1} total={5} progress={20} />);

      expect(screen.getByText(/Progress:/)).toBeInTheDocument();
    });

    it('should have proper container structure', () => {
      const { container } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv).toHaveClass('mb-6');
    });
  });

  describe('Progress Text Display', () => {
    it('should display current step and total steps', () => {
      render(<SurveyProgress current={1} total={5} progress={20} />);

      expect(screen.getByText(/1 of 5/)).toBeInTheDocument();
    });

    it('should display progress percentage', () => {
      render(<SurveyProgress current={1} total={5} progress={20} />);

      expect(screen.getByText('20%')).toBeInTheDocument();
    });

    it('should display different current step values', () => {
      const { rerender } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      expect(screen.getByText(/1 of 5/)).toBeInTheDocument();

      rerender(<SurveyProgress current={3} total={5} progress={60} />);

      expect(screen.getByText(/3 of 5/)).toBeInTheDocument();
    });

    it('should display different total values', () => {
      render(<SurveyProgress current={2} total={10} progress={20} />);

      expect(screen.getByText(/2 of 10/)).toBeInTheDocument();
    });

    it('should display 100% progress', () => {
      render(<SurveyProgress current={5} total={5} progress={100} />);

      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('should display 0% progress', () => {
      render(<SurveyProgress current={0} total={5} progress={0} />);

      expect(screen.getByText('0%')).toBeInTheDocument();
    });
  });

  describe('Progress Bar Display', () => {
    it('should render progress bar container', () => {
      const { container } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      const progressBarContainer = container.querySelector('.bg-gray-200.rounded-full.h-2');
      expect(progressBarContainer).toBeInTheDocument();
    });

    it('should render progress bar fill', () => {
      const { container } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      const progressBarFill = container.querySelector('.bg-blue-600.h-2.rounded-full');
      expect(progressBarFill).toBeInTheDocument();
    });

    it('should set correct width for progress bar', () => {
      const { container } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      const progressBarFill = container.querySelector('.bg-blue-600.h-2.rounded-full') as HTMLElement;
      expect(progressBarFill).toHaveStyle({ width: '20%' });
    });

    it('should update progress bar width when progress changes', () => {
      const { container, rerender } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      let progressBarFill = container.querySelector('.bg-blue-600.h-2.rounded-full') as HTMLElement;
      expect(progressBarFill).toHaveStyle({ width: '20%' });

      rerender(<SurveyProgress current={3} total={5} progress={60} />);

      progressBarFill = container.querySelector('.bg-blue-600.h-2.rounded-full') as HTMLElement;
      expect(progressBarFill).toHaveStyle({ width: '60%' });
    });

    it('should set 100% width when complete', () => {
      const { container } = render(
        <SurveyProgress current={5} total={5} progress={100} />
      );

      const progressBarFill = container.querySelector('.bg-blue-600.h-2.rounded-full') as HTMLElement;
      expect(progressBarFill).toHaveStyle({ width: '100%' });
    });

    it('should set 0% width when no progress', () => {
      const { container } = render(
        <SurveyProgress current={0} total={5} progress={0} />
      );

      const progressBarFill = container.querySelector('.bg-blue-600.h-2.rounded-full') as HTMLElement;
      expect(progressBarFill).toHaveStyle({ width: '0%' });
    });

    it('should have transition class for smooth animation', () => {
      const { container } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      const progressBarFill = container.querySelector('.bg-blue-600.h-2.rounded-full');
      expect(progressBarFill).toHaveClass('transition-all', 'duration-300');
    });
  });

  describe('Auto-save Message Display', () => {
    it('should show auto-save message when progress is between 0 and 100', () => {
      render(<SurveyProgress current={1} total={5} progress={50} />);

      expect(screen.getByText('Your progress is automatically saved')).toBeInTheDocument();
    });

    it('should show auto-save message at 1% progress', () => {
      render(<SurveyProgress current={1} total={5} progress={1} />);

      expect(screen.getByText('Your progress is automatically saved')).toBeInTheDocument();
    });

    it('should show auto-save message at 99% progress', () => {
      render(<SurveyProgress current={4} total={5} progress={99} />);

      expect(screen.getByText('Your progress is automatically saved')).toBeInTheDocument();
    });

    it('should not show auto-save message at 0% progress', () => {
      render(<SurveyProgress current={0} total={5} progress={0} />);

      expect(screen.queryByText('Your progress is automatically saved')).not.toBeInTheDocument();
    });

    it('should not show auto-save message at 100% progress', () => {
      render(<SurveyProgress current={5} total={5} progress={100} />);

      expect(screen.queryByText('Your progress is automatically saved')).not.toBeInTheDocument();
    });

    it('should hide auto-save message when progress reaches 100%', () => {
      const { rerender } = render(
        <SurveyProgress current={4} total={5} progress={80} />
      );

      expect(screen.getByText('Your progress is automatically saved')).toBeInTheDocument();

      rerender(<SurveyProgress current={5} total={5} progress={100} />);

      expect(screen.queryByText('Your progress is automatically saved')).not.toBeInTheDocument();
    });
  });

  describe('Step Indicators', () => {
    it('should display current step indicator', () => {
      render(<SurveyProgress current={2} total={5} progress={40} />);

      expect(screen.getByText(/2 of 5/)).toBeInTheDocument();
    });

    it('should display total steps indicator', () => {
      render(<SurveyProgress current={2} total={5} progress={40} />);

      expect(screen.getByText(/of 5/)).toBeInTheDocument();
    });

    it('should update current step when changed', () => {
      const { rerender } = render(
        <SurveyProgress current={2} total={5} progress={40} />
      );

      expect(screen.getByText(/2 of 5/)).toBeInTheDocument();

      rerender(<SurveyProgress current={4} total={5} progress={80} />);

      expect(screen.getByText(/4 of 5/)).toBeInTheDocument();
    });

    it('should show first step', () => {
      render(<SurveyProgress current={1} total={10} progress={10} />);

      expect(screen.getByText(/1 of 10/)).toBeInTheDocument();
    });

    it('should show last step', () => {
      render(<SurveyProgress current={10} total={10} progress={100} />);

      expect(screen.getByText(/10 of 10/)).toBeInTheDocument();
    });
  });

  describe('Translation Keys', () => {
    it('should use correct translation keys', () => {
      render(<SurveyProgress current={1} total={5} progress={20} />);

      expect(mockTranslate).toHaveBeenCalledWith('surveys.progress', 'Progress');
      expect(mockTranslate).toHaveBeenCalledWith('surveys.of', 'of');
    });

    it('should use progressSaved translation when applicable', () => {
      render(<SurveyProgress current={1} total={5} progress={20} />);

      expect(mockTranslate).toHaveBeenCalledWith('surveys.progressSaved', 'Your progress is automatically saved');
    });

    it('should not use progressSaved translation at 0%', () => {
      mockTranslate.mockClear();
      render(<SurveyProgress current={0} total={5} progress={0} />);

      expect(mockTranslate).not.toHaveBeenCalledWith('surveys.progressSaved', 'Your progress is automatically saved');
    });

    it('should not use progressSaved translation at 100%', () => {
      mockTranslate.mockClear();
      render(<SurveyProgress current={5} total={5} progress={100} />);

      expect(mockTranslate).not.toHaveBeenCalledWith('surveys.progressSaved', 'Your progress is automatically saved');
    });
  });

  describe('Edge Cases', () => {
    it('should handle single step survey', () => {
      render(<SurveyProgress current={1} total={1} progress={100} />);

      expect(screen.getByText(/1 of 1/)).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('should handle large number of steps', () => {
      render(<SurveyProgress current={50} total={100} progress={50} />);

      expect(screen.getByText(/50 of 100/)).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('should handle decimal progress values', () => {
      render(<SurveyProgress current={1} total={3} progress={33.33} />);

      expect(screen.getByText('33.33%')).toBeInTheDocument();
    });

    it('should handle zero current step', () => {
      render(<SurveyProgress current={0} total={5} progress={0} />);

      expect(screen.getByText(/0 of 5/)).toBeInTheDocument();
    });

    it('should handle large progress values', () => {
      const { container } = render(
        <SurveyProgress current={5} total={5} progress={100} />
      );

      const progressBarFill = container.querySelector('.bg-blue-600.h-2.rounded-full') as HTMLElement;
      expect(progressBarFill).toHaveStyle({ width: '100%' });
    });
  });

  describe('Styling and Layout', () => {
    it('should have proper margin bottom', () => {
      const { container } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv).toHaveClass('mb-6');
    });

    it('should have flex layout for header', () => {
      const { container } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      const header = container.querySelector('.flex.justify-between.items-center.mb-2');
      expect(header).toBeInTheDocument();
    });

    it('should style progress text correctly', () => {
      render(<SurveyProgress current={1} total={5} progress={20} />);

      const progressText = screen.getByText(/Progress:.*1 of 5/);
      expect(progressText).toHaveClass('text-sm', 'font-medium', 'text-gray-700');
    });

    it('should style percentage text correctly', () => {
      render(<SurveyProgress current={1} total={5} progress={20} />);

      const percentageText = screen.getByText('20%');
      expect(percentageText).toHaveClass('text-sm', 'font-medium', 'text-blue-600');
    });

    it('should style auto-save message correctly', () => {
      render(<SurveyProgress current={1} total={5} progress={20} />);

      const message = screen.getByText('Your progress is automatically saved');
      expect(message).toHaveClass('text-xs', 'text-gray-500', 'mt-1');
    });

    it('should have rounded progress bar container', () => {
      const { container } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      const progressBarContainer = container.querySelector('.bg-gray-200.rounded-full.h-2');
      expect(progressBarContainer).toHaveClass('w-full');
    });

    it('should have rounded progress bar fill', () => {
      const { container } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      const progressBarFill = container.querySelector('.bg-blue-600.h-2.rounded-full');
      expect(progressBarFill).toHaveClass('transition-all', 'duration-300');
    });
  });

  describe('Accessibility', () => {
    it('should have readable text contrast', () => {
      render(<SurveyProgress current={1} total={5} progress={20} />);

      const progressText = screen.getByText(/Progress:.*1 of 5/);
      expect(progressText).toHaveClass('text-gray-700');
    });

    it('should have visible progress percentage', () => {
      render(<SurveyProgress current={1} total={5} progress={20} />);

      const percentageText = screen.getByText('20%');
      expect(percentageText).toHaveClass('text-blue-600');
    });

    it('should maintain semantic HTML structure', () => {
      const { container } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      expect(container.firstChild).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe('Component Updates', () => {
    it('should update when all props change', () => {
      const { rerender } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      expect(screen.getByText(/1 of 5/)).toBeInTheDocument();
      expect(screen.getByText('20%')).toBeInTheDocument();

      rerender(<SurveyProgress current={3} total={10} progress={30} />);

      expect(screen.getByText(/3 of 10/)).toBeInTheDocument();
      expect(screen.getByText('30%')).toBeInTheDocument();
    });

    it('should update progress bar width on rerender', () => {
      const { container, rerender } = render(
        <SurveyProgress current={1} total={5} progress={20} />
      );

      let progressBarFill = container.querySelector('.bg-blue-600.h-2.rounded-full') as HTMLElement;
      expect(progressBarFill).toHaveStyle({ width: '20%' });

      rerender(<SurveyProgress current={2} total={5} progress={40} />);

      progressBarFill = container.querySelector('.bg-blue-600.h-2.rounded-full') as HTMLElement;
      expect(progressBarFill).toHaveStyle({ width: '40%' });
    });

    it('should toggle auto-save message on progress boundary', () => {
      const { rerender } = render(
        <SurveyProgress current={0} total={5} progress={0} />
      );

      expect(screen.queryByText('Your progress is automatically saved')).not.toBeInTheDocument();

      rerender(<SurveyProgress current={1} total={5} progress={20} />);

      expect(screen.getByText('Your progress is automatically saved')).toBeInTheDocument();
    });
  });
});

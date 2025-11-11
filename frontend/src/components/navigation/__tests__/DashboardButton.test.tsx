import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import DashboardButton from '../DashboardButton';

// Mock dependencies
const mockNavigate = vi.fn();
const mockTranslate = vi.fn((key: string) => {
  const translations: Record<string, string> = {
    'navigation.dashboard': 'Dashboard',
    'navigation.backToDashboard': 'Back to Dashboard',
  };
  return translations[key] || key;
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

// Wrapper component for router context
const renderWithRouter = (ui: React.ReactElement) => {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
};

describe('DashboardButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the button', () => {
      renderWithRouter(<DashboardButton />);

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = renderWithRouter(<DashboardButton />);

      expect(container).toBeTruthy();
    });

    it('should display Dashboard text', () => {
      renderWithRouter(<DashboardButton />);

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('should have proper button type', () => {
      renderWithRouter(<DashboardButton />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('type', 'button');
    });
  });

  describe('Variant Prop', () => {
    it('should apply outline variant by default', () => {
      renderWithRouter(<DashboardButton />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('border', 'border-gray-300', 'bg-white');
    });

    it('should apply primary variant when specified', () => {
      renderWithRouter(<DashboardButton variant="primary" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-blue-600', 'text-white');
    });

    it('should apply secondary variant when specified', () => {
      renderWithRouter(<DashboardButton variant="secondary" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-gray-600', 'text-white');
    });

    it('should apply outline variant when specified', () => {
      renderWithRouter(<DashboardButton variant="outline" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('border', 'border-gray-300', 'bg-white');
    });
  });

  describe('Size Prop', () => {
    it('should apply medium size by default', () => {
      renderWithRouter(<DashboardButton />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('px-4', 'py-2', 'text-sm');
    });

    it('should apply small size when specified', () => {
      renderWithRouter(<DashboardButton size="sm" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('px-3', 'py-1.5', 'text-sm');
    });

    it('should apply medium size when specified', () => {
      renderWithRouter(<DashboardButton size="md" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('px-4', 'py-2', 'text-sm');
    });

    it('should apply large size when specified', () => {
      renderWithRouter(<DashboardButton size="lg" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('px-6', 'py-3', 'text-base');
    });
  });

  describe('Icon Display', () => {
    it('should display icon by default', () => {
      const { container } = renderWithRouter(<DashboardButton />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should display icon when showIcon is true', () => {
      const { container } = renderWithRouter(<DashboardButton showIcon={true} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should not display icon when showIcon is false', () => {
      const { container } = renderWithRouter(<DashboardButton showIcon={false} />);

      const svg = container.querySelector('svg');
      expect(svg).not.toBeInTheDocument();
    });

    it('should apply correct icon size for small button', () => {
      const { container } = renderWithRouter(<DashboardButton size="sm" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('h-4', 'w-4');
    });

    it('should apply correct icon size for medium button', () => {
      const { container } = renderWithRouter(<DashboardButton size="md" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('h-5', 'w-5');
    });

    it('should apply correct icon size for large button', () => {
      const { container } = renderWithRouter(<DashboardButton size="lg" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('h-6', 'w-6');
    });

    it('should have aria-hidden on icon', () => {
      const { container } = renderWithRouter(<DashboardButton />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });

    it('should apply margin to icon', () => {
      const { container } = renderWithRouter(<DashboardButton />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('mr-2');
    });
  });

  describe('Navigation Behavior', () => {
    it('should navigate to dashboard when clicked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<DashboardButton />);

      const button = screen.getByRole('button');
      await user.click(button);

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });

    it('should navigate on each click', async () => {
      const user = userEvent.setup();
      renderWithRouter(<DashboardButton />);

      const button = screen.getByRole('button');
      await user.click(button);
      await user.click(button);
      await user.click(button);

      expect(mockNavigate).toHaveBeenCalledTimes(3);
    });
  });

  describe('Custom className', () => {
    it('should apply custom className', () => {
      renderWithRouter(<DashboardButton className="custom-class" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('custom-class');
    });

    it('should maintain base classes with custom className', () => {
      renderWithRouter(<DashboardButton className="custom-class" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('inline-flex', 'items-center', 'custom-class');
    });

    it('should apply multiple custom classes', () => {
      renderWithRouter(<DashboardButton className="class1 class2 class3" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('class1', 'class2', 'class3');
    });
  });

  describe('Combined Props', () => {
    it('should apply primary variant with small size', () => {
      renderWithRouter(<DashboardButton variant="primary" size="sm" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-blue-600', 'px-3', 'py-1.5');
    });

    it('should apply secondary variant with large size', () => {
      renderWithRouter(<DashboardButton variant="secondary" size="lg" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-gray-600', 'px-6', 'py-3');
    });

    it('should hide icon with custom className', () => {
      const { container } = renderWithRouter(
        <DashboardButton showIcon={false} className="my-custom-class" />
      );

      const svg = container.querySelector('svg');
      expect(svg).not.toBeInTheDocument();
      expect(screen.getByRole('button')).toHaveClass('my-custom-class');
    });
  });

  describe('Styling', () => {
    it('should have base styling classes', () => {
      renderWithRouter(<DashboardButton />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass(
        'inline-flex',
        'items-center',
        'font-medium',
        'rounded-md',
        'transition-colors'
      );
    });

    it('should have focus styles', () => {
      renderWithRouter(<DashboardButton />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass(
        'focus:outline-none',
        'focus:ring-2',
        'focus:ring-offset-2'
      );
    });

    it('should have hover styles for primary variant', () => {
      renderWithRouter(<DashboardButton variant="primary" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('hover:bg-blue-700');
    });

    it('should have hover styles for secondary variant', () => {
      renderWithRouter(<DashboardButton variant="secondary" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('hover:bg-gray-700');
    });

    it('should have hover styles for outline variant', () => {
      renderWithRouter(<DashboardButton variant="outline" />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('hover:bg-gray-50');
    });
  });

  describe('Translation Keys', () => {
    it('should use correct translation for button text', () => {
      renderWithRouter(<DashboardButton />);

      expect(mockTranslate).toHaveBeenCalledWith('navigation.dashboard');
    });

    it('should use correct translation for aria-label', () => {
      renderWithRouter(<DashboardButton />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'Back to Dashboard');
      expect(mockTranslate).toHaveBeenCalledWith('navigation.backToDashboard');
    });
  });

  describe('Accessibility', () => {
    it('should have proper button role', () => {
      renderWithRouter(<DashboardButton />);

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should have aria-label', () => {
      renderWithRouter(<DashboardButton />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label');
    });

    it('should have descriptive aria-label', () => {
      renderWithRouter(<DashboardButton />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'Back to Dashboard');
    });

    it('should be keyboard accessible', () => {
      renderWithRouter(<DashboardButton />);

      const button = screen.getByRole('button');
      button.focus();
      expect(button).toHaveFocus();
    });
  });
});

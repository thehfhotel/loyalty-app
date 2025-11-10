import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import EmailDisplay from '../EmailDisplay';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'profile.addEmailAddress': 'Add Email Address',
        'profile.noEmailProvided': 'No email provided',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock react-icons
vi.mock('react-icons/fi', () => ({
  FiMail: ({ className }: { className?: string }) => (
    <span data-testid="mail-icon" className={className}>
      📧
    </span>
  ),
}));

const renderWithRouter = (component: React.ReactElement) => {
  return render(<BrowserRouter>{component}</BrowserRouter>);
};

describe('EmailDisplay', () => {
  describe('With Email', () => {
    it('should display email address when provided', () => {
      renderWithRouter(<EmailDisplay email="test@example.com" />);
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });

    it('should display email in a span element', () => {
      const { container } = renderWithRouter(<EmailDisplay email="test@example.com" />);
      const span = container.querySelector('span');
      expect(span).toBeInTheDocument();
      expect(span?.textContent).toContain('test@example.com');
    });

    it('should apply default text color class', () => {
      const { container } = renderWithRouter(<EmailDisplay email="test@example.com" />);
      const span = container.querySelector('span');
      expect(span?.className).toContain('text-gray-900');
    });

    it('should apply custom className when provided', () => {
      const { container } = renderWithRouter(
        <EmailDisplay email="test@example.com" className="custom-class" />
      );
      const span = container.querySelector('span');
      expect(span?.className).toContain('custom-class');
    });

    it('should not show icon by default', () => {
      renderWithRouter(<EmailDisplay email="test@example.com" />);
      expect(screen.queryByTestId('mail-icon')).not.toBeInTheDocument();
    });

    it('should show icon when showIcon is true', () => {
      renderWithRouter(<EmailDisplay email="test@example.com" showIcon={true} />);
      expect(screen.getByTestId('mail-icon')).toBeInTheDocument();
    });

    it('should display icon before email text when shown', () => {
      const { container } = renderWithRouter(
        <EmailDisplay email="test@example.com" showIcon={true} />
      );
      const span = container.querySelector('span');
      expect(span?.textContent).toMatch(/📧.*test@example\.com/);
    });

    it('should apply icon styling classes when icon is shown', () => {
      renderWithRouter(<EmailDisplay email="test@example.com" showIcon={true} />);
      const icon = screen.getByTestId('mail-icon');
      expect(icon.className).toContain('w-4');
      expect(icon.className).toContain('h-4');
      expect(icon.className).toContain('mr-1');
      expect(icon.className).toContain('text-gray-500');
    });

    it('should handle linkToProfile prop when email exists (no link rendered)', () => {
      const { container } = renderWithRouter(
        <EmailDisplay email="test@example.com" linkToProfile={false} />
      );
      expect(container.querySelector('a')).not.toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });
  });

  describe('Without Email (null)', () => {
    it('should show "Add Email Address" link by default when email is null', () => {
      renderWithRouter(<EmailDisplay email={null} />);
      expect(screen.getByText('Add Email Address')).toBeInTheDocument();
    });

    it('should render link to profile settings when email is null and linkToProfile is true', () => {
      renderWithRouter(<EmailDisplay email={null} linkToProfile={true} />);
      const link = screen.getByRole('link', { name: /add email address/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/profile?tab=settings');
    });

    it('should apply link styling classes when rendering "Add Email" link', () => {
      renderWithRouter(<EmailDisplay email={null} />);
      const link = screen.getByRole('link');
      expect(link.className).toContain('text-blue-600');
      expect(link.className).toContain('hover:text-blue-800');
      expect(link.className).toContain('underline');
    });

    it('should show "No email provided" text when email is null and linkToProfile is false', () => {
      renderWithRouter(<EmailDisplay email={null} linkToProfile={false} />);
      expect(screen.getByText('No email provided')).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('should apply italic styling when showing "No email provided"', () => {
      const { container } = renderWithRouter(
        <EmailDisplay email={null} linkToProfile={false} />
      );
      const span = container.querySelector('span');
      expect(span?.className).toContain('text-gray-400');
      expect(span?.className).toContain('italic');
    });

    it('should show icon in "Add Email" link when showIcon is true', () => {
      renderWithRouter(<EmailDisplay email={null} showIcon={true} />);
      expect(screen.getByTestId('mail-icon')).toBeInTheDocument();
    });

    it('should not show icon in "No email provided" text when showIcon is true', () => {
      renderWithRouter(<EmailDisplay email={null} linkToProfile={false} showIcon={true} />);
      expect(screen.queryByTestId('mail-icon')).not.toBeInTheDocument();
    });
  });

  describe('Without Email (undefined)', () => {
    it('should show "Add Email Address" link when email is undefined', () => {
      renderWithRouter(<EmailDisplay email={undefined} />);
      expect(screen.getByText('Add Email Address')).toBeInTheDocument();
    });

    it('should show "No email provided" when email is undefined and linkToProfile is false', () => {
      renderWithRouter(<EmailDisplay email={undefined} linkToProfile={false} />);
      expect(screen.getByText('No email provided')).toBeInTheDocument();
    });
  });

  describe('Empty String Email', () => {
    it('should treat empty string as no email and show link', () => {
      renderWithRouter(<EmailDisplay email="" />);
      expect(screen.getByText('Add Email Address')).toBeInTheDocument();
    });

    it('should treat empty string as no email and show "No email provided" when linkToProfile is false', () => {
      renderWithRouter(<EmailDisplay email="" linkToProfile={false} />);
      expect(screen.getByText('No email provided')).toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('should apply custom className to email display', () => {
      const { container } = renderWithRouter(
        <EmailDisplay email="test@example.com" className="font-bold text-lg" />
      );
      const span = container.querySelector('span');
      expect(span?.className).toContain('font-bold');
      expect(span?.className).toContain('text-lg');
    });

    it('should apply custom className to "Add Email" link', () => {
      renderWithRouter(<EmailDisplay email={null} className="custom-link-class" />);
      const link = screen.getByRole('link');
      expect(link.className).toContain('custom-link-class');
    });

    it('should apply custom className to "No email provided" text', () => {
      const { container } = renderWithRouter(
        <EmailDisplay email={null} linkToProfile={false} className="custom-text-class" />
      );
      const span = container.querySelector('span');
      expect(span?.className).toContain('custom-text-class');
    });
  });

  describe('Icon Positioning', () => {
    it('should use inline-flex for proper icon alignment with email', () => {
      const { container } = renderWithRouter(
        <EmailDisplay email="test@example.com" showIcon={true} />
      );
      const span = container.querySelector('span');
      expect(span?.className).toContain('inline-flex');
      expect(span?.className).toContain('items-center');
    });

    it('should use inline-flex for proper icon alignment in link', () => {
      renderWithRouter(<EmailDisplay email={null} showIcon={true} />);
      const link = screen.getByRole('link');
      expect(link.className).toContain('inline-flex');
      expect(link.className).toContain('items-center');
    });
  });

  describe('Accessibility', () => {
    it('should render semantic link element for navigation', () => {
      renderWithRouter(<EmailDisplay email={null} />);
      const link = screen.getByRole('link', { name: /add email address/i });
      expect(link.tagName).toBe('A');
    });

    it('should have proper href for accessibility tools', () => {
      renderWithRouter(<EmailDisplay email={null} />);
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href');
      expect(link.getAttribute('href')).toBe('/profile?tab=settings');
    });

    it('should render text content in semantic span when email exists', () => {
      const { container } = renderWithRouter(<EmailDisplay email="test@example.com" />);
      const span = container.querySelector('span');
      expect(span?.tagName).toBe('SPAN');
    });
  });

  describe('Edge Cases', () => {
    it('should handle email with special characters', () => {
      renderWithRouter(<EmailDisplay email="test+tag@sub.example.com" />);
      expect(screen.getByText('test+tag@sub.example.com')).toBeInTheDocument();
    });

    it('should handle very long email addresses', () => {
      const longEmail = 'verylongemailaddresswith+tags@subdomain.example-domain.com';
      renderWithRouter(<EmailDisplay email={longEmail} />);
      expect(screen.getByText(longEmail)).toBeInTheDocument();
    });

    it('should handle email with unicode characters', () => {
      renderWithRouter(<EmailDisplay email="用户@例え.jp" />);
      expect(screen.getByText('用户@例え.jp')).toBeInTheDocument();
    });

    it('should handle all boolean props combinations', () => {
      const { rerender } = renderWithRouter(
        <EmailDisplay email="test@example.com" linkToProfile={true} showIcon={true} />
      );
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
      expect(screen.getByTestId('mail-icon')).toBeInTheDocument();

      rerender(
        <BrowserRouter>
          <EmailDisplay email={null} linkToProfile={false} showIcon={false} />
        </BrowserRouter>
      );
      expect(screen.getByText('No email provided')).toBeInTheDocument();
      expect(screen.queryByTestId('mail-icon')).not.toBeInTheDocument();
    });

    it('should maintain className when all props are provided', () => {
      const { container } = renderWithRouter(
        <EmailDisplay
          email="test@example.com"
          linkToProfile={true}
          showIcon={true}
          className="custom-class"
        />
      );
      const span = container.querySelector('span');
      expect(span?.className).toContain('custom-class');
      expect(span?.className).toContain('text-gray-900');
      expect(span?.className).toContain('inline-flex');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// Mock toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock DashboardButton
vi.mock('../../../components/navigation/DashboardButton', () => ({
  default: () => <div data-testid="dashboard-button">Dashboard</div>,
}));

// Import component after mocks
import EmailServicePage from '../EmailServicePage';

describe('EmailServicePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the page title', () => {
      render(<EmailServicePage />, { wrapper });

      expect(screen.getByText('emailService.status.title')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<EmailServicePage />, { wrapper });

      expect(container).toBeTruthy();
    });

    it('should render test button', () => {
      render(<EmailServicePage />, { wrapper });

      expect(screen.getByRole('button', { name: /emailService.test.button/i })).toBeInTheDocument();
    });

    it('should render dashboard button', () => {
      render(<EmailServicePage />, { wrapper });

      expect(screen.getByTestId('dashboard-button')).toBeInTheDocument();
    });
  });

  describe('Status Display', () => {
    it('should display error/empty state when status is null', async () => {
      render(<EmailServicePage />, { wrapper });

      // The stub queryFn returns null, so after loading finishes the component shows the error state
      await waitFor(() => {
        expect(screen.getByText('common.error')).toBeInTheDocument();
      });
    });
  });
});

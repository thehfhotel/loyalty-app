import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock data
const mockHealthStatus = {
  configured: true,
  smtpConnected: true,
  imapConnected: true,
  lastTestResult: {
    success: true,
    timestamp: '2024-01-15T10:30:00Z',
    deliveryTimeMs: 1500,
  },
};

// Mock tRPC hooks
const mockRefetch = vi.fn();
const mockMutate = vi.fn();

vi.mock('../../../hooks/useTRPC', () => ({
  trpc: {
    admin: {
      email: {
        getStatus: {
          useQuery: vi.fn(() => ({
            data: mockHealthStatus,
            isLoading: false,
            error: null,
            refetch: mockRefetch,
          })),
        },
        runTest: {
          useMutation: vi.fn(() => ({
            mutate: mockMutate,
            isPending: false,
            data: null,
          })),
        },
      },
    },
  },
}));

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
      render(<EmailServicePage />);

      expect(screen.getByText('emailService.status.title')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<EmailServicePage />);

      expect(container).toBeTruthy();
    });

    it('should render test button', () => {
      render(<EmailServicePage />);

      expect(screen.getByRole('button', { name: /emailService.test.button/i })).toBeInTheDocument();
    });

    it('should render dashboard button', () => {
      render(<EmailServicePage />);

      expect(screen.getByTestId('dashboard-button')).toBeInTheDocument();
    });
  });

  describe('Status Display', () => {
    it('should display SMTP connected status', () => {
      render(<EmailServicePage />);

      // Check for SMTP status elements
      expect(screen.getByText('SMTP Connection')).toBeInTheDocument();
    });

    it('should display IMAP connected status', () => {
      render(<EmailServicePage />);

      // Check for IMAP status elements
      expect(screen.getByText('IMAP Connection')).toBeInTheDocument();
    });
  });

  describe('Run Test Button', () => {
    it('should call mutate when clicked', async () => {
      const user = userEvent.setup();
      render(<EmailServicePage />);

      const testButton = screen.getByRole('button', { name: /emailService.test.button/i });
      await user.click(testButton);

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalled();
      });
    });
  });
});

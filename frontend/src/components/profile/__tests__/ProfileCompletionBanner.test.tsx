/* eslint-disable curly -- Test file uses single-line conditionals for concise error handling */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileCompletionBanner from '../ProfileCompletionBanner';
import { useAuthStore } from '../../../store/authStore';
import { notify } from '../../../utils/notificationManager';
// trpc is mocked via vi.mock below

// Mock dependencies
const mockTranslate = vi.fn((key: string, params?: any) => {
  const translations: Record<string, string> = {
    'profile.newMemberOffer': 'New Member Offer',
    'profile.completeProfileForCoupon': 'Complete your profile to receive a welcome coupon!',
    'profile.missingFields': `Missing: ${params?.fields}`,
    'profile.completeProfile': 'Complete Profile',
    'common.dismiss': 'Dismiss',
    'auth.firstName': 'First Name',
    'auth.lastName': 'Last Name',
    'profile.dateOfBirth': 'Date of Birth',
    'profile.gender': 'Gender',
    'profile.occupation': 'Occupation',
    'profile.phone': 'Phone',
    'common.and': 'and',
    'profile.profileCompleted': 'Profile completed successfully',
    'profile.profileUpdateError': 'Failed to update profile',
    'common.saving': 'Saving...',
    'common.cancel': 'Cancel',
    'profile.firstNamePlaceholder': 'Enter first name',
    'profile.lastNamePlaceholder': 'Enter last name',
    'profile.phonePlaceholder': 'Enter phone number',
  };

  return translations[key] || key;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

vi.mock('react-icons/fi', () => ({
  FiX: () => <span data-testid="x-icon">✕</span>,
  FiGift: () => <span data-testid="gift-icon">🎁</span>,
  FiChevronRight: () => <span data-testid="chevron-icon">›</span>,
  FiUser: () => <span data-testid="user-icon">👤</span>,
  FiPhone: () => <span data-testid="phone-icon">📞</span>,
}));

vi.mock('../../../store/authStore');
vi.mock('../../../utils/notificationManager');

// Create shared mock objects that can be modified by tests
const mockQueryData = {
  data: null as unknown,
  isLoading: false,
  error: null as unknown,
  refetch: vi.fn(),
};

const mockMutateAsync = vi.fn();
const mockMutationState = {
  mutateAsync: mockMutateAsync,
  isPending: false,
};

// Mock tRPC hooks before they're imported
vi.mock('../../../hooks/useTRPC', () => ({
  trpc: {
    user: {
      getProfileCompletionStatus: {
        useQuery: () => mockQueryData,
      },
      completeProfile: {
        useMutation: () => mockMutationState,
      },
    },
  },
  getTRPCErrorMessage: vi.fn((error: unknown) => {
    if (error instanceof Error) return error.message;
    return 'Unknown error';
  }),
}));

vi.mock('../ProfileFormFields', () => ({
  GenderField: () => <div data-testid="gender-field">Gender Field</div>,
  OccupationField: () => <div data-testid="occupation-field">Occupation Field</div>,
  DateOfBirthField: () => <div data-testid="dob-field">Date of Birth Field</div>,
}));

describe('ProfileCompletionBanner', () => {
  const mockUser = { id: 'user-123', email: 'test@example.com' };
  const mockUpdateUser = vi.fn();

  // Helper function to mock tRPC query
  const mockProfileCompletionQuery = (data: unknown) => {
    mockQueryData.data = data;
    mockQueryData.isLoading = false;
    mockQueryData.error = null;
  };

  // Helper function to mock tRPC mutation
  const mockCompleteProfileMutation = (implementation?: (data: unknown) => Promise<unknown>) => {
    mockMutateAsync.mockReset();
    if (implementation) {
      mockMutateAsync.mockImplementation(implementation);
    }
    mockMutationState.isPending = false;
    return mockMutateAsync;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    document.body.style.overflow = 'unset';

    (useAuthStore as any).mockImplementation((selector: any) => {
      const state = {
        user: mockUser,
        updateUser: mockUpdateUser,
      };
      return selector(state);
    });

    // Reset shared mocks
    mockQueryData.data = null;
    mockQueryData.isLoading = false;
    mockQueryData.error = null;
    mockQueryData.refetch.mockReset();
    mockMutateAsync.mockReset();
    mockMutationState.isPending = false;

    (notify.success as any) = vi.fn();
    (notify.error as any) = vi.fn();
  });

  afterEach(() => {
    document.body.style.overflow = 'unset';
  });

  describe('Basic Rendering', () => {
    it('should render the component', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      const { container } = render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(container).toBeTruthy();
      });
    });

    it('should show banner when profile incomplete and coupon available', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName', 'lastName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('New Member Offer')).toBeInTheDocument();
      });
    });

    it('should apply custom className', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      const { container } = render(<ProfileCompletionBanner className="custom-class" />);

      await waitFor(() => {
        const banner = container.querySelector('.custom-class');
        expect(banner).toBeInTheDocument();
      });
    });

    it('should have gradient background styling', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      const { container } = render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const banner = container.firstChild as HTMLElement;
        expect(banner).toHaveClass('bg-gradient-to-r', 'from-blue-600', 'to-purple-600');
      });
    });
  });

  describe('Banner Visibility Logic', () => {
    it('should not render when no user', async () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = { user: null, updateUser: mockUpdateUser };
        return selector(state);
      });

      const { container } = render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('should not render when profile is complete', async () => {
      mockProfileCompletionQuery({
        isComplete: true,
        missingFields: [],
        newMemberCouponAvailable: true,
      });

      const { container } = render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('should not render when no coupon available', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: false,
      });

      const { container } = render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('should not render when API returns null', async () => {
      mockProfileCompletionQuery(null);

      const { container } = render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('should not render when API call fails', async () => {
      mockQueryData.data = null;
      mockQueryData.isLoading = false;
      mockQueryData.error = new Error('API Error');

      const { container } = render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('should render when all conditions met', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('Complete your profile to receive a welcome coupon!')).toBeInTheDocument();
      });
    });
  });

  describe('Session Storage', () => {
    it('should not render when previously dismissed', async () => {
      sessionStorage.setItem('profile-banner-dismissed', 'true');

      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      const { container } = render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('should render when not previously dismissed', async () => {
      sessionStorage.removeItem('profile-banner-dismissed');

      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('New Member Offer')).toBeInTheDocument();
      });
    });
  });

  describe('Banner Content Display', () => {
    it('should display gift icon', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getAllByTestId('gift-icon')[0]).toBeInTheDocument();
      });
    });

    it('should display New Member Offer badge', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('New Member Offer')).toBeInTheDocument();
      });
    });

    it('should display complete profile message', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('Complete your profile to receive a welcome coupon!')).toBeInTheDocument();
      });
    });

    it('should display Complete Profile button', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const buttons = screen.getAllByText('Complete Profile');
        expect(buttons[0]).toBeInTheDocument();
      });
    });

    it('should display dismiss button', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const dismissButton = screen.getByLabelText('Dismiss');
        expect(dismissButton).toBeInTheDocument();
      });
    });

    it('should display chevron icon in Complete Profile button', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByTestId('chevron-icon')).toBeInTheDocument();
      });
    });
  });

  describe('Dismiss Functionality', () => {
    it('should dismiss banner when X button clicked', async () => {
      const user = userEvent.setup();

      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      const { container } = render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('New Member Offer')).toBeInTheDocument();
      });

      const dismissButton = screen.getByLabelText('Dismiss');
      await user.click(dismissButton);

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('should store dismissal in sessionStorage', async () => {
      const user = userEvent.setup();

      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('New Member Offer')).toBeInTheDocument();
      });

      const dismissButton = screen.getByLabelText('Dismiss');
      await user.click(dismissButton);

      await waitFor(() => {
        expect(sessionStorage.getItem('profile-banner-dismissed')).toBe('true');
      });
    });
  });

  describe('Missing Fields Text Generation', () => {
    it('should display single missing field', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('Missing: First Name')).toBeInTheDocument();
      });
    });

    it('should display two missing fields with "and"', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName', 'lastName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('Missing: First Name and Last Name')).toBeInTheDocument();
      });
    });

    it('should display three or more fields with commas and "and"', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName', 'lastName', 'phone'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('Missing: First Name, Last Name and Phone')).toBeInTheDocument();
      });
    });

    it('should handle date_of_birth field name', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['date_of_birth'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('Missing: Date of Birth')).toBeInTheDocument();
      });
    });

    it('should handle gender field name', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['gender'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('Missing: Gender')).toBeInTheDocument();
      });
    });

    it('should handle occupation field name', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['occupation'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getByText('Missing: Occupation')).toBeInTheDocument();
      });
    });

  });

  describe('Modal Open/Close', () => {
    it('should open modal when Complete Profile button clicked', async () => {
      const user = userEvent.setup();

      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getAllByText('Complete Profile')[0]).toBeInTheDocument();
      });

      const openButton = screen.getAllByText('Complete Profile')[0];
      if (!openButton) throw new Error('Open button not found');
      await user.click(openButton);

      await waitFor(() => {
        // Modal should show: banner button + modal heading + submit button = 3
        expect(screen.getAllByText('Complete Profile')).toHaveLength(3);
      });
    });

    it('should close modal when Cancel button clicked', async () => {
      const user = userEvent.setup();

      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        expect(screen.getAllByText('Complete Profile')[0]).toBeInTheDocument();
      });

      const openButton = screen.getAllByText('Complete Profile')[0];
      if (!openButton) throw new Error('Open button not found');
      await user.click(openButton);

      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeInTheDocument();
      });

      const cancelButton = screen.getByText('Cancel');
      await user.click(cancelButton);

      await waitFor(() => {
        // Modal should close - only banner button remains
        expect(screen.getAllByText('Complete Profile')).toHaveLength(1);
      });
    });

    it('should close modal when clicking backdrop', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        const backdrop = document.querySelector('.bg-gray-500');
        expect(backdrop).toBeInTheDocument();
      });

      const backdrop = document.querySelector('.bg-gray-500') as HTMLElement;
      fireEvent.click(backdrop);

      await waitFor(() => {
        expect(screen.getAllByText('Complete Profile')).toHaveLength(1);
      });
    });

    it('should close modal on Escape key', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        // Modal open: banner button + modal heading + submit button = 3
        expect(screen.getAllByText('Complete Profile')).toHaveLength(3);
      });

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.getAllByText('Complete Profile')).toHaveLength(1);
      });
    });

    it('should not close modal on Escape when saving', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      // Set isPending to true to simulate saving state before render
      mockMutationState.isPending = true;

      render(<ProfileCompletionBanner />);

      // Open the modal
      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      // Wait for loading state to appear (isPending was set before render)
      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeInTheDocument();
      });

      // Now try to close with Escape while saving
      fireEvent.keyDown(document, { key: 'Escape' });

      // Modal should still be open with loading state
      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });
  });

  describe('Form Field Rendering', () => {
    it('should render firstName field when missing', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        expect(screen.getByLabelText(/First Name/)).toBeInTheDocument();
      });
    });

    it('should not render firstName field when not missing', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['lastName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        expect(screen.queryByLabelText(/First Name/)).not.toBeInTheDocument();
      });
    });

    it('should render lastName field when missing', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['lastName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        expect(screen.getByLabelText(/Last Name/)).toBeInTheDocument();
      });
    });

    it('should render phone field when missing', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['phone'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        expect(screen.getByLabelText(/Phone/)).toBeInTheDocument();
      });
    });

    it('should render date_of_birth field component when missing', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['date_of_birth'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        expect(screen.getByTestId('dob-field')).toBeInTheDocument();
      });
    });

    it('should render gender field component when missing', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['gender'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        expect(screen.getByTestId('gender-field')).toBeInTheDocument();
      });
    });

    it('should render occupation field component when missing', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['occupation'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        expect(screen.getByTestId('occupation-field')).toBeInTheDocument();
      });
    });

    it('should render multiple fields when multiple missing', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName', 'lastName', 'phone'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        expect(screen.getByLabelText(/First Name/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Last Name/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Phone/)).toBeInTheDocument();
      });
    });
  });

  describe('Form Submission - Success', () => {
    it('should call mutateAsync on form submit', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      const mutateAsync = mockCompleteProfileMutation(() => Promise.resolve({
        couponAwarded: true,
        coupon: { name: 'Welcome Coupon' },
        pointsAwarded: 100,
      }));

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        const firstNameInput = screen.getByPlaceholderText('Enter first name');
        fireEvent.change(firstNameInput, { target: { value: 'John' } });
      });

      const submitButton = screen.getAllByText('Complete Profile').find(
        (el) => el.tagName === 'BUTTON' && el.closest('form')
      ) as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mutateAsync).toHaveBeenCalledWith({
          firstName: 'John',
          lastName: undefined,
          phone: undefined,
          dateOfBirth: undefined,
          gender: undefined,
          occupation: undefined,
        });
      });
    });

    it('should show success notification with coupon and points', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      mockCompleteProfileMutation(() => Promise.resolve({
        couponAwarded: true,
        coupon: { title: 'Welcome Coupon' },
        pointsAwarded: 100,
      }));

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        const firstNameInput = screen.getByPlaceholderText('Enter first name');
        fireEvent.change(firstNameInput, { target: { value: 'John' } });
      });

      const submitButton = screen.getAllByText('Complete Profile').find(
        (el) => el.tagName === 'BUTTON' && el.closest('form')
      ) as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(notify.success).toHaveBeenCalledWith(
          expect.stringContaining('coupon: Welcome Coupon'),
          expect.any(Object)
        );
      });
    });

    it('should show success notification without rewards', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      mockCompleteProfileMutation(() => Promise.resolve({
        couponAwarded: false,
        pointsAwarded: 0,
      }));

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        const firstNameInput = screen.getByPlaceholderText('Enter first name');
        fireEvent.change(firstNameInput, { target: { value: 'John' } });
      });

      const submitButton = screen.getAllByText('Complete Profile').find(
        (el) => el.tagName === 'BUTTON' && el.closest('form')
      ) as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(notify.success).toHaveBeenCalledWith('Profile completed successfully');
      });
    });

    it('should hide banner after successful submission', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      mockCompleteProfileMutation(() => Promise.resolve({
        couponAwarded: true,
        coupon: { name: 'Welcome Coupon' },
        pointsAwarded: 100,
      }));

      const { container } = render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        const firstNameInput = screen.getByPlaceholderText('Enter first name');
        fireEvent.change(firstNameInput, { target: { value: 'John' } });
      });

      const submitButton = screen.getAllByText('Complete Profile').find(
        (el) => el.tagName === 'BUTTON' && el.closest('form')
      ) as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('should close modal after successful submission', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      mockCompleteProfileMutation(() => Promise.resolve({
        couponAwarded: true,
        coupon: { name: 'Welcome Coupon' },
        pointsAwarded: 100,
      }));

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        // Modal open: banner button + modal heading + submit button = 3
        expect(screen.getAllByText('Complete Profile')).toHaveLength(3);
      });

      await waitFor(() => {
        const firstNameInput = screen.getByPlaceholderText('Enter first name');
        fireEvent.change(firstNameInput, { target: { value: 'John' } });
      });

      const submitButton = screen.getAllByText('Complete Profile').find(
        (el) => el.tagName === 'BUTTON' && el.closest('form')
      ) as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        // Modal closed, banner hidden
        expect(screen.queryByText('Complete Profile')).not.toBeInTheDocument();
      });
    });

    it('should store dismissal in sessionStorage after submission', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      mockCompleteProfileMutation(() => Promise.resolve({
        couponAwarded: true,
        coupon: { name: 'Welcome Coupon' },
        pointsAwarded: 100,
      }));

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        const firstNameInput = screen.getByPlaceholderText('Enter first name');
        fireEvent.change(firstNameInput, { target: { value: 'John' } });
      });

      const submitButton = screen.getAllByText('Complete Profile').find(
        (el) => el.tagName === 'BUTTON' && el.closest('form')
      ) as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(sessionStorage.getItem('profile-banner-dismissed')).toBe('true');
      });
    });
  });

  describe('Form Submission - Error', () => {
    it('should show error notification on submission failure', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      mockCompleteProfileMutation(() => Promise.reject(new Error('Network error')));

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        const firstNameInput = screen.getByPlaceholderText('Enter first name');
        fireEvent.change(firstNameInput, { target: { value: 'John' } });
      });

      const submitButton = screen.getAllByText('Complete Profile').find(
        (el) => el.tagName === 'BUTTON' && el.closest('form')
      ) as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        // getTRPCErrorMessage returns the error message from the Error object
        expect(notify.error).toHaveBeenCalledWith('Network error');
      });
    });

    it('should keep modal open on submission failure', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      mockCompleteProfileMutation(() => Promise.reject(new Error('Network error')));

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        const firstNameInput = screen.getByPlaceholderText('Enter first name');
        fireEvent.change(firstNameInput, { target: { value: 'John' } });
      });

      const submitButton = screen.getAllByText('Complete Profile').find(
        (el) => el.tagName === 'BUTTON' && el.closest('form')
      ) as HTMLButtonElement;
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(notify.error).toHaveBeenCalled();
      });

      // Modal should still be open: banner button + modal heading + submit button = 3
      expect(screen.getAllByText('Complete Profile')).toHaveLength(3);
    });
  });

  describe('Form Submission - Loading State', () => {
    it('should show loading state during submission', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      // Set isPending to true to simulate loading state
      mockMutationState.isPending = true;

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      // When isPending is true, should show "Saving..."
      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeInTheDocument();
      });
    });

    it('should disable submit button during submission', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      // Set up the mutation with isPending: true to simulate loading state
      mockMutationState.isPending = true;

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      // When isPending is true, the submit button should show "Saving..." and be disabled
      await waitFor(() => {
        const savingButton = screen.getByText('Saving...');
        expect(savingButton.closest('button')).toBeDisabled();
      });
    });

    it('should disable cancel button during submission', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      // Set up the mutation with isPending: true to simulate loading state
      mockMutationState.isPending = true;

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      // When isPending is true, the cancel button should be disabled
      await waitFor(() => {
        const cancelButton = screen.getByText('Cancel');
        expect(cancelButton).toBeDisabled();
      });
    });
  });

  describe('Background Scroll Prevention', () => {
    it('should prevent background scrolling when modal open', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        expect(document.body.style.overflow).toBe('hidden');
      });
    });

    it('should restore scrolling when modal closed', async () => {
      const user = userEvent.setup();

      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const openButton = screen.getAllByText('Complete Profile')[0];
        if (!openButton) throw new Error('Open button not found');
        fireEvent.click(openButton);
      });

      await waitFor(() => {
        expect(document.body.style.overflow).toBe('hidden');
      });

      const cancelButton = screen.getByText('Cancel');
      await user.click(cancelButton);

      await waitFor(() => {
        expect(document.body.style.overflow).toBe('unset');
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper aria-label on dismiss button', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const dismissButton = screen.getByLabelText('Dismiss');
        expect(dismissButton).toHaveAttribute('aria-label', 'Dismiss');
      });
    });

    it('should be keyboard accessible', async () => {
      mockProfileCompletionQuery({
        isComplete: false,
        missingFields: ['firstName'],
        newMemberCouponAvailable: true,
      });

      render(<ProfileCompletionBanner />);

      await waitFor(() => {
        const completeButton = screen.getAllByText('Complete Profile')[0];
        if (!completeButton) throw new Error('Complete button not found');
        completeButton.focus();
        expect(completeButton).toHaveFocus();
      });
    });
  });
});

/* eslint-disable @typescript-eslint/no-non-null-assertion -- Test file uses non-null assertions for DOM element access */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SurveyCouponAssignments from '../SurveyCouponAssignments';
import { surveyService } from '../../../services/surveyService';
import { couponService } from '../../../services/couponService';
import { SurveyCouponDetails, SurveyCouponAssignment } from '../../../types/survey';
import { Coupon } from '../../../types/coupon';
import toast from 'react-hot-toast';

// Mock dependencies
const mockTranslate = vi.fn((key: string, defaultValue?: string) => {
  const translations: Record<string, string> = {
    'surveys.admin.couponAssignment.title': 'Coupon Assignments',
    'surveys.admin.couponAssignment.description': 'Manage coupon assignments for this survey',
    'surveys.admin.couponAssignment.assignCoupon': 'Assign Coupon',
    'surveys.admin.couponAssignment.noAssignments': 'No coupon assignments yet',
    'surveys.admin.couponAssignment.noAssignmentsHelp': 'Click "Assign Coupon" to add a coupon reward',
    'surveys.admin.couponAssignment.awarded': 'Awarded',
    'surveys.admin.couponAssignment.awardedOnCompletion': 'Awarded on completion',
    'surveys.admin.couponAssignment.reason': 'Reason',
    'surveys.admin.couponAssignment.loadError': 'Failed to load coupon assignments',
    'surveys.admin.couponAssignment.assignSuccess': 'Coupon assigned successfully',
    'surveys.admin.couponAssignment.assignError': 'Failed to assign coupon',
    'surveys.admin.couponAssignment.updateSuccess': 'Assignment updated successfully',
    'surveys.admin.couponAssignment.updateError': 'Failed to update assignment',
    'surveys.admin.couponAssignment.removeSuccess': 'Assignment removed successfully',
    'surveys.admin.couponAssignment.removeError': 'Failed to remove assignment',
    'surveys.admin.couponAssignment.confirmRemove': 'Remove Coupon Assignment?',
    'surveys.admin.couponAssignment.confirmRemoveMessage': 'Are you sure you want to remove this coupon assignment? This action cannot be undone.',
    'surveys.admin.couponAssignment.selectCoupon': 'Select a coupon',
    'surveys.admin.couponAssignment.noAvailableCoupons': 'No available coupons',
    'surveys.admin.couponAssignment.rewardCondition': 'Reward Condition',
    'surveys.admin.couponAssignment.alwaysOnCompletion': 'Coupon awarded automatically on survey completion',
    'surveys.admin.couponAssignment.maxAwards': 'Maximum Awards',
    'surveys.admin.couponAssignment.unlimited': 'Unlimited',
    'surveys.admin.couponAssignment.maxAwardsHelp': 'Leave empty for unlimited awards',
    'surveys.admin.couponAssignment.customExpiry': 'Custom Expiry (Days)',
    'surveys.admin.couponAssignment.useCouponExpiry': 'Use coupon expiry',
    'surveys.admin.couponAssignment.customExpiryHelp': 'Override coupon expiry with custom days',
    'surveys.admin.couponAssignment.reasonPlaceholder': 'e.g., Survey completion reward',
    'surveys.admin.couponAssignment.assign': 'Assign',
    'surveys.couponAssignment.editAssignment': 'Edit Assignment',
    'coupons.coupon': 'Coupon',
    'coupons.freeUpgrade': 'Free Upgrade',
    'coupons.freeService': 'Free Service',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.edit': 'Edit',
    'common.remove': 'Remove',
    'common.active': 'Active',
    'common.inactive': 'Inactive',
  };
  return translations[key] || defaultValue || key;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

vi.mock('../../../services/surveyService', () => ({
  surveyService: {
    getSurveyCouponAssignments: vi.fn(),
    assignCouponToSurvey: vi.fn(),
    updateSurveyCouponAssignment: vi.fn(),
    removeCouponFromSurvey: vi.fn(),
  },
}));

vi.mock('../../../services/couponService', () => ({
  couponService: {
    listCoupons: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

// Mock ConfirmDialog to simplify testing
vi.mock('../../common/ConfirmDialog', () => ({
  ConfirmDialog: ({
    isOpen,
    title,
    message,
    confirmText,
    cancelText,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) => {
    if (!isOpen) return null;
    return (
      <div data-testid="confirm-dialog">
        <h3>{title}</h3>
        <p>{message}</p>
        <button onClick={onConfirm}>{confirmText}</button>
        <button onClick={onCancel}>{cancelText}</button>
      </div>
    );
  },
}));

describe('SurveyCouponAssignments', () => {
  const mockAssignment: SurveyCouponDetails = {
    assignment_id: 'assignment-1',
    survey_id: 'survey-1',
    survey_title: 'Test Survey',
    survey_status: 'active',
    coupon_id: 'coupon-1',
    coupon_code: 'SAVE20',
    coupon_name: '20% Off Coupon',
    coupon_type: 'percentage',
    coupon_value: 20,
    coupon_currency: 'THB',
    coupon_status: 'active',
    is_active: true,
    max_awards: 100,
    awarded_count: 15,
    custom_expiry_days: 30,
    assigned_reason: 'Survey completion reward',
    assigned_by: 'admin-1',
    assigned_by_email: 'admin@example.com',
    assigned_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  const mockAssignment2: SurveyCouponDetails = {
    assignment_id: 'assignment-2',
    survey_id: 'survey-1',
    survey_title: 'Test Survey',
    survey_status: 'active',
    coupon_id: 'coupon-2',
    coupon_code: 'FIXED50',
    coupon_name: '50 THB Off',
    coupon_type: 'fixed_amount',
    coupon_value: 50,
    coupon_currency: 'THB',
    coupon_status: 'active',
    is_active: false,
    awarded_count: 5,
    assigned_reason: 'Special reward',
    assigned_by: 'admin-1',
    assigned_by_email: 'admin@example.com',
    assigned_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  };

  const mockCoupon: Coupon = {
    id: 'coupon-3',
    code: 'UPGRADE',
    name: 'Free Room Upgrade',
    description: 'Get a free room upgrade',
    termsAndConditions: 'Subject to availability',
    type: 'free_upgrade',
    currency: 'THB',
    validFrom: '2024-01-01T00:00:00Z',
    validUntil: '2024-12-31T23:59:59Z',
    usageLimit: 500,
    usageLimitPerUser: 1,
    usedCount: 50,
    tierRestrictions: [],
    customerSegment: {},
    status: 'active',
    createdBy: 'admin-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  const mockCoupons = [mockCoupon];

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(surveyService.getSurveyCouponAssignments).mockResolvedValue({
      assignments: [mockAssignment, mockAssignment2],
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    vi.mocked(couponService.listCoupons).mockResolvedValue({
      coupons: mockCoupons,
      page: 1,
      limit: 100,
      total: 1,
      totalPages: 1,
    });

    vi.mocked(surveyService.assignCouponToSurvey).mockResolvedValue({} as SurveyCouponAssignment);
    vi.mocked(surveyService.updateSurveyCouponAssignment).mockResolvedValue({} as SurveyCouponAssignment);
    vi.mocked(surveyService.removeCouponFromSurvey).mockResolvedValue(undefined);
  });

  describe('Loading State', () => {
    it('should show skeleton loader on initial load', () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      const skeleton = document.querySelector('.animate-pulse');
      expect(skeleton).toBeInTheDocument();
    });

    it('should hide skeleton after data loads', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        const skeleton = document.querySelector('.animate-pulse');
        expect(skeleton).not.toBeInTheDocument();
      });
    });

    it('should call services on mount', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(surveyService.getSurveyCouponAssignments).toHaveBeenCalledWith('survey-1');
        expect(couponService.listCoupons).toHaveBeenCalledWith(1, 100, { status: 'active' });
      });
    });
  });

  describe('Empty State', () => {
    it('should display empty state when no assignments exist', async () => {
      vi.mocked(surveyService.getSurveyCouponAssignments).mockResolvedValue({
        assignments: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('No coupon assignments yet')).toBeInTheDocument();
        expect(screen.getByText('Click "Assign Coupon" to add a coupon reward')).toBeInTheDocument();
      });
    });

    it('should show gift icon in empty state', async () => {
      vi.mocked(surveyService.getSurveyCouponAssignments).mockResolvedValue({
        assignments: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });

      const { container } = render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        const icon = container.querySelector('svg.text-gray-400');
        expect(icon).toBeInTheDocument();
      });
    });
  });

  describe('Assignment List Display', () => {
    it('should display all assignments', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('SAVE20 - 20% Off Coupon')).toBeInTheDocument();
        expect(screen.getByText('FIXED50 - 50 THB Off')).toBeInTheDocument();
      });
    });

    it('should display percentage coupon details correctly', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('20% off')).toBeInTheDocument();
      });
    });

    it('should display fixed amount coupon details correctly', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('THB 50 off')).toBeInTheDocument();
      });
    });

    it('should display awarded count', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Awarded: 15 \/ 100/)).toBeInTheDocument();
        expect(screen.getByText(/Awarded: 5$/)).toBeInTheDocument();
      });
    });

    it('should show active status badge', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        const badges = screen.getAllByText('Active');
        expect(badges.length).toBeGreaterThan(0);
        expect(badges[0]!).toHaveClass('bg-green-100', 'text-green-800');
      });
    });

    it('should show inactive status badge', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Inactive')).toBeInTheDocument();
        expect(screen.getByText('Inactive')).toHaveClass('bg-gray-100', 'text-gray-800');
      });
    });

    it('should display assigned reason when present', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Reason: Survey completion reward/)).toBeInTheDocument();
        expect(screen.getByText(/Reason: Special reward/)).toBeInTheDocument();
      });
    });

    it('should display free upgrade type correctly', async () => {
      const freeUpgradeAssignment: SurveyCouponDetails = {
        ...mockAssignment,
        assignment_id: 'assignment-3',
        coupon_id: 'coupon-3',
        coupon_code: 'UPGRADE',
        coupon_name: 'Free Room Upgrade',
        coupon_type: 'free_upgrade',
        coupon_value: undefined,
      };

      vi.mocked(surveyService.getSurveyCouponAssignments).mockResolvedValue({
        assignments: [freeUpgradeAssignment],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Free Upgrade')).toBeInTheDocument();
      });
    });

    it('should display free service type correctly', async () => {
      const freeServiceAssignment: SurveyCouponDetails = {
        ...mockAssignment,
        assignment_id: 'assignment-4',
        coupon_id: 'coupon-4',
        coupon_code: 'SPA',
        coupon_name: 'Free Spa Service',
        coupon_type: 'free_service',
        coupon_value: undefined,
      };

      vi.mocked(surveyService.getSurveyCouponAssignments).mockResolvedValue({
        assignments: [freeServiceAssignment],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Free Service')).toBeInTheDocument();
      });
    });
  });

  describe('Edit Button Functionality', () => {
    it('should show edit button for each assignment', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        const editButtons = screen.getAllByTitle('Edit');
        expect(editButtons).toHaveLength(2);
      });
    });

    it('should open EditAssignmentModal when edit button clicked', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('SAVE20 - 20% Off Coupon')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle('Edit');
      await user.click(editButtons[0]!);

      await waitFor(() => {
        expect(screen.getByText('Edit Assignment')).toBeInTheDocument();
        // Modal should be open with active checkbox
        expect(screen.getByRole('checkbox')).toBeInTheDocument();
      });
    });
  });

  describe('Delete Button Functionality', () => {
    it('should show delete button for each assignment', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        const deleteButtons = screen.getAllByTitle('Remove');
        expect(deleteButtons).toHaveLength(2);
      });
    });

    it('should open ConfirmDialog when delete button clicked', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('SAVE20 - 20% Off Coupon')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Remove');
      await user.click(deleteButtons[0]!);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(screen.getByText('Remove Coupon Assignment?')).toBeInTheDocument();
      });
    });
  });

  describe('Assign Button', () => {
    it('should show assign button', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Assign Coupon')).toBeInTheDocument();
      });
    });

    it('should enable assign button when survey is active', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        const assignButton = screen.getByText('Assign Coupon');
        expect(assignButton).not.toBeDisabled();
      });
    });

    it('should disable assign button when survey is not active', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="draft"
        />
      );

      await waitFor(() => {
        const assignButton = screen.getByText('Assign Coupon');
        expect(assignButton).toBeDisabled();
      });
    });

    it('should open AssignCouponModal when assign button clicked', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Coupon Assignments')).toBeInTheDocument();
      });

      const assignButton = screen.getByText('Assign Coupon');
      await user.click(assignButton);

      await waitFor(() => {
        // Modal should show with "Assign Coupon" title
        const modalTitle = screen.getAllByText('Assign Coupon');
        expect(modalTitle.length).toBeGreaterThan(1); // Button + Modal title
      });
    });
  });

  describe('AssignCouponModal', () => {
    it('should display available coupons in dropdown', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Coupon Assignments')).toBeInTheDocument();
      });

      const assignButton = screen.getByText('Assign Coupon');
      await user.click(assignButton);

      await waitFor(() => {
        expect(screen.getByText('UPGRADE - Free Room Upgrade')).toBeInTheDocument();
      });
    });

    it('should show max awards input field', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Coupon Assignments')).toBeInTheDocument();
      });

      const assignButton = screen.getByText('Assign Coupon');
      await user.click(assignButton);

      await waitFor(() => {
        expect(screen.getByText('Maximum Awards')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Unlimited')).toBeInTheDocument();
      });
    });

    it('should show custom expiry input field', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Coupon Assignments')).toBeInTheDocument();
      });

      const assignButton = screen.getByText('Assign Coupon');
      await user.click(assignButton);

      await waitFor(() => {
        expect(screen.getByText('Custom Expiry (Days)')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Use coupon expiry')).toBeInTheDocument();
      });
    });

    it('should call assignCouponToSurvey on form submission', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Coupon Assignments')).toBeInTheDocument();
      });

      const assignButton = screen.getByText('Assign Coupon');
      await user.click(assignButton);

      await waitFor(() => {
        expect(screen.getByText('UPGRADE - Free Room Upgrade')).toBeInTheDocument();
      });

      // Select coupon
      const select = screen.getByRole('combobox');
      await user.selectOptions(select, 'coupon-3');

      // Fill in max awards
      const maxAwardsInput = screen.getByPlaceholderText('Unlimited');
      await user.clear(maxAwardsInput);
      await user.type(maxAwardsInput, '50');

      // Fill in custom expiry
      const expiryInput = screen.getByPlaceholderText('Use coupon expiry');
      await user.clear(expiryInput);
      await user.type(expiryInput, '30');

      // Submit form
      const submitButtons = screen.getAllByText('Assign');
      await user.click(submitButtons[submitButtons.length - 1]!); // Click the button in modal, not the main assign button

      await waitFor(() => {
        expect(surveyService.assignCouponToSurvey).toHaveBeenCalledWith({
          survey_id: 'survey-1',
          coupon_id: 'coupon-3',
          max_awards: 50,
          custom_expiry_days: 30,
          assigned_reason: 'Survey completion reward',
        });
        expect(toast.success).toHaveBeenCalledWith('Coupon assigned successfully');
      });
    });

    it('should show error toast when assignment fails', async () => {
      const user = userEvent.setup();
      vi.mocked(surveyService.assignCouponToSurvey).mockRejectedValue(new Error('Assignment failed'));

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Coupon Assignments')).toBeInTheDocument();
      });

      const assignButton = screen.getByText('Assign Coupon');
      await user.click(assignButton);

      await waitFor(() => {
        expect(screen.getByText('UPGRADE - Free Room Upgrade')).toBeInTheDocument();
      });

      // Select coupon
      const select = screen.getByRole('combobox');
      await user.selectOptions(select, 'coupon-3');

      // Submit form
      const submitButtons = screen.getAllByText('Assign');
      await user.click(submitButtons[submitButtons.length - 1]!);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to assign coupon');
      });
    });

    it('should close modal on cancel', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Coupon Assignments')).toBeInTheDocument();
      });

      const assignButton = screen.getByText('Assign Coupon');
      await user.click(assignButton);

      await waitFor(() => {
        expect(screen.getByText('UPGRADE - Free Room Upgrade')).toBeInTheDocument();
      });

      const cancelButtons = screen.getAllByText('Cancel');
      await user.click(cancelButtons[0]!);

      await waitFor(() => {
        // Modal should be closed, so we shouldn't see the dropdown
        expect(screen.queryByText('UPGRADE - Free Room Upgrade')).not.toBeInTheDocument();
      });
    });
  });

  describe('EditAssignmentModal', () => {
    it('should pre-populate form with existing values', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('SAVE20 - 20% Off Coupon')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle('Edit');
      await user.click(editButtons[0]!);

      await waitFor(() => {
        // Check if active checkbox is checked
        const activeCheckbox = screen.getByRole('checkbox');
        expect(activeCheckbox).toBeChecked();

        // Check if max awards field has value
        const inputs = screen.getAllByPlaceholderText('Unlimited');
        expect(inputs[0]!).toHaveValue(100);

        // Check if custom expiry has value
        const expiryInputs = screen.getAllByPlaceholderText('Use coupon expiry');
        expect(expiryInputs[0]!).toHaveValue(30);

        // Check if reason textarea has value
        const textareas = document.querySelectorAll('textarea');
        expect(textareas[0]!).toHaveValue('Survey completion reward');
      });
    });

    it('should call updateSurveyCouponAssignment on form submission', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('SAVE20 - 20% Off Coupon')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle('Edit');
      await user.click(editButtons[0]!);

      await waitFor(() => {
        expect(screen.getByText('Edit Assignment')).toBeInTheDocument();
      });

      // Change max awards
      const maxAwardsInputs = screen.getAllByPlaceholderText('Unlimited');
      await user.clear(maxAwardsInputs[0]!);
      await user.type(maxAwardsInputs[0]!, '200');

      // Submit form
      const saveButton = screen.getByText('Save');
      await user.click(saveButton);

      await waitFor(() => {
        expect(surveyService.updateSurveyCouponAssignment).toHaveBeenCalledWith(
          'survey-1',
          'coupon-1',
          {
            max_awards: 200,
            custom_expiry_days: 30,
            assigned_reason: 'Survey completion reward',
            is_active: true,
          }
        );
        expect(toast.success).toHaveBeenCalledWith('Assignment updated successfully');
      });
    });

    it('should show error toast when update fails', async () => {
      const user = userEvent.setup();
      vi.mocked(surveyService.updateSurveyCouponAssignment).mockRejectedValue(
        new Error('Update failed')
      );

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('SAVE20 - 20% Off Coupon')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle('Edit');
      await user.click(editButtons[0]!);

      await waitFor(() => {
        expect(screen.getByText('Edit Assignment')).toBeInTheDocument();
      });

      const saveButton = screen.getByText('Save');
      await user.click(saveButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to update assignment');
      });
    });

    it('should close modal on cancel', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('SAVE20 - 20% Off Coupon')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle('Edit');
      await user.click(editButtons[0]!);

      await waitFor(() => {
        expect(screen.getByText('Edit Assignment')).toBeInTheDocument();
      });

      const cancelButtons = screen.getAllByText('Cancel');
      await user.click(cancelButtons[0]!);

      await waitFor(() => {
        expect(screen.queryByText('Edit Assignment')).not.toBeInTheDocument();
      });
    });
  });

  describe('ConfirmDialog for Deletion', () => {
    it('should call removeCouponFromSurvey when confirmed', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('SAVE20 - 20% Off Coupon')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Remove');
      await user.click(deleteButtons[0]!);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      const confirmButton = within(screen.getByTestId('confirm-dialog')).getByText('Remove');
      await user.click(confirmButton);

      await waitFor(() => {
        expect(surveyService.removeCouponFromSurvey).toHaveBeenCalledWith('survey-1', 'coupon-1');
        expect(toast.success).toHaveBeenCalledWith('Assignment removed successfully');
      });
    });

    it('should close dialog when cancelled', async () => {
      const user = userEvent.setup();

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('SAVE20 - 20% Off Coupon')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Remove');
      await user.click(deleteButtons[0]!);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      const cancelButton = within(screen.getByTestId('confirm-dialog')).getByText('Cancel');
      await user.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
        expect(surveyService.removeCouponFromSurvey).not.toHaveBeenCalled();
      });
    });

    it('should show error toast when removal fails', async () => {
      const user = userEvent.setup();
      vi.mocked(surveyService.removeCouponFromSurvey).mockRejectedValue(
        new Error('Removal failed')
      );

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('SAVE20 - 20% Off Coupon')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Remove');
      await user.click(deleteButtons[0]!);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      const confirmButton = within(screen.getByTestId('confirm-dialog')).getByText('Remove');
      await user.click(confirmButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to remove assignment');
      });
    });
  });

  describe('Error Handling', () => {
    it('should show error toast when loading assignments fails', async () => {
      vi.mocked(surveyService.getSurveyCouponAssignments).mockRejectedValue(
        new Error('Load failed')
      );

      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to load coupon assignments');
      });
    });
  });

  describe('Component Header', () => {
    it('should display component title', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Coupon Assignments')).toBeInTheDocument();
      });
    });

    it('should display component description', async () => {
      render(
        <SurveyCouponAssignments
          surveyId="survey-1"
          surveyTitle="Test Survey"
          surveyStatus="active"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Manage coupon assignments for this survey')).toBeInTheDocument();
      });
    });
  });
});

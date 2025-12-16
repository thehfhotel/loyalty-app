/* eslint-disable curly -- Test file uses single-line conditionals for concise error handling */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsModal from '../SettingsModal';
import { useAuthStore } from '../../../store/authStore';
import { userService, UserProfile } from '../../../services/userService';

// Mock dependencies
const mockTranslate = vi.fn((key: string) => {
  const translations: Record<string, string> = {
    'profile.editProfile': 'Edit Profile',
    'profile.email': 'Email',
    'profile.emailPlaceholder': 'Enter your email',
    'profile.emailHelpText': 'Email cannot be changed',
    'auth.firstName': 'First Name',
    'auth.lastName': 'Last Name',
    'auth.phone': 'Phone',
    'profile.firstNamePlaceholder': 'Enter first name',
    'profile.lastNamePlaceholder': 'Enter last name',
    'profile.phonePlaceholder': 'Enter phone number',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.saving': 'Saving...',
    'profile.dateOfBirth': 'Date of Birth',
    'profile.gender': 'Gender',
    'profile.occupation': 'Occupation',
    'profile.interests': 'Interests',
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
  FiUser: () => <span data-testid="user-icon">👤</span>,
  FiPhone: () => <span data-testid="phone-icon">📞</span>,
  FiCamera: () => <span data-testid="camera-icon">📷</span>,
  FiSmile: () => <span data-testid="smile-icon">😊</span>,
  FiMail: () => <span data-testid="mail-icon">✉</span>,
}));

vi.mock('../../../store/authStore');
vi.mock('../../../services/userService');
vi.mock('../../../utils/notificationManager', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../EmojiAvatar', () => ({
  default: ({ avatarUrl, size, className }: any) => (
    <div data-testid="emoji-avatar" data-avatar-url={avatarUrl} data-size={size} className={className}>
      Avatar
    </div>
  ),
}));

vi.mock('../EmojiSelector', () => ({
  EmojiSelectorInline: ({ onSelect, currentEmoji }: any) => (
    <div data-testid="emoji-selector" data-current-emoji={currentEmoji}>
      <button onClick={() => onSelect('😀')} data-testid="select-emoji-button">
        Select 😀
      </button>
    </div>
  ),
}));

vi.mock('../ProfileFormFields', () => ({
  GenderField: ({ register, errors }: any) => (
    <div data-testid="gender-field">
      <input {...register('gender')} data-testid="gender-input" />
      {errors?.gender && <span>{errors.gender.message}</span>}
    </div>
  ),
  OccupationField: ({ register, errors }: any) => (
    <div data-testid="occupation-field">
      <input {...register('occupation')} data-testid="occupation-input" />
      {errors?.occupation && <span>{errors.occupation.message}</span>}
    </div>
  ),
  InterestsField: ({ register, errors, watchedValue }: any) => (
    <div data-testid="interests-field" data-watched-value={watchedValue}>
      <input {...register('interests')} data-testid="interests-input" />
      {errors?.interests && <span>{errors.interests.message}</span>}
    </div>
  ),
  DateOfBirthField: ({ register, errors }: any) => (
    <div data-testid="dob-field">
      <input {...register('dateOfBirth')} data-testid="dob-input" />
      {errors?.dateOfBirth && <span>{errors.dateOfBirth.message}</span>}
    </div>
  ),
}));

describe('SettingsModal', () => {
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    role: 'user',
    isActive: true,
    emailVerified: true,
    createdAt: '2024-01-01',
  };

  const mockProfile: UserProfile = {
    userId: 'user-123',
    firstName: 'John',
    lastName: 'Doe',
    phone: '1234567890',
    dateOfBirth: '1990-01-01',
    preferences: {},
    avatarUrl: 'emoji:😀',
    membershipId: 'M123',
    gender: 'male',
    occupation: 'Engineer',
    interests: ['Technology', 'Sports'],
    profileCompleted: true,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    profile: mockProfile,
    onSubmit: vi.fn(),
    isSaving: false,
    onAvatarUpload: vi.fn(),
    onDeleteAvatar: vi.fn(),
    uploadingAvatar: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    (useAuthStore as any).mockImplementation((selector: any) => {
      const state = { user: mockUser };
      return selector(state);
    });

    (userService.updateEmojiAvatar as any) = vi.fn();
  });

  describe('Basic Rendering', () => {
    it('should render the component when isOpen is true', () => {
      const { container } = render(<SettingsModal {...defaultProps} />);

      expect(container).toBeTruthy();
      expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    });

    it('should not render when isOpen is false', () => {
      const { container } = render(<SettingsModal {...defaultProps} isOpen={false} />);

      expect(container.firstChild).toBeNull();
    });

    it('should render modal with backdrop', () => {
      render(<SettingsModal {...defaultProps} />);

      const backdrop = document.querySelector('.bg-gray-500');
      expect(backdrop).toBeInTheDocument();
      expect(backdrop).toHaveClass('bg-opacity-75');
    });

    it('should render modal title', () => {
      render(<SettingsModal {...defaultProps} />);

      expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    });

    it('should render close button with X icon', () => {
      render(<SettingsModal {...defaultProps} />);

      expect(screen.getByTestId('x-icon')).toBeInTheDocument();
    });
  });

  describe('Form Field Display', () => {
    it('should render email field with value from user', () => {
      render(<SettingsModal {...defaultProps} />);

      const emailInput = screen.getByLabelText('Email');
      expect(emailInput).toBeInTheDocument();
      expect(emailInput).toHaveValue('test@example.com');
    });

    it('should render email help text', () => {
      render(<SettingsModal {...defaultProps} />);

      expect(screen.getByText('Email cannot be changed')).toBeInTheDocument();
    });

    it('should render firstName field with profile value', () => {
      render(<SettingsModal {...defaultProps} />);

      const firstNameInput = screen.getByLabelText('First Name');
      expect(firstNameInput).toBeInTheDocument();
      expect(firstNameInput).toHaveValue('John');
    });

    it('should render lastName field with profile value', () => {
      render(<SettingsModal {...defaultProps} />);

      const lastNameInput = screen.getByLabelText('Last Name');
      expect(lastNameInput).toBeInTheDocument();
      expect(lastNameInput).toHaveValue('Doe');
    });

    it('should render phone field with profile value', () => {
      render(<SettingsModal {...defaultProps} />);

      const phoneInput = screen.getByLabelText('Phone');
      expect(phoneInput).toBeInTheDocument();
      expect(phoneInput).toHaveValue('1234567890');
    });

    it('should render all form field components', () => {
      render(<SettingsModal {...defaultProps} />);

      expect(screen.getByTestId('dob-field')).toBeInTheDocument();
      expect(screen.getByTestId('gender-field')).toBeInTheDocument();
      expect(screen.getByTestId('occupation-field')).toBeInTheDocument();
      expect(screen.getByTestId('interests-field')).toBeInTheDocument();
    });

    it('should render field icons', () => {
      render(<SettingsModal {...defaultProps} />);

      expect(screen.getAllByTestId('user-icon')).toHaveLength(2);
      expect(screen.getByTestId('phone-icon')).toBeInTheDocument();
      expect(screen.getByTestId('mail-icon')).toBeInTheDocument();
    });

    it('should render empty fields when profile values are missing', () => {
      const profileWithMissingData: UserProfile = {
        ...mockProfile,
        lastName: '',
        phone: '',
        dateOfBirth: undefined,
      };

      render(<SettingsModal {...defaultProps} profile={profileWithMissingData} />);

      const lastNameInput = screen.getByLabelText('Last Name');
      const phoneInput = screen.getByLabelText('Phone');

      expect(lastNameInput).toHaveValue('');
      expect(phoneInput).toHaveValue('');
    });
  });

  describe('Form Field Validation', () => {
    it('should show validation error for empty firstName', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(<SettingsModal {...defaultProps} onSubmit={onSubmit} />);

      const firstNameInput = screen.getByLabelText('First Name');
      await user.clear(firstNameInput);

      const saveButton = screen.getByText('Save');
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('First name is required')).toBeInTheDocument();
      });

      // Ensure the form was not submitted
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should allow empty email', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(<SettingsModal {...defaultProps} onSubmit={onSubmit} />);

      const emailInput = screen.getByLabelText('Email');
      await user.clear(emailInput);

      const saveButton = screen.getByText('Save');
      await user.click(saveButton);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
    });

    it('should allow optional fields to be empty', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(<SettingsModal {...defaultProps} onSubmit={onSubmit} />);

      const lastNameInput = screen.getByLabelText('Last Name');
      const phoneInput = screen.getByLabelText('Phone');

      await user.clear(lastNameInput);
      await user.clear(phoneInput);

      const saveButton = screen.getByText('Save');
      await user.click(saveButton);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
    });
  });

  describe('Form Submission', () => {
    it('should call onSubmit when form is submitted', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(<SettingsModal {...defaultProps} onSubmit={onSubmit} />);

      const saveButton = screen.getByText('Save');
      await user.click(saveButton);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
    });

    it('should call onSubmit with updated values', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(<SettingsModal {...defaultProps} onSubmit={onSubmit} />);

      const firstNameInput = screen.getByLabelText('First Name');
      await user.clear(firstNameInput);
      await user.type(firstNameInput, 'Jane');

      const saveButton = screen.getByText('Save');
      await user.click(saveButton);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
        const callArgs = onSubmit.mock.calls[0]![0];
        expect(callArgs.firstName).toBe('Jane');
      });
    });

    it('should not call onSubmit if firstName is empty', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(<SettingsModal {...defaultProps} onSubmit={onSubmit} />);

      const firstNameInput = screen.getByLabelText('First Name');
      await user.clear(firstNameInput);

      const saveButton = screen.getByText('Save');
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('First name is required')).toBeInTheDocument();
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('Avatar Section', () => {
    it('should render profile picture section', () => {
      render(<SettingsModal {...defaultProps} />);

      expect(screen.getByText('Profile Picture')).toBeInTheDocument();
    });

    it('should render EmojiAvatar with profile avatarUrl', () => {
      render(<SettingsModal {...defaultProps} />);

      const avatar = screen.getByTestId('emoji-avatar');
      expect(avatar).toBeInTheDocument();
      expect(avatar).toHaveAttribute('data-avatar-url', 'emoji:😀');
      expect(avatar).toHaveAttribute('data-size', 'lg');
    });

    it('should render Choose Emoji button', () => {
      render(<SettingsModal {...defaultProps} />);

      expect(screen.getByText('Choose Emoji')).toBeInTheDocument();
      expect(screen.getByTestId('smile-icon')).toBeInTheDocument();
    });

    it('should render Upload Image button', () => {
      render(<SettingsModal {...defaultProps} />);

      expect(screen.getByText('Upload Image')).toBeInTheDocument();
      expect(screen.getByTestId('camera-icon')).toBeInTheDocument();
    });

    it('should render Remove button when avatarUrl exists', () => {
      render(<SettingsModal {...defaultProps} />);

      expect(screen.getByText('Remove')).toBeInTheDocument();
    });

    it('should not render Remove button when no avatarUrl', () => {
      const profileWithoutAvatar = { ...mockProfile, avatarUrl: undefined };
      render(<SettingsModal {...defaultProps} profile={profileWithoutAvatar} />);

      expect(screen.queryByText('Remove')).not.toBeInTheDocument();
    });

    it('should render avatar help text', () => {
      render(<SettingsModal {...defaultProps} />);

      expect(
        screen.getByText('Choose an emoji or upload your own image for your profile picture')
      ).toBeInTheDocument();
    });

    it('should render hidden file input', () => {
      render(<SettingsModal {...defaultProps} />);

      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toBeInTheDocument();
      expect(fileInput).toHaveClass('hidden');
      expect(fileInput).toHaveAttribute('accept', 'image/*');
    });
  });

  describe('Avatar Interactions', () => {
    it('should toggle emoji selector when Choose Emoji clicked', async () => {
      const user = userEvent.setup();
      render(<SettingsModal {...defaultProps} />);

      expect(screen.queryByTestId('emoji-selector')).not.toBeInTheDocument();

      const chooseEmojiButton = screen.getByText('Choose Emoji');
      await user.click(chooseEmojiButton);

      expect(screen.getByTestId('emoji-selector')).toBeInTheDocument();
    });

    it('should close emoji selector when X clicked', async () => {
      const user = userEvent.setup();
      render(<SettingsModal {...defaultProps} />);

      const chooseEmojiButton = screen.getByText('Choose Emoji');
      await user.click(chooseEmojiButton);

      expect(screen.getByTestId('emoji-selector')).toBeInTheDocument();

      const closeButtons = screen.getAllByTestId('x-icon');
      const selectorCloseButton = closeButtons[1]!;
      await user.click(selectorCloseButton.parentElement!);

      await waitFor(() => {
        expect(screen.queryByTestId('emoji-selector')).not.toBeInTheDocument();
      });
    });

    it('should trigger file input when Upload Image clicked', async () => {
      const user = userEvent.setup();
      render(<SettingsModal {...defaultProps} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      const uploadButton = screen.getByText('Upload Image');
      await user.click(uploadButton);

      expect(clickSpy).toHaveBeenCalled();
    });

    it('should call onAvatarUpload when file selected', async () => {
      const onAvatarUpload = vi.fn();
      render(<SettingsModal {...defaultProps} onAvatarUpload={onAvatarUpload} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['dummy content'], 'test.png', { type: 'image/png' });

      await userEvent.upload(fileInput, file);

      expect(onAvatarUpload).toHaveBeenCalled();
    });

    it('should call onDeleteAvatar when Remove clicked', async () => {
      const user = userEvent.setup();
      const onDeleteAvatar = vi.fn();
      render(<SettingsModal {...defaultProps} onDeleteAvatar={onDeleteAvatar} />);

      const removeButton = screen.getByText('Remove');
      await user.click(removeButton);

      expect(onDeleteAvatar).toHaveBeenCalled();
    });

    it('should call userService.updateEmojiAvatar when emoji selected', async () => {
      const user = userEvent.setup();
      const mockUpdatedProfile = { ...mockProfile, avatarUrl: 'emoji:😀' };
      (userService.updateEmojiAvatar as any).mockResolvedValue(mockUpdatedProfile);

      render(<SettingsModal {...defaultProps} />);

      const chooseEmojiButton = screen.getByText('Choose Emoji');
      await user.click(chooseEmojiButton);

      const selectEmojiButton = screen.getByTestId('select-emoji-button');
      await user.click(selectEmojiButton);

      await waitFor(() => {
        expect(userService.updateEmojiAvatar).toHaveBeenCalledWith('😀');
      });
    });

    it('should close emoji selector after successful emoji selection', async () => {
      const user = userEvent.setup();
      const mockUpdatedProfile = { ...mockProfile, avatarUrl: 'emoji:😀' };
      (userService.updateEmojiAvatar as any).mockResolvedValue(mockUpdatedProfile);

      render(<SettingsModal {...defaultProps} />);

      const chooseEmojiButton = screen.getByText('Choose Emoji');
      await user.click(chooseEmojiButton);

      const selectEmojiButton = screen.getByTestId('select-emoji-button');
      await user.click(selectEmojiButton);

      await waitFor(() => {
        expect(screen.queryByTestId('emoji-selector')).not.toBeInTheDocument();
      });
    });

    it('should call onProfileUpdate when emoji selected successfully', async () => {
      const user = userEvent.setup();
      const onProfileUpdate = vi.fn();
      const mockUpdatedProfile = { ...mockProfile, avatarUrl: 'emoji:😀' };
      (userService.updateEmojiAvatar as any).mockResolvedValue(mockUpdatedProfile);

      render(<SettingsModal {...defaultProps} onProfileUpdate={onProfileUpdate} />);

      const chooseEmojiButton = screen.getByText('Choose Emoji');
      await user.click(chooseEmojiButton);

      const selectEmojiButton = screen.getByTestId('select-emoji-button');
      await user.click(selectEmojiButton);

      await waitFor(() => {
        expect(onProfileUpdate).toHaveBeenCalledWith(mockUpdatedProfile);
      });
    });
  });

  describe('Loading States', () => {
    it('should show Saving... text when isSaving is true', () => {
      render(<SettingsModal {...defaultProps} isSaving={true} />);

      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    it('should show Save text when isSaving is false', () => {
      render(<SettingsModal {...defaultProps} isSaving={false} />);

      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('should disable submit button when isSaving is true', () => {
      render(<SettingsModal {...defaultProps} isSaving={true} />);

      const saveButton = screen.getByText('Saving...');
      expect(saveButton).toBeDisabled();
    });

    it('should enable submit button when isSaving is false', () => {
      render(<SettingsModal {...defaultProps} isSaving={false} />);

      const saveButton = screen.getByText('Save');
      expect(saveButton).not.toBeDisabled();
    });

    it('should disable Upload Image button when uploadingAvatar is true', () => {
      render(<SettingsModal {...defaultProps} uploadingAvatar={true} />);

      const uploadButton = screen.getByText('Upload Image');
      expect(uploadButton).toBeDisabled();
    });

    it('should disable Remove button when uploadingAvatar is true', () => {
      render(<SettingsModal {...defaultProps} uploadingAvatar={true} />);

      const removeButton = screen.getByText('Remove');
      expect(removeButton).toBeDisabled();
    });

    it('should disable Choose Emoji button when updatingEmoji', async () => {
      const user = userEvent.setup();
      (userService.updateEmojiAvatar as any).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      render(<SettingsModal {...defaultProps} />);

      const chooseEmojiButton = screen.getByText('Choose Emoji');
      await user.click(chooseEmojiButton);

      const selectEmojiButton = screen.getByTestId('select-emoji-button');
      await user.click(selectEmojiButton);

      await waitFor(() => {
        expect(chooseEmojiButton).toBeDisabled();
      });
    });

    it('should show loading spinner on avatar when updatingEmoji', async () => {
      const user = userEvent.setup();
      (userService.updateEmojiAvatar as any).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      render(<SettingsModal {...defaultProps} />);

      const chooseEmojiButton = screen.getByText('Choose Emoji');
      await user.click(chooseEmojiButton);

      const selectEmojiButton = screen.getByTestId('select-emoji-button');
      await user.click(selectEmojiButton);

      await waitFor(() => {
        const spinner = document.querySelector('.animate-spin');
        expect(spinner).toBeInTheDocument();
      });
    });

    it('should apply opacity-50 to avatar when updatingEmoji', async () => {
      const user = userEvent.setup();
      (userService.updateEmojiAvatar as any).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      render(<SettingsModal {...defaultProps} />);

      const chooseEmojiButton = screen.getByText('Choose Emoji');
      await user.click(chooseEmojiButton);

      const selectEmojiButton = screen.getByTestId('select-emoji-button');
      await user.click(selectEmojiButton);

      await waitFor(() => {
        const avatar = screen.getByTestId('emoji-avatar');
        expect(avatar).toHaveClass('opacity-50');
      });
    });

    it('should disable Upload Image when updatingEmoji', async () => {
      const user = userEvent.setup();
      (userService.updateEmojiAvatar as any).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      render(<SettingsModal {...defaultProps} />);

      const chooseEmojiButton = screen.getByText('Choose Emoji');
      await user.click(chooseEmojiButton);

      const selectEmojiButton = screen.getByTestId('select-emoji-button');
      await user.click(selectEmojiButton);

      await waitFor(() => {
        const uploadButton = screen.getByText('Upload Image');
        expect(uploadButton).toBeDisabled();
      });
    });
  });

  describe('Modal Open/Close Behavior', () => {
    it('should call onClose when close button clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<SettingsModal {...defaultProps} onClose={onClose} />);

      const closeButton = screen.getByTestId('x-icon').parentElement;
      if (!closeButton) throw new Error('Close button not found');
      await user.click(closeButton);

      expect(onClose).toHaveBeenCalled();
    });

    it('should call onClose when backdrop clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<SettingsModal {...defaultProps} onClose={onClose} />);

      const backdrop = document.querySelector('.bg-gray-500') as HTMLElement;
      await user.click(backdrop);

      expect(onClose).toHaveBeenCalled();
    });

    it('should call onClose when Cancel button clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<SettingsModal {...defaultProps} onClose={onClose} />);

      const cancelButton = screen.getByText('Cancel');
      await user.click(cancelButton);

      expect(onClose).toHaveBeenCalled();
    });

    it('should not close when modal content is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<SettingsModal {...defaultProps} onClose={onClose} />);

      const modalContent = screen.getByText('Edit Profile');
      await user.click(modalContent);

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Form Reset on Profile Change', () => {
    it('should reset form when profile changes', () => {
      const { rerender } = render(<SettingsModal {...defaultProps} />);

      const firstNameInput = screen.getByLabelText('First Name');
      expect(firstNameInput).toHaveValue('John');

      const updatedProfile = { ...mockProfile, firstName: 'Jane' };
      rerender(<SettingsModal {...defaultProps} profile={updatedProfile} />);

      expect(firstNameInput).toHaveValue('Jane');
    });

    it('should reset form when user email changes', () => {
      const { rerender } = render(<SettingsModal {...defaultProps} />);

      const emailInput = screen.getByLabelText('Email');
      expect(emailInput).toHaveValue('test@example.com');

      const updatedUser = { ...mockUser, email: 'newemail@example.com' };
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = { user: updatedUser };
        return selector(state);
      });

      rerender(<SettingsModal {...defaultProps} />);

      expect(emailInput).toHaveValue('newemail@example.com');
    });

    it('should handle profile with null interests', () => {
      const profileWithNullInterests = { ...mockProfile, interests: undefined };
      render(<SettingsModal {...defaultProps} profile={profileWithNullInterests} />);

      const interestsField = screen.getByTestId('interests-field');
      expect(interestsField).toHaveAttribute('data-watched-value', '');
    });

    it('should format dateOfBirth to ISO date string', () => {
      render(<SettingsModal {...defaultProps} />);

      const dobInput = screen.getByTestId('dob-input');
      expect(dobInput).toHaveValue('1990-01-01');
    });

    it('should handle profile with no dateOfBirth', () => {
      const profileWithoutDOB = { ...mockProfile, dateOfBirth: undefined };
      render(<SettingsModal {...defaultProps} profile={profileWithoutDOB} />);

      const dobInput = screen.getByTestId('dob-input');
      expect(dobInput).toHaveValue('');
    });
  });

  describe('Accessibility', () => {
    it('should have proper form structure', () => {
      render(<SettingsModal {...defaultProps} />);

      const form = document.querySelector('form');
      expect(form).toBeInTheDocument();
    });

    it('should have proper labels for form fields', () => {
      render(<SettingsModal {...defaultProps} />);

      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByLabelText('First Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Last Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Phone')).toBeInTheDocument();
    });

    it('should have proper button types', () => {
      render(<SettingsModal {...defaultProps} />);

      const cancelButton = screen.getByText('Cancel');
      const saveButton = screen.getByText('Save');

      expect(cancelButton).toHaveAttribute('type', 'button');
      expect(saveButton).toHaveAttribute('type', 'submit');
    });

    it('should support keyboard navigation', async () => {
      render(<SettingsModal {...defaultProps} />);

      const firstNameInput = screen.getByLabelText('First Name');
      firstNameInput.focus();

      expect(firstNameInput).toHaveFocus();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null profile gracefully', () => {
      render(<SettingsModal {...defaultProps} profile={null} />);

      const firstNameInput = screen.getByLabelText('First Name');
      expect(firstNameInput).toHaveValue('');
    });

    it('should handle null user gracefully', () => {
      (useAuthStore as any).mockImplementation((selector: any) => {
        const state = { user: null };
        return selector(state);
      });

      render(<SettingsModal {...defaultProps} />);

      const emailInput = screen.getByLabelText('Email');
      expect(emailInput).toHaveValue('');
    });

    it('should handle emoji selection error gracefully', async () => {
      const user = userEvent.setup();
      (userService.updateEmojiAvatar as any).mockRejectedValue(
        new Error('Failed to update emoji')
      );

      render(<SettingsModal {...defaultProps} />);

      const chooseEmojiButton = screen.getByText('Choose Emoji');
      await user.click(chooseEmojiButton);

      const selectEmojiButton = screen.getByTestId('select-emoji-button');
      await user.click(selectEmojiButton);

      await waitFor(() => {
        expect(userService.updateEmojiAvatar).toHaveBeenCalled();
      });

      // Modal should still be open
      expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    });

    it('should handle missing onProfileUpdate callback', async () => {
      const user = userEvent.setup();
      const mockUpdatedProfile = { ...mockProfile, avatarUrl: 'emoji:😀' };
      (userService.updateEmojiAvatar as any).mockResolvedValue(mockUpdatedProfile);

      render(<SettingsModal {...defaultProps} onProfileUpdate={undefined} />);

      const chooseEmojiButton = screen.getByText('Choose Emoji');
      await user.click(chooseEmojiButton);

      const selectEmojiButton = screen.getByTestId('select-emoji-button');
      await user.click(selectEmojiButton);

      await waitFor(() => {
        expect(userService.updateEmojiAvatar).toHaveBeenCalled();
      });

      // Should not crash
      expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    });

    it('should handle empty interests array', () => {
      const profileWithEmptyInterests = { ...mockProfile, interests: [] };
      render(<SettingsModal {...defaultProps} profile={profileWithEmptyInterests} />);

      const interestsField = screen.getByTestId('interests-field');
      expect(interestsField).toHaveAttribute('data-watched-value', '');
    });

    it('should convert dateOfBirth Date object to string', () => {
      const profileWithDateObject = {
        ...mockProfile,
        dateOfBirth: new Date('1990-01-01').toISOString(),
      };
      render(<SettingsModal {...defaultProps} profile={profileWithDateObject} />);

      const dobInput = screen.getByTestId('dob-input');
      expect(dobInput).toHaveValue('1990-01-01');
    });
  });

  describe('Watch Functionality', () => {
    it('should pass watched interests value to InterestsField', async () => {
      const user = userEvent.setup();
      render(<SettingsModal {...defaultProps} />);

      const interestsField = screen.getByTestId('interests-field');
      expect(interestsField).toHaveAttribute('data-watched-value', 'Technology, Sports');

      // Type in the interests input to trigger watch
      const interestsInput = screen.getByTestId('interests-input');
      await user.clear(interestsInput);
      await user.type(interestsInput, 'Gaming, Reading');

      await waitFor(() => {
        expect(interestsField).toHaveAttribute('data-watched-value', 'Gaming, Reading');
      });
    });
  });
});

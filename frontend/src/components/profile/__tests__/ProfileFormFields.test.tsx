import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { GenderField, OccupationField, DateOfBirthField, ProfileFormData } from '../ProfileFormFields';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        // Gender field translations
        'profile.gender': 'Gender',
        'profile.selectGender': 'Select gender',
        'profile.male': 'Male',
        'profile.female': 'Female',
        'profile.other': 'Other',
        'profile.preferNotToSay': 'Prefer not to say',

        // Occupation field translations
        'profile.occupation': 'Occupation',
        'profile.selectOccupation': 'Select occupation',
        'profile.occupations.student': 'Student',
        'profile.occupations.business_owner': 'Business Owner',
        'profile.occupations.employee': 'Employee',
        'profile.occupations.freelancer': 'Freelancer',
        'profile.occupations.consultant': 'Consultant',
        'profile.occupations.teacher': 'Teacher',
        'profile.occupations.healthcare': 'Healthcare',
        'profile.occupations.engineer': 'Engineer',
        'profile.occupations.artist': 'Artist',
        'profile.occupations.sales': 'Sales',
        'profile.occupations.manager': 'Manager',
        'profile.occupations.retired': 'Retired',
        'profile.occupations.other': 'Other',

        // Date of birth field translations
        'profile.dateOfBirth': 'Date of Birth',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock react-icons
vi.mock('react-icons/fi', () => ({
  FiUser: () => <span data-testid="icon-user">User Icon</span>,
  FiBriefcase: () => <span data-testid="icon-briefcase">Briefcase Icon</span>,
  FiCalendar: () => <span data-testid="icon-calendar">Calendar Icon</span>,
}));

// Helper to render GenderField with form context
function renderGenderField(props: {
  showRequiredAsterisk?: boolean;
  isModal?: boolean;
  errors?: Record<string, { message: string }>;
}) {
  const TestComponent = () => {
    const { register, formState } = useForm<ProfileFormData>();
    const errors = props.errors || formState.errors;

    return (
      <GenderField
        register={register}
        errors={errors}
        showRequiredAsterisk={props.showRequiredAsterisk ?? false}
        isModal={props.isModal ?? false}
      />
    );
  };

  return render(<TestComponent />);
}

// Helper to render OccupationField with form context
function renderOccupationField(props: {
  showRequiredAsterisk?: boolean;
  isModal?: boolean;
  errors?: Record<string, { message: string }>;
}) {
  const TestComponent = () => {
    const { register, formState } = useForm<ProfileFormData>();
    const errors = props.errors || formState.errors;

    return (
      <OccupationField
        register={register}
        errors={errors}
        showRequiredAsterisk={props.showRequiredAsterisk ?? false}
        isModal={props.isModal ?? false}
      />
    );
  };

  return render(<TestComponent />);
}

// Helper to render DateOfBirthField with form context
function renderDateOfBirthField(props: {
  showRequiredAsterisk?: boolean;
  isModal?: boolean;
  errors?: Record<string, { message: string }>;
}) {
  const TestComponent = () => {
    const { register, formState } = useForm<ProfileFormData>();
    const errors = props.errors || formState.errors;

    return (
      <DateOfBirthField
        register={register}
        errors={errors}
        showRequiredAsterisk={props.showRequiredAsterisk ?? false}
        isModal={props.isModal ?? false}
      />
    );
  };

  return render(<TestComponent />);
}

describe('GenderField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      const { container } = renderGenderField({});
      expect(container).toBeTruthy();
    });

    it('should display the gender label', () => {
      renderGenderField({});
      expect(screen.getByText('Gender')).toBeInTheDocument();
    });

    it('should render gender select dropdown', () => {
      renderGenderField({});
      const select = screen.getByRole('combobox', { name: /gender/i });
      expect(select).toBeInTheDocument();
      expect(select).toHaveAttribute('id', 'gender');
    });

    it('should display user icon in non-modal mode', () => {
      renderGenderField({ isModal: false });
      expect(screen.getByTestId('icon-user')).toBeInTheDocument();
    });

    it('should not display user icon in label for modal mode', () => {
      renderGenderField({ isModal: true });
      const label = screen.getByText('Gender').closest('label');
      expect(label?.querySelector('[data-testid="icon-user"]')).not.toBeInTheDocument();
    });
  });

  describe('Gender Options Display', () => {
    it('should display all gender options', () => {
      renderGenderField({});

      expect(screen.getByText('Select gender')).toBeInTheDocument();
      expect(screen.getByText('Male')).toBeInTheDocument();
      expect(screen.getByText('Female')).toBeInTheDocument();
      expect(screen.getByText('Other')).toBeInTheDocument();
      expect(screen.getByText('Prefer not to say')).toBeInTheDocument();
    });

    it('should have empty value as default option', () => {
      renderGenderField({});
      const select = screen.getByRole('combobox', { name: /gender/i }) as HTMLSelectElement;
      expect(select.value).toBe('');
    });

    it('should have correct option values', () => {
      renderGenderField({});
      const select = screen.getByRole('combobox', { name: /gender/i });
      const options = select.querySelectorAll('option');

      expect(options[0]).toHaveValue('');
      expect(options[1]).toHaveValue('male');
      expect(options[2]).toHaveValue('female');
      expect(options[3]).toHaveValue('other');
      expect(options[4]).toHaveValue('prefer_not_to_say');
    });
  });

  describe('Value Changes', () => {
    it('should update value when option is selected', async () => {
      const user = userEvent.setup();
      renderGenderField({});

      const select = screen.getByRole('combobox', { name: /gender/i }) as HTMLSelectElement;

      await user.selectOptions(select, 'male');
      expect(select.value).toBe('male');

      await user.selectOptions(select, 'female');
      expect(select.value).toBe('female');
    });

    it('should show custom input field when "Other" is selected in modal mode', async () => {
      const user = userEvent.setup();
      renderGenderField({ isModal: true });

      const select = screen.getByRole('combobox', { name: /gender/i });

      // Initially no custom input
      expect(screen.queryByPlaceholderText('Please specify')).not.toBeInTheDocument();

      // Select "Other"
      await user.selectOptions(select, 'other');

      // Custom input should appear
      expect(screen.getByPlaceholderText('Please specify')).toBeInTheDocument();
    });

    it('should not show custom input field when "Other" is selected in non-modal mode', async () => {
      const user = userEvent.setup();
      renderGenderField({ isModal: false });

      const select = screen.getByRole('combobox', { name: /gender/i });

      await user.selectOptions(select, 'other');

      // Custom input should NOT appear in non-modal mode
      expect(screen.queryByPlaceholderText('Please specify')).not.toBeInTheDocument();
    });

    it('should allow typing custom gender in modal mode', async () => {
      const user = userEvent.setup();
      renderGenderField({ isModal: true });

      const select = screen.getByRole('combobox', { name: /gender/i });
      await user.selectOptions(select, 'other');

      const customInput = screen.getByPlaceholderText('Please specify') as HTMLInputElement;
      // The input should be present and editable
      expect(customInput).toBeInTheDocument();
      expect(customInput).toHaveAttribute('type', 'text');

      // Simulate a change event directly since the component uses controlled input with custom handler
      await user.type(customInput, 'N');
      expect(customInput.value).toContain('N');
    });

    it('should hide custom input when selecting option other than "Other"', async () => {
      const user = userEvent.setup();
      renderGenderField({ isModal: true });

      const select = screen.getByRole('combobox', { name: /gender/i });

      // Select "Other" first
      await user.selectOptions(select, 'other');
      expect(screen.getByPlaceholderText('Please specify')).toBeInTheDocument();

      // Change to "Male"
      await user.selectOptions(select, 'male');
      expect(screen.queryByPlaceholderText('Please specify')).not.toBeInTheDocument();
    });
  });

  describe('Error Display', () => {
    it('should display error message when error exists', () => {
      renderGenderField({
        errors: { gender: { message: 'Gender is required' } }
      });

      expect(screen.getByText('Gender is required')).toBeInTheDocument();
      expect(screen.getByText('Gender is required')).toHaveClass('text-red-600');
    });

    it('should not display error message when no error', () => {
      renderGenderField({});

      const errorMessage = screen.queryByText(/is required/i);
      expect(errorMessage).not.toBeInTheDocument();
    });

    it('should display default error message when error message is undefined', () => {
      renderGenderField({
        errors: { gender: { message: '' } }
      });

      expect(screen.getByText('Invalid value')).toBeInTheDocument();
    });
  });

  describe('Required Asterisk Display', () => {
    it('should display asterisk when showRequiredAsterisk is true', () => {
      renderGenderField({ showRequiredAsterisk: true });

      const label = screen.getByText(/Gender/);
      expect(label.textContent).toContain('*');
    });

    it('should not display asterisk when showRequiredAsterisk is false', () => {
      renderGenderField({ showRequiredAsterisk: false });

      const label = screen.getByText('Gender');
      expect(label.textContent).not.toMatch(/\*/);
    });
  });

  describe('Modal vs Non-Modal Styling', () => {
    it('should apply modal-specific styles when isModal is true', () => {
      renderGenderField({ isModal: true });

      const select = screen.getByRole('combobox', { name: /gender/i });
      expect(select).toHaveClass('border-gray-300');
      expect(select).toHaveClass('focus:ring-blue-500');
      expect(select).toHaveClass('text-gray-900');
    });

    it('should apply non-modal styles when isModal is false', () => {
      renderGenderField({ isModal: false });

      const select = screen.getByRole('combobox', { name: /gender/i });
      expect(select).toHaveClass('focus:ring-primary-500');
      expect(select).toHaveClass('focus:border-primary-500');
    });
  });
});

describe('OccupationField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      const { container } = renderOccupationField({});
      expect(container).toBeTruthy();
    });

    it('should display the occupation label', () => {
      renderOccupationField({});
      expect(screen.getByText('Occupation')).toBeInTheDocument();
    });

    it('should render occupation select dropdown', () => {
      renderOccupationField({});
      const select = screen.getByRole('combobox', { name: /occupation/i });
      expect(select).toBeInTheDocument();
      expect(select).toHaveAttribute('id', 'occupation');
    });

    it('should display briefcase icon in label', () => {
      renderOccupationField({});
      // Icon is always shown in label for occupation field
      const icons = screen.getAllByTestId('icon-briefcase');
      expect(icons.length).toBeGreaterThan(0);
    });

    it('should display briefcase icon in input area for non-modal mode', () => {
      renderOccupationField({ isModal: false });
      const icons = screen.getAllByTestId('icon-briefcase');
      // Should have both label icon and input area icon
      expect(icons.length).toBe(2);
    });

    it('should not display icon in input area for modal mode', () => {
      renderOccupationField({ isModal: true });
      const icons = screen.getAllByTestId('icon-briefcase');
      // Should only have label icon, not input area icon
      expect(icons.length).toBe(1);
    });
  });

  describe('Occupation Options Display', () => {
    it('should display all occupation options', () => {
      renderOccupationField({});

      expect(screen.getByText('Select occupation')).toBeInTheDocument();
      expect(screen.getByText('Student')).toBeInTheDocument();
      expect(screen.getByText('Business Owner')).toBeInTheDocument();
      expect(screen.getByText('Employee')).toBeInTheDocument();
      expect(screen.getByText('Freelancer')).toBeInTheDocument();
      expect(screen.getByText('Consultant')).toBeInTheDocument();
      expect(screen.getByText('Teacher')).toBeInTheDocument();
      expect(screen.getByText('Healthcare')).toBeInTheDocument();
      expect(screen.getByText('Engineer')).toBeInTheDocument();
      expect(screen.getByText('Artist')).toBeInTheDocument();
      expect(screen.getByText('Sales')).toBeInTheDocument();
      expect(screen.getByText('Manager')).toBeInTheDocument();
      expect(screen.getByText('Retired')).toBeInTheDocument();
      expect(screen.getByText('Other')).toBeInTheDocument();
    });

    it('should have empty value as default option', () => {
      renderOccupationField({});
      const select = screen.getByRole('combobox', { name: /occupation/i }) as HTMLSelectElement;
      expect(select.value).toBe('');
    });

    it('should have correct option values', () => {
      renderOccupationField({});
      const select = screen.getByRole('combobox', { name: /occupation/i });
      const options = select.querySelectorAll('option');

      expect(options[0]).toHaveValue('');
      expect(options[1]).toHaveValue('student');
      expect(options[2]).toHaveValue('business_owner');
      expect(options[3]).toHaveValue('employee');
      expect(options[4]).toHaveValue('freelancer');
      expect(options[5]).toHaveValue('consultant');
      expect(options[6]).toHaveValue('teacher');
      expect(options[7]).toHaveValue('healthcare');
      expect(options[8]).toHaveValue('engineer');
      expect(options[9]).toHaveValue('artist');
      expect(options[10]).toHaveValue('sales');
      expect(options[11]).toHaveValue('manager');
      expect(options[12]).toHaveValue('retired');
      expect(options[13]).toHaveValue('other');
    });

    it('should have 14 total options (including placeholder)', () => {
      renderOccupationField({});
      const select = screen.getByRole('combobox', { name: /occupation/i });
      const options = select.querySelectorAll('option');
      expect(options).toHaveLength(14);
    });
  });

  describe('Value Changes', () => {
    it('should update value when option is selected', async () => {
      const user = userEvent.setup();
      renderOccupationField({});

      const select = screen.getByRole('combobox', { name: /occupation/i }) as HTMLSelectElement;

      await user.selectOptions(select, 'student');
      expect(select.value).toBe('student');

      await user.selectOptions(select, 'engineer');
      expect(select.value).toBe('engineer');
    });

    it('should allow selecting all occupation options', async () => {
      const user = userEvent.setup();
      renderOccupationField({});

      const select = screen.getByRole('combobox', { name: /occupation/i }) as HTMLSelectElement;
      const occupationValues = [
        'student', 'business_owner', 'employee', 'freelancer', 'consultant',
        'teacher', 'healthcare', 'engineer', 'artist', 'sales', 'manager', 'retired', 'other'
      ];

      for (const value of occupationValues) {
        await user.selectOptions(select, value);
        expect(select.value).toBe(value);
      }
    });
  });

  describe('Error Display', () => {
    it('should display error message when error exists', () => {
      renderOccupationField({
        errors: { occupation: { message: 'Occupation is required' } }
      });

      expect(screen.getByText('Occupation is required')).toBeInTheDocument();
      expect(screen.getByText('Occupation is required')).toHaveClass('text-red-600');
    });

    it('should not display error message when no error', () => {
      renderOccupationField({});

      const errorMessage = screen.queryByText(/is required/i);
      expect(errorMessage).not.toBeInTheDocument();
    });

    it('should display default error message when error message is undefined', () => {
      renderOccupationField({
        errors: { occupation: { message: '' } }
      });

      expect(screen.getByText('Invalid value')).toBeInTheDocument();
    });
  });

  describe('Required Asterisk Display', () => {
    it('should display asterisk when showRequiredAsterisk is true', () => {
      renderOccupationField({ showRequiredAsterisk: true });

      const label = screen.getByText(/Occupation/);
      expect(label.textContent).toContain('*');
    });

    it('should not display asterisk when showRequiredAsterisk is false', () => {
      renderOccupationField({ showRequiredAsterisk: false });

      const label = screen.getByText('Occupation');
      expect(label.textContent).not.toMatch(/\*/);
    });
  });

  describe('Modal vs Non-Modal Styling', () => {
    it('should apply modal-specific styles when isModal is true', () => {
      renderOccupationField({ isModal: true });

      const select = screen.getByRole('combobox', { name: /occupation/i });
      expect(select).toHaveClass('border-gray-300');
      expect(select).toHaveClass('focus:ring-blue-500');
      expect(select).toHaveClass('text-gray-900');
      expect(select).toHaveClass('bg-white');
    });

    it('should apply non-modal styles when isModal is false', () => {
      renderOccupationField({ isModal: false });

      const select = screen.getByRole('combobox', { name: /occupation/i });
      expect(select).toHaveClass('focus:ring-primary-500');
      expect(select).toHaveClass('focus:border-primary-500');
      expect(select).toHaveClass('pl-10'); // Space for icon
    });

    it('should have icon container in non-modal mode', () => {
      const { container } = renderOccupationField({ isModal: false });

      const iconContainer = container.querySelector('.absolute.inset-y-0.left-0');
      expect(iconContainer).toBeInTheDocument();
    });

    it('should not have icon container in modal mode', () => {
      const { container } = renderOccupationField({ isModal: true });

      const iconContainer = container.querySelector('.absolute.inset-y-0.left-0');
      expect(iconContainer).not.toBeInTheDocument();
    });
  });
});

describe('DateOfBirthField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      const { container } = renderDateOfBirthField({});
      expect(container).toBeTruthy();
    });

    it('should display the date of birth label', () => {
      renderDateOfBirthField({});
      expect(screen.getByText('Date of Birth')).toBeInTheDocument();
    });

    it('should render date input field', () => {
      renderDateOfBirthField({});
      const input = screen.getByLabelText(/date of birth/i);
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('id', 'dateOfBirth');
      expect(input).toHaveAttribute('type', 'date');
    });

    it('should display calendar icon in label', () => {
      renderDateOfBirthField({});
      const icons = screen.getAllByTestId('icon-calendar');
      expect(icons.length).toBeGreaterThan(0);
    });

    it('should display calendar icon in input area for non-modal mode', () => {
      renderDateOfBirthField({ isModal: false });
      const icons = screen.getAllByTestId('icon-calendar');
      // Should have both label icon and input area icon
      expect(icons.length).toBe(2);
    });

    it('should not display icon in input area for modal mode', () => {
      renderDateOfBirthField({ isModal: true });
      const icons = screen.getAllByTestId('icon-calendar');
      // Should only have label icon
      expect(icons.length).toBe(1);
    });
  });

  describe('Value Changes', () => {
    it('should update value when date is entered', async () => {
      const user = userEvent.setup();
      renderDateOfBirthField({});

      const input = screen.getByLabelText(/date of birth/i) as HTMLInputElement;

      await user.type(input, '1990-05-15');
      expect(input.value).toBe('1990-05-15');
    });

    it('should allow changing date value', async () => {
      const user = userEvent.setup();
      renderDateOfBirthField({});

      const input = screen.getByLabelText(/date of birth/i) as HTMLInputElement;

      await user.type(input, '1990-05-15');
      expect(input.value).toBe('1990-05-15');

      await user.clear(input);
      await user.type(input, '1985-12-25');
      expect(input.value).toBe('1985-12-25');
    });

    it('should accept valid date formats', async () => {
      const user = userEvent.setup();
      renderDateOfBirthField({});

      const input = screen.getByLabelText(/date of birth/i) as HTMLInputElement;

      // Test various valid dates
      const validDates = ['2000-01-01', '1995-06-15', '1980-12-31'];

      for (const date of validDates) {
        await user.clear(input);
        await user.type(input, date);
        expect(input.value).toBe(date);
      }
    });
  });

  describe('Error Display', () => {
    it('should display error message when error exists', () => {
      renderDateOfBirthField({
        errors: { dateOfBirth: { message: 'Date of birth is required' } }
      });

      expect(screen.getByText('Date of birth is required')).toBeInTheDocument();
      expect(screen.getByText('Date of birth is required')).toHaveClass('text-red-600');
    });

    it('should not display error message when no error', () => {
      renderDateOfBirthField({});

      const errorMessage = screen.queryByText(/is required/i);
      expect(errorMessage).not.toBeInTheDocument();
    });

    it('should display default error message when error message is undefined', () => {
      renderDateOfBirthField({
        errors: { dateOfBirth: { message: '' } }
      });

      expect(screen.getByText('Invalid value')).toBeInTheDocument();
    });

    it('should display validation error for invalid date', () => {
      renderDateOfBirthField({
        errors: { dateOfBirth: { message: 'Please enter a valid date' } }
      });

      expect(screen.getByText('Please enter a valid date')).toBeInTheDocument();
    });
  });

  describe('Required Asterisk Display', () => {
    it('should display asterisk when showRequiredAsterisk is true', () => {
      renderDateOfBirthField({ showRequiredAsterisk: true });

      const label = screen.getByText(/Date of Birth/);
      expect(label.textContent).toContain('*');
    });

    it('should not display asterisk when showRequiredAsterisk is false', () => {
      renderDateOfBirthField({ showRequiredAsterisk: false });

      const label = screen.getByText('Date of Birth');
      expect(label.textContent).not.toMatch(/\*/);
    });
  });

  describe('Modal vs Non-Modal Styling', () => {
    it('should apply modal-specific styles when isModal is true', () => {
      renderDateOfBirthField({ isModal: true });

      const input = screen.getByLabelText(/date of birth/i);
      expect(input).toHaveClass('border-gray-300');
      expect(input).toHaveClass('focus:ring-blue-500');
      expect(input).toHaveClass('text-gray-900');
    });

    it('should apply non-modal styles when isModal is false', () => {
      renderDateOfBirthField({ isModal: false });

      const input = screen.getByLabelText(/date of birth/i);
      expect(input).toHaveClass('focus:ring-primary-500');
      expect(input).toHaveClass('focus:border-primary-500');
      expect(input).toHaveClass('pl-10'); // Space for icon
    });

    it('should have icon container in non-modal mode', () => {
      const { container } = renderDateOfBirthField({ isModal: false });

      const iconContainer = container.querySelector('.absolute.inset-y-0.left-0');
      expect(iconContainer).toBeInTheDocument();
    });

    it('should not have icon container in modal mode', () => {
      const { container } = renderDateOfBirthField({ isModal: true });

      const iconContainer = container.querySelector('.absolute.inset-y-0.left-0');
      expect(iconContainer).not.toBeInTheDocument();
    });

    it('should have light color scheme for date picker', () => {
      renderDateOfBirthField({});

      const input = screen.getByLabelText(/date of birth/i);
      expect(input).toHaveStyle({ colorScheme: 'light' });
    });
  });

  describe('Accessibility', () => {
    it('should have proper input type for date', () => {
      renderDateOfBirthField({});

      const input = screen.getByLabelText(/date of birth/i);
      expect(input).toHaveAttribute('type', 'date');
    });

    it('should have correct id for label association', () => {
      renderDateOfBirthField({});

      const label = screen.getByText(/Date of Birth/).closest('label');
      const input = screen.getByLabelText(/date of birth/i);

      expect(label).toHaveAttribute('for', 'dateOfBirth');
      expect(input).toHaveAttribute('id', 'dateOfBirth');
    });
  });
});

describe('Null Field Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GenderField Null Handling', () => {
    it('should render with empty value when gender is null/undefined', () => {
      renderGenderField({});

      const select = screen.getByRole('combobox', { name: /gender/i }) as HTMLSelectElement;
      // Default value should be empty string (placeholder option)
      expect(select.value).toBe('');
    });

    it('should not crash when errors object has null gender error', () => {
      renderGenderField({
        errors: { gender: null as any }
      });

      // Should render without crashing
      const select = screen.getByRole('combobox', { name: /gender/i });
      expect(select).toBeInTheDocument();
    });

    it('should handle gender field with custom "other" option', async () => {
      const user = userEvent.setup();
      renderGenderField({ isModal: true });

      const select = screen.getByRole('combobox', { name: /gender/i });

      // Select "Other" option
      await user.selectOptions(select, 'other');

      // Custom input should appear
      const customInput = screen.getByPlaceholderText('Please specify');
      expect(customInput).toBeInTheDocument();
      expect(customInput).toHaveValue('');
    });

    it('should display placeholder option as default', () => {
      renderGenderField({});

      const placeholderOption = screen.getByText('Select gender');
      expect(placeholderOption).toBeInTheDocument();
      expect(placeholderOption).toHaveValue('');
    });
  });

  describe('OccupationField Null Handling', () => {
    it('should render with empty value when occupation is null/undefined', () => {
      renderOccupationField({});

      const select = screen.getByRole('combobox', { name: /occupation/i }) as HTMLSelectElement;
      // Default value should be empty string (placeholder option)
      expect(select.value).toBe('');
    });

    it('should not crash when errors object has null occupation error', () => {
      renderOccupationField({
        errors: { occupation: null as any }
      });

      // Should render without crashing
      const select = screen.getByRole('combobox', { name: /occupation/i });
      expect(select).toBeInTheDocument();
    });

    it('should display placeholder option as default', () => {
      renderOccupationField({});

      const placeholderOption = screen.getByText('Select occupation');
      expect(placeholderOption).toBeInTheDocument();
      expect(placeholderOption).toHaveValue('');
    });

    it('should handle selecting "other" occupation option', async () => {
      const user = userEvent.setup();
      renderOccupationField({});

      const select = screen.getByRole('combobox', { name: /occupation/i }) as HTMLSelectElement;

      // Select "Other" option
      await user.selectOptions(select, 'other');
      expect(select.value).toBe('other');
    });
  });

  describe('DateOfBirthField Null Handling', () => {
    it('should render with empty value when dateOfBirth is null/undefined', () => {
      renderDateOfBirthField({});

      const input = screen.getByLabelText(/date of birth/i) as HTMLInputElement;
      // Default value should be empty
      expect(input.value).toBe('');
    });

    it('should not crash when errors object has null dateOfBirth error', () => {
      renderDateOfBirthField({
        errors: { dateOfBirth: null as any }
      });

      // Should render without crashing
      const input = screen.getByLabelText(/date of birth/i);
      expect(input).toBeInTheDocument();
    });

    it('should accept empty string as valid initial value', () => {
      renderDateOfBirthField({});

      const input = screen.getByLabelText(/date of birth/i) as HTMLInputElement;
      expect(input.value).toBe('');
      // Input should still be functional
      expect(input).toBeEnabled();
    });
  });

  describe('All Fields - Minimal Props', () => {
    it('should render GenderField without crashing with minimal props', () => {
      const { container } = renderGenderField({});

      expect(container).toBeTruthy();
      expect(screen.getByText('Gender')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /gender/i })).toBeInTheDocument();
    });

    it('should render OccupationField without crashing with minimal props', () => {
      const { container } = renderOccupationField({});

      expect(container).toBeTruthy();
      expect(screen.getByText('Occupation')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /occupation/i })).toBeInTheDocument();
    });

    it('should render DateOfBirthField without crashing with minimal props', () => {
      const { container } = renderDateOfBirthField({});

      expect(container).toBeTruthy();
      expect(screen.getByText('Date of Birth')).toBeInTheDocument();
      expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { InterestsField } from '../ProfileFormFields';

// Mock i18next with actual translation keys from interestUtils.ts
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'profile.interests': 'Interests',
        'profile.selectInterestsHelp': 'Select all interests that match your preferences',
        'profile.selectedInterests': 'Selected',
        // Actual interest options from INTEREST_KEY_MAP
        'profile.interestOptions.travel_adventure': 'Travel & Adventure',
        'profile.interestOptions.food_dining': 'Food & Dining',
        'profile.interestOptions.health_fitness': 'Health & Fitness',
        'profile.interestOptions.technology': 'Technology',
        'profile.interestOptions.reading_books': 'Reading & Books',
        'profile.interestOptions.music_entertainment': 'Music & Entertainment',
        'profile.interestOptions.sports_recreation': 'Sports & Recreation',
        'profile.interestOptions.art_culture': 'Art & Culture',
        'profile.interestOptions.photography': 'Photography',
        'profile.interestOptions.nature_outdoors': 'Nature & Outdoors',
        'profile.interestOptions.fashion_beauty': 'Fashion & Beauty',
        'profile.interestOptions.business_finance': 'Business & Finance',
        'profile.interestOptions.education_learning': 'Education & Learning',
        'profile.interestOptions.family_relationships': 'Family & Relationships',
        'profile.interestOptions.gaming': 'Gaming',
        'profile.interestOptions.cooking_baking': 'Cooking & Baking',
        'profile.interestOptions.movies_tv': 'Movies & TV',
        'profile.interestOptions.volunteering': 'Volunteering',
        'profile.interestOptions.shopping': 'Shopping',
        'profile.interestOptions.home_garden': 'Home & Garden',
      };
      return translations[key] || key;
    },
  }),
}));

// Helper to render InterestsField with form context
function renderInterestsField(props: {
  watchedValue?: string;
  isModal?: boolean;
}) {
  const TestComponent = () => {
    const { register, formState: { errors } } = useForm();
    return (
      <InterestsField
        register={register}
        errors={errors}
        isModal={props.isModal ?? false}
        watchedValue={props.watchedValue}
      />
    );
  };

  return render(<TestComponent />);
}

// Helper component that simulates watchedValue prop changes
function InterestsFieldWithWatch({ initialValue }: { initialValue: string }) {
  const { register, formState: { errors } } = useForm({
    defaultValues: { interests: initialValue }
  });

  return (
    <InterestsField
      register={register}
      errors={errors}
      isModal={false}
      watchedValue={initialValue}
    />
  );
}

describe('InterestsField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      const { container } = renderInterestsField({});
      expect(container).toBeTruthy();
    });

    it('should display the interests label', () => {
      renderInterestsField({});
      expect(screen.getByText('Interests')).toBeInTheDocument();
    });

    it('should display interest options as checkboxes', () => {
      renderInterestsField({});
      // Check for actual interest option text (translated names)
      expect(screen.getByText('Travel & Adventure')).toBeInTheDocument();
      expect(screen.getByText('Food & Dining')).toBeInTheDocument();
      expect(screen.getByText('Health & Fitness')).toBeInTheDocument();
    });

    it('should have all checkboxes unchecked by default', () => {
      renderInterestsField({});
      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(checkbox => {
        expect(checkbox).not.toBeChecked();
      });
    });
  });

  describe('watchedValue Sync - Critical Bug Prevention', () => {
    /**
     * This test catches the bug where InterestsField didn't sync with
     * react-hook-form's reset() because it relied on DOM events that
     * reset() doesn't trigger. The fix was to use watchedValue prop.
     */
    it('should check interests when watchedValue is provided', () => {
      // Use actual display names stored in database
      renderInterestsField({ watchedValue: 'Travel & Adventure, Food & Dining' });

      const travelCheckbox = screen.getByRole('checkbox', { name: /travel.*adventure/i });
      const foodCheckbox = screen.getByRole('checkbox', { name: /food.*dining/i });

      expect(travelCheckbox).toBeChecked();
      expect(foodCheckbox).toBeChecked();
    });

    it('should update selections when watchedValue changes (form reset scenario)', () => {
      // This test specifically catches the bug that was fixed
      const { rerender } = render(<InterestsFieldWithWatch initialValue="" />);

      // Initially no interests selected
      let travelCheckbox = screen.getByRole('checkbox', { name: /travel.*adventure/i });
      expect(travelCheckbox).not.toBeChecked();

      // Simulate form reset with new value (this is what happens when modal opens with profile data)
      rerender(<InterestsFieldWithWatch initialValue="Travel & Adventure, Health & Fitness" />);

      // After "reset", interests should be selected
      travelCheckbox = screen.getByRole('checkbox', { name: /travel.*adventure/i });
      const fitnessCheckbox = screen.getByRole('checkbox', { name: /health.*fitness/i });

      expect(travelCheckbox).toBeChecked();
      expect(fitnessCheckbox).toBeChecked();
    });

    it('should clear selections when watchedValue becomes empty', () => {
      const { rerender } = render(
        <InterestsFieldWithWatch initialValue="Travel & Adventure, Food & Dining" />
      );

      // Initially interests are selected
      let travelCheckbox = screen.getByRole('checkbox', { name: /travel.*adventure/i });
      expect(travelCheckbox).toBeChecked();

      // Simulate clearing selections
      rerender(<InterestsFieldWithWatch initialValue="" />);

      // After clear, no interests should be selected
      travelCheckbox = screen.getByRole('checkbox', { name: /travel.*adventure/i });
      expect(travelCheckbox).not.toBeChecked();
    });

    it('should handle single interest in watchedValue', () => {
      renderInterestsField({ watchedValue: 'Technology' });

      const techCheckbox = screen.getByRole('checkbox', { name: /technology/i });
      expect(techCheckbox).toBeChecked();

      // Other checkboxes should not be checked
      const travelCheckbox = screen.getByRole('checkbox', { name: /travel.*adventure/i });
      expect(travelCheckbox).not.toBeChecked();
    });
  });

  describe('User Interaction', () => {
    it('should toggle interest when checkbox is clicked', async () => {
      const user = userEvent.setup();
      renderInterestsField({});

      const travelCheckbox = screen.getByRole('checkbox', { name: /travel.*adventure/i });
      expect(travelCheckbox).not.toBeChecked();

      await user.click(travelCheckbox);
      expect(travelCheckbox).toBeChecked();

      await user.click(travelCheckbox);
      expect(travelCheckbox).not.toBeChecked();
    });

    it('should allow multiple selections', async () => {
      const user = userEvent.setup();
      renderInterestsField({});

      const travelCheckbox = screen.getByRole('checkbox', { name: /travel.*adventure/i });
      const foodCheckbox = screen.getByRole('checkbox', { name: /food.*dining/i });
      const techCheckbox = screen.getByRole('checkbox', { name: /technology/i });

      await user.click(travelCheckbox);
      await user.click(foodCheckbox);
      await user.click(techCheckbox);

      expect(travelCheckbox).toBeChecked();
      expect(foodCheckbox).toBeChecked();
      expect(techCheckbox).toBeChecked();
    });

    it('should display selected count', async () => {
      const user = userEvent.setup();
      renderInterestsField({});

      const travelCheckbox = screen.getByRole('checkbox', { name: /travel.*adventure/i });
      const foodCheckbox = screen.getByRole('checkbox', { name: /food.*dining/i });

      await user.click(travelCheckbox);
      await user.click(foodCheckbox);

      expect(screen.getByText(/Selected.*\(2\)/)).toBeInTheDocument();
    });

    it('should remove interest when X button clicked in selected list', async () => {
      const user = userEvent.setup();
      renderInterestsField({ watchedValue: 'Travel & Adventure, Food & Dining' });

      // Find and click the X button for first selected item
      const removeButtons = screen.getAllByRole('button', { name: '×' });
      await user.click(removeButtons[0]);

      // First item (Travel) should now be unchecked
      const travelCheckbox = screen.getByRole('checkbox', { name: /travel.*adventure/i });
      expect(travelCheckbox).not.toBeChecked();
    });
  });

  describe('Edge Cases', () => {
    it('should handle watchedValue with trailing comma', () => {
      // Realistic edge case - trailing comma from string manipulation
      renderInterestsField({ watchedValue: 'Travel & Adventure, Food & Dining, ' });

      const travelCheckbox = screen.getByRole('checkbox', { name: /travel.*adventure/i });
      const foodCheckbox = screen.getByRole('checkbox', { name: /food.*dining/i });

      expect(travelCheckbox).toBeChecked();
      expect(foodCheckbox).toBeChecked();
    });

    it('should handle undefined watchedValue', () => {
      renderInterestsField({ watchedValue: undefined });

      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(checkbox => {
        expect(checkbox).not.toBeChecked();
      });
    });

    it('should handle empty string watchedValue', () => {
      renderInterestsField({ watchedValue: '' });

      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(checkbox => {
        expect(checkbox).not.toBeChecked();
      });
    });
  });
});

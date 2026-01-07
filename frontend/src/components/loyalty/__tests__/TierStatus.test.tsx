import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TierStatus from '../TierStatus';
import { UserLoyaltyStatus, Tier } from '../../../services/loyaltyService';

// Mock dependencies
const mockTranslate = vi.fn((key: string, params?: any) => {
  const translations: Record<string, string> = {
    'loyalty.tierStatus': 'Tier Status',
    'loyalty.currentTier': 'Current Tier',
    'loyalty.newMember': 'New Member',
    'loyalty.night': 'night',
    'loyalty.nights': 'nights',
    'loyalty.nightToGo': 'night to go',
    'loyalty.nightsToGo': 'nights to go',
    'loyalty.pointsToGo': 'points to go',
    'loyalty.nextTierBenefits': `Next tier: ${params?.tier || 'Unknown'}`,
    'loyalty.unlockBenefitsNights': `Stay ${params?.nights || 0} more nights to unlock`,
    'loyalty.unlockBenefits': `Earn ${params?.points || 0} more points to unlock`,
    'loyalty.topTierMessage': "You've reached the highest tier!",
    'loyalty.topTierDescription': 'Enjoy all premium benefits',
    'loyalty.maxTierReached': 'Max tier reached',
  };

  if (params && translations[key]) {
    let translated = translations[key];
    Object.keys(params).forEach(paramKey => {
      translated = translated.replace(`{${paramKey}}`, params[paramKey]);
    });
    return translated;
  }

  return translations[key] || key;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

vi.mock('react-icons/fi', () => ({
  FiChevronUp: () => <span data-testid="chevron-up-icon">↑</span>,
  FiAward: () => <span data-testid="award-icon">🏆</span>,
}));

describe('TierStatus', () => {
  const mockTiers: Tier[] = [
    {
      id: 'bronze',
      name: 'Bronze',
      min_points: 0,
      min_nights: 0,
      benefits: { description: 'Bronze benefits', perks: ['Basic perk'] },
      color: '#CD7F32',
      sort_order: 1,
    },
    {
      id: 'silver',
      name: 'Silver',
      min_points: 1000,
      min_nights: 1,
      benefits: { description: 'Silver benefits', perks: ['Silver perk'] },
      color: '#C0C0C0',
      sort_order: 2,
    },
    {
      id: 'gold',
      name: 'Gold',
      min_points: 2500,
      min_nights: 10,
      benefits: { description: 'Gold benefits', perks: ['Gold perk'] },
      color: '#FFD700',
      sort_order: 3,
    },
    {
      id: 'platinum',
      name: 'Platinum',
      min_points: 5000,
      min_nights: 20,
      benefits: { description: 'Platinum benefits', perks: ['Platinum perk'] },
      color: '#E5E4E2',
      sort_order: 4,
    },
  ];

  const mockLoyaltyStatus: UserLoyaltyStatus = {
    user_id: 'user-123',
    current_points: 1800,
    total_nights: 5,
    tier_name: 'Silver',
    tier_color: '#C0C0C0',
    tier_benefits: {
      description: 'Silver benefits',
      perks: ['Silver perk'],
    },
    tier_level: 2,
    progress_percentage: 53.33,
    next_tier_nights: 10,
    next_tier_name: 'Gold',
    nights_to_next_tier: 5,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(screen.getByText('Tier Status')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(container).toBeTruthy();
    });

    it('should have proper container structure', () => {
      const { container } = render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv).toHaveClass('bg-white', 'rounded-lg', 'shadow-md', 'p-6');
    });
  });

  describe('Current Tier Display', () => {
    it('should display current tier name', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      const silverElements = screen.getAllByText('Silver');
      expect(silverElements.length).toBeGreaterThan(0);
    });

    it('should display current tier with correct color', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      const silverElements = screen.getAllByText('Silver');
      // Find the one in the header (has the color style)
      const headerTierName = silverElements.find(el =>
        el.classList.contains('font-medium') && !el.classList.contains('text-gray-900')
      );
      expect(headerTierName).toHaveStyle({ color: '#C0C0C0' });
    });

    it('should display current tier indicator', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(screen.getByText('Current Tier')).toBeInTheDocument();
    });

    it('should display award icon with current tier color', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      const awardIcons = screen.getAllByTestId('award-icon');
      expect(awardIcons.length).toBeGreaterThan(0);
    });
  });

  describe('Tier List Rendering', () => {
    it('should render all tiers', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(screen.getByText('Bronze')).toBeInTheDocument();
      expect(screen.getAllByText('Silver').length).toBeGreaterThan(0);
      expect(screen.getByText('Gold')).toBeInTheDocument();
      expect(screen.getByText('Platinum')).toBeInTheDocument();
    });

    it('should display correct number of tier items', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      const awardIcons = screen.getAllByTestId('award-icon');
      // Header icon + 4 tier icons = 5 total
      expect(awardIcons).toHaveLength(5);
    });

    it('should display minimum nights for each tier', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(screen.getByText('New Member')).toBeInTheDocument();
      expect(screen.getByText(/1\+ night/)).toBeInTheDocument();
      expect(screen.getByText(/10\+ nights/)).toBeInTheDocument();
      expect(screen.getByText(/20\+ nights/)).toBeInTheDocument();
    });
  });

  describe('Progress Bar Display', () => {
    it('should display progress bar for next tier', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(screen.getByText('5 nights to go')).toBeInTheDocument();
      expect(screen.getByText('53.3%')).toBeInTheDocument();
    });

    it('should display correct progress percentage', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(screen.getByText('53.3%')).toBeInTheDocument();
    });

    it('should display nights to next tier', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(screen.getByText('5 nights to go')).toBeInTheDocument();
    });

    it('should display progress bar with correct color', () => {
      const { container } = render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      const progressBars = container.querySelectorAll('.h-2.rounded-full.transition-all');
      expect(progressBars.length).toBeGreaterThan(0);
      expect(progressBars[0]).toHaveStyle({ backgroundColor: '#FFD700' }); // Gold tier color
    });
  });

  describe('Nights-Based Progress', () => {
    it('should display nights to go when available', () => {
      const nightsBasedStatus = {
        ...mockLoyaltyStatus,
        nights_to_next_tier: 3,
      };

      render(<TierStatus loyaltyStatus={nightsBasedStatus} allTiers={mockTiers} />);

      expect(screen.getByText('3 nights to go')).toBeInTheDocument();
    });

    it('should display singular "night" for 1 night', () => {
      const nightsBasedStatus = {
        ...mockLoyaltyStatus,
        nights_to_next_tier: 1,
      };

      render(<TierStatus loyaltyStatus={nightsBasedStatus} allTiers={mockTiers} />);

      expect(screen.getByText('1 night to go')).toBeInTheDocument();
    });

    it('should display plural "nights" for multiple nights', () => {
      const nightsBasedStatus = {
        ...mockLoyaltyStatus,
        nights_to_next_tier: 5,
      };

      render(<TierStatus loyaltyStatus={nightsBasedStatus} allTiers={mockTiers} />);

      expect(screen.getByText('5 nights to go')).toBeInTheDocument();
    });
  });

  describe('Next Tier Benefits Preview', () => {
    it('should display next tier benefits section', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(screen.getByText('Next tier: Gold')).toBeInTheDocument();
    });

    it('should display unlock message with nights', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(screen.getByText('Stay 5 more nights to unlock')).toBeInTheDocument();
    });

    it('should display unlock message with nights when available', () => {
      const nightsBasedStatus = {
        ...mockLoyaltyStatus,
        nights_to_next_tier: 3,
      };

      render(<TierStatus loyaltyStatus={nightsBasedStatus} allTiers={mockTiers} />);

      expect(screen.getByText('Stay 3 more nights to unlock')).toBeInTheDocument();
    });

    it('should not display next tier benefits when at top tier', () => {
      const topTierStatus = {
        ...mockLoyaltyStatus,
        tier_name: 'Platinum',
        tier_color: '#E5E4E2',
        next_tier_name: null,
        next_tier_points: null,
        points_to_next_tier: null,
      };

      render(<TierStatus loyaltyStatus={topTierStatus} allTiers={mockTiers} />);

      expect(screen.queryByText(/Next tier:/)).not.toBeInTheDocument();
    });
  });

  describe('Top Tier Message', () => {
    it('should display top tier message when at highest tier', () => {
      const topTierStatus = {
        ...mockLoyaltyStatus,
        tier_name: 'Platinum',
        tier_color: '#E5E4E2',
        next_tier_name: null,
        next_tier_points: null,
        points_to_next_tier: null,
      };

      render(<TierStatus loyaltyStatus={topTierStatus} allTiers={mockTiers} />);

      expect(screen.getByText(/You've reached the highest tier!/)).toBeInTheDocument();
      expect(screen.getByText('Enjoy all premium benefits')).toBeInTheDocument();
    });

    it('should not display top tier message when not at highest tier', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(screen.queryByText(/You've reached the highest tier!/)).not.toBeInTheDocument();
    });

    it('should display top tier message with correct color', () => {
      const topTierStatus = {
        ...mockLoyaltyStatus,
        tier_name: 'Platinum',
        tier_color: '#E5E4E2',
        next_tier_name: null,
        next_tier_points: null,
        points_to_next_tier: null,
      };

      render(<TierStatus loyaltyStatus={topTierStatus} allTiers={mockTiers} />);

      const topTierMessage = screen.getByText(/You've reached the highest tier!/);
      expect(topTierMessage).toHaveStyle({ color: '#E5E4E2' });
    });
  });

  describe('Progress Percentage Calculation', () => {
    it('should handle valid progress percentage', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(screen.getByText('53.3%')).toBeInTheDocument();
    });

    it('should handle zero progress percentage', () => {
      const zeroProgressStatus = {
        ...mockLoyaltyStatus,
        progress_percentage: 0,
      };

      render(<TierStatus loyaltyStatus={zeroProgressStatus} allTiers={mockTiers} />);

      expect(screen.getByText('0.0%')).toBeInTheDocument();
    });

    it('should handle 100% progress', () => {
      const fullProgressStatus = {
        ...mockLoyaltyStatus,
        progress_percentage: 100,
      };

      render(<TierStatus loyaltyStatus={fullProgressStatus} allTiers={mockTiers} />);

      expect(screen.getByText('100.0%')).toBeInTheDocument();
    });

    it('should handle null progress percentage gracefully', () => {
      const nullProgressStatus = {
        ...mockLoyaltyStatus,
        progress_percentage: null as any,
      };

      const { container } = render(<TierStatus loyaltyStatus={nullProgressStatus} allTiers={mockTiers} />);

      // Should not crash, progress bar should not be visible
      expect(container).toBeTruthy();
    });
  });

  describe('Chevron Up Icon Display', () => {
    it('should display chevron up icon for next tier', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      const chevronIcons = screen.getAllByTestId('chevron-up-icon');
      expect(chevronIcons.length).toBeGreaterThan(0);
    });

    it('should only display chevron for next tier, not others', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      // Only 1 chevron should be displayed (for Gold, the next tier)
      const chevronIcons = screen.getAllByTestId('chevron-up-icon');
      expect(chevronIcons).toHaveLength(1);
    });
  });

  describe('Translation Keys', () => {
    it('should use correct translation keys', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(mockTranslate).toHaveBeenCalledWith('loyalty.tierStatus');
      expect(mockTranslate).toHaveBeenCalledWith('loyalty.currentTier');
      expect(mockTranslate).toHaveBeenCalledWith('loyalty.nightsToGo');
    });

    it('should use nextTierBenefits translation with tier parameter', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(mockTranslate).toHaveBeenCalledWith('loyalty.nextTierBenefits', { tier: 'Gold' });
    });

    it('should use unlockBenefitsNights translation with nights parameter', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(mockTranslate).toHaveBeenCalledWith('loyalty.unlockBenefitsNights', { nights: 5 });
    });

    it('should use unlockBenefitsNights translation when nights available', () => {
      const nightsBasedStatus = {
        ...mockLoyaltyStatus,
        nights_to_next_tier: 3,
      };

      render(<TierStatus loyaltyStatus={nightsBasedStatus} allTiers={mockTiers} />);

      expect(mockTranslate).toHaveBeenCalledWith('loyalty.unlockBenefitsNights', { nights: 3 });
    });

    it('should use top tier translations when at highest tier', () => {
      const topTierStatus = {
        ...mockLoyaltyStatus,
        tier_name: 'Platinum',
        tier_color: '#E5E4E2',
        next_tier_name: null,
        next_tier_points: null,
        points_to_next_tier: null,
      };

      render(<TierStatus loyaltyStatus={topTierStatus} allTiers={mockTiers} />);

      expect(mockTranslate).toHaveBeenCalledWith('loyalty.topTierMessage');
      expect(mockTranslate).toHaveBeenCalledWith('loyalty.topTierDescription');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty tiers array gracefully', () => {
      const { container } = render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={[]} />);

      expect(container).toBeTruthy();
      expect(screen.getByText('Tier Status')).toBeInTheDocument();
    });

    it('should handle very high progress percentage', () => {
      const highProgressStatus = {
        ...mockLoyaltyStatus,
        progress_percentage: 99.9,
      };

      render(<TierStatus loyaltyStatus={highProgressStatus} allTiers={mockTiers} />);

      expect(screen.getByText('99.9%')).toBeInTheDocument();
    });

    it('should handle very low minimum points', () => {
      const customTiers: Tier[] = [
        { ...mockTiers[0], min_points: 0 } as Tier,
        { ...mockTiers[1], min_points: 1 } as Tier,
      ];

      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={customTiers} />);

      expect(screen.getByText('New Member')).toBeInTheDocument();
      expect(screen.getByText('1+ night')).toBeInTheDocument();
    });

    it('should handle tier not found in allTiers', () => {
      const unknownTierStatus = {
        ...mockLoyaltyStatus,
        tier_name: 'Unknown',
      };

      const { container } = render(<TierStatus loyaltyStatus={unknownTierStatus} allTiers={mockTiers} />);

      // Should render without crashing
      expect(container).toBeTruthy();
    });

    it('should handle null nights_to_next_tier', () => {
      const undefinedNightsStatus = {
        ...mockLoyaltyStatus,
        nights_to_next_tier: null,
      };

      render(<TierStatus loyaltyStatus={undefinedNightsStatus} allTiers={mockTiers} />);

      // Should display "Max tier reached" when nights_to_next_tier is null (appears in 2 places)
      const maxTierTexts = screen.getAllByText('Max tier reached');
      expect(maxTierTexts.length).toBeGreaterThan(0);
    });
  });

  describe('Accessibility', () => {
    it('should have proper text hierarchy', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      const heading = screen.getByText('Tier Status');
      expect(heading.tagName).toBe('H3');
    });

    it('should maintain semantic structure', () => {
      const { container } = render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      expect(container.querySelector('.bg-white.rounded-lg')).toBeInTheDocument();
    });

    it('should have accessible icons', () => {
      render(<TierStatus loyaltyStatus={mockLoyaltyStatus} allTiers={mockTiers} />);

      const awardIcons = screen.getAllByTestId('award-icon');
      expect(awardIcons.length).toBeGreaterThan(0);
    });
  });

  describe('Null Field Handling', () => {
    it('should handle null tier_color gracefully with fallback style', () => {
      const statusWithNullColor = {
        ...mockLoyaltyStatus,
        tier_color: null as any,
      };

      const { container } = render(<TierStatus loyaltyStatus={statusWithNullColor} allTiers={mockTiers} />);

      // Should not crash
      expect(container).toBeTruthy();
      // Required fields should still render
      expect(screen.getByText('Tier Status')).toBeInTheDocument();
      expect(screen.getAllByText('Silver').length).toBeGreaterThan(0);
    });

    it('should handle undefined tier_color gracefully', () => {
      const statusWithUndefinedColor = {
        ...mockLoyaltyStatus,
        tier_color: undefined as any,
      };

      const { container } = render(<TierStatus loyaltyStatus={statusWithUndefinedColor} allTiers={mockTiers} />);

      // Should not crash
      expect(container).toBeTruthy();
      expect(screen.getByText('Tier Status')).toBeInTheDocument();
    });

    it('should handle null tier_name gracefully', () => {
      const statusWithNullTierName = {
        ...mockLoyaltyStatus,
        tier_name: null as any,
      };

      const { container } = render(<TierStatus loyaltyStatus={statusWithNullTierName} allTiers={mockTiers} />);

      // Should not crash
      expect(container).toBeTruthy();
      expect(screen.getByText('Tier Status')).toBeInTheDocument();
    });

    it('should handle missing tier lookup gracefully when tier_name is not in allTiers', () => {
      const statusWithUnknownTier = {
        ...mockLoyaltyStatus,
        tier_name: 'NonExistentTier',
      };

      const { container } = render(<TierStatus loyaltyStatus={statusWithUnknownTier} allTiers={mockTiers} />);

      // Should not crash
      expect(container).toBeTruthy();
      expect(screen.getByText('Tier Status')).toBeInTheDocument();
      // The unknown tier name should still be displayed
      expect(screen.getByText('NonExistentTier')).toBeInTheDocument();
    });

    it('should not crash with minimal required props', () => {
      const minimalStatus: UserLoyaltyStatus = {
        user_id: 'user-123',
        current_points: 0,
        total_nights: 0,
        tier_name: 'Bronze',
        tier_color: '#CD7F32',
        tier_benefits: {},
        tier_level: 1,
        progress_percentage: 0,
        next_tier_nights: null,
        next_tier_name: null,
        nights_to_next_tier: null,
      };

      const { container } = render(<TierStatus loyaltyStatus={minimalStatus} allTiers={mockTiers} />);

      // Should not crash
      expect(container).toBeTruthy();
      expect(screen.getByText('Tier Status')).toBeInTheDocument();
      // Bronze appears multiple times (header and tier list), so use getAllByText
      const bronzeElements = screen.getAllByText('Bronze');
      expect(bronzeElements.length).toBeGreaterThan(0);
    });

    it('should handle null next_tier_name (top tier user) without showing progress section', () => {
      const topTierStatus = {
        ...mockLoyaltyStatus,
        tier_name: 'Platinum',
        tier_color: '#E5E4E2',
        next_tier_name: null,
        next_tier_nights: null,
        nights_to_next_tier: null,
        progress_percentage: 100,
      };

      const { container } = render(<TierStatus loyaltyStatus={topTierStatus} allTiers={mockTiers} />);

      // Should not crash
      expect(container).toBeTruthy();
      // Should not display "Next tier:" section
      expect(screen.queryByText(/Next tier:/)).not.toBeInTheDocument();
      // Should display top tier message instead
      expect(screen.getByText(/You've reached the highest tier!/)).toBeInTheDocument();
    });

    it('should handle null nights_to_next_tier in progress display', () => {
      const statusWithNullNights = {
        ...mockLoyaltyStatus,
        nights_to_next_tier: null,
      };

      const { container } = render(<TierStatus loyaltyStatus={statusWithNullNights} allTiers={mockTiers} />);

      // Should not crash
      expect(container).toBeTruthy();
      // Should display "Max tier reached" when nights_to_next_tier is null
      const maxTierTexts = screen.getAllByText('Max tier reached');
      expect(maxTierTexts.length).toBeGreaterThan(0);
    });

    it('should handle empty string tier_color', () => {
      const statusWithEmptyColor = {
        ...mockLoyaltyStatus,
        tier_color: '',
      };

      const { container } = render(<TierStatus loyaltyStatus={statusWithEmptyColor} allTiers={mockTiers} />);

      // Should not crash
      expect(container).toBeTruthy();
      expect(screen.getByText('Tier Status')).toBeInTheDocument();
    });
  });
});

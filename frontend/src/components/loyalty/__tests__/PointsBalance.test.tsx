import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PointsBalance from '../PointsBalance';
import { UserLoyaltyStatus } from '../../../services/loyaltyService';

// Mock dependencies
const mockTranslate = vi.fn((key: string, params?: any) => {
  const translations: Record<string, string> = {
    'loyalty.pointsBalance': 'Points Balance',
    'loyalty.member': 'Member',
    'loyalty.availablePoints': 'Available Points',
    'loyalty.tierBenefits': 'Tier Benefits',
    'loyalty.noDescription': 'No tier description available',
    'loyalty.moreBenefits': 'more benefits',
  };

  if (params) {
    return translations[key]?.replace('{count}', params.count) || key;
  }

  return translations[key] || key;
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

vi.mock('react-icons/fi', () => ({
  FiStar: (props: any) => <span data-testid="tier-star-icon" {...props}>⭐</span>,
}));

describe('PointsBalance', () => {
  const mockLoyaltyStatus: UserLoyaltyStatus = {
    user_id: 'user-123',
    current_points: 1500,
    total_nights: 15,
    tier_name: 'Gold',
    tier_color: '#FFD700',
    tier_benefits: {
      description: 'Enjoy exclusive Gold tier benefits',
      perks: ['Free room upgrade', 'Late checkout', 'Welcome drink'],
    },
    tier_level: 2,
    progress_percentage: 75,
    next_tier_nights: 20,
    next_tier_name: 'Platinum',
    nights_to_next_tier: 5,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the component', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(screen.getByText('Points Balance')).toBeInTheDocument();
    });

    it('should render without crashing', () => {
      const { container } = render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(container).toBeTruthy();
    });

    it('should have proper container structure', () => {
      const { container } = render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv).toHaveClass('bg-white', 'rounded-lg', 'shadow-md', 'p-6', 'border-l-4');
    });
  });

  describe('Points Display', () => {
    it('should display current points', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(screen.getByText('1,500')).toBeInTheDocument();
    });

    it('should format large numbers with thousands separator', () => {
      const largePointsStatus = {
        ...mockLoyaltyStatus,
        current_points: 123456,
      };

      render(<PointsBalance loyaltyStatus={largePointsStatus} />);

      expect(screen.getByText('123,456')).toBeInTheDocument();
    });

    it('should display zero points', () => {
      const zeroPointsStatus = {
        ...mockLoyaltyStatus,
        current_points: 0,
      };

      render(<PointsBalance loyaltyStatus={zeroPointsStatus} />);

      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should display available points label', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(screen.getByText('Available Points')).toBeInTheDocument();
    });

    it('should format points with millions', () => {
      const millionPointsStatus = {
        ...mockLoyaltyStatus,
        current_points: 1234567,
      };

      render(<PointsBalance loyaltyStatus={millionPointsStatus} />);

      expect(screen.getByText('1,234,567')).toBeInTheDocument();
    });
  });

  describe('Tier Information', () => {
    it('should display tier name', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(screen.getByText('Gold Member')).toBeInTheDocument();
    });

    it('should display member label with tier name', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(screen.getByText('Gold Member')).toBeInTheDocument();
    });

    it('should display different tier names', () => {
      const platinumStatus = {
        ...mockLoyaltyStatus,
        tier_name: 'Platinum',
        tier_color: '#E5E4E2',
      };

      render(<PointsBalance loyaltyStatus={platinumStatus} />);

      expect(screen.getByText('Platinum Member')).toBeInTheDocument();
    });

    it('should apply tier color to border', () => {
      const { container } = render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv).toHaveStyle({ borderLeftColor: '#FFD700' });
    });

    it('should apply tier color to points display', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const pointsElement = screen.getByTestId('loyalty-points');
      expect(pointsElement).toHaveStyle({ color: '#FFD700' });
    });

    it('should apply tier color to star icon container background', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const starContainer = screen.getByTestId('star-icon-container');
      expect(starContainer).toHaveStyle({ backgroundColor: '#FFD70020' });
    });
  });

  describe('Icon Display', () => {
    it('should render star icon', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const starIcon = screen.getByTestId('tier-star-icon');
      expect(starIcon).toBeInTheDocument();
      expect(starIcon).toHaveStyle({ color: '#FFD700' });
    });

    it('should render star icon within styled container', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const starIcon = screen.getByTestId('tier-star-icon');
      expect(starIcon).toBeInTheDocument();

      const container = screen.getByTestId('star-icon-container');
      expect(container).toHaveClass('p-2', 'rounded-lg');
      expect(starIcon.parentElement).toBe(container);
    });
  });

  describe('Tier Benefits Display', () => {
    it('should display tier benefits section title', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(screen.getByText('Tier Benefits')).toBeInTheDocument();
    });

    it('should display tier benefits description', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(screen.getByText('Enjoy exclusive Gold tier benefits')).toBeInTheDocument();
    });

    it('should display no description message when description is null', () => {
      const noDescStatus = {
        ...mockLoyaltyStatus,
        tier_benefits: {
          description: null as any,
          perks: [],
        },
      };

      render(<PointsBalance loyaltyStatus={noDescStatus} />);

      expect(screen.getByText('No tier description available')).toBeInTheDocument();
    });

    it('should display no description message when description is undefined', () => {
      const noDescStatus = {
        ...mockLoyaltyStatus,
        tier_benefits: {
          description: undefined as any,
          perks: [],
        },
      };

      render(<PointsBalance loyaltyStatus={noDescStatus} />);

      expect(screen.getByText('No tier description available')).toBeInTheDocument();
    });
  });

  describe('Perks Display', () => {
    it('should display first two perks', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(screen.getByText('Free room upgrade')).toBeInTheDocument();
      expect(screen.getByText('Late checkout')).toBeInTheDocument();
    });

    it('should not display third perk directly', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(screen.queryByText('Welcome drink')).not.toBeInTheDocument();
    });

    it('should display "+X more benefits" when more than 2 perks', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(screen.getByText('+1 more benefits')).toBeInTheDocument();
    });

    it('should display correct count for multiple additional perks', () => {
      const manyPerksStatus = {
        ...mockLoyaltyStatus,
        tier_benefits: {
          description: 'Many perks',
          perks: ['Perk 1', 'Perk 2', 'Perk 3', 'Perk 4', 'Perk 5'],
        },
      };

      render(<PointsBalance loyaltyStatus={manyPerksStatus} />);

      expect(screen.getByText('+3 more benefits')).toBeInTheDocument();
    });

    it('should not display "+X more benefits" when exactly 2 perks', () => {
      const twoPerksStatus = {
        ...mockLoyaltyStatus,
        tier_benefits: {
          description: 'Two perks',
          perks: ['Perk 1', 'Perk 2'],
        },
      };

      render(<PointsBalance loyaltyStatus={twoPerksStatus} />);

      expect(screen.queryByText(/more benefits/)).not.toBeInTheDocument();
    });

    it('should display one perk when only one available', () => {
      const onePerkStatus = {
        ...mockLoyaltyStatus,
        tier_benefits: {
          description: 'One perk',
          perks: ['Single perk'],
        },
      };

      render(<PointsBalance loyaltyStatus={onePerkStatus} />);

      expect(screen.getByText('Single perk')).toBeInTheDocument();
      expect(screen.queryByText(/more benefits/)).not.toBeInTheDocument();
    });

    it('should not display perks section when perks array is empty', () => {
      const noPerksStatus = {
        ...mockLoyaltyStatus,
        tier_benefits: {
          description: 'No perks',
          perks: [],
        },
      };

      const { container } = render(<PointsBalance loyaltyStatus={noPerksStatus} />);

      const perksList = container.querySelector('ul');
      expect(perksList).not.toBeInTheDocument();
    });

    it('should not display perks section when perks is null', () => {
      const nullPerksStatus = {
        ...mockLoyaltyStatus,
        tier_benefits: {
          description: 'Null perks',
          perks: null as any,
        },
      };

      const { container } = render(<PointsBalance loyaltyStatus={nullPerksStatus} />);

      const perksList = container.querySelector('ul');
      expect(perksList).not.toBeInTheDocument();
    });

    it('should apply tier color to perk bullet points', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const bullet0 = screen.getByTestId('perk-bullet-0');
      const bullet1 = screen.getByTestId('perk-bullet-1');

      expect(bullet0).toHaveStyle({ backgroundColor: '#FFD700' });
      expect(bullet1).toHaveStyle({ backgroundColor: '#FFD700' });
    });
  });

  describe('Legacy Props', () => {
    it('should accept but not use expiringPoints prop', () => {
      render(
        <PointsBalance
          loyaltyStatus={mockLoyaltyStatus}
          expiringPoints={100}
        />
      );

      // Should not display expiring points
      expect(screen.queryByText('100')).not.toBeInTheDocument();
      expect(screen.queryByText(/expiring/i)).not.toBeInTheDocument();
    });

    it('should accept but not use nextExpiryDate prop', () => {
      render(
        <PointsBalance
          loyaltyStatus={mockLoyaltyStatus}
          nextExpiryDate="2024-12-31"
        />
      );

      // Should not display expiry date
      expect(screen.queryByText(/2024-12-31/)).not.toBeInTheDocument();
      expect(screen.queryByText(/expir/i)).not.toBeInTheDocument();
    });
  });

  describe('Translation Keys', () => {
    it('should use correct translation keys', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(mockTranslate).toHaveBeenCalledWith('loyalty.pointsBalance');
      expect(mockTranslate).toHaveBeenCalledWith('loyalty.member');
      expect(mockTranslate).toHaveBeenCalledWith('loyalty.availablePoints');
      expect(mockTranslate).toHaveBeenCalledWith('loyalty.tierBenefits');
    });

    it('should use noDescription translation when no description', () => {
      const noDescStatus = {
        ...mockLoyaltyStatus,
        tier_benefits: {
          description: undefined as any,
          perks: [],
        },
      };

      render(<PointsBalance loyaltyStatus={noDescStatus} />);

      expect(mockTranslate).toHaveBeenCalledWith('loyalty.noDescription');
    });

    it('should use moreBenefits translation when extra perks', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      expect(mockTranslate).toHaveBeenCalledWith('loyalty.moreBenefits');
    });
  });

  describe('Styling and Layout', () => {
    it('should have proper section divider', () => {
      const { container } = render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const divider = container.querySelector('.border-t.pt-4');
      expect(divider).toBeInTheDocument();
    });

    it('should have proper spacing between elements', () => {
      const { container } = render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv).toHaveClass('p-6');
    });

    it('should have shadow and rounded corners', () => {
      const { container } = render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv).toHaveClass('shadow-md', 'rounded-lg');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long tier names', () => {
      const longNameStatus = {
        ...mockLoyaltyStatus,
        tier_name: 'Very Long Tier Name That Should Still Display Properly',
      };

      render(<PointsBalance loyaltyStatus={longNameStatus} />);

      expect(screen.getByText(/Very Long Tier Name That Should Still Display Properly/)).toBeInTheDocument();
    });

    it('should handle very long descriptions', () => {
      const longDescStatus = {
        ...mockLoyaltyStatus,
        tier_benefits: {
          description: 'This is a very long description that goes on and on explaining all the wonderful benefits that come with this amazing tier membership level and all its perks',
          perks: [],
        },
      };

      render(<PointsBalance loyaltyStatus={longDescStatus} />);

      expect(screen.getByText(/This is a very long description/)).toBeInTheDocument();
    });

    it('should handle special characters in perk names', () => {
      const specialCharsStatus = {
        ...mockLoyaltyStatus,
        tier_benefits: {
          description: 'Benefits',
          perks: ['10% discount & free shipping', 'Priority access (24/7)'],
        },
      };

      render(<PointsBalance loyaltyStatus={specialCharsStatus} />);

      expect(screen.getByText('10% discount & free shipping')).toBeInTheDocument();
      expect(screen.getByText('Priority access (24/7)')).toBeInTheDocument();
    });

    it('should handle different tier colors', () => {
      const customColorStatus = {
        ...mockLoyaltyStatus,
        tier_color: '#FF0000',
      };

      const { container } = render(<PointsBalance loyaltyStatus={customColorStatus} />);

      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv).toHaveStyle({ borderLeftColor: '#FF0000' });
    });

    it('should handle null tier_benefits gracefully', () => {
      const nullBenefitsStatus = {
        ...mockLoyaltyStatus,
        tier_benefits: null as any,
      };

      const { container } = render(<PointsBalance loyaltyStatus={nullBenefitsStatus} />);

      // Should render the component without crashing
      expect(container).toBeTruthy();

      // Should still display points and tier info
      expect(screen.getByText('1,500')).toBeInTheDocument();
      expect(screen.getByText('Gold Member')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper text hierarchy', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const heading = screen.getByText('Points Balance');
      expect(heading.tagName).toBe('H3');
    });

    it('should have sufficient color contrast with tier colors', () => {
      render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const pointsElement = screen.getByText('1,500');
      expect(pointsElement).toHaveClass('text-3xl', 'font-bold');
    });

    it('should maintain semantic structure', () => {
      const { container } = render(<PointsBalance loyaltyStatus={mockLoyaltyStatus} />);

      const list = container.querySelector('ul');
      expect(list).toHaveClass('text-xs', 'text-gray-600', 'space-y-1');
    });
  });
});

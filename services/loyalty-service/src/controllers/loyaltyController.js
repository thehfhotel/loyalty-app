const PointTransaction = require('../models/PointTransaction');
const LoyaltyTier = require('../models/LoyaltyTier');
const Reward = require('../models/Reward');

class LoyaltyController {
  static async getDashboard(req, res, next) {
    try {
      const { user } = req;

      // Get user's tier information
      const tierInfo = await LoyaltyTier.getUserTierInfo(user.id);

      // Get points summary
      const pointsSummary = await PointTransaction.getPointsSummary(user.id);

      // Get recent transactions
      const recentTransactions = await PointTransaction.getUserTransactions(user.id, { limit: 5 });

      // Get available rewards
      const availableRewards = await Reward.findAvailableForUser(user.id);

      // Get recent redemptions
      const recentRedemptions = await Reward.getUserRedemptions(user.id, { limit: 3 });

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            name: `${user.first_name} ${user.last_name}`,
            email: user.email,
            tier: user.loyalty_tier,
            totalPoints: user.total_points
          },
          tierInfo,
          pointsSummary,
          recentTransactions: recentTransactions.transactions,
          availableRewards: availableRewards.slice(0, 6), // Top 6 rewards
          recentRedemptions: recentRedemptions.redemptions
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async getPointsBalance(req, res, next) {
    try {
      const { user } = req;

      const pointsSummary = await PointTransaction.getPointsSummary(user.id);

      res.json({
        success: true,
        data: {
          userId: user.id,
          currentBalance: user.total_points,
          ...pointsSummary
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async addPoints(req, res, next) {
    try {
      const { userId, points, description, referenceId, referenceType } = req.body;

      // Only allow this for admin users or internal service calls
      if (!req.user.isAdmin && !req.headers['x-internal-service']) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized to add points'
        });
      }

      // Calculate expiration date (2 years from now)
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 2);

      const transaction = await PointTransaction.create({
        userId,
        pointsAmount: points,
        transactionType: 'earned',
        description,
        referenceId,
        referenceType,
        expiresAt
      });

      res.status(201).json({
        success: true,
        message: 'Points added successfully',
        data: {
          transaction: transaction.toJSON(),
          newTotalPoints: transaction.newTotalPoints,
          tierUpgrade: transaction.tierUpgrade
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async simulateBookingPoints(req, res, next) {
    try {
      const { user } = req;
      const { bookingAmount, roomType = 'standard', nights = 1 } = req.body;

      if (!bookingAmount || bookingAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid booking amount is required'
        });
      }

      // Calculate points for this booking
      const pointsCalculation = await LoyaltyTier.calculatePointsForBooking(
        bookingAmount, 
        user.loyalty_tier
      );

      // Add bonus points for multiple nights
      if (nights > 1) {
        pointsCalculation.nightsBonus = Math.floor(nights * 10); // 10 points per night
        pointsCalculation.totalPoints += pointsCalculation.nightsBonus;
      }

      // Room type bonus
      const roomBonuses = {
        'standard': 0,
        'deluxe': 50,
        'suite': 100,
        'presidential': 200
      };
      pointsCalculation.roomBonus = roomBonuses[roomType] || 0;
      pointsCalculation.totalPoints += pointsCalculation.roomBonus;

      // Simulate what the new total would be
      const newTotalPoints = user.total_points + pointsCalculation.totalPoints;

      // Check potential tier upgrade
      const potentialTier = await LoyaltyTier.checkTierUpgradeEligibility(
        newTotalPoints, 0, 0 // Just check points for simulation
      );

      res.json({
        success: true,
        data: {
          bookingDetails: {
            amount: bookingAmount,
            roomType,
            nights
          },
          pointsCalculation,
          currentPoints: user.total_points,
          projectedTotal: newTotalPoints,
          currentTier: user.loyalty_tier,
          potentialTierUpgrade: potentialTier?.tier_name !== user.loyalty_tier ? potentialTier : null
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async getEarningOpportunities(req, res, next) {
    try {
      const { user } = req;

      // Get tier information
      const tierInfo = await LoyaltyTier.getUserTierInfo(user.id);

      // Calculate various earning opportunities
      const opportunities = [
        {
          type: 'booking',
          title: 'Stay Earnings',
          description: `Earn ${tierInfo.currentTier.pointMultiplier}x points on all stays`,
          baseRate: 'points per $1 spent',
          multiplier: tierInfo.currentTier.pointMultiplier
        },
        {
          type: 'survey',
          title: 'Survey Participation',
          description: 'Complete post-stay surveys',
          baseRate: '100 points per survey',
          multiplier: 1
        },
        {
          type: 'referral',
          title: 'Refer Friends',
          description: 'Earn points when friends join and stay',
          baseRate: '500 points per successful referral',
          multiplier: 1
        },
        {
          type: 'social',
          title: 'Social Sharing',
          description: 'Share your experiences on social media',
          baseRate: '25 points per approved post',
          multiplier: 1
        },
        {
          type: 'birthday',
          title: 'Birthday Bonus',
          description: 'Annual birthday point bonus',
          baseRate: '500 bonus points',
          multiplier: tierInfo.currentTier.pointMultiplier
        }
      ];

      // Add tier-specific opportunities
      if (tierInfo.nextTier) {
        opportunities.push({
          type: 'tier_upgrade',
          title: `${tierInfo.nextTier.name} Tier Upgrade`,
          description: `You're ${tierInfo.nextTier.progressPercentage.toFixed(1)}% of the way to ${tierInfo.nextTier.name}`,
          baseRate: `${tierInfo.nextTier.minPoints - tierInfo.userStats.totalPoints} points needed`,
          multiplier: 1,
          isUpgrade: true
        });
      }

      res.json({
        success: true,
        data: {
          currentTier: tierInfo.currentTier,
          nextTier: tierInfo.nextTier,
          opportunities,
          userStats: tierInfo.userStats
        }
      });

    } catch (error) {
      next(error);
    }
  }
}

module.exports = LoyaltyController;
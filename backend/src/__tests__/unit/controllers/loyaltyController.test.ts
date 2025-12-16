import { Request, Response } from 'express';

// Create mock service instance that will be used by controller
const mockLoyaltyService = {
  getAllTiers: jest.fn(),
  getUserLoyaltyStatus: jest.fn(),
  calculateUserPoints: jest.fn(),
  getUserPointsHistory: jest.fn(),
  earnPointsForStay: jest.fn(),
  getAllUsersLoyaltyStatus: jest.fn(),
  awardPoints: jest.fn(),
  deductPoints: jest.fn(),
  getAdminTransactions: jest.fn(),
  getPointsEarningRules: jest.fn(),
  expireOldPoints: jest.fn(),
  addStayNightsAndPoints: jest.fn(),
  awardNights: jest.fn(),
  deductNights: jest.fn(),
};

// Mock the service BEFORE importing the controller
jest.mock('../../../services/loyaltyService', () => ({
  LoyaltyService: jest.fn().mockImplementation(() => mockLoyaltyService),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import controller AFTER mock is set up
import { LoyaltyController } from '../../../controllers/loyaltyController';

describe('LoyaltyController', () => {
  let loyaltyController: LoyaltyController;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  const adminUser = { id: 'admin-1', role: 'admin' as const, email: 'admin@test.com' };
  const customerUser = { id: 'customer-1', role: 'customer' as const, email: 'customer@test.com' };

  const mockTier = {
    id: 'tier-1',
    name: 'Gold',
    min_nights: 10,
    multiplier: 1.5,
    color: '#FFD700',
    benefits: ['Priority check-in', 'Room upgrades'],
  };

  const mockLoyaltyStatus = {
    user_id: 'customer-1',
    current_points: 5000,
    lifetime_points: 15000,
    total_nights: 12,
    tier: mockTier,
    points_to_next_tier: null,
    nights_to_next_tier: null,
  };

  const mockPointsCalculation = {
    total_points: 5000,
    active_points: 4500,
    pending_points: 500,
    expiring_soon: [
      {
        points: 1000,
        expiry_date: '2025-01-31',
      },
    ],
  };

  const mockPointsHistory = {
    transactions: [
      {
        id: 'txn-1',
        points_change: 500,
        transaction_type: 'stay',
        description: 'Stay at Hotel A',
        created_at: '2024-12-01T10:00:00Z',
      },
    ],
    total: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    loyaltyController = new LoyaltyController();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnThis();
    mockRes = {
      json: jsonMock,
      status: statusMock,
    };
    mockReq = {
      body: {},
      params: {},
      query: {},
      user: customerUser,
    };
  });

  // ========== getTiers Tests ==========
  describe('getTiers', () => {
    it('should return all tiers successfully', async () => {
      const mockTiers = [mockTier];
      mockLoyaltyService.getAllTiers.mockResolvedValue(mockTiers);

      await loyaltyController.getTiers(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockTiers,
      });
    });

    it('should return 500 on service error', async () => {
      mockLoyaltyService.getAllTiers.mockRejectedValue(new Error('Database error'));

      await loyaltyController.getTiers(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to fetch loyalty tiers',
      });
    });
  });

  // ========== getUserLoyaltyStatus Tests ==========
  describe('getUserLoyaltyStatus', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await loyaltyController.getUserLoyaltyStatus(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return loyalty status for authenticated user', async () => {
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.getUserLoyaltyStatus(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledWith('customer-1');
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockLoyaltyStatus,
      });
    });

    it('should return 404 when loyalty status not found', async () => {
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(null);

      await loyaltyController.getUserLoyaltyStatus(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Loyalty status not found',
      });
    });

    it('should return 500 on service error', async () => {
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockRejectedValue(new Error('Database error'));

      await loyaltyController.getUserLoyaltyStatus(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to fetch loyalty status',
      });
    });
  });

  // ========== getPointsCalculation Tests ==========
  describe('getPointsCalculation', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await loyaltyController.getPointsCalculation(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return points calculation for authenticated user', async () => {
      (mockLoyaltyService.calculateUserPoints as jest.Mock).mockResolvedValue(mockPointsCalculation);

      await loyaltyController.getPointsCalculation(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.calculateUserPoints).toHaveBeenCalledWith('customer-1');
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockPointsCalculation,
      });
    });

    it('should return 500 on service error', async () => {
      (mockLoyaltyService.calculateUserPoints as jest.Mock).mockRejectedValue(new Error('Calculation error'));

      await loyaltyController.getPointsCalculation(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to calculate points',
      });
    });
  });

  // ========== getPointsHistory Tests ==========
  describe('getPointsHistory', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await loyaltyController.getPointsHistory(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return points history with default pagination', async () => {
      (mockLoyaltyService.getUserPointsHistory as jest.Mock).mockResolvedValue(mockPointsHistory);

      await loyaltyController.getPointsHistory(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.getUserPointsHistory).toHaveBeenCalledWith('customer-1', 50, 0);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockPointsHistory,
      });
    });

    it('should return points history with custom pagination', async () => {
      mockReq.query = { limit: '20', offset: '10' };
      (mockLoyaltyService.getUserPointsHistory as jest.Mock).mockResolvedValue(mockPointsHistory);

      await loyaltyController.getPointsHistory(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.getUserPointsHistory).toHaveBeenCalledWith('customer-1', 20, 10);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockPointsHistory,
      });
    });

    it('should return 500 on service error', async () => {
      (mockLoyaltyService.getUserPointsHistory as jest.Mock).mockRejectedValue(new Error('Database error'));

      await loyaltyController.getPointsHistory(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to fetch points history',
      });
    });
  });

  // ========== simulateStayEarning Tests ==========
  describe('simulateStayEarning', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await loyaltyController.simulateStayEarning(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return 400 when amountSpent is missing', async () => {
      mockReq.body = {};

      await loyaltyController.simulateStayEarning(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Valid amount spent is required',
      });
    });

    it('should return 400 when amountSpent is zero', async () => {
      mockReq.body = { amountSpent: 0 };

      await loyaltyController.simulateStayEarning(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Valid amount spent is required',
      });
    });

    it('should return 400 when amountSpent is negative', async () => {
      mockReq.body = { amountSpent: -100 };

      await loyaltyController.simulateStayEarning(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Valid amount spent is required',
      });
    });

    it('should simulate stay earning successfully', async () => {
      mockReq.body = { amountSpent: 1000, stayId: 'stay-1' };
      (mockLoyaltyService.earnPointsForStay as jest.Mock).mockResolvedValue('txn-1');
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.simulateStayEarning(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.earnPointsForStay).toHaveBeenCalledWith('customer-1', 1000, 'stay-1');
      expect(mockLoyaltyService.getUserLoyaltyStatus).toHaveBeenCalledWith('customer-1');
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Points earned successfully',
        data: {
          transactionId: 'txn-1',
          loyaltyStatus: mockLoyaltyStatus,
        },
      });
    });

    it('should simulate stay earning without stayId', async () => {
      mockReq.body = { amountSpent: 1000 };
      (mockLoyaltyService.earnPointsForStay as jest.Mock).mockResolvedValue('txn-1');
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.simulateStayEarning(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.earnPointsForStay).toHaveBeenCalledWith('customer-1', 1000, undefined);
    });

    it('should return 500 on service error', async () => {
      mockReq.body = { amountSpent: 1000 };
      (mockLoyaltyService.earnPointsForStay as jest.Mock).mockRejectedValue(new Error('Transaction failed'));

      await loyaltyController.simulateStayEarning(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Transaction failed',
      });
    });
  });

  // ========== getAllUsersLoyaltyStatus Tests (Admin) ==========
  describe('getAllUsersLoyaltyStatus', () => {
    beforeEach(() => {
      mockReq.user = adminUser;
    });

    it('should return all users loyalty status with default pagination', async () => {
      const mockResult = {
        users: [mockLoyaltyStatus],
        total: 1,
      };
      (mockLoyaltyService.getAllUsersLoyaltyStatus as jest.Mock).mockResolvedValue(mockResult);

      await loyaltyController.getAllUsersLoyaltyStatus(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.getAllUsersLoyaltyStatus).toHaveBeenCalledWith(50, 0, undefined);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockResult,
      });
    });

    it('should return all users loyalty status with custom pagination', async () => {
      mockReq.query = { limit: '25', offset: '50' };
      const mockResult = {
        users: [],
        total: 100,
      };
      (mockLoyaltyService.getAllUsersLoyaltyStatus as jest.Mock).mockResolvedValue(mockResult);

      await loyaltyController.getAllUsersLoyaltyStatus(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.getAllUsersLoyaltyStatus).toHaveBeenCalledWith(25, 50, undefined);
    });

    it('should return all users loyalty status with search term', async () => {
      mockReq.query = { search: 'john@example.com' };
      const mockResult = {
        users: [mockLoyaltyStatus],
        total: 1,
      };
      (mockLoyaltyService.getAllUsersLoyaltyStatus as jest.Mock).mockResolvedValue(mockResult);

      await loyaltyController.getAllUsersLoyaltyStatus(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.getAllUsersLoyaltyStatus).toHaveBeenCalledWith(50, 0, 'john@example.com');
    });

    it('should return 500 on service error', async () => {
      (mockLoyaltyService.getAllUsersLoyaltyStatus as jest.Mock).mockRejectedValue(new Error('Database error'));

      await loyaltyController.getAllUsersLoyaltyStatus(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to fetch users loyalty status',
      });
    });
  });

  // ========== awardPoints Tests (Admin) ==========
  describe('awardPoints', () => {
    beforeEach(() => {
      mockReq.user = adminUser;
    });

    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await loyaltyController.awardPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return 400 when userId is missing', async () => {
      mockReq.body = { points: 100 };

      await loyaltyController.awardPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID and points are required',
      });
    });

    it('should return 400 when points is missing', async () => {
      mockReq.body = { userId: 'customer-1' };

      await loyaltyController.awardPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID and points are required',
      });
    });

    it('should return 400 when points is zero', async () => {
      mockReq.body = { userId: 'customer-1', points: 0 };

      await loyaltyController.awardPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      // Note: Controller uses !points which treats 0 as falsy (missing)
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID and points are required',
      });
    });

    it('should return 400 when points is negative', async () => {
      mockReq.body = { userId: 'customer-1', points: -100 };

      await loyaltyController.awardPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Points must be greater than 0',
      });
    });

    it('should award points successfully with description', async () => {
      mockReq.body = {
        userId: 'customer-1',
        points: 500,
        description: 'Bonus points for feedback',
        referenceId: 'ref-123',
      };
      (mockLoyaltyService.awardPoints as jest.Mock).mockResolvedValue('txn-1');
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.awardPoints(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
        'customer-1',
        500,
        'admin_award',
        'Bonus points for feedback',
        'ref-123',
        'admin-1',
        'Points awarded by admin user admin-1'
      );
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Points awarded successfully',
        data: {
          transactionId: 'txn-1',
          loyaltyStatus: mockLoyaltyStatus,
        },
      });
    });

    it('should award points successfully without description', async () => {
      mockReq.body = { userId: 'customer-1', points: 500 };
      (mockLoyaltyService.awardPoints as jest.Mock).mockResolvedValue('txn-1');
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.awardPoints(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.awardPoints).toHaveBeenCalledWith(
        'customer-1',
        500,
        'admin_award',
        'Points awarded by admin',
        undefined,
        'admin-1',
        'Points awarded by admin user admin-1'
      );
    });

    it('should return 500 on service error', async () => {
      mockReq.body = { userId: 'customer-1', points: 500 };
      (mockLoyaltyService.awardPoints as jest.Mock).mockRejectedValue(new Error('Award failed'));

      await loyaltyController.awardPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Award failed',
      });
    });
  });

  // ========== deductPoints Tests (Admin) ==========
  describe('deductPoints', () => {
    beforeEach(() => {
      mockReq.user = adminUser;
    });

    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await loyaltyController.deductPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return 400 when userId is missing', async () => {
      mockReq.body = { points: 100, reason: 'Test' };

      await loyaltyController.deductPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID, points, and reason are required',
      });
    });

    it('should return 400 when points is missing', async () => {
      mockReq.body = { userId: 'customer-1', reason: 'Test' };

      await loyaltyController.deductPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID, points, and reason are required',
      });
    });

    it('should return 400 when reason is missing', async () => {
      mockReq.body = { userId: 'customer-1', points: 100 };

      await loyaltyController.deductPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID, points, and reason are required',
      });
    });

    it('should return 400 when points is zero', async () => {
      mockReq.body = { userId: 'customer-1', points: 0, reason: 'Test' };

      await loyaltyController.deductPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      // Note: Controller uses !points which treats 0 as falsy (missing)
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID, points, and reason are required',
      });
    });

    it('should return 400 when points is negative', async () => {
      mockReq.body = { userId: 'customer-1', points: -100, reason: 'Test' };

      await loyaltyController.deductPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Points must be greater than 0',
      });
    });

    it('should deduct points successfully', async () => {
      mockReq.body = {
        userId: 'customer-1',
        points: 200,
        reason: 'Policy violation',
      };
      (mockLoyaltyService.deductPoints as jest.Mock).mockResolvedValue('txn-1');
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.deductPoints(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.deductPoints).toHaveBeenCalledWith(
        'customer-1',
        200,
        'admin_deduction',
        'Points deducted by admin: Policy violation',
        undefined,
        'admin-1',
        'Policy violation'
      );
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Points deducted successfully',
        data: {
          transactionId: 'txn-1',
          loyaltyStatus: mockLoyaltyStatus,
        },
      });
    });

    it('should return 500 on service error', async () => {
      mockReq.body = { userId: 'customer-1', points: 200, reason: 'Test' };
      (mockLoyaltyService.deductPoints as jest.Mock).mockRejectedValue(new Error('Deduction failed'));

      await loyaltyController.deductPoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Deduction failed',
      });
    });
  });

  // ========== getAdminTransactions Tests (Admin) ==========
  describe('getAdminTransactions', () => {
    beforeEach(() => {
      mockReq.user = adminUser;
    });

    it('should return admin transactions with default pagination', async () => {
      const mockTransactions = {
        transactions: [],
        total: 0,
      };
      (mockLoyaltyService.getAdminTransactions as jest.Mock).mockResolvedValue(mockTransactions);

      await loyaltyController.getAdminTransactions(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.getAdminTransactions).toHaveBeenCalledWith(50, 0);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockTransactions,
      });
    });

    it('should return admin transactions with custom pagination', async () => {
      mockReq.query = { limit: '100', offset: '50' };
      const mockTransactions = {
        transactions: [],
        total: 150,
      };
      (mockLoyaltyService.getAdminTransactions as jest.Mock).mockResolvedValue(mockTransactions);

      await loyaltyController.getAdminTransactions(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.getAdminTransactions).toHaveBeenCalledWith(100, 50);
    });

    it('should return 500 on service error', async () => {
      (mockLoyaltyService.getAdminTransactions as jest.Mock).mockRejectedValue(new Error('Database error'));

      await loyaltyController.getAdminTransactions(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to fetch admin transactions',
      });
    });
  });

  // ========== getUserPointsHistoryAdmin Tests (Admin) ==========
  describe('getUserPointsHistoryAdmin', () => {
    beforeEach(() => {
      mockReq.user = adminUser;
    });

    it('should return user points history with default pagination', async () => {
      mockReq.params = { userId: 'customer-1' };
      (mockLoyaltyService.getUserPointsHistory as jest.Mock).mockResolvedValue(mockPointsHistory);

      await loyaltyController.getUserPointsHistoryAdmin(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.getUserPointsHistory).toHaveBeenCalledWith('customer-1', 50, 0);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockPointsHistory,
      });
    });

    it('should return user points history with custom pagination', async () => {
      mockReq.params = { userId: 'customer-1' };
      mockReq.query = { limit: '30', offset: '10' };
      (mockLoyaltyService.getUserPointsHistory as jest.Mock).mockResolvedValue(mockPointsHistory);

      await loyaltyController.getUserPointsHistoryAdmin(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.getUserPointsHistory).toHaveBeenCalledWith('customer-1', 30, 10);
    });

    it('should return 500 on service error', async () => {
      mockReq.params = { userId: 'customer-1' };
      (mockLoyaltyService.getUserPointsHistory as jest.Mock).mockRejectedValue(new Error('Database error'));

      await loyaltyController.getUserPointsHistoryAdmin(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to fetch user points history',
      });
    });
  });

  // ========== getEarningRules Tests (Admin) ==========
  describe('getEarningRules', () => {
    beforeEach(() => {
      mockReq.user = adminUser;
    });

    it('should return earning rules successfully', async () => {
      const mockRules = {
        base_points_per_thb: 1,
        tier_multipliers: {
          bronze: 1.0,
          silver: 1.2,
          gold: 1.5,
          platinum: 2.0,
        },
      };
      (mockLoyaltyService.getPointsEarningRules as jest.Mock).mockResolvedValue(mockRules);

      await loyaltyController.getEarningRules(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: mockRules,
      });
    });

    it('should return 500 on service error', async () => {
      (mockLoyaltyService.getPointsEarningRules as jest.Mock).mockRejectedValue(new Error('Database error'));

      await loyaltyController.getEarningRules(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to fetch earning rules',
      });
    });
  });

  // ========== expirePoints Tests (Admin) ==========
  describe('expirePoints', () => {
    beforeEach(() => {
      mockReq.user = adminUser;
    });

    it('should expire points successfully', async () => {
      (mockLoyaltyService.expireOldPoints as jest.Mock).mockResolvedValue(25);

      await loyaltyController.expirePoints(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Expired points for 25 transactions',
        data: { expiredCount: 25 },
      });
    });

    it('should handle zero expired transactions', async () => {
      (mockLoyaltyService.expireOldPoints as jest.Mock).mockResolvedValue(0);

      await loyaltyController.expirePoints(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Expired points for 0 transactions',
        data: { expiredCount: 0 },
      });
    });

    it('should return 500 on service error', async () => {
      (mockLoyaltyService.expireOldPoints as jest.Mock).mockRejectedValue(new Error('Expiration failed'));

      await loyaltyController.expirePoints(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to expire points',
      });
    });
  });

  // ========== awardSpendingWithNights Tests (Admin) ==========
  describe('awardSpendingWithNights', () => {
    beforeEach(() => {
      mockReq.user = adminUser;
    });

    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await loyaltyController.awardSpendingWithNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return 400 when userId is missing', async () => {
      mockReq.body = { amountSpent: 1000, nightsStayed: 2 };

      await loyaltyController.awardSpendingWithNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID is required',
      });
    });

    it('should return 400 when both amountSpent and nightsStayed are zero', async () => {
      mockReq.body = { userId: 'customer-1', amountSpent: 0, nightsStayed: 0 };

      await loyaltyController.awardSpendingWithNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'At least one of amount spent or nights stayed must be provided',
      });
    });

    it('should return 400 when both values are missing', async () => {
      mockReq.body = { userId: 'customer-1' };

      await loyaltyController.awardSpendingWithNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'At least one of amount spent or nights stayed must be provided',
      });
    });

    it('should award spending with nights successfully', async () => {
      mockReq.body = {
        userId: 'customer-1',
        amountSpent: 2000,
        nightsStayed: 3,
        referenceId: 'stay-123',
        description: 'Hotel stay award',
      };
      const mockResult = {
        transactionId: 'txn-1',
        pointsEarned: 2000,
        nightsAdded: 3,
      };
      (mockLoyaltyService.addStayNightsAndPoints as jest.Mock).mockResolvedValue(mockResult);
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.awardSpendingWithNights(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.addStayNightsAndPoints).toHaveBeenCalledWith(
        'customer-1',
        3,
        2000,
        'stay-123',
        'Hotel stay award',
        'admin-1',
        'Admin admin@test.com awarded 3 nights and 2000 THB spending'
      );
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Spending points and nights awarded successfully',
        data: {
          ...mockResult,
          loyaltyStatus: mockLoyaltyStatus,
        },
      });
    });

    it('should award only amountSpent when nightsStayed is not provided', async () => {
      mockReq.body = {
        userId: 'customer-1',
        amountSpent: 1500,
      };
      const mockResult = {
        transactionId: 'txn-1',
        pointsEarned: 1500,
        nightsAdded: 0,
      };
      (mockLoyaltyService.addStayNightsAndPoints as jest.Mock).mockResolvedValue(mockResult);
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.awardSpendingWithNights(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.addStayNightsAndPoints).toHaveBeenCalledWith(
        'customer-1',
        0,
        1500,
        undefined,
        'Spending points with nights awarded by admin',
        'admin-1',
        'Admin admin@test.com awarded 0 nights and 1500 THB spending'
      );
    });

    it('should award only nightsStayed when amountSpent is not provided', async () => {
      mockReq.body = {
        userId: 'customer-1',
        nightsStayed: 2,
      };
      const mockResult = {
        transactionId: 'txn-1',
        pointsEarned: 0,
        nightsAdded: 2,
      };
      (mockLoyaltyService.addStayNightsAndPoints as jest.Mock).mockResolvedValue(mockResult);
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.awardSpendingWithNights(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.addStayNightsAndPoints).toHaveBeenCalledWith(
        'customer-1',
        2,
        0,
        undefined,
        'Spending points with nights awarded by admin',
        'admin-1',
        'Admin admin@test.com awarded 2 nights and 0 THB spending'
      );
    });

    it('should return 500 on service error', async () => {
      mockReq.body = { userId: 'customer-1', amountSpent: 1000 };
      (mockLoyaltyService.addStayNightsAndPoints as jest.Mock).mockRejectedValue(new Error('Award failed'));

      await loyaltyController.awardSpendingWithNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Award failed',
      });
    });
  });

  // ========== awardNights Tests (Admin) ==========
  describe('awardNights', () => {
    beforeEach(() => {
      mockReq.user = adminUser;
    });

    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await loyaltyController.awardNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return 400 when userId is missing', async () => {
      mockReq.body = { nights: 5, reason: 'Bonus' };

      await loyaltyController.awardNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID, nights, and reason are required',
      });
    });

    it('should return 400 when nights is missing', async () => {
      mockReq.body = { userId: 'customer-1', reason: 'Bonus' };

      await loyaltyController.awardNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID, nights, and reason are required',
      });
    });

    it('should return 400 when reason is missing', async () => {
      mockReq.body = { userId: 'customer-1', nights: 5 };

      await loyaltyController.awardNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID, nights, and reason are required',
      });
    });

    it('should return 400 when nights is zero', async () => {
      mockReq.body = { userId: 'customer-1', nights: 0, reason: 'Test' };

      await loyaltyController.awardNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      // Note: Controller uses !nights which treats 0 as falsy (missing)
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID, nights, and reason are required',
      });
    });

    it('should return 400 when nights is negative', async () => {
      mockReq.body = { userId: 'customer-1', nights: -5, reason: 'Test' };

      await loyaltyController.awardNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Nights must be greater than 0',
      });
    });

    it('should award nights successfully', async () => {
      mockReq.body = {
        userId: 'customer-1',
        nights: 3,
        reason: 'Compensation for service issue',
        referenceId: 'comp-123',
      };
      const mockResult = {
        nightsAdded: 3,
        newTotalNights: 15,
      };
      (mockLoyaltyService.awardNights as jest.Mock).mockResolvedValue(mockResult);
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.awardNights(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.awardNights).toHaveBeenCalledWith(
        'customer-1',
        3,
        'admin-1',
        'Compensation for service issue',
        'comp-123'
      );
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Nights awarded successfully',
        data: {
          ...mockResult,
          loyaltyStatus: mockLoyaltyStatus,
        },
      });
    });

    it('should award nights successfully without referenceId', async () => {
      mockReq.body = {
        userId: 'customer-1',
        nights: 2,
        reason: 'Promotional bonus',
      };
      const mockResult = {
        nightsAdded: 2,
        newTotalNights: 14,
      };
      (mockLoyaltyService.awardNights as jest.Mock).mockResolvedValue(mockResult);
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.awardNights(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.awardNights).toHaveBeenCalledWith(
        'customer-1',
        2,
        'admin-1',
        'Promotional bonus',
        undefined
      );
    });

    it('should return 500 on service error', async () => {
      mockReq.body = { userId: 'customer-1', nights: 3, reason: 'Test' };
      (mockLoyaltyService.awardNights as jest.Mock).mockRejectedValue(new Error('Award failed'));

      await loyaltyController.awardNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Award failed',
      });
    });
  });

  // ========== deductNights Tests (Admin) ==========
  describe('deductNights', () => {
    beforeEach(() => {
      mockReq.user = adminUser;
    });

    it('should return 401 when user is not authenticated', async () => {
      mockReq.user = undefined;

      await loyaltyController.deductNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Authentication required',
      });
    });

    it('should return 400 when userId is missing', async () => {
      mockReq.body = { nights: 2, reason: 'Correction' };

      await loyaltyController.deductNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID, nights, and reason are required',
      });
    });

    it('should return 400 when nights is missing', async () => {
      mockReq.body = { userId: 'customer-1', reason: 'Correction' };

      await loyaltyController.deductNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID, nights, and reason are required',
      });
    });

    it('should return 400 when reason is missing', async () => {
      mockReq.body = { userId: 'customer-1', nights: 2 };

      await loyaltyController.deductNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID, nights, and reason are required',
      });
    });

    it('should return 400 when nights is zero', async () => {
      mockReq.body = { userId: 'customer-1', nights: 0, reason: 'Test' };

      await loyaltyController.deductNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      // Note: Controller uses !nights which treats 0 as falsy (missing)
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User ID, nights, and reason are required',
      });
    });

    it('should return 400 when nights is negative', async () => {
      mockReq.body = { userId: 'customer-1', nights: -2, reason: 'Test' };

      await loyaltyController.deductNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Nights must be greater than 0',
      });
    });

    it('should deduct nights successfully', async () => {
      mockReq.body = {
        userId: 'customer-1',
        nights: 1,
        reason: 'Booking correction',
        referenceId: 'corr-456',
      };
      const mockResult = {
        nightsDeducted: 1,
        newTotalNights: 11,
      };
      (mockLoyaltyService.deductNights as jest.Mock).mockResolvedValue(mockResult);
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.deductNights(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.deductNights).toHaveBeenCalledWith(
        'customer-1',
        1,
        'admin-1',
        'Booking correction',
        'corr-456'
      );
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Nights deducted successfully',
        data: {
          ...mockResult,
          loyaltyStatus: mockLoyaltyStatus,
        },
      });
    });

    it('should deduct nights successfully without referenceId', async () => {
      mockReq.body = {
        userId: 'customer-1',
        nights: 2,
        reason: 'Data correction',
      };
      const mockResult = {
        nightsDeducted: 2,
        newTotalNights: 10,
      };
      (mockLoyaltyService.deductNights as jest.Mock).mockResolvedValue(mockResult);
      (mockLoyaltyService.getUserLoyaltyStatus as jest.Mock).mockResolvedValue(mockLoyaltyStatus);

      await loyaltyController.deductNights(mockReq as Request, mockRes as Response);

      expect(mockLoyaltyService.deductNights).toHaveBeenCalledWith(
        'customer-1',
        2,
        'admin-1',
        'Data correction',
        undefined
      );
    });

    it('should return 500 on service error', async () => {
      mockReq.body = { userId: 'customer-1', nights: 1, reason: 'Test' };
      (mockLoyaltyService.deductNights as jest.Mock).mockRejectedValue(new Error('Deduction failed'));

      await loyaltyController.deductNights(mockReq as Request, mockRes as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Deduction failed',
      });
    });
  });
});

/**
 * User Routes Integration Tests
 * Tests user profile management, avatar upload, admin operations
 *
 * Week 1 Priority - 25-30 tests
 * Coverage Target: ~3% contribution
 */

import request from 'supertest';
import { Express, Request, Response, NextFunction } from 'express';
import userRoutes from '../../../routes/user';
import { UserService } from '../../../services/userService';
import { ImageProcessor } from '../../../utils/imageProcessor';
import { createTestApp } from '../../fixtures';

// Mock dependencies
jest.mock('../../../services/userService');
jest.mock('../../../utils/imageProcessor');
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock Multer middleware
jest.mock('../../../config/multer', () => ({
  uploadAvatar: (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      req.file = {
        buffer: Buffer.from('fake-image-data'),
        originalname: 'test-avatar.jpg',
        size: 1024,
        mimetype: 'image/jpeg',
      } as Express.Multer.File;
    }
    next();
  },
  handleMulterError: jest.fn((error: unknown) => {
    throw error;
  }),
}));

describe('User Routes Integration Tests', () => {
  let app: Express;
  let userService: jest.Mocked<UserService>;

  // Mock authenticate middleware
  const mockAuthenticate = (role: 'customer' | 'admin' | 'super_admin' = 'customer') => (
    req: Request,
    _res: Response,
    next: NextFunction
  ) => {
    req.user = {
      id: 'test-user-id',
      email: 'test@example.com',
      role: role,
    };
    next();
  };

  beforeAll(() => {
    // Mock authentication middleware before routes
    jest.mock('../../../middleware/auth', () => ({
      authenticate: mockAuthenticate('customer'),
    }));

    app = createTestApp(userRoutes, '/api/users');
  });

  beforeEach(() => {
    userService = new UserService() as jest.Mocked<UserService>;
    jest.clearAllMocks();
  });

  describe('GET /api/users/profile', () => {
    it('should get user profile', async () => {
      const mockProfile = {
        id: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        phoneNumber: '1234567890',
        dateOfBirth: '1990-01-01',
        loyaltyPoints: 1000,
      };

      userService.getProfile = jest.fn().mockResolvedValue(mockProfile);

      const response = await request(app).get('/api/users/profile');

      expect(response.status).toBe(200);
      expect(response.body.profile).toEqual(mockProfile);
      expect(userService.getProfile).toHaveBeenCalledWith('test-user-id');
    });

    it('should handle profile fetch errors', async () => {
      userService.getProfile = jest.fn().mockRejectedValue(
        new Error('Profile not found')
      );

      const response = await request(app).get('/api/users/profile');

      expect(response.status).toBe(500);
    });
  });

  describe('PUT /api/users/profile', () => {
    it('should update user profile with valid data', async () => {
      const updateData = {
        firstName: 'Updated',
        lastName: 'Name',
        phoneNumber: '9876543210',
        dateOfBirth: '1995-05-15',
      };

      const mockUpdatedProfile = {
        id: 'test-user-id',
        ...updateData,
      };

      userService.updateProfile = jest.fn().mockResolvedValue(mockUpdatedProfile);

      const response = await request(app)
        .put('/api/users/profile')
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.profile).toEqual(mockUpdatedProfile);
      expect(userService.updateProfile).toHaveBeenCalledWith(
        'test-user-id',
        updateData
      );
    });

    it('should reject invalid profile update data', async () => {
      const response = await request(app)
        .put('/api/users/profile')
        .send({
          firstName: '', // Invalid: empty string
          email: 'not-an-email', // Invalid: bad format
        });

      expect(response.status).toBe(400);
    });

    it('should handle profile update errors', async () => {
      userService.updateProfile = jest.fn().mockRejectedValue(
        new Error('Update failed')
      );

      const response = await request(app)
        .put('/api/users/profile')
        .send({
          firstName: 'Test',
          lastName: 'User',
        });

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/users/profile-completion-status', () => {
    it('should get profile completion status', async () => {
      const mockStatus = {
        isComplete: false,
        completedFields: ['firstName', 'lastName', 'email'],
        missingFields: ['phoneNumber', 'dateOfBirth'],
        completionPercentage: 60,
      };

      userService.getProfileCompletionStatus = jest.fn().mockResolvedValue(mockStatus);

      const response = await request(app).get('/api/users/profile-completion-status');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockStatus);
    });

    it('should handle errors when checking completion status', async () => {
      userService.getProfileCompletionStatus = jest.fn().mockRejectedValue(
        new Error('Status check failed')
      );

      const response = await request(app).get('/api/users/profile-completion-status');

      expect(response.status).toBe(500);
    });
  });

  describe('PUT /api/users/complete-profile', () => {
    it('should complete profile and receive coupon reward', async () => {
      const completeData = {
        firstName: 'Complete',
        lastName: 'Profile',
        phoneNumber: '1234567890',
        dateOfBirth: '1990-01-01',
      };

      const mockResult = {
        profile: { ...completeData, id: 'test-user-id' },
        coupon: {
          id: 'coupon-123',
          code: 'WELCOME10',
          value: 10,
        },
      };

      userService.completeProfile = jest.fn().mockResolvedValue(mockResult);

      const response = await request(app)
        .put('/api/users/complete-profile')
        .send(completeData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockResult);
    });

    it('should complete profile without coupon if already received', async () => {
      const mockResult = {
        profile: { id: 'test-user-id', firstName: 'Test' },
        coupon: null,
      };

      userService.completeProfile = jest.fn().mockResolvedValue(mockResult);

      const response = await request(app)
        .put('/api/users/complete-profile')
        .send({
          firstName: 'Test',
          lastName: 'User',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.coupon).toBeNull();
    });
  });

  describe('POST /api/users/avatar', () => {
    it('should upload avatar successfully', async () => {
      const mockAvatarUrl = 'https://storage.example.com/avatars/test-user-id.jpg';
      const mockProfile = {
        id: 'test-user-id',
        avatarUrl: mockAvatarUrl,
      };

      userService.getProfile = jest.fn().mockResolvedValue(mockProfile);
      ImageProcessor.processAvatar = jest.fn().mockResolvedValue(mockAvatarUrl);
      userService.updateAvatar = jest.fn().mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/users/avatar')
        .set('Content-Type', 'multipart/form-data')
        .attach('avatar', Buffer.from('fake-image'), 'test.jpg');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.avatarUrl).toBe(mockAvatarUrl);
      expect(ImageProcessor.processAvatar).toHaveBeenCalled();
      expect(userService.updateAvatar).toHaveBeenCalledWith('test-user-id', mockAvatarUrl);
    });

    it('should reject upload without file', async () => {
      const response = await request(app).post('/api/users/avatar');

      expect(response.status).toBe(400);
    });

    it('should handle avatar processing errors', async () => {
      ImageProcessor.processAvatar = jest.fn().mockRejectedValue(
        new Error('Processing failed')
      );

      const response = await request(app)
        .post('/api/users/avatar')
        .set('Content-Type', 'multipart/form-data')
        .attach('avatar', Buffer.from('fake-image'), 'test.jpg');

      expect(response.status).toBe(500);
    });
  });

  describe('PUT /api/users/avatar/emoji', () => {
    it('should update emoji avatar', async () => {
      const mockProfile = {
        id: 'test-user-id',
        emojiAvatar: '😊',
      };

      userService.updateEmojiAvatar = jest.fn().mockResolvedValue(mockProfile);

      const response = await request(app)
        .put('/api/users/avatar/emoji')
        .send({ emoji: '😊' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.profile.emojiAvatar).toBe('😊');
    });

    it('should reject invalid emoji', async () => {
      const response = await request(app)
        .put('/api/users/avatar/emoji')
        .send({ emoji: '' });

      expect(response.status).toBe(400);
    });

    it('should reject missing emoji', async () => {
      const response = await request(app)
        .put('/api/users/avatar/emoji')
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/users/email', () => {
    it('should update user email', async () => {
      userService.updateUserEmail = jest.fn().mockResolvedValue(undefined);

      const response = await request(app)
        .put('/api/users/email')
        .send({ email: 'newemail@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(userService.updateUserEmail).toHaveBeenCalledWith(
        'test-user-id',
        'newemail@example.com'
      );
    });

    it('should reject invalid email', async () => {
      const response = await request(app)
        .put('/api/users/email')
        .send({ email: 'not-an-email' });

      expect(response.status).toBe(400);
    });

    it('should reject missing email', async () => {
      const response = await request(app)
        .put('/api/users/email')
        .send({});

      expect(response.status).toBe(400);
    });

    it('should handle duplicate email error', async () => {
      userService.updateUserEmail = jest.fn().mockRejectedValue(
        new Error('Email already exists')
      );

      const response = await request(app)
        .put('/api/users/email')
        .send({ email: 'existing@example.com' });

      expect(response.status).toBe(500);
    });
  });

  describe('DELETE /api/users/avatar', () => {
    it('should delete avatar successfully', async () => {
      ImageProcessor.deleteUserAvatar = jest.fn().mockResolvedValue(undefined);
      userService.deleteAvatar = jest.fn().mockResolvedValue(undefined);

      const response = await request(app).delete('/api/users/avatar');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(ImageProcessor.deleteUserAvatar).toHaveBeenCalledWith('test-user-id');
      expect(userService.deleteAvatar).toHaveBeenCalledWith('test-user-id');
    });

    it('should handle avatar deletion errors', async () => {
      ImageProcessor.deleteUserAvatar = jest.fn().mockRejectedValue(
        new Error('Deletion failed')
      );

      const response = await request(app).delete('/api/users/avatar');

      expect(response.status).toBe(500);
    });
  });

  describe('Admin Routes - GET /api/users/admin/users', () => {
    beforeEach(() => {
      // Override mock to simulate admin user
      jest.doMock('../../../middleware/auth', () => ({
        authenticate: mockAuthenticate('admin'),
      }));
    });

    it('should get paginated user list for admin', async () => {
      const mockResult = {
        users: [
          { id: '1', email: 'user1@example.com' },
          { id: '2', email: 'user2@example.com' },
        ],
        total: 25,
      };

      userService.getAllUsers = jest.fn().mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/api/users/admin/users')
        .query({ page: 1, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockResult.users);
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 25,
        pages: 3,
      });
    });

    it('should support search functionality', async () => {
      const mockResult = {
        users: [{ id: '1', email: 'search@example.com' }],
        total: 1,
      };

      userService.getAllUsers = jest.fn().mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/api/users/admin/users')
        .query({ search: 'search@example' });

      expect(response.status).toBe(200);
      expect(userService.getAllUsers).toHaveBeenCalledWith(1, 10, 'search@example');
    });

    it('should use default pagination if not provided', async () => {
      const mockResult = { users: [], total: 0 };
      userService.getAllUsers = jest.fn().mockResolvedValue(mockResult);

      const response = await request(app).get('/api/users/admin/users');

      expect(response.status).toBe(200);
      expect(userService.getAllUsers).toHaveBeenCalledWith(1, 10, '');
    });
  });

  describe('Admin Routes - GET /api/users/admin/stats', () => {
    it('should get user statistics for admin', async () => {
      const mockStats = {
        totalUsers: 1000,
        activeUsers: 750,
        newUsersToday: 50,
        averageLoyaltyPoints: 5000,
      };

      userService.getUserStats = jest.fn().mockResolvedValue(mockStats);

      const response = await request(app).get('/api/users/admin/stats');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockStats);
    });
  });

  describe('Admin Routes - GET /api/users/admin/users/:userId', () => {
    it('should get specific user details', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'user@example.com',
        firstName: 'Test',
        lastName: 'User',
      };

      userService.getUserById = jest.fn().mockResolvedValue(mockUser);

      const response = await request(app).get('/api/users/admin/users/user-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockUser);
    });

    it('should handle user not found', async () => {
      userService.getUserById = jest.fn().mockRejectedValue(
        new Error('User not found')
      );

      const response = await request(app).get('/api/users/admin/users/nonexistent');

      expect(response.status).toBe(500);
    });
  });

  describe('Admin Routes - PATCH /api/users/admin/users/:userId/status', () => {
    it('should activate user', async () => {
      userService.updateUserStatus = jest.fn().mockResolvedValue(undefined);

      const response = await request(app)
        .patch('/api/users/admin/users/user-123/status')
        .send({ isActive: true });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('activated');
      expect(userService.updateUserStatus).toHaveBeenCalledWith('user-123', true);
    });

    it('should deactivate user', async () => {
      userService.updateUserStatus = jest.fn().mockResolvedValue(undefined);

      const response = await request(app)
        .patch('/api/users/admin/users/user-123/status')
        .send({ isActive: false });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('deactivated');
    });

    it('should reject invalid status value', async () => {
      const response = await request(app)
        .patch('/api/users/admin/users/user-123/status')
        .send({ isActive: 'not-a-boolean' });

      expect(response.status).toBe(400);
    });
  });

  describe('Admin Routes - PATCH /api/users/admin/users/:userId/role', () => {
    it('should update user role', async () => {
      userService.updateUserRole = jest.fn().mockResolvedValue(undefined);

      const response = await request(app)
        .patch('/api/users/admin/users/user-123/role')
        .send({ role: 'admin' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(userService.updateUserRole).toHaveBeenCalledWith('user-123', 'admin');
    });

    it('should reject missing role', async () => {
      const response = await request(app)
        .patch('/api/users/admin/users/user-123/role')
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('Admin Routes - DELETE /api/users/admin/users/:userId', () => {
    beforeEach(() => {
      // Simulate super_admin for deletion
      jest.doMock('../../../middleware/auth', () => ({
        authenticate: (req: Request, _res: Response, next: NextFunction) => {
          req.user = {
            id: 'admin-id',
            email: 'admin@example.com',
            role: 'super_admin',
          };
          next();
        },
      }));
    });

    it('should delete user as super admin', async () => {
      userService.deleteUser = jest.fn().mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/users/admin/users/user-to-delete');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(userService.deleteUser).toHaveBeenCalledWith('user-to-delete');
    });

    it('should prevent self-deletion', async () => {
      const response = await request(app)
        .delete('/api/users/admin/users/admin-id');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Cannot delete your own account');
    });
  });

  describe('Admin Routes - Coupon Settings', () => {
    it('should get new member coupon settings', async () => {
      const mockSettings = {
        enabled: true,
        couponType: 'percentage',
        couponValue: 10,
      };

      userService.getNewMemberCouponSettings = jest.fn().mockResolvedValue(mockSettings);

      const response = await request(app).get(
        '/api/users/admin/new-member-coupon-settings'
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockSettings);
    });

    it('should update new member coupon settings', async () => {
      const updateSettings = {
        enabled: true,
        couponValue: 15,
      };

      userService.updateNewMemberCouponSettings = jest.fn().mockResolvedValue(updateSettings);

      const response = await request(app)
        .put('/api/users/admin/new-member-coupon-settings')
        .send(updateSettings);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(updateSettings);
    });

    it('should get coupon status for admin', async () => {
      const mockStatus = {
        id: 'coupon-123',
        status: 'available',
        expiresAt: '2024-12-31',
      };

      userService.getCouponStatusForAdmin = jest.fn().mockResolvedValue(mockStatus);

      const response = await request(app).get(
        '/api/users/admin/coupon-status/coupon-123'
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockStatus);
    });
  });
});

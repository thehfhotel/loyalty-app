/**
 * PrismaUserService Unit Tests
 * Tests user management operations with Prisma
 */

// Mock Prisma client - must be before imports
const mockPrismaClient = {
  users: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  user_profiles: {
    upsert: jest.fn(),
  },
  membership_id_sequence: {
    findFirst: jest.fn(),
    upsert: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

// Mock the db module
jest.mock('../../../config/prisma', () => ({
  db: mockPrismaClient,
}));

import { PrismaUserService, UserWithProfile } from '../../../services/prismaUserService';
import { AppError } from '../../../middleware/errorHandler';
import { Prisma } from '../../../generated/prisma/client';

describe('PrismaUserService', () => {
  let service: PrismaUserService;
  let mockUser: UserWithProfile;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PrismaUserService();

    // Mock user data
    mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      password_hash: null,
      oauth_provider: 'google',
      oauth_provider_id: 'google-123',
      role: 'customer',
      is_active: true,
      email_verified: true,
      created_at: new Date(),
      updated_at: new Date(),
      user_profiles: {
        user_id: 'user-123',
        first_name: 'John',
        last_name: 'Doe',
        phone: '+1234567890',
        date_of_birth: null,
        avatar_url: null,
        preferences: {},
        membership_id: '26901001',
        created_at: new Date(),
        updated_at: new Date(),
      },
    };
  });

  describe('getUserById', () => {
    it('should retrieve user with profile by ID', async () => {
      mockPrismaClient.users.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUserById('user-123');

      expect(result).toEqual(mockUser);
      expect(mockPrismaClient.users.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        include: {
          user_profiles: true,
          user_loyalty: {
            include: {
              tiers: true,
            },
          },
        },
      });
    });

    it('should return null for non-existent user', async () => {
      mockPrismaClient.users.findUnique.mockResolvedValue(null);

      const result = await service.getUserById('non-existent');

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      mockPrismaClient.users.findUnique.mockRejectedValue(new Error('Database connection failed'));

      await expect(service.getUserById('user-123')).rejects.toThrow(AppError);
      await expect(service.getUserById('user-123')).rejects.toThrow('Failed to fetch user');
    });

    it('should include user loyalty with tiers', async () => {
      const userWithLoyalty = {
        ...mockUser,
        user_loyalty: {
          id: 'loyalty-123',
          user_id: 'user-123',
          tier_id: 1,
          current_points: 1000,
          total_nights: 5,
          created_at: new Date(),
          updated_at: new Date(),
          tiers: {
            id: 1,
            tier_name: 'silver',
            min_nights: 1,
            benefits: {},
          },
        },
      };
      mockPrismaClient.users.findUnique.mockResolvedValue(userWithLoyalty);

      const result = await service.getUserById('user-123');

      expect(result).toEqual(userWithLoyalty);
    });
  });

  describe('getUserByEmail', () => {
    it('should retrieve user by email', async () => {
      mockPrismaClient.users.findFirst.mockResolvedValue(mockUser);

      const result = await service.getUserByEmail('test@example.com');

      expect(result).toEqual(mockUser);
      expect(mockPrismaClient.users.findFirst).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        include: {
          user_profiles: true,
        },
      });
    });

    it('should return null for non-existent email', async () => {
      mockPrismaClient.users.findFirst.mockResolvedValue(null);

      const result = await service.getUserByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      mockPrismaClient.users.findFirst.mockRejectedValue(new Error('Database error'));

      await expect(service.getUserByEmail('test@example.com')).rejects.toThrow(AppError);
      await expect(service.getUserByEmail('test@example.com')).rejects.toThrow('Failed to fetch user by email');
    });

    it('should perform case-sensitive email lookup', async () => {
      mockPrismaClient.users.findFirst.mockResolvedValue(mockUser);

      await service.getUserByEmail('Test@Example.com');

      expect(mockPrismaClient.users.findFirst).toHaveBeenCalledWith({
        where: { email: 'Test@Example.com' },
        include: { user_profiles: true },
      });
    });
  });

  describe('createUser', () => {
    beforeEach(() => {
      // Mock membership ID generation
      mockPrismaClient.membership_id_sequence.findFirst.mockResolvedValue({
        id: 1,
        current_user_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });
      mockPrismaClient.membership_id_sequence.upsert.mockResolvedValue({
        id: 1,
        current_user_count: 1,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    it('should create user with password hash', async () => {
      const userData = {
        email: 'newuser@example.com',
        password_hash: '$2b$10$hashedpassword',
        first_name: 'New',
        last_name: 'User',
      };

      mockPrismaClient.users.create.mockResolvedValue(mockUser);

      const result = await service.createUser(userData);

      expect(result).toEqual(mockUser);
      expect(mockPrismaClient.users.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: userData.email,
          password_hash: userData.password_hash,
          user_profiles: {
            create: expect.objectContaining({
              first_name: userData.first_name,
              last_name: userData.last_name,
              membership_id: '26901001',
            }),
          },
          user_loyalty: {
            create: {
              current_points: 0,
            },
          },
        }),
        include: {
          user_profiles: true,
          user_loyalty: true,
        },
      });
    });

    it('should create user with OAuth provider', async () => {
      const userData = {
        email: 'oauth@example.com',
        oauth_provider: 'google',
        oauth_provider_id: 'google-456',
        first_name: 'OAuth',
        last_name: 'User',
      };

      mockPrismaClient.users.create.mockResolvedValue(mockUser);

      const result = await service.createUser(userData);

      expect(result).toEqual(mockUser);
      expect(mockPrismaClient.users.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: userData.email,
          oauth_provider: userData.oauth_provider,
          oauth_provider_id: userData.oauth_provider_id,
        }),
        include: expect.any(Object),
      });
    });

    it('should generate unique membership ID', async () => {
      mockPrismaClient.membership_id_sequence.findFirst.mockResolvedValue({
        id: 1,
        current_user_count: 99,
        created_at: new Date(),
        updated_at: new Date(),
      });
      mockPrismaClient.membership_id_sequence.upsert.mockResolvedValue({
        id: 1,
        current_user_count: 100,
        created_at: new Date(),
        updated_at: new Date(),
      });
      mockPrismaClient.users.create.mockResolvedValue(mockUser);

      await service.createUser({
        email: 'test@example.com',
        first_name: 'Test',
      });

      expect(mockPrismaClient.membership_id_sequence.upsert).toHaveBeenCalledWith({
        where: { id: 1 },
        update: { current_user_count: 100 },
        create: { current_user_count: 100 },
      });
    });

    it('should handle duplicate email error', async () => {
      const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      mockPrismaClient.users.create.mockRejectedValue(error);

      await expect(
        service.createUser({
          email: 'duplicate@example.com',
          password_hash: 'hash',
        })
      ).rejects.toThrow('User with this email already exists');
    });

    it('should handle database errors during creation', async () => {
      mockPrismaClient.users.create.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        service.createUser({
          email: 'test@example.com',
          password_hash: 'hash',
        })
      ).rejects.toThrow('Failed to create user');
    });

    it('should create user with minimal data', async () => {
      mockPrismaClient.users.create.mockResolvedValue(mockUser);

      const result = await service.createUser({
        email: 'minimal@example.com',
      });

      expect(result).toEqual(mockUser);
      expect(mockPrismaClient.users.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'minimal@example.com',
          password_hash: undefined,
          oauth_provider: undefined,
          oauth_provider_id: undefined,
        }),
        include: expect.any(Object),
      });
    });

    it('should create user with phone number', async () => {
      mockPrismaClient.users.create.mockResolvedValue(mockUser);

      await service.createUser({
        email: 'phone@example.com',
        phone: '+1234567890',
      });

      expect(mockPrismaClient.users.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_profiles: {
            create: expect.objectContaining({
              phone: '+1234567890',
            }),
          },
        }),
        include: expect.any(Object),
      });
    });

    it('should initialize loyalty with 0 points', async () => {
      mockPrismaClient.users.create.mockResolvedValue(mockUser);

      await service.createUser({
        email: 'loyalty@example.com',
      });

      expect(mockPrismaClient.users.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_loyalty: {
            create: {
              current_points: 0,
            },
          },
        }),
        include: expect.any(Object),
      });
    });

    it('should handle membership ID sequence initialization', async () => {
      mockPrismaClient.membership_id_sequence.findFirst.mockResolvedValue(null);
      mockPrismaClient.membership_id_sequence.upsert.mockResolvedValue({
        id: 1,
        current_user_count: 1,
        created_at: new Date(),
        updated_at: new Date(),
      });
      mockPrismaClient.users.create.mockResolvedValue(mockUser);

      await service.createUser({
        email: 'first@example.com',
      });

      expect(mockPrismaClient.membership_id_sequence.upsert).toHaveBeenCalledWith({
        where: { id: 1 },
        update: { current_user_count: 1 },
        create: { current_user_count: 1 },
      });
    });

    it('should generate membership ID with correct format', async () => {
      // Test various user counts to verify format
      const testCases = [
        { count: 1, expected: '26901001' },    // Block 1, Position 1
        { count: 100, expected: '26901100' },  // Block 1, Position 100
        { count: 101, expected: '26902001' },  // Block 2, Position 1
        { count: 250, expected: '26903050' },  // Block 3, Position 50
      ];

      for (const testCase of testCases) {
        mockPrismaClient.membership_id_sequence.findFirst.mockResolvedValue({
          id: 1,
          current_user_count: testCase.count - 1,
          created_at: new Date(),
          updated_at: new Date(),
        });
        mockPrismaClient.membership_id_sequence.upsert.mockResolvedValue({
          id: 1,
          current_user_count: testCase.count,
          created_at: new Date(),
          updated_at: new Date(),
        });
        mockPrismaClient.users.create.mockResolvedValue(mockUser);

        await service.createUser({
          email: `test${testCase.count}@example.com`,
        });

        expect(mockPrismaClient.users.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            user_profiles: {
              create: expect.objectContaining({
                membership_id: testCase.expected,
              }),
            },
          }),
          include: expect.any(Object),
        });
      }
    });
  });

  describe('updateUserProfile', () => {
    const mockProfile = {
      user_id: 'user-123',
      first_name: 'Updated',
      last_name: 'Name',
      phone: '+9876543210',
      date_of_birth: null,
      avatar_url: null,
      preferences: {},
      membership_id: '26901001',
      created_at: new Date(),
      updated_at: new Date(),
    };

    it('should update existing user profile', async () => {
      mockPrismaClient.user_profiles.upsert.mockResolvedValue(mockProfile);

      const profileData = {
        first_name: 'Updated',
        last_name: 'Name',
        phone: '+9876543210',
      };

      const result = await service.updateUserProfile('user-123', profileData);

      expect(result).toEqual(mockProfile);
      expect(mockPrismaClient.user_profiles.upsert).toHaveBeenCalledWith({
        where: { user_id: 'user-123' },
        update: expect.objectContaining({
          first_name: 'Updated',
          last_name: 'Name',
          phone: '+9876543210',
          updated_at: expect.any(Date),
        }),
        create: expect.objectContaining({
          user_id: 'user-123',
          first_name: 'Updated',
          last_name: 'Name',
          phone: '+9876543210',
          membership_id: expect.any(String),
        }),
      });
    });

    it('should create profile if not exists', async () => {
      mockPrismaClient.membership_id_sequence.findFirst.mockResolvedValue({
        id: 1,
        current_user_count: 5,
        created_at: new Date(),
        updated_at: new Date(),
      });
      mockPrismaClient.membership_id_sequence.upsert.mockResolvedValue({
        id: 1,
        current_user_count: 6,
        created_at: new Date(),
        updated_at: new Date(),
      });
      mockPrismaClient.user_profiles.upsert.mockResolvedValue(mockProfile);

      const result = await service.updateUserProfile('new-user-123', {
        first_name: 'New',
        last_name: 'User',
      });

      expect(result).toEqual(mockProfile);
      expect(mockPrismaClient.user_profiles.upsert).toHaveBeenCalled();
    });

    it('should update date of birth', async () => {
      const dateOfBirth = new Date('1990-01-01');
      mockPrismaClient.user_profiles.upsert.mockResolvedValue({
        ...mockProfile,
        date_of_birth: dateOfBirth,
      });

      await service.updateUserProfile('user-123', {
        date_of_birth: dateOfBirth,
      });

      expect(mockPrismaClient.user_profiles.upsert).toHaveBeenCalledWith({
        where: { user_id: 'user-123' },
        update: expect.objectContaining({
          date_of_birth: dateOfBirth,
        }),
        create: expect.any(Object),
      });
    });

    it('should update preferences', async () => {
      const preferences = { theme: 'dark', language: 'en' };
      mockPrismaClient.user_profiles.upsert.mockResolvedValue({
        ...mockProfile,
        preferences,
      });

      await service.updateUserProfile('user-123', {
        preferences,
      });

      expect(mockPrismaClient.user_profiles.upsert).toHaveBeenCalledWith({
        where: { user_id: 'user-123' },
        update: expect.objectContaining({
          preferences,
        }),
        create: expect.any(Object),
      });
    });

    it('should update avatar URL', async () => {
      mockPrismaClient.user_profiles.upsert.mockResolvedValue({
        ...mockProfile,
        avatar_url: 'https://example.com/avatar.jpg',
      });

      await service.updateUserProfile('user-123', {
        avatar_url: 'https://example.com/avatar.jpg',
      });

      expect(mockPrismaClient.user_profiles.upsert).toHaveBeenCalledWith({
        where: { user_id: 'user-123' },
        update: expect.objectContaining({
          avatar_url: 'https://example.com/avatar.jpg',
        }),
        create: expect.any(Object),
      });
    });

    it('should handle database errors', async () => {
      mockPrismaClient.user_profiles.upsert.mockRejectedValue(new Error('Database error'));

      await expect(
        service.updateUserProfile('user-123', {
          first_name: 'Test',
        })
      ).rejects.toThrow('Failed to update user profile');
    });

    it('should update timestamp on profile update', async () => {
      const startTime = new Date();
      mockPrismaClient.user_profiles.upsert.mockResolvedValue(mockProfile);

      await service.updateUserProfile('user-123', {
        first_name: 'Updated',
      });

      const updateCall = mockPrismaClient.user_profiles.upsert.mock.calls[0][0];
      expect(updateCall.update.updated_at).toBeInstanceOf(Date);
      expect(updateCall.update.updated_at.getTime()).toBeGreaterThanOrEqual(startTime.getTime());
    });
  });

  describe('getUsers', () => {
    const mockUsers = [mockUser];

    it('should retrieve users with pagination', async () => {
      mockPrismaClient.users.findMany.mockResolvedValue(mockUsers);
      mockPrismaClient.users.count.mockResolvedValue(1);

      const result = await service.getUsers({
        page: 1,
        limit: 10,
      });

      expect(result).toEqual({
        users: mockUsers,
        total: 1,
        page: 1,
        totalPages: 1,
      });
      expect(mockPrismaClient.users.findMany).toHaveBeenCalledWith({
        where: {},
        include: { user_profiles: true },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });
    });

    it('should default to page 1 and limit 10', async () => {
      mockPrismaClient.users.findMany.mockResolvedValue(mockUsers);
      mockPrismaClient.users.count.mockResolvedValue(1);

      const result = await service.getUsers({});

      expect(result.page).toBe(1);
      expect(mockPrismaClient.users.findMany).toHaveBeenCalledWith({
        where: {},
        include: { user_profiles: true },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });
    });

    it('should calculate correct skip/offset for pagination', async () => {
      mockPrismaClient.users.findMany.mockResolvedValue([]);
      mockPrismaClient.users.count.mockResolvedValue(50);

      await service.getUsers({
        page: 3,
        limit: 20,
      });

      expect(mockPrismaClient.users.findMany).toHaveBeenCalledWith({
        where: {},
        include: { user_profiles: true },
        skip: 40, // (page 3 - 1) * 20
        take: 20,
        orderBy: { created_at: 'desc' },
      });
    });

    it('should cap limit at 100', async () => {
      mockPrismaClient.users.findMany.mockResolvedValue([]);
      mockPrismaClient.users.count.mockResolvedValue(0);

      await service.getUsers({
        limit: 500, // Try to request 500
      });

      expect(mockPrismaClient.users.findMany).toHaveBeenCalledWith({
        where: {},
        include: { user_profiles: true },
        skip: 0,
        take: 100, // Capped at 100
        orderBy: { created_at: 'desc' },
      });
    });

    it('should search by email', async () => {
      mockPrismaClient.users.findMany.mockResolvedValue(mockUsers);
      mockPrismaClient.users.count.mockResolvedValue(1);

      await service.getUsers({
        search: 'test@example.com',
      });

      expect(mockPrismaClient.users.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { email: { contains: 'test@example.com', mode: 'insensitive' } },
            {
              user_profiles: {
                OR: [
                  { first_name: { contains: 'test@example.com', mode: 'insensitive' } },
                  { last_name: { contains: 'test@example.com', mode: 'insensitive' } },
                ],
              },
            },
          ],
        },
        include: { user_profiles: true },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });
    });

    it('should search by name', async () => {
      mockPrismaClient.users.findMany.mockResolvedValue(mockUsers);
      mockPrismaClient.users.count.mockResolvedValue(1);

      await service.getUsers({
        search: 'John',
      });

      expect(mockPrismaClient.users.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { email: { contains: 'John', mode: 'insensitive' } },
            {
              user_profiles: {
                OR: [
                  { first_name: { contains: 'John', mode: 'insensitive' } },
                  { last_name: { contains: 'John', mode: 'insensitive' } },
                ],
              },
            },
          ],
        },
        include: { user_profiles: true },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });
    });

    it('should filter by role', async () => {
      mockPrismaClient.users.findMany.mockResolvedValue([]);
      mockPrismaClient.users.count.mockResolvedValue(0);

      await service.getUsers({
        role: 'admin',
      });

      expect(mockPrismaClient.users.findMany).toHaveBeenCalledWith({
        where: { role: 'admin' },
        include: { user_profiles: true },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });
    });

    it('should combine search and role filter', async () => {
      mockPrismaClient.users.findMany.mockResolvedValue([]);
      mockPrismaClient.users.count.mockResolvedValue(0);

      await service.getUsers({
        search: 'admin',
        role: 'super_admin',
      });

      expect(mockPrismaClient.users.findMany).toHaveBeenCalledWith({
        where: {
          role: 'super_admin',
          OR: expect.any(Array),
        },
        include: { user_profiles: true },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });
    });

    it('should calculate total pages correctly', async () => {
      mockPrismaClient.users.findMany.mockResolvedValue([]);
      mockPrismaClient.users.count.mockResolvedValue(25);

      const result = await service.getUsers({
        limit: 10,
      });

      expect(result.totalPages).toBe(3); // Math.ceil(25 / 10)
    });

    it('should handle empty results', async () => {
      mockPrismaClient.users.findMany.mockResolvedValue([]);
      mockPrismaClient.users.count.mockResolvedValue(0);

      const result = await service.getUsers({});

      expect(result.users).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    it('should handle database errors', async () => {
      mockPrismaClient.users.findMany.mockRejectedValue(new Error('Database error'));

      await expect(service.getUsers({})).rejects.toThrow('Failed to fetch users');
    });

    it('should order users by created_at descending', async () => {
      mockPrismaClient.users.findMany.mockResolvedValue(mockUsers);
      mockPrismaClient.users.count.mockResolvedValue(1);

      await service.getUsers({});

      expect(mockPrismaClient.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { created_at: 'desc' },
        })
      );
    });
  });

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      mockPrismaClient.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      const result = await service.testConnection();

      expect(result).toBe(true);
      expect(mockPrismaClient.$queryRaw).toHaveBeenCalled();
    });

    it('should return false for failed connection', async () => {
      mockPrismaClient.$queryRaw.mockRejectedValue(new Error('Connection failed'));

      const result = await service.testConnection();

      expect(result).toBe(false);
    });

    it('should handle network timeouts', async () => {
      mockPrismaClient.$queryRaw.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 100);
        });
      });

      const result = await service.testConnection();

      expect(result).toBe(false);
    });
  });
});

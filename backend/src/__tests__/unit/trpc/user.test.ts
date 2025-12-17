import { TRPCError } from '@trpc/server';

// Create mock userService instance
const mockUserService = {
  getProfile: jest.fn(),
  updateProfile: jest.fn(),
  updateAvatar: jest.fn(),
  deleteAvatar: jest.fn(),
};

// Mock the userService before importing the router
jest.mock('../../../services/userService', () => ({
  userService: mockUserService,
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import router and tRPC test caller after mocks are set up
import { userRouter } from '../../../trpc/routers/user';
import type { Context } from '../../../trpc/context';

/**
 * Helper to create a tRPC caller with context
 */
const createCaller = (ctx: Context) => {
  return userRouter.createCaller(ctx);
};

describe('tRPC User Router', () => {
  const customerUser = { id: 'customer-1', role: 'customer' as const, email: 'customer@test.com' };

  const mockProfile = {
    userId: 'customer-1',
    firstName: 'John',
    lastName: 'Doe',
    phone: '+1234567890',
    dateOfBirth: new Date('1990-01-01'),
    preferences: { theme: 'dark', newsletter: true },
    avatarUrl: 'https://example.com/avatar.jpg',
    membershipId: 'MEM123456',
    gender: 'male',
    occupation: 'Engineer',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-15'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== getProfile Tests ==========
  describe('getProfile', () => {
    it('should return user profile for authenticated user', async () => {
      const caller = createCaller({ user: customerUser });
      mockUserService.getProfile.mockResolvedValue(mockProfile);

      const result = await caller.getProfile();

      expect(mockUserService.getProfile).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual(mockProfile);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.getProfile()).rejects.toThrow(TRPCError);
      await expect(caller.getProfile()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockUserService.getProfile.mockRejectedValue(new Error('Profile not found'));

      await expect(caller.getProfile()).rejects.toThrow('Profile not found');
    });
  });

  // ========== updateProfile Tests ==========
  describe('updateProfile', () => {
    it('should update profile with all fields', async () => {
      const caller = createCaller({ user: customerUser });
      const updateData = {
        firstName: 'Jane',
        lastName: 'Smith',
        phone: '+9876543210',
        dateOfBirth: '1995-05-15',
        gender: 'female',
        occupation: 'Designer',
        preferences: { theme: 'light' },
      };
      const updatedProfile = { ...mockProfile, ...updateData };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateProfile(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should update profile with firstName only', async () => {
      const caller = createCaller({ user: customerUser });
      const updateData = { firstName: 'Jane' };
      const updatedProfile = { ...mockProfile, firstName: 'Jane' };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateProfile(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should update profile with lastName only', async () => {
      const caller = createCaller({ user: customerUser });
      const updateData = { lastName: 'Smith' };
      const updatedProfile = { ...mockProfile, lastName: 'Smith' };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateProfile(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should update profile with phone only', async () => {
      const caller = createCaller({ user: customerUser });
      const updateData = { phone: '+9999999999' };
      const updatedProfile = { ...mockProfile, phone: '+9999999999' };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateProfile(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should update profile with dateOfBirth', async () => {
      const caller = createCaller({ user: customerUser });
      const updateData = { dateOfBirth: '1992-03-20' };
      const updatedProfile = { ...mockProfile, dateOfBirth: new Date('1992-03-20') };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateProfile(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should update profile with gender only', async () => {
      const caller = createCaller({ user: customerUser });
      const updateData = { gender: 'female' };
      const updatedProfile = { ...mockProfile, gender: 'female' };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateProfile(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should update profile with occupation only', async () => {
      const caller = createCaller({ user: customerUser });
      const updateData = { occupation: 'Doctor' };
      const updatedProfile = { ...mockProfile, occupation: 'Doctor' };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateProfile(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should update profile with preferences only', async () => {
      const caller = createCaller({ user: customerUser });
      const updateData = { preferences: { theme: 'light', newsletter: false } };
      const updatedProfile = { ...mockProfile, preferences: { theme: 'light', newsletter: false } };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateProfile(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should reject empty firstName', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.updateProfile({ firstName: '' })
      ).rejects.toThrow();
    });

    it('should handle empty string dateOfBirth by transforming to undefined', async () => {
      const caller = createCaller({ user: customerUser });
      mockUserService.updateProfile.mockResolvedValue(mockProfile);

      await caller.updateProfile({ dateOfBirth: '' });

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', {
        dateOfBirth: undefined,
      });
    });

    it('should reject invalid date format', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.updateProfile({ dateOfBirth: 'invalid-date' })
      ).rejects.toThrow();
    });

    it('should accept valid date formats', async () => {
      const caller = createCaller({ user: customerUser });
      mockUserService.updateProfile.mockResolvedValue(mockProfile);

      const validDates = [
        '2024-01-15',
        '2024/01/15',
        '01/15/2024',
        '2024-01-15T00:00:00Z',
      ];

      for (const date of validDates) {
        await caller.updateProfile({ dateOfBirth: date });
      }

      expect(mockUserService.updateProfile).toHaveBeenCalledTimes(4);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.updateProfile({ firstName: 'Jane' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.updateProfile({ firstName: 'Jane' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockUserService.updateProfile.mockRejectedValue(new Error('Database error'));

      await expect(
        caller.updateProfile({ firstName: 'Jane' })
      ).rejects.toThrow('Database error');
    });
  });

  // ========== getSettings Tests ==========
  describe('getSettings', () => {
    it('should return user settings for authenticated user', async () => {
      const caller = createCaller({ user: customerUser });
      mockUserService.getProfile.mockResolvedValue(mockProfile);

      const result = await caller.getSettings();

      expect(mockUserService.getProfile).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual({
        preferences: mockProfile.preferences,
        gender: mockProfile.gender,
        occupation: mockProfile.occupation,
      });
    });

    it('should return settings with undefined gender and occupation', async () => {
      const caller = createCaller({ user: customerUser });
      const profileWithoutExtras = {
        ...mockProfile,
        gender: undefined,
        occupation: undefined,
      };
      mockUserService.getProfile.mockResolvedValue(profileWithoutExtras);

      const result = await caller.getSettings();

      expect(result).toEqual({
        preferences: mockProfile.preferences,
        gender: undefined,
        occupation: undefined,
      });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.getSettings()).rejects.toThrow(TRPCError);
      await expect(caller.getSettings()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockUserService.getProfile.mockRejectedValue(new Error('Profile not found'));

      await expect(caller.getSettings()).rejects.toThrow('Profile not found');
    });
  });

  // ========== updateSettings Tests ==========
  describe('updateSettings', () => {
    it('should update settings with all fields', async () => {
      const caller = createCaller({ user: customerUser });
      const updateData = {
        preferences: { theme: 'light', newsletter: false },
        gender: 'female',
        occupation: 'Designer',
      };
      const updatedProfile = { ...mockProfile, ...updateData };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateSettings(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should update settings with preferences only', async () => {
      const caller = createCaller({ user: customerUser });
      const updateData = { preferences: { theme: 'dark' } };
      const updatedProfile = { ...mockProfile, preferences: { theme: 'dark' } };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateSettings(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should update settings with gender only', async () => {
      const caller = createCaller({ user: customerUser });
      const updateData = { gender: 'non-binary' };
      const updatedProfile = { ...mockProfile, gender: 'non-binary' };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateSettings(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should update settings with occupation only', async () => {
      const caller = createCaller({ user: customerUser });
      const updateData = { occupation: 'Teacher' };
      const updatedProfile = { ...mockProfile, occupation: 'Teacher' };
      mockUserService.updateProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateSettings(updateData);

      expect(mockUserService.updateProfile).toHaveBeenCalledWith('customer-1', updateData);
      expect(result).toEqual(updatedProfile);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.updateSettings({ preferences: { theme: 'light' } })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.updateSettings({ preferences: { theme: 'light' } })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockUserService.updateProfile.mockRejectedValue(new Error('Database error'));

      await expect(
        caller.updateSettings({ preferences: { theme: 'light' } })
      ).rejects.toThrow('Database error');
    });
  });

  // ========== updateAvatar Tests ==========
  describe('updateAvatar', () => {
    it('should update avatar successfully', async () => {
      const caller = createCaller({ user: customerUser });
      const avatarUrl = 'https://example.com/new-avatar.jpg';
      const updatedProfile = { ...mockProfile, avatarUrl };
      mockUserService.updateAvatar.mockResolvedValue(undefined);
      mockUserService.getProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateAvatar({ avatarUrl });

      expect(mockUserService.updateAvatar).toHaveBeenCalledWith('customer-1', avatarUrl);
      expect(mockUserService.getProfile).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual(updatedProfile);
    });

    it('should reject empty avatarUrl', async () => {
      const caller = createCaller({ user: customerUser });

      await expect(
        caller.updateAvatar({ avatarUrl: '' })
      ).rejects.toThrow();
    });

    it('should accept emoji avatar URL', async () => {
      const caller = createCaller({ user: customerUser });
      const emojiUrl = 'emoji://😀';
      const updatedProfile = { ...mockProfile, avatarUrl: emojiUrl };
      mockUserService.updateAvatar.mockResolvedValue(undefined);
      mockUserService.getProfile.mockResolvedValue(updatedProfile);

      const result = await caller.updateAvatar({ avatarUrl: emojiUrl });

      expect(mockUserService.updateAvatar).toHaveBeenCalledWith('customer-1', emojiUrl);
      expect(result).toEqual(updatedProfile);
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(
        caller.updateAvatar({ avatarUrl: 'https://example.com/avatar.jpg' })
      ).rejects.toThrow(TRPCError);
      await expect(
        caller.updateAvatar({ avatarUrl: 'https://example.com/avatar.jpg' })
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle updateAvatar service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockUserService.updateAvatar.mockRejectedValue(new Error('Upload failed'));

      await expect(
        caller.updateAvatar({ avatarUrl: 'https://example.com/avatar.jpg' })
      ).rejects.toThrow('Upload failed');
    });

    it('should handle getProfile service errors after avatar update', async () => {
      const caller = createCaller({ user: customerUser });
      mockUserService.updateAvatar.mockResolvedValue(undefined);
      mockUserService.getProfile.mockRejectedValue(new Error('Profile fetch failed'));

      await expect(
        caller.updateAvatar({ avatarUrl: 'https://example.com/avatar.jpg' })
      ).rejects.toThrow('Profile fetch failed');
    });
  });

  // ========== deleteAvatar Tests ==========
  describe('deleteAvatar', () => {
    it('should delete avatar successfully', async () => {
      const caller = createCaller({ user: customerUser });
      mockUserService.deleteAvatar.mockResolvedValue(undefined);

      const result = await caller.deleteAvatar();

      expect(mockUserService.deleteAvatar).toHaveBeenCalledWith('customer-1');
      expect(result).toEqual({ success: true });
    });

    it('should throw UNAUTHORIZED when user is not authenticated', async () => {
      const caller = createCaller({ user: null });

      await expect(caller.deleteAvatar()).rejects.toThrow(TRPCError);
      await expect(caller.deleteAvatar()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('should handle service errors', async () => {
      const caller = createCaller({ user: customerUser });
      mockUserService.deleteAvatar.mockRejectedValue(new Error('Delete failed'));

      await expect(caller.deleteAvatar()).rejects.toThrow('Delete failed');
    });
  });
});

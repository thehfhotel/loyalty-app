/**
 * AdminConfigService Unit Tests
 * Tests admin configuration loading and role checking
 */

import fs from 'fs';
import { logger } from '../../../utils/logger';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Import after mocking
import { adminConfigService } from '../../../services/adminConfigService';

describe('AdminConfigService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Reset the singleton instance by reloading config
    adminConfigService.reloadConfig();
  });

  describe('Configuration Loading', () => {
    it('should load admin config successfully', () => {
      const mockConfig = {
        adminEmails: ['admin1@example.com', 'admin2@example.com'],
        superAdminEmails: ['superadmin@example.com'],
        description: 'Test admin configuration',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));

      adminConfigService.reloadConfig();

      expect(fs.existsSync).toHaveBeenCalled();
      expect(fs.readFileSync).toHaveBeenCalledWith(expect.any(String), 'utf8');
      expect(logger.info).toHaveBeenCalledWith(
        'Admin config loaded: 2 admin emails, 1 super admin emails configured'
      );
    });

    it('should handle missing config file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      adminConfigService.reloadConfig();

      expect(logger.warn).toHaveBeenCalledWith(
        'Admin config file not found, no admin emails configured'
      );
    });

    it('should handle invalid JSON in config file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid-json-{]');

      adminConfigService.reloadConfig();

      expect(logger.error).toHaveBeenCalledWith(
        'Error loading admin config:',
        expect.any(Error)
      );
    });

    it('should handle backward compatibility when superAdminEmails is missing', () => {
      const oldConfig = {
        adminEmails: ['admin@example.com'],
        description: 'Old config without superAdminEmails',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(oldConfig));

      adminConfigService.reloadConfig();

      expect(logger.info).toHaveBeenCalledWith(
        'Admin config loaded: 1 admin emails, 0 super admin emails configured'
      );
    });

    it('should handle file read errors', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      adminConfigService.reloadConfig();

      expect(logger.error).toHaveBeenCalledWith(
        'Error loading admin config:',
        expect.any(Error)
      );
    });

    it('should handle empty config file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('');

      adminConfigService.reloadConfig();

      expect(logger.error).toHaveBeenCalled();
    });

    it('should use correct config file path', () => {
      const mockConfig = {
        adminEmails: [],
        superAdminEmails: [],
        description: 'Test',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));

      adminConfigService.reloadConfig();

      expect(fs.existsSync).toHaveBeenCalledWith(expect.stringContaining('admins.json'));
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('admins.json'),
        'utf8'
      );
    });
  });

  describe('isAdminEmail', () => {
    beforeEach(() => {
      const mockConfig = {
        adminEmails: ['admin@example.com', 'Admin2@Example.com'],
        superAdminEmails: ['superadmin@example.com'],
        description: 'Test config',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
      adminConfigService.reloadConfig();
    });

    it('should return true for admin email', () => {
      const result = adminConfigService.isAdminEmail('admin@example.com');
      expect(result).toBe(true);
    });

    it('should return false for non-admin email', () => {
      const result = adminConfigService.isAdminEmail('user@example.com');
      expect(result).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(adminConfigService.isAdminEmail('ADMIN@EXAMPLE.COM')).toBe(true);
      expect(adminConfigService.isAdminEmail('admin@EXAMPLE.com')).toBe(true);
      expect(adminConfigService.isAdminEmail('Admin@Example.Com')).toBe(true);
    });

    it('should trim whitespace', () => {
      expect(adminConfigService.isAdminEmail('  admin@example.com  ')).toBe(true);
      expect(adminConfigService.isAdminEmail('admin@example.com\n')).toBe(true);
      expect(adminConfigService.isAdminEmail('\tadmin@example.com')).toBe(true);
    });

    it('should handle config with mixed case', () => {
      const result = adminConfigService.isAdminEmail('admin2@example.com');
      expect(result).toBe(true);
    });

    it('should return false when config is not loaded', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      adminConfigService.reloadConfig();

      const result = adminConfigService.isAdminEmail('admin@example.com');
      expect(result).toBe(false);
    });

    it('should not match super admin emails', () => {
      const result = adminConfigService.isAdminEmail('superadmin@example.com');
      expect(result).toBe(false);
    });

    it('should handle partial email matches correctly', () => {
      expect(adminConfigService.isAdminEmail('admin@example.co')).toBe(false);
      expect(adminConfigService.isAdminEmail('admin@example.com.uk')).toBe(false);
      expect(adminConfigService.isAdminEmail('xadmin@example.com')).toBe(false);
    });
  });

  describe('isSuperAdminEmail', () => {
    beforeEach(() => {
      const mockConfig = {
        adminEmails: ['admin@example.com'],
        superAdminEmails: ['superadmin@example.com', 'SuperAdmin2@Example.com'],
        description: 'Test config',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
      adminConfigService.reloadConfig();
    });

    it('should return true for super admin email', () => {
      const result = adminConfigService.isSuperAdminEmail('superadmin@example.com');
      expect(result).toBe(true);
    });

    it('should return false for non-super-admin email', () => {
      const result = adminConfigService.isSuperAdminEmail('user@example.com');
      expect(result).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(adminConfigService.isSuperAdminEmail('SUPERADMIN@EXAMPLE.COM')).toBe(true);
      expect(adminConfigService.isSuperAdminEmail('superadmin@EXAMPLE.com')).toBe(true);
      expect(adminConfigService.isSuperAdminEmail('SuperAdmin@Example.Com')).toBe(true);
    });

    it('should trim whitespace', () => {
      expect(adminConfigService.isSuperAdminEmail('  superadmin@example.com  ')).toBe(true);
      expect(adminConfigService.isSuperAdminEmail('superadmin@example.com\n')).toBe(true);
      expect(adminConfigService.isSuperAdminEmail('\tsuperadmin@example.com')).toBe(true);
    });

    it('should handle config with mixed case', () => {
      const result = adminConfigService.isSuperAdminEmail('superadmin2@example.com');
      expect(result).toBe(true);
    });

    it('should return false when config is not loaded', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      adminConfigService.reloadConfig();

      const result = adminConfigService.isSuperAdminEmail('superadmin@example.com');
      expect(result).toBe(false);
    });

    it('should not match regular admin emails', () => {
      const result = adminConfigService.isSuperAdminEmail('admin@example.com');
      expect(result).toBe(false);
    });

    it('should handle partial email matches correctly', () => {
      expect(adminConfigService.isSuperAdminEmail('superadmin@example.co')).toBe(false);
      expect(adminConfigService.isSuperAdminEmail('superadmin@example.com.uk')).toBe(false);
      expect(adminConfigService.isSuperAdminEmail('xsuperadmin@example.com')).toBe(false);
    });
  });

  describe('getRequiredRole', () => {
    beforeEach(() => {
      const mockConfig = {
        adminEmails: ['admin@example.com'],
        superAdminEmails: ['superadmin@example.com'],
        description: 'Test config',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
      adminConfigService.reloadConfig();
    });

    it('should return super_admin for super admin email', () => {
      const result = adminConfigService.getRequiredRole('superadmin@example.com');
      expect(result).toBe('super_admin');
    });

    it('should return admin for admin email', () => {
      const result = adminConfigService.getRequiredRole('admin@example.com');
      expect(result).toBe('admin');
    });

    it('should return null for regular user email', () => {
      const result = adminConfigService.getRequiredRole('user@example.com');
      expect(result).toBeNull();
    });

    it('should prioritize super_admin over admin', () => {
      // Add an email to both lists
      const dualRoleConfig = {
        adminEmails: ['both@example.com'],
        superAdminEmails: ['both@example.com'],
        description: 'Test dual role',
      };

      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(dualRoleConfig));
      adminConfigService.reloadConfig();

      const result = adminConfigService.getRequiredRole('both@example.com');
      expect(result).toBe('super_admin');
    });

    it('should be case-insensitive', () => {
      expect(adminConfigService.getRequiredRole('ADMIN@EXAMPLE.COM')).toBe('admin');
      expect(adminConfigService.getRequiredRole('SUPERADMIN@EXAMPLE.COM')).toBe('super_admin');
    });

    it('should trim whitespace', () => {
      expect(adminConfigService.getRequiredRole('  admin@example.com  ')).toBe('admin');
      expect(adminConfigService.getRequiredRole('  superadmin@example.com  ')).toBe('super_admin');
    });

    it('should return null when config is not loaded', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      adminConfigService.reloadConfig();

      const result = adminConfigService.getRequiredRole('admin@example.com');
      expect(result).toBeNull();
    });
  });

  describe('getAdminEmails', () => {
    it('should return list of admin emails', () => {
      const mockConfig = {
        adminEmails: ['admin1@example.com', 'admin2@example.com'],
        superAdminEmails: ['superadmin@example.com'],
        description: 'Test config',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
      adminConfigService.reloadConfig();

      const result = adminConfigService.getAdminEmails();
      expect(result).toEqual(['admin1@example.com', 'admin2@example.com']);
    });

    it('should return empty array when config not loaded', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      adminConfigService.reloadConfig();

      const result = adminConfigService.getAdminEmails();
      expect(result).toEqual([]);
    });

    it('should return empty array for empty admin list', () => {
      const mockConfig = {
        adminEmails: [],
        superAdminEmails: ['superadmin@example.com'],
        description: 'No admins',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
      adminConfigService.reloadConfig();

      const result = adminConfigService.getAdminEmails();
      expect(result).toEqual([]);
    });
  });

  describe('getSuperAdminEmails', () => {
    it('should return list of super admin emails', () => {
      const mockConfig = {
        adminEmails: ['admin@example.com'],
        superAdminEmails: ['superadmin1@example.com', 'superadmin2@example.com'],
        description: 'Test config',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
      adminConfigService.reloadConfig();

      const result = adminConfigService.getSuperAdminEmails();
      expect(result).toEqual(['superadmin1@example.com', 'superadmin2@example.com']);
    });

    it('should return empty array when config not loaded', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      adminConfigService.reloadConfig();

      const result = adminConfigService.getSuperAdminEmails();
      expect(result).toEqual([]);
    });

    it('should return empty array for empty super admin list', () => {
      const mockConfig = {
        adminEmails: ['admin@example.com'],
        superAdminEmails: [],
        description: 'No super admins',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
      adminConfigService.reloadConfig();

      const result = adminConfigService.getSuperAdminEmails();
      expect(result).toEqual([]);
    });
  });

  describe('reloadConfig', () => {
    it('should reload configuration from file', () => {
      const initialConfig = {
        adminEmails: ['admin1@example.com'],
        superAdminEmails: [],
        description: 'Initial',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(initialConfig));
      adminConfigService.reloadConfig();

      expect(adminConfigService.isAdminEmail('admin1@example.com')).toBe(true);

      // Update config
      const updatedConfig = {
        adminEmails: ['admin2@example.com'],
        superAdminEmails: [],
        description: 'Updated',
      };

      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(updatedConfig));
      adminConfigService.reloadConfig();

      expect(adminConfigService.isAdminEmail('admin1@example.com')).toBe(false);
      expect(adminConfigService.isAdminEmail('admin2@example.com')).toBe(true);
    });

    it('should handle reload errors gracefully', () => {
      const initialConfig = {
        adminEmails: ['admin@example.com'],
        superAdminEmails: [],
        description: 'Valid',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(initialConfig));
      adminConfigService.reloadConfig();

      // Cause an error on reload
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('File read error');
      });
      adminConfigService.reloadConfig();

      expect(logger.error).toHaveBeenCalledWith('Error loading admin config:', expect.any(Error));
    });

    it('should log info message on successful reload', () => {
      const mockConfig = {
        adminEmails: ['admin@example.com'],
        superAdminEmails: ['superadmin@example.com'],
        description: 'Test',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));

      adminConfigService.reloadConfig();

      expect(logger.info).toHaveBeenCalledWith(
        'Admin config loaded: 1 admin emails, 1 super admin emails configured'
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle email with special characters', () => {
      const mockConfig = {
        adminEmails: ['admin+test@example.com', 'admin.name@sub.example.com'],
        superAdminEmails: [],
        description: 'Special chars',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
      adminConfigService.reloadConfig();

      expect(adminConfigService.isAdminEmail('admin+test@example.com')).toBe(true);
      expect(adminConfigService.isAdminEmail('admin.name@sub.example.com')).toBe(true);
    });

    it('should handle very long email addresses', () => {
      const longEmail = 'verylongemailaddressthatshouldstillwork@verylongdomainname.example.com';
      const mockConfig = {
        adminEmails: [longEmail],
        superAdminEmails: [],
        description: 'Long email',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
      adminConfigService.reloadConfig();

      expect(adminConfigService.isAdminEmail(longEmail)).toBe(true);
    });

    it('should handle empty string email', () => {
      const mockConfig = {
        adminEmails: ['admin@example.com'],
        superAdminEmails: [],
        description: 'Test',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
      adminConfigService.reloadConfig();

      expect(adminConfigService.isAdminEmail('')).toBe(false);
      expect(adminConfigService.isSuperAdminEmail('')).toBe(false);
      expect(adminConfigService.getRequiredRole('')).toBeNull();
    });

    it('should handle large number of admin emails', () => {
      const adminEmails = Array.from({ length: 1000 }, (_, i) => `admin${i}@example.com`);
      const mockConfig = {
        adminEmails,
        superAdminEmails: [],
        description: 'Many admins',
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
      adminConfigService.reloadConfig();

      expect(adminConfigService.isAdminEmail('admin500@example.com')).toBe(true);
      expect(adminConfigService.isAdminEmail('admin999@example.com')).toBe(true);
      expect(adminConfigService.isAdminEmail('admin1000@example.com')).toBe(false);
    });
  });
});

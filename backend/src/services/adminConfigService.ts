import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

interface AdminConfig {
  adminEmails: string[];
  superAdminEmails: string[];
  description: string;
}

class AdminConfigService {
  private config: AdminConfig | null = null;
  private configPath: string;

  constructor() {
    this.configPath = path.join(__dirname, '../../config/admins.json');
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(configData);
        
        // Ensure backward compatibility - add superAdminEmails if not present
        if (!this.config?.superAdminEmails) {
          this.config!.superAdminEmails = [];
        }
        
        logger.info(`Admin config loaded: ${this.config?.adminEmails.length} admin emails, ${this.config?.superAdminEmails.length} super admin emails configured`);
      } else {
        logger.warn('Admin config file not found, no admin emails configured');
        this.config = { adminEmails: [], superAdminEmails: [], description: 'No admin emails configured' };
      }
    } catch (error) {
      logger.error('Error loading admin config:', error);
      this.config = { adminEmails: [], superAdminEmails: [], description: 'Error loading admin config' };
    }
  }

  public isAdminEmail(email: string): boolean {
    if (!this.config) {
      return false;
    }
    
    const normalizedEmail = email.toLowerCase().trim();
    return this.config.adminEmails.some(adminEmail => 
      adminEmail.toLowerCase().trim() === normalizedEmail
    );
  }

  public isSuperAdminEmail(email: string): boolean {
    if (!this.config) {
      return false;
    }
    
    const normalizedEmail = email.toLowerCase().trim();
    return this.config.superAdminEmails.some(superAdminEmail => 
      superAdminEmail.toLowerCase().trim() === normalizedEmail
    );
  }

  public getRequiredRole(email: string): 'super_admin' | 'admin' | null {
    if (!this.config) {
      return null;
    }

    const normalizedEmail = email.toLowerCase().trim();
    
    // Super admin takes precedence over admin
    if (this.isSuperAdminEmail(normalizedEmail)) {
      return 'super_admin';
    }
    
    if (this.isAdminEmail(normalizedEmail)) {
      return 'admin';
    }
    
    return null;
  }

  public getAdminEmails(): string[] {
    return this.config?.adminEmails || [];
  }

  public getSuperAdminEmails(): string[] {
    return this.config?.superAdminEmails || [];
  }

  public reloadConfig(): void {
    this.loadConfig();
  }
}

export const adminConfigService = new AdminConfigService();
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { ImapFlow } from 'imapflow';
import { logger } from '../utils/logger';

export function generateVerificationCode(): string {
  // Use uppercase only - frontend normalizes input to uppercase for user convenience
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const codeLength = 8;
  const maxUnbiased = 256 - (256 % chars.length);
  let code = '';
  while (code.length < codeLength) {
    const byte = crypto.randomBytes(1)[0] as number;
    if (byte >= maxUnbiased) {
      continue;
    }
    code += chars.charAt(byte % chars.length);
  }
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

export interface EmailHealthStatus {
  configured: boolean;
  smtpConnected: boolean;
  imapConnected: boolean;
  lastTestResult?: {
    success: boolean;
    timestamp: string;
    error?: string;
    deliveryTimeMs?: number;
  };
}

export interface EmailTestResult {
  success: boolean;
  smtpSent: boolean;
  imapReceived: boolean;
  deliveryTimeMs?: number;
  error?: string;
  testId: string;
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private isConfigured: boolean;
  private lastTestResult?: EmailHealthStatus['lastTestResult'];

  constructor() {
    // Check if SMTP is configured (both user and pass must be set)
    this.isConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS);

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.privateemail.com',
      port: parseInt(process.env.SMTP_PORT ?? '465'),
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Add timeouts to prevent hanging on connection issues
      connectionTimeout: 5000, // 5 seconds to establish connection
      greetingTimeout: 5000,   // 5 seconds for server greeting
      socketTimeout: 10000,    // 10 seconds for socket inactivity
    });
  }

  /**
   * Get email service health status
   */
  async getHealthStatus(): Promise<EmailHealthStatus> {
    const status: EmailHealthStatus = {
      configured: this.isConfigured,
      smtpConnected: false,
      imapConnected: false,
      lastTestResult: this.lastTestResult,
    };

    if (!this.isConfigured) {
      return status;
    }

    // Test SMTP connection
    try {
      await this.transporter.verify();
      status.smtpConnected = true;
    } catch (error) {
      logger.warn('SMTP connection check failed', { error: error instanceof Error ? error.message : error });
    }

    // Test IMAP connection
    try {
      const imapConnected = await this.testImapConnection();
      status.imapConnected = imapConnected;
    } catch (error) {
      logger.warn('IMAP connection check failed', { error: error instanceof Error ? error.message : error });
    }

    return status;
  }

  /**
   * Test IMAP connection
   */
  private async testImapConnection(): Promise<boolean> {
    if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASS) {
      return false;
    }

    const client = new ImapFlow({
      host: process.env.IMAP_HOST,
      port: parseInt(process.env.IMAP_PORT ?? '993'),
      secure: true,
      auth: {
        user: process.env.IMAP_USER,
        pass: process.env.IMAP_PASS,
      },
      logger: false,
    });

    try {
      await client.connect();
      await client.logout();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Test email delivery end-to-end:
   * 1. Send a test email to self (SMTP_FROM -> SMTP_FROM)
   * 2. Wait for email to appear in IMAP inbox
   * 3. Delete the test email
   * 4. Return result
   */
  async testEmailDelivery(timeoutMs: number = 30000): Promise<EmailTestResult> {
    const testId = `email-test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const startTime = Date.now();

    const result: EmailTestResult = {
      success: false,
      smtpSent: false,
      imapReceived: false,
      testId,
    };

    // Check if configured
    if (!this.isConfigured) {
      result.error = 'SMTP not configured (missing SMTP_USER or SMTP_PASS)';
      this.updateLastTestResult(result);
      return result;
    }

    const imapConfigured = !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS);
    if (!imapConfigured) {
      result.error = 'IMAP not configured (missing IMAP_HOST, IMAP_USER, or IMAP_PASS)';
      this.updateLastTestResult(result);
      return result;
    }

    const testEmail = process.env.SMTP_FROM ?? process.env.SMTP_USER;
    if (!testEmail) {
      result.error = 'No email address configured (SMTP_FROM or SMTP_USER)';
      this.updateLastTestResult(result);
      return result;
    }

    // Step 1: Send test email via SMTP
    try {
      await this.transporter.sendMail({
        from: testEmail,
        to: testEmail,
        subject: `[EMAIL TEST] ${testId}`,
        text: `This is an automated email delivery test.\n\nTest ID: ${testId}\nTimestamp: ${new Date().toISOString()}\n\nThis email will be automatically deleted.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 2px solid #4CAF50; border-radius: 10px;">
            <h2 style="color: #4CAF50;">✅ Email Delivery Test</h2>
            <p>This is an automated email delivery test.</p>
            <table style="width: 100%; margin: 20px 0;">
              <tr><td><strong>Test ID:</strong></td><td><code>${testId}</code></td></tr>
              <tr><td><strong>Timestamp:</strong></td><td>${new Date().toISOString()}</td></tr>
            </table>
            <p style="color: #666; font-size: 12px;">This email will be automatically deleted.</p>
          </div>
        `,
      });
      result.smtpSent = true;
      logger.info('Test email sent via SMTP', { testId, to: testEmail });
    } catch (error) {
      result.error = `SMTP send failed: ${error instanceof Error ? error.message : String(error)}`;
      this.updateLastTestResult(result);
      return result;
    }

    // Step 2: Wait for email in IMAP inbox
    const client = new ImapFlow({
      host: process.env.IMAP_HOST!,
      port: parseInt(process.env.IMAP_PORT ?? '993'),
      secure: true,
      auth: {
        user: process.env.IMAP_USER!,
        pass: process.env.IMAP_PASS!,
      },
      logger: false,
    });

    try {
      await client.connect();

      const pollInterval = 2000; // Check every 2 seconds
      const maxAttempts = Math.ceil(timeoutMs / pollInterval);

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Wait before checking (except first attempt)
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // Lock inbox for reading
        const lock = await client.getMailboxLock('INBOX');
        try {
          // Search for our test email
          const searchResult = await client.search({ subject: testId });
          const messages = Array.isArray(searchResult) ? searchResult : [];

          if (messages.length > 0) {
            result.imapReceived = true;
            result.deliveryTimeMs = Date.now() - startTime;

            // Delete the test email
            await client.messageDelete(messages, { uid: true });
            logger.info('Test email received and deleted', {
              testId,
              deliveryTimeMs: result.deliveryTimeMs,
              attempts: attempt + 1
            });
            break;
          }
        } finally {
          lock.release();
        }
      }

      await client.logout();
    } catch (error) {
      result.error = `IMAP check failed: ${error instanceof Error ? error.message : String(error)}`;
      try { await client.logout(); } catch { /* ignore */ }
      this.updateLastTestResult(result);
      return result;
    }

    // Final result
    if (result.smtpSent && result.imapReceived) {
      result.success = true;
    } else if (result.smtpSent && !result.imapReceived) {
      result.error = `Email sent but not received within ${timeoutMs}ms timeout`;
    }

    this.updateLastTestResult(result);
    return result;
  }

  private updateLastTestResult(result: EmailTestResult): void {
    this.lastTestResult = {
      success: result.success,
      timestamp: new Date().toISOString(),
      error: result.error,
      deliveryTimeMs: result.deliveryTimeMs,
    };
  }

  async sendVerificationEmail(to: string, code: string): Promise<void> {
    if (!this.isConfigured) {
      logger.warn('SMTP not configured, skipping verification email', { to });
      return;
    }

    const from = process.env.SMTP_FROM ?? 'noreply@example.com';

    await this.transporter.sendMail({
      from,
      to,
      subject: 'Verify your new email address',
      text: `Your verification code is: ${code}\n\nThis code expires in 1 hour.\n\nIf you didn't request this change, please ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Verify your new email address</h2>
          <p>Your verification code is:</p>
          <h1 style="font-size: 32px; letter-spacing: 4px; background: #f5f5f5; padding: 20px; text-align: center; font-family: monospace;">${code}</h1>
          <p>This code expires in 1 hour.</p>
          <p style="color: #666; font-size: 12px;">If you didn't request this change, please ignore this email.</p>
        </div>
      `,
    });

    logger.info('Verification email sent', { to });
  }

  async sendRegistrationVerificationEmail(to: string, code: string): Promise<void> {
    if (!this.isConfigured) {
      logger.warn('SMTP not configured, skipping registration verification email', { to });
      return;
    }

    const from = process.env.SMTP_FROM ?? 'noreply@example.com';

    await this.transporter.sendMail({
      from,
      to,
      subject: 'Welcome! Please verify your email address',
      text: `Welcome to our loyalty program!\n\nYour verification code is: ${code}\n\nThis code expires in 1 hour.\n\nPlease enter this code in your profile to verify your email address.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to our loyalty program!</h2>
          <p>Thank you for registering. Please verify your email address using the code below:</p>
          <h1 style="font-size: 32px; letter-spacing: 4px; background: #f5f5f5; padding: 20px; text-align: center; font-family: monospace;">${code}</h1>
          <p>This code expires in 1 hour.</p>
          <p>Enter this code in your profile settings to complete verification.</p>
          <p style="color: #666; font-size: 12px;">If you didn't create an account, please ignore this email.</p>
        </div>
      `,
    });

    logger.info('Registration verification email sent', { to });
  }

  /**
   * Check if email service is properly configured
   */
  isEmailConfigured(): boolean {
    return this.isConfigured;
  }
}

export const emailService = new EmailService();

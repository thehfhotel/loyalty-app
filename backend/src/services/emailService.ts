import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';

export class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly fromEmail: string;
  private readonly baseUrl: string;

  constructor() {
    this.fromEmail = process.env.FROM_EMAIL || 'noreply@hotel-loyalty.com';
    this.baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    
    this.transporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  /**
   * Send email verification
   */
  async sendEmailVerification(email: string, token: string): Promise<void> {
    const verificationUrl = `${this.baseUrl}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
    
    const mailOptions = {
      from: this.fromEmail,
      to: email,
      subject: 'Verify Your Email - Hotel Loyalty',
      html: this.getEmailVerificationTemplate(verificationUrl),
      text: `Please verify your email by clicking this link: ${verificationUrl}`,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info('Email verification sent', { email });
    } catch (error) {
      logger.error('Failed to send email verification:', error);
      throw new Error('Failed to send verification email');
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, firstName: string, token: string): Promise<void> {
    const resetUrl = `${this.baseUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    
    const mailOptions = {
      from: this.fromEmail,
      to: email,
      subject: 'Password Reset - Hotel Loyalty',
      html: this.getPasswordResetTemplate(firstName, resetUrl),
      text: `Hi ${firstName}, please reset your password by clicking this link: ${resetUrl}`,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info('Password reset email sent', { email });
    } catch (error) {
      logger.error('Failed to send password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  /**
   * Send welcome email
   */
  async sendWelcomeEmail(email: string, firstName: string): Promise<void> {
    const mailOptions = {
      from: this.fromEmail,
      to: email,
      subject: 'Welcome to Hotel Loyalty!',
      html: this.getWelcomeTemplate(firstName),
      text: `Welcome to Hotel Loyalty, ${firstName}! Start earning points and enjoy exclusive benefits.`,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info('Welcome email sent', { email });
    } catch (error) {
      logger.error('Failed to send welcome email:', error);
      // Don't throw error for welcome email failures
    }
  }

  /**
   * Email verification template
   */
  private getEmailVerificationTemplate(verificationUrl: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">Hotel Loyalty</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px;">Verify Your Email Address</p>
        </div>
        
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <h2 style="color: #333; margin-top: 0;">Almost there!</h2>
          <p>Thank you for signing up for Hotel Loyalty. To complete your registration and start earning points, please verify your email address by clicking the button below:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Verify Email Address</a>
          </div>
          
          <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
          <p style="word-break: break-all; background: #e8e8e8; padding: 10px; border-radius: 5px;">${verificationUrl}</p>
          
          <p style="margin-top: 30px; font-size: 14px; color: #666;">
            This verification link will expire in 24 hours. If you didn't create an account with us, please ignore this email.
          </p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Password reset template
   */
  private getPasswordResetTemplate(firstName: string, resetUrl: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">Hotel Loyalty</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px;">Password Reset Request</p>
        </div>
        
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <h2 style="color: #333; margin-top: 0;">Hi ${firstName},</h2>
          <p>We received a request to reset your password for your Hotel Loyalty account. Click the button below to create a new password:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Reset Password</a>
          </div>
          
          <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
          <p style="word-break: break-all; background: #e8e8e8; padding: 10px; border-radius: 5px;">${resetUrl}</p>
          
          <p style="margin-top: 30px; font-size: 14px; color: #666;">
            This password reset link will expire in 1 hour. If you didn't request a password reset, please ignore this email or contact support if you have concerns.
          </p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Welcome email template
   */
  private getWelcomeTemplate(firstName: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Hotel Loyalty</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">Hotel Loyalty</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px;">Welcome to the Family!</p>
        </div>
        
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <h2 style="color: #333; margin-top: 0;">Welcome, ${firstName}! 🎉</h2>
          <p>Thank you for joining Hotel Loyalty! You're now part of our exclusive community and can start earning points and enjoying amazing benefits right away.</p>
          
          <h3 style="color: #667eea;">What's Next?</h3>
          <ul>
            <li><strong>Earn Points:</strong> Get points for every stay, survey completion, and special activities</li>
            <li><strong>Unlock Tiers:</strong> Progress through Bronze, Silver, Gold, and Platinum tiers</li>
            <li><strong>Exclusive Offers:</strong> Receive personalized coupons and special promotions</li>
            <li><strong>Mobile Access:</strong> Install our PWA for convenient mobile access</li>
          </ul>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${this.baseUrl}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Start Exploring</a>
          </div>
          
          <p style="margin-top: 30px; font-size: 14px; color: #666;">
            Need help? Contact our support team or visit our help center. We're here to make your loyalty experience exceptional!
          </p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Test email configuration
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      logger.info('Email service connection verified');
      return true;
    } catch (error) {
      logger.error('Email service connection failed:', error);
      return false;
    }
  }
}

export const emailService = new EmailService();
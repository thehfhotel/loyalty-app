import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export function generateVerificationCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    // eslint-disable-next-line security/detect-object-injection -- Safe: i is a loop counter 0-7
    const byte = bytes[i];
    if (byte !== undefined) {
      code += chars.charAt(byte % chars.length);
    }
  }
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.privateemail.com',
      port: parseInt(process.env.SMTP_PORT ?? '465'),
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendVerificationEmail(to: string, code: string): Promise<void> {
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
}

export const emailService = new EmailService();

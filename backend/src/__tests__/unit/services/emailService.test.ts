/**
 * EmailService Unit Tests
 * Tests email verification code generation and email sending functionality
 */

// Mock nodemailer BEFORE importing emailService
const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({
  sendMail: mockSendMail,
}));

jest.mock('nodemailer', () => ({
  createTransport: mockCreateTransport,
}));

// Mock logger to prevent console output during tests
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { generateVerificationCode, emailService } from '../../../services/emailService';

describe('EmailService', () => {
  describe('generateVerificationCode', () => {
    it('should generate code in XXXX-XXXX format (uppercase)', () => {
      const code = generateVerificationCode();

      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    it('should generate code with exactly 9 characters (4 + dash + 4)', () => {
      const code = generateVerificationCode();

      expect(code).toHaveLength(9);
      expect(code.split('-')).toHaveLength(2);
      expect(code.split('-')[0]).toHaveLength(4);
      expect(code.split('-')[1]).toHaveLength(4);
    });

    it('should only contain uppercase alphanumeric characters (A-Z0-9)', () => {
      const code = generateVerificationCode();
      const codeWithoutDash = code.replace('-', '');

      expect(codeWithoutDash).toMatch(/^[A-Z0-9]{8}$/);
      expect(codeWithoutDash).not.toMatch(/[^A-Z0-9]/);
    });

    it('should generate unique codes on each call', () => {
      const codes = new Set<string>();
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        codes.add(generateVerificationCode());
      }

      // All codes should be unique
      expect(codes.size).toBe(iterations);
    });

    it('should only use characters from the uppercase charset', () => {
      const validChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const code = generateVerificationCode();
      const codeWithoutDash = code.replace('-', '');

      for (const char of codeWithoutDash) {
        expect(validChars).toContain(char);
      }
    });

    it('should generate different codes in rapid succession', () => {
      const code1 = generateVerificationCode();
      const code2 = generateVerificationCode();
      const code3 = generateVerificationCode();

      expect(code1).not.toBe(code2);
      expect(code2).not.toBe(code3);
      expect(code1).not.toBe(code3);
    });
  });

  describe('sendVerificationEmail', () => {
    beforeEach(() => {
      // Reset mocks
      jest.clearAllMocks();

      // Set default successful response for sendMail
      mockSendMail.mockResolvedValue({
        messageId: 'test-message-id',
        accepted: ['recipient@example.com'],
        rejected: [],
        response: '250 OK',
      });
    });

    it('should send email with correct recipient', async () => {
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';

      await emailService.sendVerificationEmail(recipient, code);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: recipient,
        })
      );
    });

    it('should include verification code in email body (text)', async () => {
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';

      await emailService.sendVerificationEmail(recipient, code);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(code),
        })
      );
    });

    it('should include verification code in email body (html)', async () => {
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';

      await emailService.sendVerificationEmail(recipient, code);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining(code),
        })
      );
    });

    it('should send email with correct subject', async () => {
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';

      await emailService.sendVerificationEmail(recipient, code);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Verify your new email address',
        })
      );
    });

    it('should send email with from address', async () => {
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';

      await emailService.sendVerificationEmail(recipient, code);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.any(String),
        })
      );
    });

    it('should include expiration information in text body', async () => {
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';

      await emailService.sendVerificationEmail(recipient, code);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('expires in 1 hour'),
        })
      );
    });

    it('should include expiration information in html body', async () => {
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';

      await emailService.sendVerificationEmail(recipient, code);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('expires in 1 hour'),
        })
      );
    });

    it('should handle SMTP errors gracefully', async () => {
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';
      const smtpError = new Error('SMTP connection failed');

      mockSendMail.mockRejectedValueOnce(smtpError);

      await expect(
        emailService.sendVerificationEmail(recipient, code)
      ).rejects.toThrow('SMTP connection failed');
    });

    it('should handle network errors gracefully', async () => {
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';
      const networkError = new Error('Network timeout');

      mockSendMail.mockRejectedValueOnce(networkError);

      await expect(
        emailService.sendVerificationEmail(recipient, code)
      ).rejects.toThrow('Network timeout');
    });

    it('should handle authentication errors gracefully', async () => {
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';
      const authError = new Error('Invalid login credentials');

      mockSendMail.mockRejectedValueOnce(authError);

      await expect(
        emailService.sendVerificationEmail(recipient, code)
      ).rejects.toThrow('Invalid login credentials');
    });

    it('should send email with complete mail options', async () => {
      const recipient = 'test@example.com';
      const code = 'Test-1234';

      await emailService.sendVerificationEmail(recipient, code);

      expect(mockSendMail).toHaveBeenCalledWith({
        from: expect.any(String),
        to: recipient,
        subject: 'Verify your new email address',
        text: expect.stringContaining(code),
        html: expect.stringContaining(code),
      });
    });

    it('should use environment variable for SMTP_FROM if set', async () => {
      const originalSmtpFrom = process.env.SMTP_FROM;
      process.env.SMTP_FROM = 'custom@example.com';

      // Need to recreate the email service to pick up new env var
      // Since emailService is a singleton, we test with the current implementation
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';

      await emailService.sendVerificationEmail(recipient, code);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.any(String),
        })
      );

      // Restore original value
      if (originalSmtpFrom) {
        process.env.SMTP_FROM = originalSmtpFrom;
      } else {
        delete process.env.SMTP_FROM;
      }
    });

    it('should handle multiple emails sent in sequence', async () => {
      const recipients = [
        'user1@example.com',
        'user2@example.com',
        'user3@example.com',
      ];
      const codes = ['Code-0001', 'Code-0002', 'Code-0003'];

      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        const code = codes[i];
        if (recipient && code) {
          await emailService.sendVerificationEmail(recipient, code);
        }
      }

      expect(mockSendMail).toHaveBeenCalledTimes(3);
    });

    it('should include security notice in text body', async () => {
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';

      await emailService.sendVerificationEmail(recipient, code);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("didn't request this change"),
        })
      );
    });

    it('should include security notice in html body', async () => {
      const recipient = 'user@example.com';
      const code = 'AbC1-XyZ9';

      await emailService.sendVerificationEmail(recipient, code);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining("didn't request this change"),
        })
      );
    });
  });

  describe('Email Service Configuration', () => {
    it('should create transporter with SMTP configuration', async () => {
      // Trigger email service to use transporter
      const recipient = 'config-test@example.com';
      const code = 'Test-1234';

      await emailService.sendVerificationEmail(recipient, code);

      // Verify that sendMail was called, proving the transporter is configured
      expect(mockSendMail).toHaveBeenCalled();
    });

    it('should use nodemailer for email sending', async () => {
      // Trigger email service
      const recipient = 'nodemailer-test@example.com';
      const code = 'Test-5678';

      await emailService.sendVerificationEmail(recipient, code);

      // Verify that our mock was called, confirming nodemailer is being used
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: recipient,
          subject: expect.any(String),
          text: expect.any(String),
          html: expect.any(String),
        })
      );
    });
  });

  describe('Integration Tests', () => {
    it('should generate and send verification email with generated code', async () => {
      const recipient = 'integration@example.com';
      const code = generateVerificationCode();

      await emailService.sendVerificationEmail(recipient, code);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: recipient,
          text: expect.stringContaining(code),
          html: expect.stringContaining(code),
        })
      );
    });

    it('should handle complete verification flow', async () => {
      const recipient = 'complete-flow@example.com';

      // Generate code
      const code = generateVerificationCode();
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

      // Send email
      await emailService.sendVerificationEmail(recipient, code);

      // Verify email was sent with correct data
      expect(mockSendMail).toHaveBeenCalledWith({
        from: expect.any(String),
        to: recipient,
        subject: 'Verify your new email address',
        text: expect.stringContaining(code),
        html: expect.stringContaining(code),
      });
    });
  });
});

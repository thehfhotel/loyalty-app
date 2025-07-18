import { z } from 'zod';
import { REGEX_PATTERNS } from '../constants';

// Email validation
export const validateEmail = (email: string): boolean => {
  return REGEX_PATTERNS.EMAIL.test(email);
};

// Password validation
export const validatePassword = (password: string): boolean => {
  return REGEX_PATTERNS.PASSWORD.test(password);
};

// Phone validation
export const validatePhone = (phone: string): boolean => {
  return REGEX_PATTERNS.PHONE.test(phone);
};

// UUID validation
export const validateUUID = (uuid: string): boolean => {
  return REGEX_PATTERNS.UUID.test(uuid);
};

// Coupon code validation
export const validateCouponCode = (code: string): boolean => {
  return REGEX_PATTERNS.COUPON_CODE.test(code);
};

// Password strength checker
export const getPasswordStrength = (password: string): {
  score: number;
  feedback: string[];
} => {
  const feedback: string[] = [];
  let score = 0;

  if (password.length >= 8) {
    score += 1;
  } else {
    feedback.push('Password must be at least 8 characters long');
  }

  if (/[a-z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Password must contain at least one lowercase letter');
  }

  if (/[A-Z]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Password must contain at least one uppercase letter');
  }

  if (/\d/.test(password)) {
    score += 1;
  } else {
    feedback.push('Password must contain at least one number');
  }

  if (/[@$!%*?&]/.test(password)) {
    score += 1;
  } else {
    feedback.push('Password must contain at least one special character');
  }

  return { score, feedback };
};

// Zod schema helpers
export const createStringSchema = (options: {
  min?: number;
  max?: number;
  pattern?: RegExp;
  message?: string;
}) => {
  let schema = z.string();
  
  if (options.min !== undefined) {
    schema = schema.min(options.min);
  }
  
  if (options.max !== undefined) {
    schema = schema.max(options.max);
  }
  
  if (options.pattern) {
    schema = schema.regex(options.pattern, options.message);
  }
  
  return schema;
};

export const createNumberSchema = (options: {
  min?: number;
  max?: number;
  int?: boolean;
  positive?: boolean;
}) => {
  let schema = z.number();
  
  if (options.min !== undefined) {
    schema = schema.min(options.min);
  }
  
  if (options.max !== undefined) {
    schema = schema.max(options.max);
  }
  
  if (options.int) {
    schema = schema.int();
  }
  
  if (options.positive) {
    schema = schema.positive();
  }
  
  return schema;
};

// Common validation schemas
export const commonSchemas = {
  email: z.string().email().min(1),
  password: z.string().min(8).regex(REGEX_PATTERNS.PASSWORD, 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  phone: z.string().regex(REGEX_PATTERNS.PHONE, 'Invalid phone number format'),
  uuid: z.string().uuid(),
  couponCode: z.string().regex(REGEX_PATTERNS.COUPON_CODE, 'Invalid coupon code format'),
  positiveNumber: z.number().positive(),
  nonNegativeNumber: z.number().min(0),
  dateString: z.string().datetime(),
  url: z.string().url(),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
};

// Form validation helpers
export const validateForm = <T>(schema: z.ZodSchema<T>, data: unknown): {
  success: boolean;
  data?: T;
  errors?: Record<string, string>;
} => {
  try {
    const result = schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors: Record<string, string> = {};
      error.issues.forEach(issue => {
        const path = issue.path.join('.');
        errors[path] = issue.message;
      });
      return { success: false, errors };
    }
    return { success: false, errors: { general: 'Validation failed' } };
  }
};

// Async validation wrapper
export const asyncValidate = async <T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  customValidators?: Array<(data: T) => Promise<string | null>>
): Promise<{
  success: boolean;
  data?: T;
  errors?: Record<string, string>;
}> => {
  const result = validateForm(schema, data);
  
  if (!result.success || !result.data) {
    return result;
  }

  if (customValidators) {
    const errors: Record<string, string> = {};
    
    for (const validator of customValidators) {
      const error = await validator(result.data);
      if (error) {
        errors.custom = error;
      }
    }
    
    if (Object.keys(errors).length > 0) {
      return { success: false, errors };
    }
  }

  return result;
};
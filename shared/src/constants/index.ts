// Application Constants
export const APP_CONFIG = {
  NAME: 'Hotel Loyalty App',
  VERSION: '1.0.0',
  DESCRIPTION: 'Progressive Web Application for Hotel Loyalty Program',
  AUTHOR: 'Hotel Development Team',
} as const;

// API Constants
export const API_CONFIG = {
  BASE_URL: process.env.REACT_APP_API_URL || 'http://localhost:3001',
  VERSION: 'v1',
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
} as const;

// Authentication Constants
export const AUTH_CONFIG = {
  TOKEN_KEY: 'loyalty_token',
  REFRESH_TOKEN_KEY: 'loyalty_refresh_token',
  TOKEN_EXPIRY_KEY: 'loyalty_token_expiry',
  SESSION_TIMEOUT: 7 * 24 * 60 * 60 * 1000, // 7 days
  REFRESH_THRESHOLD: 5 * 60 * 1000, // 5 minutes before expiry
} as const;

// Loyalty Program Constants
export const LOYALTY_CONFIG = {
  DEFAULT_TIER: 'bronze',
  POINTS_EXPIRY_DAYS: 365,
  MIN_POINTS_REDEMPTION: 100,
  TIER_PROGRESSION_PERIOD: 12, // months
  BONUS_POINTS_MULTIPLIER: 2,
} as const;

// Tier Definitions
export const TIER_CONFIG = {
  BRONZE: {
    name: 'Bronze',
    minPoints: 0,
    maxPoints: 999,
    color: '#CD7F32',
    benefits: ['5% discount on dining', 'Early check-in (subject to availability)'],
  },
  SILVER: {
    name: 'Silver',
    minPoints: 1000,
    maxPoints: 2999,
    color: '#C0C0C0',
    benefits: ['10% discount on dining', 'Free WiFi', 'Late check-out'],
  },
  GOLD: {
    name: 'Gold',
    minPoints: 3000,
    maxPoints: 7999,
    color: '#FFD700',
    benefits: ['15% discount on dining', 'Room upgrade', 'Free breakfast'],
  },
  PLATINUM: {
    name: 'Platinum',
    minPoints: 8000,
    maxPoints: null,
    color: '#E5E4E2',
    benefits: ['20% discount on dining', 'Suite upgrade', 'Free breakfast', 'Concierge service'],
  },
} as const;

// Points Earning Rules
export const POINTS_EARNING = {
  SPEND_RATE: 1, // 1 point per dollar spent
  STAY_BONUS: 100, // Bonus points per stay
  SURVEY_COMPLETION: 50,
  SOCIAL_SHARE: 25,
  REFERRAL_BONUS: 500,
  BIRTHDAY_BONUS: 200,
} as const;

// Coupon Types
export const COUPON_TYPES = {
  PERCENTAGE: 'percentage',
  FIXED_AMOUNT: 'fixed_amount',
  FREE_ITEM: 'free_item',
} as const;

// Coupon Categories
export const COUPON_CATEGORIES = {
  ROOM: 'room',
  DINING: 'dining',
  SPA: 'spa',
  EXPERIENCE: 'experience',
  GENERAL: 'general',
} as const;

// Notification Types
export const NOTIFICATION_TYPES = {
  CAMPAIGN: 'campaign',
  SYSTEM: 'system',
  PROMOTION: 'promotion',
  SURVEY: 'survey',
  REMINDER: 'reminder',
} as const;

// Notification Channels
export const NOTIFICATION_CHANNELS = {
  PUSH: 'push',
  EMAIL: 'email',
  SMS: 'sms',
  IN_APP: 'in-app',
} as const;

// Survey Question Types
export const SURVEY_QUESTION_TYPES = {
  TEXT: 'text',
  NUMBER: 'number',
  SINGLE_CHOICE: 'single_choice',
  MULTIPLE_CHOICE: 'multiple_choice',
  RATING: 'rating',
  BOOLEAN: 'boolean',
} as const;

// Campaign Types
export const CAMPAIGN_TYPES = {
  PROMOTIONAL: 'promotional',
  INFORMATIONAL: 'informational',
  SURVEY: 'survey',
  WELCOME: 'welcome',
} as const;

// Database Table Names
export const DB_TABLES = {
  USERS: 'users',
  CUSTOMER_PROFILES: 'customer_profiles',
  TIERS: 'tiers',
  POINTS_TRANSACTIONS: 'points_transactions',
  POINTS_RULES: 'points_rules',
  REDEMPTION_OPTIONS: 'redemption_options',
  REDEMPTION_REQUESTS: 'redemption_requests',
  CAMPAIGNS: 'campaigns',
  COUPONS: 'coupons',
  CUSTOMER_COUPONS: 'customer_coupons',
  SURVEYS: 'surveys',
  SURVEY_RESPONSES: 'survey_responses',
  NOTIFICATIONS: 'notifications',
  AUDIT_LOGS: 'audit_logs',
} as const;

// Error Codes
export const ERROR_CODES = {
  // Authentication
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_INSUFFICIENT_PERMISSIONS: 'AUTH_INSUFFICIENT_PERMISSIONS',
  
  // Validation
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  VALIDATION_DUPLICATE_EMAIL: 'VALIDATION_DUPLICATE_EMAIL',
  VALIDATION_WEAK_PASSWORD: 'VALIDATION_WEAK_PASSWORD',
  
  // Resources
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  RESOURCE_INSUFFICIENT_BALANCE: 'RESOURCE_INSUFFICIENT_BALANCE',
  
  // External Services
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  EXTERNAL_SERVICE_TIMEOUT: 'EXTERNAL_SERVICE_TIMEOUT',
  
  // System
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  SYSTEM_MAINTENANCE: 'SYSTEM_MAINTENANCE',
  SYSTEM_RATE_LIMITED: 'SYSTEM_RATE_LIMITED',
} as const;

// Regex Patterns
export const REGEX_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^\+?[\d\s-()]+$/,
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  COUPON_CODE: /^[A-Z0-9]{6,12}$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
} as const;

// Date Formats
export const DATE_FORMATS = {
  API: 'YYYY-MM-DD',
  DISPLAY: 'MMM DD, YYYY',
  DATETIME: 'YYYY-MM-DD HH:mm:ss',
  TIME: 'HH:mm',
} as const;

// File Upload Limits
export const UPLOAD_LIMITS = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  MAX_FILES: 10,
} as const;

// Cache Keys
export const CACHE_KEYS = {
  USER_PROFILE: 'user_profile',
  LOYALTY_TIERS: 'loyalty_tiers',
  POINTS_RULES: 'points_rules',
  REDEMPTION_OPTIONS: 'redemption_options',
  ACTIVE_CAMPAIGNS: 'active_campaigns',
  ACTIVE_SURVEYS: 'active_surveys',
} as const;

// PWA Configuration
export const PWA_CONFIG = {
  CACHE_NAME: 'loyalty-app-v1',
  OFFLINE_FALLBACK: '/offline.html',
  CACHE_STRATEGIES: {
    CACHE_FIRST: 'cache-first',
    NETWORK_FIRST: 'network-first',
    STALE_WHILE_REVALIDATE: 'stale-while-revalidate',
  },
} as const;
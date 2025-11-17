/**
 * Testing Type Utilities
 * Provides common types for testing to reduce any type usage
 */

import { Request, Response, NextFunction } from 'express';
import { JwtPayload } from 'jsonwebtoken';

// User type for authentication mocking
export interface TestUser {
  id: string;
  email: string;
  role: string;
  isActive?: boolean;
  emailVerified?: boolean;
}

// Enhanced Request with user property for testing
export interface TestRequest extends Omit<Request, 'user'> {
  user?: TestUser | JwtPayload;
}

// Express middleware function types
export type TestMiddlewareFunction = (req: TestRequest, res: Response, next: NextFunction) => void;

// Authorization middleware factory type
export type TestAuthorizeFunction = (...roles: string[]) => TestMiddlewareFunction;

// Mock service creation utility
export interface MockService {
  [key: string]: jest.Mock;
}

// Common mock response types
export interface MockResponse<T = unknown> {
  data?: T;
  message?: string;
  error?: string;
  success?: boolean;
}

// Mock analytics data types
export interface MockAnalyticsData {
  userId: string;
  eventType: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// Mock notification data
export interface MockNotificationData {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: Date;
}

// Utility to create typed mock service
export function createMockService<T extends MockService>(methods: (keyof T)[]): T {
  const service = {} as T;
  for (const method of methods) {
    service[method] = jest.fn() as T[typeof method];
  }
  return service;
}

// Utility to create test user with defaults
export function createTestUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: 'test-user-id',
    email: 'test@example.com',
    role: 'customer',
    isActive: true,
    emailVerified: true,
    ...overrides,
  };
}
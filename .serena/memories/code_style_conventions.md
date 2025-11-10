# Code Style & Conventions

## TypeScript Configuration

### Strict Type Safety
- **Strict Mode**: Always enabled (`"strict": true`)
- **No Unused Locals**: Enabled
- **No Unused Parameters**: Enabled
- **No Implicit Returns**: Enabled
- **No Fallthrough Cases**: Enabled

### Type Preferences
- **Avoid `any`**: Use proper types or `unknown` with type guards
- **Prefer Type Inference**: Let TypeScript infer when obvious
- **Explicit Return Types**: For public APIs and exported functions
- **Interface vs Type**: Prefer `interface` for object shapes, `type` for unions/intersections

## Naming Conventions

### General Rules
- **Files**: camelCase for utilities, PascalCase for components
  - `userService.ts`, `authService.ts` (services)
  - `LoginPage.tsx`, `CouponCard.tsx` (components)
- **Directories**: kebab-case or camelCase consistently
  - `backend/src/services/`, `frontend/src/components/`
- **Variables/Functions**: camelCase
  - `getUserData()`, `currentUser`, `isAuthenticated`
- **Classes/Interfaces/Types**: PascalCase
  - `UserService`, `AuthMiddleware`, `IUserProfile`
- **Constants**: UPPER_SNAKE_CASE
  - `JWT_SECRET`, `MAX_LOGIN_ATTEMPTS`, `DEFAULT_TIER`
- **Private Members**: Prefix with underscore (optional)
  - `_internalState`, `_validateToken()`

### Backend Naming
- **Service Files**: `{domain}Service.ts` (e.g., `userService.ts`)
- **Controller Files**: `{domain}Controller.ts` (e.g., `couponController.ts`)
- **Middleware Files**: Descriptive names (`auth.ts`, `errorHandler.ts`)
- **Route Files**: Domain names (`user.ts`, `loyalty.ts`, `auth.ts`)
- **Type Files**: Domain names (`user.ts`, `auth.ts`, `coupon.ts`)

### Frontend Naming
- **Components**: PascalCase with descriptive names
  - `LoginPage.tsx`, `CouponCard.tsx`, `PointsBalance.tsx`
- **Hooks**: Prefix with `use` (`useAuthRedirect.ts`, `useSessionTimeout.ts`)
- **Services**: `{domain}Service.ts` (matches backend pattern)
- **Stores**: `{domain}Store.ts` (e.g., `authStore.ts`)
- **Utils**: Descriptive camelCase (`emojiUtils.ts`, `dateFormatter.ts`)

## Code Organization

### Service Layer Pattern (Backend)
```typescript
// services/userService.ts
export class UserService {
  async getUserById(id: string): Promise<User> {
    // Business logic here
  }
  
  async updateProfile(id: string, data: UpdateProfileDto): Promise<User> {
    // Validation and business logic
  }
}
```

### Controller Pattern (Backend)
```typescript
// controllers/userController.ts
export const getUserProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user.id;
    const user = await userService.getUserById(userId);
    return res.json(user);
  } catch (error) {
    return next(error);
  }
};
```

### Component Pattern (Frontend)
```typescript
// components/profile/ProfileCard.tsx
interface ProfileCardProps {
  user: User;
  onUpdate?: (data: UpdateProfileDto) => Promise<void>;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({ user, onUpdate }) => {
  // Component logic
  return (
    // JSX
  );
};
```

### Custom Hook Pattern (Frontend)
```typescript
// hooks/useAuth.ts
export const useAuth = () => {
  const store = useAuthStore();
  
  const login = async (credentials: LoginDto) => {
    // Auth logic
  };
  
  return { login, logout, user: store.user };
};
```

## Error Handling

### Backend Error Handling
```typescript
// Always use try-catch with proper error propagation
try {
  const result = await someOperation();
  return res.json(result);
} catch (error) {
  // Let error handler middleware handle it
  return next(error);
}

// For error type handling
if (error instanceof Error) {
  throw new AppError(500, error.message);
} else {
  throw new AppError(500, `Unknown error: ${String(error)}`);
}
```

### Frontend Error Handling
```typescript
// Use try-catch with user feedback
try {
  await userService.updateProfile(data);
  toast.success('Profile updated successfully');
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  toast.error(`Failed to update profile: ${errorMessage}`);
}
```

## Input Validation

### Backend Validation (Zod)
```typescript
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// In middleware
export const validateLogin = validateRequest(loginSchema);

// In route
router.post('/login', validateLogin, loginController);
```

### Frontend Validation (React Hook Form + Zod)
```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const { register, handleSubmit, formState: { errors } } = useForm({
  resolver: zodResolver(schema),
});
```

## Async/Await Patterns

### Always Use Async/Await (Never Promise Chains)
```typescript
// ✅ CORRECT
async function fetchUserData(id: string): Promise<User> {
  const user = await userService.getUserById(id);
  const profile = await profileService.getProfile(user.profileId);
  return { ...user, profile };
}

// ❌ WRONG - Don't use .then() chains
function fetchUserData(id: string): Promise<User> {
  return userService.getUserById(id)
    .then(user => profileService.getProfile(user.profileId))
    .then(profile => ({ ...user, profile }));
}
```

## Import Organization

### Import Order
1. External libraries (React, Express, etc.)
2. Internal absolute imports (@/services, @/components)
3. Relative imports from parent directories (../)
4. Relative imports from same directory (./)
5. Type imports (separate group)

```typescript
// External
import express from 'express';
import { z } from 'zod';

// Internal
import { userService } from '@/services/userService';
import { authMiddleware } from '@/middleware/auth';

// Relative
import { validateRequest } from '../middleware/validateRequest';
import { logger } from './logger';

// Types
import type { User, UserProfile } from '@/types/user';
```

## Comments & Documentation

### JSDoc for Public APIs
```typescript
/**
 * Retrieves user loyalty status including points and tier information
 * @param userId - The unique identifier of the user
 * @returns Promise resolving to user loyalty status
 * @throws {AppError} When user is not found
 */
export async function getUserLoyaltyStatus(userId: string): Promise<LoyaltyStatus> {
  // Implementation
}
```

### Inline Comments
- Explain **why**, not **what**
- Use comments for complex business logic
- Keep comments up-to-date with code changes

## Security Best Practices

### Never Log Sensitive Data
```typescript
// ❌ WRONG
logger.info('User logged in:', { password: user.password, token: jwt });

// ✅ CORRECT
logger.info('User logged in:', { userId: user.id, email: user.email });
```

### Always Sanitize User Input
```typescript
// Use Zod schemas for validation
// Use parameterized queries (Prisma handles this)
// Sanitize HTML content with libraries
```

### Use Prepared Statements (Prisma)
```typescript
// ✅ CORRECT - Prisma handles parameterization
await prisma.user.findMany({
  where: { email: userInput },
});

// ❌ WRONG - Never use raw SQL with string concatenation
await prisma.$queryRaw`SELECT * FROM users WHERE email = '${userInput}'`;
```

## React/Frontend Specific

### Component Props
- Always define prop interfaces
- Use optional chaining for optional props
- Provide default props when appropriate

### State Management
- Use Zustand for global state
- Use React Hook Form for form state
- Use local useState for component-specific state
- Minimize prop drilling with context or stores

### Effect Hook Usage
```typescript
// Always declare dependencies
useEffect(() => {
  fetchData();
}, [userId]); // Complete dependency array

// Use cleanup functions when needed
useEffect(() => {
  const subscription = subscribe();
  return () => subscription.unsubscribe();
}, []);
```

## Database Patterns

### Prisma Client Usage
```typescript
// Always generate Prisma client before build
// npm run db:generate

// Use Prisma migrations for schema changes
// npm run db:migrate

// Use transactions for multi-step operations
await prisma.$transaction(async (tx) => {
  await tx.user.update(...);
  await tx.loyalty.create(...);
});
```

## Testing Conventions

### Test File Naming
- Unit tests: `{name}.test.ts`
- Integration tests: `{name}.integration.test.ts`
- E2E tests: `{feature}.spec.ts`

### Test Structure
```typescript
describe('UserService', () => {
  describe('getUserById', () => {
    it('should return user when found', async () => {
      // Arrange
      const userId = 'test-id';
      
      // Act
      const user = await userService.getUserById(userId);
      
      // Assert
      expect(user).toBeDefined();
      expect(user.id).toBe(userId);
    });
  });
});
```

## ESLint Configuration

### Security Rules (Always Errors)
- `security/detect-object-injection`: error
- `security/detect-non-literal-fs-filename`: error
- `security/detect-child-process`: error
- `no-eval`, `no-implied-eval`, `no-new-func`: error

### Type Safety (Always Errors)
- `@typescript-eslint/no-explicit-any`: error
- `@typescript-eslint/no-unused-vars`: error
- `@typescript-eslint/ban-types`: error

### Code Quality (Progressive)
- `@typescript-eslint/prefer-nullish-coalescing`: error
- `@typescript-eslint/prefer-optional-chain`: error
- `prefer-const`: error
- `no-var`: error
- `eqeqeq`: error

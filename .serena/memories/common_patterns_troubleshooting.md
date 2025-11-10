# Common Patterns & Troubleshooting

## Common Development Patterns

### Service Layer Pattern
```typescript
// backend/src/services/exampleService.ts
export class ExampleService {
  async getData(id: string): Promise<Data> {
    // 1. Validate input
    if (!id) throw new AppError(400, 'ID is required');
    
    // 2. Database operation (Prisma)
    const data = await prisma.example.findUnique({
      where: { id },
      include: { relations: true }
    });
    
    // 3. Business logic
    if (!data) throw new AppError(404, 'Data not found');
    
    // 4. Transform and return
    return this.transformData(data);
  }
  
  private transformData(raw: any): Data {
    // Transform database model to API model
    return {
      id: raw.id,
      name: raw.name,
      // ... other fields
    };
  }
}
```

### Controller Pattern
```typescript
// backend/src/controllers/exampleController.ts
export const getData = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = await exampleService.getData(id);
    return res.json(data);
  } catch (error) {
    return next(error); // Let error handler middleware handle it
  }
};
```

### Route Definition Pattern
```typescript
// backend/src/routes/example.ts
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import * as controller from '../controllers/exampleController';

const router = Router();

// Public routes
router.get('/public', controller.getPublicData);

// Protected routes (require authentication)
router.get('/private', authMiddleware, controller.getPrivateData);

// Admin routes
router.post('/admin', authMiddleware, requireRole('admin'), controller.adminAction);

export default router;
```

### Frontend Service Pattern
```typescript
// frontend/src/services/exampleService.ts
import api from '../utils/axiosInterceptor';

export const exampleService = {
  async getData(id: string) {
    const response = await api.get(`/examples/${id}`);
    return response.data;
  },
  
  async createData(data: CreateDto) {
    const response = await api.post('/examples', data);
    return response.data;
  },
  
  async updateData(id: string, data: UpdateDto) {
    const response = await api.put(`/examples/${id}`, data);
    return response.data;
  }
};
```

### Frontend Component Pattern
```typescript
// frontend/src/components/ExampleComponent.tsx
import React, { useState, useEffect } from 'react';
import { exampleService } from '../services/exampleService';
import toast from 'react-hot-toast';

interface ExampleComponentProps {
  id: string;
  onUpdate?: () => void;
}

export const ExampleComponent: React.FC<ExampleComponentProps> = ({ id, onUpdate }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    loadData();
  }, [id]);
  
  const loadData = async () => {
    try {
      const result = await exampleService.getData(id);
      setData(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to load data: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) return <div>Loading...</div>;
  if (!data) return <div>No data found</div>;
  
  return (
    <div className="p-4 bg-white rounded-lg shadow">
      {/* Component content */}
    </div>
  );
};
```

## Common Issues & Solutions

### Issue 1: "Cannot find module '../generated/prisma'"
**Cause**: Prisma client not generated before build

**Solution**:
```bash
cd backend
npm run db:generate  # Generate Prisma client
npm run build       # Then build
```

**Prevention**: Always run `db:generate` before building in CI/CD

### Issue 2: TypeScript error "error is of type 'unknown'"
**Cause**: Improper error handling in try-catch

**Solution**:
```typescript
// ❌ WRONG
try {
  await operation();
} catch (error) {
  console.log(error.message);  // TypeScript error!
}

// ✅ CORRECT
try {
  await operation();
} catch (error) {
  if (error instanceof Error) {
    console.log(error.message);
  } else {
    console.log('Unknown error:', String(error));
  }
}
```

### Issue 3: AxiosError 404 on API calls
**Cause**: Frontend service using incorrect API path

**Solution**:
1. Find backend route definition file
2. Check router mounting in `index.ts`
3. Construct full path: `/api/{mount-path}/{route-path}`

**Example**:
- Backend: `user.ts` has `router.get('/admin/settings')`
- Mount: `index.ts` has `app.use('/api/users', userRoutes)`
- Frontend: Use `/users/admin/settings` NOT `/admin/settings`

### Issue 4: Docker Compose "Additional property container_name is not allowed"
**Cause**: `container_name` used in wrong section

**Solution**:
```yaml
# ✅ CORRECT - container_name in services
services:
  backend:
    container_name: loyalty_backend  # Correct location
    
volumes:
  backend_data:  # No container_name here
```

### Issue 5: Tailwind CSS plugin errors "Cannot find module '@tailwindcss/forms'"
**Cause**: Plugin not installed or wrong dependency section

**Solution**:
```bash
# 1. Ensure plugin in correct section of package.json
"dependencies": {
  "@tailwindcss/forms": "^0.5.10"  # Production dependency
}

# 2. Clear Docker cache and rebuild
docker compose down -v
docker compose build --no-cache frontend
docker compose up -d
```

### Issue 6: E2E tests failing with port conflicts
**Cause**: E2E ports conflicting with development ports

**Solution**:
```bash
# Use non-conflicting ports for E2E
E2E_FRONTEND_PORT: 3201  # Not 3000
E2E_BACKEND_PORT: 4202   # Not 4000
E2E_DB_PORT: 5436       # Not 5434
```

### Issue 7: Database data inconsistency
**Cause**: Direct database manipulation bypassing business logic

**Solution**:
```bash
# ❌ NEVER do this
docker compose exec postgres psql -U loyalty -d loyalty_db
UPDATE user_loyalty SET current_points = 500 WHERE user_id = '...';

# ✅ ALWAYS use backend APIs
curl -X POST "http://localhost:4001/api/loyalty/award-points" \
     -H "Content-Type: application/json" \
     -d '{"userId": "...", "points": 500, "reason": "Adjustment"}'
```

### Issue 8: OAuth authentication failing
**Cause**: Missing or incorrect OAuth configuration

**Solution**:
```bash
# 1. Check OAuth health
npm run oauth:health

# 2. Verify environment variables
echo $GOOGLE_CLIENT_ID
echo $LINE_CHANNEL_ID

# 3. Check redirect URLs match configuration
# Google: http://localhost:4001/api/oauth/google/callback
# LINE: http://localhost:4001/api/oauth/line/callback

# 4. Reset rate limits if needed
npm run oauth:reset-limits
```

### Issue 9: Build failing in CI/CD but works locally
**Cause**: Path resolution differences between local and CI/CD

**Solution**:
1. Verify relative paths with `../` work in both environments
2. Use absolute paths in configurations when possible
3. Test path resolution from different working directories
4. Add path validation in scripts:
```bash
if [ ! -f "../expected/file.txt" ]; then
  echo "❌ File not found at expected path"
  exit 1
fi
```

### Issue 10: Tests passing locally but failing in pipeline
**Cause**: Environment differences or missing dependencies

**Solution**:
```bash
# 1. Check test database setup
# 2. Verify environment variables in CI/CD
# 3. Check for timing-dependent tests (use proper waits)
# 4. Ensure test isolation (cleanup between tests)
# 5. Review CI/CD logs for specific errors
```

## Performance Optimization Patterns

### Database Query Optimization
```typescript
// ❌ N+1 Query Problem
const users = await prisma.user.findMany();
for (const user of users) {
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
  // Process profile
}

// ✅ Use includes to fetch related data
const users = await prisma.user.findMany({
  include: {
    profile: true,
    loyalty: true
  }
});
```

### Pagination Pattern
```typescript
// Always paginate large datasets
const pageSize = 20;
const page = parseInt(req.query.page) || 1;

const [items, total] = await prisma.$transaction([
  prisma.item.findMany({
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: { createdAt: 'desc' }
  }),
  prisma.item.count()
]);

return res.json({
  items,
  pagination: {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize)
  }
});
```

### Caching Pattern
```typescript
// Use Redis for frequently accessed data
import { redisClient } from '../config/redis';

async function getCachedData(key: string) {
  // Try cache first
  const cached = await redisClient.get(key);
  if (cached) return JSON.parse(cached);
  
  // Fetch from database
  const data = await prisma.data.findMany();
  
  // Cache for 5 minutes
  await redisClient.setex(key, 300, JSON.stringify(data));
  
  return data;
}
```

## Security Patterns

### Input Validation Pattern
```typescript
// Define Zod schema
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(100),
  name: z.string().min(2).max(100)
});

// Use in route
router.post('/users', validateRequest(createUserSchema), async (req, res, next) => {
  // req.body is now validated and typed
  const user = await userService.createUser(req.body);
  return res.json(user);
});
```

### Authentication Pattern
```typescript
// Middleware checks JWT token
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) throw new AppError(401, 'No token provided');
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    next();
  } catch (error) {
    return next(new AppError(401, 'Invalid token'));
  }
};
```

### Role-Based Authorization Pattern
```typescript
export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'Not authenticated'));
    }
    
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, 'Insufficient permissions'));
    }
    
    next();
  };
};

// Usage
router.delete('/users/:id', authMiddleware, requireRole('admin'), deleteUser);
```

## Testing Patterns

### Unit Test Pattern
```typescript
describe('UserService', () => {
  describe('createUser', () => {
    it('should create a user with hashed password', async () => {
      // Arrange
      const userData = { email: 'test@example.com', password: 'password123' };
      
      // Act
      const user = await userService.createUser(userData);
      
      // Assert
      expect(user).toBeDefined();
      expect(user.email).toBe(userData.email);
      expect(user.password).not.toBe(userData.password); // Should be hashed
    });
    
    it('should throw error for duplicate email', async () => {
      // Arrange
      const userData = { email: 'existing@example.com', password: 'password123' };
      
      // Act & Assert
      await expect(userService.createUser(userData)).rejects.toThrow('Email already exists');
    });
  });
});
```

### Integration Test Pattern
```typescript
describe('POST /api/auth/login', () => {
  it('should return JWT token for valid credentials', async () => {
    // Arrange
    const credentials = { email: 'test@example.com', password: 'password123' };
    
    // Act
    const response = await request(app)
      .post('/api/auth/login')
      .send(credentials);
    
    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('token');
    expect(response.body).toHaveProperty('refreshToken');
  });
});
```

### E2E Test Pattern
```typescript
// tests/auth.spec.ts
import { test, expect } from '@playwright/test';

test('user can login successfully', async ({ page }) => {
  // Navigate to login page
  await page.goto('http://localhost:4001/login');
  
  // Fill in credentials
  await page.fill('input[name="email"]', 'test@example.com');
  await page.fill('input[name="password"]', 'password123');
  
  // Submit form
  await page.click('button[type="submit"]');
  
  // Assert redirect to dashboard
  await expect(page).toHaveURL(/.*dashboard/);
  await expect(page.locator('h1')).toContainText('Dashboard');
});
```

## Deployment Patterns

### Zero-Downtime Deployment
1. Run new version alongside old version
2. Run health checks on new version
3. Switch traffic to new version
4. Keep old version for quick rollback
5. Clean up old version after stability period

### Database Migration Pattern
```bash
# 1. Backup database
npm run db:backup

# 2. Test migration in development
npm run db:migrate

# 3. Check rollback safety
npm run db:rollback-check

# 4. Deploy migration to production
npm run db:migrate:deploy

# 5. Verify migration status
npm run db:migrate:status
```

### Environment Configuration Pattern
```bash
# Development (.env)
NODE_ENV=development
DATABASE_URL=postgresql://loyalty:loyalty_pass@localhost:5434/loyalty_db

# Production (.env.production)
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@prod-host:5432/loyalty_db
JWT_SECRET=<strong-production-secret>
```

## Monitoring & Logging Patterns

### Structured Logging
```typescript
import { logger } from '../utils/logger';

// Log with context
logger.info('User logged in', { userId: user.id, email: user.email });
logger.error('Failed to process payment', { orderId, error: error.message });
logger.warn('Rate limit approaching', { userId, attempts });
```

### Error Tracking
```typescript
// Custom error class with context
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public context?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Usage
throw new AppError(404, 'User not found', { userId });
```

## Quick Debugging Commands

```bash
# View recent backend logs
docker compose logs --tail=100 backend

# View recent database logs
docker compose logs --tail=50 postgres

# Check container resource usage
docker stats

# Inspect container
docker compose exec backend bash

# Check database connection
docker compose exec postgres psql -U loyalty -d loyalty_db -c "SELECT 1"

# Check Redis connection
docker compose exec redis redis-cli PING

# View environment variables
docker compose exec backend env | grep JWT

# Check file permissions
docker compose exec backend ls -la /app

# Monitor real-time logs
docker compose logs -f backend frontend
```

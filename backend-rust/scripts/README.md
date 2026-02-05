# Backend Scripts

This directory contains utility scripts for the Rust backend.

## OpenAPI TypeScript Client Generator

The `generate-client.sh` script generates a type-safe TypeScript client from the backend's OpenAPI specification. This replaces tRPC with OpenAPI-generated types for full type safety between the Rust backend and React frontend.

### Prerequisites

1. **Node.js and npm** - Required for running the TypeScript generator
2. **Rust backend running** - The OpenAPI spec is served at `/api/openapi.json`

### Quick Start

```bash
# Make sure the Rust backend is running first
cd /home/nut/loyalty-app/backend-rust
cargo run

# In another terminal, run the generator
cd /home/nut/loyalty-app/backend-rust/scripts
./generate-client.sh
```

### Usage Options

```bash
# Default: Fetch from running backend at localhost:4001
./generate-client.sh

# Custom URL (e.g., staging or production)
./generate-client.sh --url https://api.example.com/api/openapi.json

# Use a local OpenAPI spec file
./generate-client.sh --file ../openapi.json

# Show help
./generate-client.sh --help
```

### Generated Output

The script generates TypeScript files in `frontend/src/api/generated/`:

```
frontend/src/api/generated/
├── index.ts          # Main exports
├── types.gen.ts      # Generated TypeScript types
├── services.gen.ts   # API service functions
└── core/             # Client configuration
```

### Frontend Integration

#### 1. Install Dependencies (if not already installed)

The generator script automatically installs these if missing, but you can also add them manually:

```bash
cd frontend
npm install --save-dev @hey-api/openapi-ts
npm install @hey-api/client-fetch
```

#### 2. Add npm Script

Add to `frontend/package.json`:

```json
{
  "scripts": {
    "generate:api": "openapi-ts -i http://localhost:4001/api/openapi.json -o src/api/generated -c @hey-api/client-fetch"
  }
}
```

#### 3. Configure the Client

Create or update `frontend/src/api/client.ts`:

```typescript
import { client } from './generated';

// Configure the base URL
client.setConfig({
  baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:4001/api',
});

// Optional: Add authentication interceptor
client.interceptors.request.use((request) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    request.headers.set('Authorization', `Bearer ${token}`);
  }
  return request;
});

// Optional: Add error handling interceptor
client.interceptors.response.use((response) => {
  if (!response.ok) {
    // Handle errors globally
    console.error('API Error:', response.status);
  }
  return response;
});
```

#### 4. Use in Components

```typescript
import { getUsers, createBooking, getUserById } from '@/api/generated';

// In your component or hook
async function fetchUsers() {
  const { data, error } = await getUsers();

  if (error) {
    console.error('Failed to fetch users:', error);
    return;
  }

  return data;
}

// With parameters
async function fetchUser(userId: string) {
  const { data, error } = await getUserById({
    path: { id: userId }
  });

  return data;
}

// POST request with body
async function makeBooking(bookingData: CreateBookingRequest) {
  const { data, error } = await createBooking({
    body: bookingData
  });

  return data;
}
```

#### 5. Integration with React Query

The generated client works seamlessly with TanStack Query (React Query):

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { getUsers, createBooking } from '@/api/generated';

// Query hook
function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await getUsers();
      if (error) throw error;
      return data;
    },
  });
}

// Mutation hook
function useCreateBooking() {
  return useMutation({
    mutationFn: async (bookingData: CreateBookingRequest) => {
      const { data, error } = await createBooking({ body: bookingData });
      if (error) throw error;
      return data;
    },
  });
}
```

### CI/CD Integration

Add the generator to your CI/CD pipeline to ensure types stay in sync:

```yaml
# In your GitHub Actions workflow
- name: Generate API Client
  run: |
    cd backend-rust
    cargo run &
    sleep 5  # Wait for server to start
    cd ../backend-rust/scripts
    ./generate-client.sh
    kill %1

- name: Check for uncommitted changes
  run: |
    git diff --exit-code frontend/src/api/generated/
```

### Troubleshooting

#### "Cannot fetch OpenAPI spec" error

Make sure the Rust backend is running:

```bash
cd backend-rust
cargo run
```

Then verify the spec is accessible:

```bash
curl http://localhost:4001/api/openapi.json
```

#### Type mismatches after backend changes

Regenerate the client whenever the backend API changes:

```bash
./generate-client.sh
```

#### Generated types are incorrect

1. Check the OpenAPI spec for errors: `curl http://localhost:4001/api/openapi.json | jq .`
2. Ensure all routes have proper OpenAPI annotations in the Rust code
3. Rebuild and restart the backend if you've made changes

### Migration from tRPC

If migrating from tRPC, follow these steps:

1. **Generate the client** using this script
2. **Update imports** - Replace tRPC imports with generated client imports
3. **Update hook usage** - The generated client returns `{ data, error }` instead of throwing
4. **Remove tRPC dependencies** (optional, after full migration):
   ```bash
   npm uninstall @trpc/client @trpc/react-query
   ```

### Benefits over tRPC

- **Language agnostic** - Works with any backend that serves OpenAPI
- **Standard tooling** - Uses industry-standard OpenAPI specification
- **Better documentation** - OpenAPI spec can be used with Swagger UI
- **Wider ecosystem** - Many tools support OpenAPI (Postman, etc.)
- **Rust native** - No need for tRPC adapter in Rust

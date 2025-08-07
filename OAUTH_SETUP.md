# 🔐 OAuth Configuration Guide

## Google OAuth Setup

### 1. Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing project
3. Navigate to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth 2.0 Client IDs**
5. Select **Web application**
6. Configure redirect URIs:
   - Development: `http://localhost:4001/api/oauth/google/callback`
   - Production: `https://your-domain.com/api/oauth/google/callback`

### 2. Configure Environment Variables

Add to your `.env` files:

```bash
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_CALLBACK_URL=http://localhost:4001/api/oauth/google/callback

# Frontend URL for redirects
FRONTEND_URL=http://localhost:3000
```

### 3. Production Environment Variables

For production, update with your actual domain:

```bash
GOOGLE_CALLBACK_URL=https://your-domain.com/api/oauth/google/callback
FRONTEND_URL=https://your-frontend-domain.com
```

## Testing OAuth Flow

1. Start backend: `npm run dev` (should be on port 4001)
2. Start frontend: `npm run dev` (should be on port 3000)
3. Navigate to login page
4. Click "Continue with Google"
5. Complete OAuth flow
6. Should redirect back to `/oauth/success` page

## Troubleshooting

### Common Issues

1. **`oauth_incomplete` error**: Fixed in latest version - Passport strategy now returns complete result object
2. **`google_not_configured` error**: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
3. **Redirect mismatch**: Ensure GOOGLE_CALLBACK_URL matches Google Cloud Console settings
4. **CORS issues**: Ensure FRONTEND_URL is correctly set for redirects

### Debug Logs

Check backend logs for OAuth debug information:
- `[OAuth] Google OAuth initiated`
- `[OAuth Service] Google profile received`
- `[OAuth] Google OAuth success for user`

## Security Notes

- Never commit real OAuth credentials to version control
- Use different credentials for development and production
- Regularly rotate OAuth secrets
- Implement proper CSRF protection (already included in state management)
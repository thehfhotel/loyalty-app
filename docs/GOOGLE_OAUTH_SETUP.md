# Google OAuth Setup Guide

This guide explains how to set up Google OAuth for the Loyalty App.

## Prerequisites

1. A Google Cloud Console account
2. A Google Cloud Project created for your application

## Google Cloud Console Setup

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" and then "New Project"
3. Fill in your project details:
   - Project Name: `Hotel Loyalty System`
   - Organization: Your organization (optional)
4. Click "Create"

### Step 2: Enable Google+ API

1. In your Google Cloud project, go to "APIs & Services" → "Library"
2. Search for "Google+ API" and click on it
3. Click "Enable"

### Step 3: Configure OAuth Consent Screen

1. Go to "APIs & Services" → "OAuth consent screen"
2. Choose "External" user type and click "Create"
3. Fill in the required information:
   - App name: `Hotel Loyalty System`
   - User support email: Your email
   - Developer contact information: Your email
4. Click "Save and Continue"
5. Add scopes (optional for now) and click "Save and Continue"
6. Add test users if needed and click "Save and Continue"

### Step 4: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth 2.0 Client IDs"
3. Choose "Web application" as the application type
4. Fill in the details:
   - Name: `Hotel Loyalty System Web Client`
   - Authorized JavaScript origins:
     ```
     http://localhost:4001
     ```
   - Authorized redirect URIs:
     ```
     http://localhost:4000/api/oauth/google/callback
     ```
5. Click "Create"
6. Copy your Client ID and Client Secret

## Environment Configuration

Create a `.env` file in the project root with your Google OAuth credentials:

```bash
# Copy the example file
cp .env.example .env
```

Then update your `.env` file with the actual Google OAuth credentials:

```bash
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-actual-google-client-id
GOOGLE_CLIENT_SECRET=your-actual-google-client-secret

# Other OAuth providers (optional)
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret

# Additional secrets (change in production)
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production
SESSION_SECRET=your-super-secret-session-key-change-in-production
```

The `docker-compose.yml` is configured to read these environment variables from your `.env` file automatically.

## How It Works

1. **User clicks "Continue with Google"** on the login page
2. **Backend redirects** to Google OAuth with proper scopes (profile, email)
3. **User authorizes** the app on Google
4. **Google redirects back** to `/api/oauth/google/callback` with auth code
5. **Backend exchanges** auth code for user profile information
6. **Backend creates/updates** user account and generates JWT tokens
7. **Backend redirects** to frontend `/oauth/success` with tokens
8. **Frontend extracts** tokens and completes authentication

## User Experience

### New User Flow:
- Automatic account creation using Google profile data
- Email is marked as verified (Google emails are trusted)
- Gets appropriate role based on admin configuration
- Redirected to dashboard with welcome message

### Existing User Flow:
- Updates profile data if new information available from Google
- Logs in with existing account
- Redirected to dashboard with welcome back message

## Admin Role Assignment

Google OAuth users follow the same admin role assignment rules:
- If email is in `adminEmails` → gets `admin` role
- If email is in `superAdminEmails` → gets `super_admin` role  
- Super admin takes precedence over admin if email is in both lists

## Security Features

- ✅ **Email verification**: Google users have verified emails by default
- ✅ **No password required**: OAuth users don't need passwords
- ✅ **Admin config integration**: Role assignment based on email configuration
- ✅ **Audit logging**: All OAuth actions are logged with provider information
- ✅ **Session management**: Secure session handling with configurable secrets
- ✅ **Error handling**: Graceful fallback when Google OAuth is not configured
- ✅ **Scope limitation**: Only requests profile and email permissions

## Testing

To test Google OAuth:

1. Set up a Google Cloud Project (see steps above)
2. Update environment variables with real Google credentials
3. Restart the backend: `docker compose restart backend`
4. Visit `http://localhost:4001/login`
5. Click "Continue with Google"
6. Authorize the app on Google
7. You should be redirected back and logged in

## Troubleshooting

### Common Issues:

1. **"Google login is not configured"**
   - Check that `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
   - Ensure they are not the default placeholder values

2. **OAuth redirect mismatch error**
   - Verify the redirect URI in Google Cloud Console matches your environment
   - Check that `GOOGLE_CALLBACK_URL` is correctly set
   - Ensure the authorized redirect URIs include your callback URL

3. **"redirect_uri_mismatch" error**
   - Double-check the redirect URI in Google Cloud Console
   - Ensure the protocol (http/https) matches exactly
   - Remove any trailing slashes

4. **Session errors**
   - Ensure `SESSION_SECRET` is set to a secure value
   - Check that sessions are properly configured

5. **Profile data missing**
   - Verify Google project has proper API access
   - Check that OAuth consent screen is properly configured

## Production Setup

For production deployment:

1. Update Google Cloud Console with production URLs:
   - Authorized JavaScript origins: `https://yourdomain.com`
   - Authorized redirect URIs: `https://yourdomain.com/api/oauth/google/callback`
2. Set production environment variables
3. Use HTTPS for all OAuth URLs
4. Set secure session configuration
5. Consider publishing your OAuth consent screen for public use
6. Monitor OAuth logs for errors

## API Endpoints

- **GET** `/api/oauth/google` - Initiates Google OAuth flow
- **GET** `/api/oauth/google/callback` - Handles Google OAuth callback
- **GET** `/api/oauth/me` - Gets user info after OAuth success (requires Bearer token)

## Facebook OAuth Migration

Facebook OAuth has been replaced with Google OAuth:
- Facebook login button is hidden from the UI
- Facebook OAuth routes are kept for backward compatibility
- New users will only see Google login option
- Existing Facebook OAuth users can still use their accounts

## Security Considerations

- Never commit Google Client Secret to version control
- Use environment variables for all sensitive configuration
- Enable HTTPS in production for secure OAuth flow
- Regularly rotate session secrets
- Monitor OAuth logs for suspicious activity
- Implement rate limiting on OAuth endpoints
- Consider implementing additional security measures like CSRF protection
- Review and limit OAuth scopes to minimum required permissions

## Google Cloud Console Production Checklist

- [ ] OAuth consent screen is published (not in testing mode)
- [ ] Production domain is added to authorized origins
- [ ] Production callback URL is added to authorized redirect URIs
- [ ] API quotas are sufficient for production load
- [ ] Monitoring and logging are configured
- [ ] Security settings are reviewed and hardened
# Facebook OAuth Setup Guide

This guide explains how to set up Facebook OAuth for the Loyalty App.

## Prerequisites

1. A Facebook Developer Account
2. A Facebook App created for your project

## Facebook App Setup

### Step 1: Create a Facebook App

1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Click "Create App"
3. Choose "Consumer" as the app type
4. Fill in your app details:
   - App Name: `Hotel Loyalty System`
   - App Contact Email: Your email
   - App Purpose: Authentication

### Step 2: Configure Facebook Login

1. In your Facebook App dashboard, click "Add Product"
2. Find "Facebook Login" and click "Set Up"
3. Choose "Web" as the platform
4. Enter your site URL: `http://localhost:4001` (for development)

### Step 3: Configure OAuth Settings

1. Go to Facebook Login → Settings
2. Add these Valid OAuth Redirect URIs:
   ```
   http://localhost:4001/api/oauth/facebook/callback
   ```
3. Set Client OAuth Login to "Yes"
4. Set Web OAuth Login to "Yes"

### Step 4: Get App Credentials

1. Go to Settings → Basic
2. Copy your App ID and App Secret
3. Update your environment variables in `docker compose.yml`:

```yaml
environment:
  FACEBOOK_APP_ID: your-actual-facebook-app-id
  FACEBOOK_APP_SECRET: your-actual-facebook-app-secret
  FACEBOOK_CALLBACK_URL: http://localhost:4001/api/oauth/facebook/callback
```

## Environment Variables

Update the following environment variables in your `docker compose.yml`:

```yaml
backend:
  environment:
    # ... other variables
    FACEBOOK_APP_ID: your-facebook-app-id-here
    FACEBOOK_APP_SECRET: your-facebook-app-secret-here
    FACEBOOK_CALLBACK_URL: http://localhost:4001/api/oauth/facebook/callback
    FRONTEND_URL: http://localhost:4001
    SESSION_SECRET: your-session-secret-change-in-production
```

## How It Works

1. **User clicks "Continue with Facebook"** on the login page
2. **Backend redirects** to Facebook OAuth with proper permissions
3. **User authorizes** the app on Facebook
4. **Facebook redirects back** to `/api/oauth/facebook/callback` with auth code
5. **Backend exchanges** auth code for user profile information
6. **Backend creates/updates** user account and generates JWT tokens
7. **Backend redirects** to frontend `/oauth/success` with tokens
8. **Frontend extracts** tokens and completes authentication

## User Flow

### New User:
- Creates account automatically using Facebook profile data
- Email is marked as verified
- Gets appropriate role based on admin configuration
- Redirected to dashboard with welcome message

### Existing User:
- Updates profile data if new information available from Facebook
- Logs in with existing account
- Redirected to dashboard with welcome back message

## Admin Role Assignment

Facebook OAuth users are subject to the same admin role assignment rules:
- If email is in `adminEmails` → gets `admin` role
- If email is in `superAdminEmails` → gets `super_admin` role  
- Super admin takes precedence over admin if email is in both lists

## Security Features

- **Email verification**: Facebook users have verified emails by default
- **No password required**: OAuth users don't need passwords
- **Admin config integration**: Role assignment based on email configuration
- **Audit logging**: All OAuth actions are logged with provider information
- **Session management**: Secure session handling with configurable secrets
- **Error handling**: Graceful fallback when Facebook OAuth is not configured

## Testing

To test Facebook OAuth:

1. Set up a Facebook App (see steps above)
2. Update environment variables with real Facebook credentials
3. Restart the backend: `docker compose restart backend`
4. Visit `http://localhost:4001/login`
5. Click "Continue with Facebook"
6. Authorize the app on Facebook
7. You should be redirected back and logged in

## Troubleshooting

### Common Issues:

1. **"Facebook login is not configured"**
   - Check that `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` are set
   - Ensure they are not the default placeholder values

2. **OAuth redirect mismatch**
   - Verify the callback URL in Facebook app settings matches your environment
   - Check that `FACEBOOK_CALLBACK_URL` is correctly set

3. **Session errors**
   - Ensure `SESSION_SECRET` is set to a secure value
   - Check that sessions are properly configured

4. **Profile data missing**
   - Verify Facebook app has proper permissions for email and profile
   - Check that profile fields are requested in the OAuth scope

## Production Setup

For production deployment:

1. Create a production Facebook App
2. Update OAuth redirect URIs to your production domain
3. Set production environment variables
4. Use HTTPS for all OAuth URLs
5. Set secure session configuration
6. Monitor OAuth logs for errors

## Security Considerations

- Never commit Facebook App Secret to version control
- Use environment variables for all sensitive configuration
- Enable HTTPS in production for secure OAuth flow
- Regularly rotate session secrets
- Monitor OAuth logs for suspicious activity
- Implement rate limiting on OAuth endpoints
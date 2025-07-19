# LINE OAuth Setup Guide

This guide explains how to set up LINE OAuth for the Loyalty App.

## Prerequisites

1. A LINE Developers account
2. Access to LINE Developers Console

## LINE Developers Console Setup

### Step 1: Create a LINE Login Channel

1. Go to [LINE Developers Console](https://developers.line.biz/console/)
2. Click "Create a new provider" or select an existing provider
3. Fill in provider details:
   - Provider name: `Hotel Loyalty System`
   - Description: Your application description
4. Click "Create"

### Step 2: Create a LINE Login Channel

1. In your provider dashboard, click "Create a new channel"
2. Select "LINE Login" as the channel type
3. Fill in the channel information:
   - Channel name: `Hotel Loyalty System Login`
   - Channel description: Brief description of your app
   - App type: Select "Web app"
   - Email address: Your email
   - Privacy policy URL: Your privacy policy URL (optional for development)
   - Terms of use URL: Your terms of use URL (optional for development)
4. Click "Create"

### Step 3: Configure Channel Settings

1. Go to the "Basic settings" tab of your channel
2. Note down your **Channel ID** and **Channel secret**
3. Go to the "LINE Login" tab
4. Add callback URLs:
   - Development: `http://localhost:4000/api/oauth/line/callback`
   - Production: `https://yourdomain.com/api/oauth/line/callback`
5. Configure scopes (permissions):
   - Select "profile" scope to get user's display name and profile image
   - Note: LINE Login doesn't provide email by default

### Step 4: Get Your Credentials

1. In the "Basic settings" tab, copy:
   - **Channel ID**: This is your `LINE_CHANNEL_ID`
   - **Channel secret**: This is your `LINE_CHANNEL_SECRET`

## Environment Configuration

Update your `.env` file with the LINE OAuth credentials:

```bash
# LINE OAuth Configuration
LINE_CHANNEL_ID=your-actual-line-channel-id
LINE_CHANNEL_SECRET=your-actual-line-channel-secret
```

The `docker-compose.yml` is configured to read these environment variables automatically.

## How It Works

1. **User clicks "Continue with LINE"** on the login page
2. **Backend redirects** to LINE OAuth with proper scopes (profile)
3. **User authorizes** the app on LINE
4. **LINE redirects back** to `/api/oauth/line/callback` with auth code
5. **Backend exchanges** auth code for user profile information
6. **Backend creates/updates** user account and generates JWT tokens
7. **Backend redirects** to frontend `/oauth/success` with tokens
8. **Frontend extracts** tokens and completes authentication

## User Experience

### New User Flow:
- Automatic account creation using LINE profile data
- Uses LINE ID as unique identifier (email format: `line_{id}@line.oauth`)
- Email is marked as unverified (LINE doesn't provide email)
- Gets appropriate role based on admin configuration
- Redirected to dashboard with welcome message

### Existing User Flow:
- Updates profile data if new information available from LINE
- Logs in with existing account
- Redirected to dashboard with welcome back message

## Admin Role Assignment

LINE OAuth users follow the same admin role assignment rules:
- If email is in `adminEmails` → gets `admin` role
- If email is in `superAdminEmails` → gets `super_admin` role  
- Super admin takes precedence over admin if email is in both lists
- Note: Since LINE doesn't provide email, role assignment typically won't apply

## Security Features

- ✅ **Profile verification**: LINE users have verified profiles by default
- ✅ **No password required**: OAuth users don't need passwords
- ✅ **Unique LINE ID**: Each LINE account has a unique ID for identification
- ✅ **Admin config integration**: Role assignment based on email configuration
- ✅ **Audit logging**: All OAuth actions are logged with provider information
- ✅ **Session management**: Secure session handling with configurable secrets
- ✅ **Error handling**: Graceful fallback when LINE OAuth is not configured
- ✅ **Scope limitation**: Only requests profile permissions

## Testing

To test LINE OAuth:

1. Set up a LINE Login channel (see steps above)
2. Update environment variables with real LINE credentials
3. Restart the backend: `docker compose restart backend`
4. Visit `http://localhost:3000/login`
5. Click "Continue with LINE"
6. Authorize the app on LINE
7. You should be redirected back and logged in

## Troubleshooting

### Common Issues:

1. **"LINE login is not configured"**
   - Check that `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` are set
   - Ensure they are not the default placeholder values

2. **OAuth redirect mismatch error**
   - Verify the callback URL in LINE Developers Console matches your environment
   - Check that `LINE_CALLBACK_URL` is correctly set
   - Ensure the callback URLs include your actual callback URL

3. **"redirect_uri_mismatch" error**
   - Double-check the callback URL in LINE Developers Console
   - Ensure the protocol (http/https) matches exactly
   - Remove any trailing slashes

4. **Session errors**
   - Ensure `SESSION_SECRET` is set to a secure value
   - Check that sessions are properly configured

5. **Profile data missing**
   - Verify LINE channel has proper scope configuration
   - Check that "profile" scope is enabled in channel settings

## Production Setup

For production deployment:

1. Update LINE Developers Console with production URLs:
   - Callback URL: `https://yourdomain.com/api/oauth/line/callback`
2. Set production environment variables
3. Use HTTPS for all OAuth URLs
4. Set secure session configuration
5. Consider publishing your LINE channel for public use
6. Monitor OAuth logs for errors

## API Endpoints

- **GET** `/api/oauth/line` - Initiates LINE OAuth flow
- **GET** `/api/oauth/line/callback` - Handles LINE OAuth callback
- **GET** `/api/oauth/me` - Gets user info after OAuth success (requires Bearer token)

## LINE Profile Data

LINE OAuth provides the following user data:
- **User ID**: Unique LINE identifier
- **Display Name**: User's LINE display name
- **Picture URL**: User's profile picture
- **Status Message**: User's status message (optional)

Note: LINE OAuth does **not** provide email addresses by default.

## Security Considerations

- Never commit LINE Channel Secret to version control
- Use environment variables for all sensitive configuration
- Enable HTTPS in production for secure OAuth flow
- Regularly rotate session secrets
- Monitor OAuth logs for suspicious activity
- Implement rate limiting on OAuth endpoints
- Consider implementing additional security measures like CSRF protection
- Review and limit OAuth scopes to minimum required permissions

## LINE Developers Console Production Checklist

- [ ] Channel is published (not in development mode)
- [ ] Production domain is added to callback URLs
- [ ] Channel information is complete and accurate
- [ ] Privacy policy and terms of use URLs are configured (if required)
- [ ] Scopes are properly configured
- [ ] Channel verification is completed (if required)
- [ ] Monitoring and logging are configured
- [ ] Security settings are reviewed and hardened
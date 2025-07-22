# Thai Language Survey Error Debugging Guide

## Overview

This document provides tools and instructions for capturing the exact validation error response when creating surveys with Thai language content, which currently results in a 400 Bad Request error.

## Problem Description

When creating a survey with Thai language content:
- **Title**: "ความพึงพอใจของลูกค้า" (Customer Satisfaction)
- **Description**: "กรุณาช่วยเราปรับปรุงบริการ" (Please help us improve our service)  
- **Question**: "คุณพอใจกับบริการไหม?" (Are you satisfied with the service?)
- **Options**: "พอใจมาก" (Very satisfied), "พอใจ" (Satisfied)

The system returns a **400 Bad Request** error during survey creation.

## Debugging Tools Provided

### 1. Enhanced Frontend Logging (`SurveyBuilder.tsx`)

**Location**: `/frontend/src/pages/admin/SurveyBuilder.tsx`

**Enhancements Added**:
- Detailed request data logging before API calls
- Character encoding analysis (UTF-8 byte counts)
- Comprehensive error response capture
- Validation error display

**Features**:
- Logs exact data being sent to backend
- Shows character lengths vs byte lengths for Thai text
- Captures full error responses including validation details
- Shows backend received data for comparison

### 2. Enhanced Backend Validation (`surveyController.ts`)

**Location**: `/backend/src/controllers/surveyController.ts`

**Enhancements Added**:
- Comprehensive request body logging
- Character encoding analysis for each field
- Detailed validation error reporting
- Database constraint error capturing

**Features**:
- Logs user info and raw request body
- Analyzes UTF-8 encoding for each text field
- Performs thorough validation with detailed error messages
- Shows received vs expected data structures

### 3. Thai Survey Debug Page

**Location**: `/frontend/src/pages/admin/ThaiSurveyDebug.tsx`  
**URL**: `http://localhost:3000/admin/surveys/debug/thai`

**Features**:
- Pre-filled Thai language survey data
- Real-time text encoding analysis
- Interactive field editing
- Detailed error display
- Character encoding inspection

### 4. Node.js Error Capture Script

**Location**: `/capture-thai-survey-error.js`

**Usage**:
```bash
# Ensure backend is running on http://localhost:4000
cd /Users/nut/loyalty-app
node capture-thai-survey-error.js
```

**Features**:
- Automated login with test credentials
- Thai survey creation with detailed logging
- Network request/response analysis
- Character encoding inspection
- Comprehensive error analysis

## Step-by-Step Debugging Instructions

### Method 1: Using the Debug Page (Recommended)

1. **Start the backend server**:
   ```bash
   cd backend
   npm run dev
   ```

2. **Start the frontend server**:
   ```bash  
   cd frontend
   npm run dev
   ```

3. **Login as admin**:
   - Email: `winut.hf@gmail.com`
   - Password: `Kick2you@ss`

4. **Navigate to debug page**:
   ```
   http://localhost:3000/admin/surveys/debug/thai
   ```

5. **Open browser dev tools** (F12) and go to Console tab

6. **Click "Create Thai Survey"** button

7. **Check console output** for detailed logs:
   - Request data analysis
   - Character encoding details  
   - Error response capture

8. **Check the "Last Error" section** on the page for:
   - Validation errors
   - Backend received data
   - Full error details

### Method 2: Using the Node.js Script

1. **Ensure backend is running**:
   ```bash
   cd backend  
   npm run dev
   ```

2. **Run the capture script**:
   ```bash
   cd /Users/nut/loyalty-app
   node capture-thai-survey-error.js
   ```

3. **Review the output** which includes:
   - Login process logs
   - Survey data encoding analysis
   - Complete error response capture
   - Recommendations based on error type

### Method 3: Using the Enhanced Survey Builder

1. **Navigate to**: `http://localhost:3000/admin/surveys/create`

2. **Open browser dev tools** (F12) Console tab

3. **Create a survey with Thai content**:
   - Title: `ความพึงพอใจของลูกค้า`
   - Description: `กรุณาช่วยเราปรับปรุงบริการ`
   - Add single choice question: `คุณพอใจกับบริการไหม?`
   - Options: `พอใจมาก`, `พอใจ`

4. **Click "Create & Publish"**

5. **Check console** for detailed error logs

6. **Check backend server logs** for validation details

## What to Look For

### Common Issues to Check:

1. **Character Encoding Problems**:
   - UTF-8 byte length vs character length mismatches
   - Character corruption during transmission
   - Database column encoding issues

2. **Field Length Limits**:
   - Database column size restrictions
   - API payload size limits
   - Frontend validation conflicts

3. **Data Type Issues**:
   - JSON serialization problems
   - Type validation failures  
   - Required field validation

4. **Database Constraints**:
   - Foreign key constraint violations
   - Unique constraint violations
   - Check constraint failures

### Key Log Sections:

**Frontend Console**:
```
=== SURVEY CREATION DEBUG ===
Survey Data: {...}
Title encoding: {title: "...", titleLength: X, titleBytes: Y}
Description encoding: {...}
Questions data: [...]
=============================
```

**Backend Logs**:  
```
=== BACKEND SURVEY CREATION DEBUG ===
User: {id: "...", role: "admin"}
Raw request body: {...}
Survey data validation:
- Title: {value: "...", type: "string", length: X, bytes: Y, encoding: "UTF-8"}
[validation results...]
=====================================
```

**Error Logs**:
```
=== SURVEY CREATION ERROR ===  
Full error object: {...}
Error response data: {...}
Validation errors: [...]
=============================
```

## Expected Outcomes

After running any of these debugging methods, you should have:

1. **Exact error message** from the backend API
2. **Specific validation failure details** (which field is failing)
3. **Character encoding analysis** (UTF-8 byte counts vs character counts)
4. **Data structure comparison** (sent vs received)
5. **Database constraint information** (if applicable)

## Next Steps

Based on the captured error information:

1. **400 Bad Request with validation errors**: 
   - Check specific field validation failures
   - Verify data types and required fields
   - Check character encoding issues

2. **500 Internal Server Error**:
   - Check backend server logs
   - Look for database connection/constraint issues  
   - Check for Unicode/UTF-8 handling problems

3. **Network/Connection Issues**:
   - Verify backend server is running
   - Check API endpoints and CORS settings
   - Validate authentication tokens

## Files Modified

- ✅ `frontend/src/pages/admin/SurveyBuilder.tsx` - Enhanced error logging
- ✅ `backend/src/controllers/surveyController.ts` - Detailed validation
- ✅ `backend/src/services/surveyService.ts` - Added missing method
- ✅ `frontend/src/pages/admin/ThaiSurveyDebug.tsx` - New debug page
- ✅ `frontend/src/App.tsx` - Added debug route
- ✅ `capture-thai-survey-error.js` - Node.js capture script

## Usage Notes

- All debugging tools are **development-only** and should be removed or disabled in production
- The enhanced logging may show sensitive data in console/logs - use only in secure development environments
- Backend logs may become verbose - monitor disk space if running for extended periods
- The Node.js script requires the backend server to be running and accessible on port 4000
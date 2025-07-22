const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5001;

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

// Mock JWT secret
const JWT_SECRET = 'mock-jwt-secret-for-testing';

// Simple authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Mock backend running', timestamp: new Date().toISOString() });
});

// Mock login endpoint
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  // Simple mock authentication
  if (email === 'winut.hf@gmail.com' && password === 'Kick2you@ss') {
    const token = jwt.sign(
      { 
        id: 'mock-user-id',
        email: email,
        role: 'user',
        name: 'Test User'
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    res.json({
      success: true,
      user: {
        id: 'mock-user-id',
        email: email,
        name: 'Test User',
        role: 'user'
      },
      token
    });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// Mock user profile endpoint
app.get('/api/user/profile', authenticate, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// Mock loyalty points endpoint
app.get('/api/loyalty/points', authenticate, (req, res) => {
  res.json({
    success: true,
    data: {
      currentPoints: 1250,
      tierLevel: 'Gold',
      pointsToNextTier: 750
    }
  });
});

// SURVEY API ENDPOINTS - The ones we want to test!

// Get public surveys
app.get('/api/surveys/public/user', authenticate, (req, res) => {
  console.log(`✅ Route hit: GET /api/surveys/public/user - User: ${req.user.email}`);
  res.json({
    success: true,
    surveys: [
      {
        id: 'survey-1',
        title: 'Customer Satisfaction Survey',
        description: 'Tell us about your experience',
        access_type: 'public',
        status: 'active',
        created_at: '2024-01-15T10:00:00Z'
      },
      {
        id: 'survey-2', 
        title: 'Service Quality Survey',
        description: 'Rate our service quality',
        access_type: 'public',
        status: 'active',
        created_at: '2024-01-20T14:00:00Z'
      }
    ]
  });
});

// Get invited surveys
app.get('/api/surveys/invited/user', authenticate, (req, res) => {
  console.log(`✅ Route hit: GET /api/surveys/invited/user - User: ${req.user.email}`);
  res.json({
    success: true,
    surveys: [
      {
        id: 'survey-3',
        title: 'VIP Member Feedback',
        description: 'Exclusive survey for VIP members',
        access_type: 'invite_only',
        status: 'active',
        invitation_sent_at: '2024-01-25T09:00:00Z',
        created_at: '2024-01-25T08:00:00Z'
      }
    ]
  });
});

// Get available surveys (combination of public + invited)
app.get('/api/surveys/available/user', authenticate, (req, res) => {
  console.log(`✅ Route hit: GET /api/surveys/available/user - User: ${req.user.email}`);
  res.json({
    success: true,
    surveys: [
      {
        id: 'survey-1',
        title: 'Customer Satisfaction Survey',
        description: 'Tell us about your experience',
        access_type: 'public',
        status: 'active',
        created_at: '2024-01-15T10:00:00Z'
      },
      {
        id: 'survey-2', 
        title: 'Service Quality Survey',
        description: 'Rate our service quality',
        access_type: 'public',
        status: 'active',
        created_at: '2024-01-20T14:00:00Z'
      },
      {
        id: 'survey-3',
        title: 'VIP Member Feedback',
        description: 'Exclusive survey for VIP members',
        access_type: 'invite_only',
        status: 'active',
        invitation_sent_at: '2024-01-25T09:00:00Z',
        created_at: '2024-01-25T08:00:00Z'
      }
    ]
  });
});

// Catch-all for unregistered routes
app.use((req, res) => {
  console.log(`❌ Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Route not found', path: req.path, method: req.method });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Mock backend server running on port ${PORT}`);
  console.log(`📋 Available routes:`);
  console.log(`   GET  /api/health`);
  console.log(`   POST /api/auth/login`);
  console.log(`   GET  /api/user/profile (auth required)`);
  console.log(`   GET  /api/loyalty/points (auth required)`);
  console.log(`   GET  /api/surveys/public/user (auth required)`);
  console.log(`   GET  /api/surveys/invited/user (auth required)`);
  console.log(`   GET  /api/surveys/available/user (auth required)`);
  console.log(`\n💡 Test credentials: winut.hf@gmail.com / Kick2you@ss`);
});
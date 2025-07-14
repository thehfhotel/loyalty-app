const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const { validate, schemas } = require('../utils/validation');

// Public routes
router.post('/register', validate(schemas.register), AuthController.register);
router.post('/login', validate(schemas.login), AuthController.login);
router.post('/refresh-token', validate(schemas.refreshToken), AuthController.refreshToken);

// Protected routes
router.post('/logout', authenticateToken, AuthController.logout);
router.post('/change-password', authenticateToken, validate(schemas.changePassword), AuthController.changePassword);
router.post('/verify-email', authenticateToken, AuthController.verifyEmail);
router.get('/me', authenticateToken, AuthController.getProfile);

module.exports = router;
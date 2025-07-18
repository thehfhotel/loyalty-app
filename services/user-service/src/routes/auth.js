const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const { schemas, validate } = require('../utils/validation');

// Public routes
router.post('/register', validate(schemas.register), authController.register.bind(authController));
router.post('/login', validate(schemas.login), authController.login.bind(authController));
router.post('/refresh-token', authController.refreshToken.bind(authController));

// Protected routes
router.post('/logout', authenticateToken, authController.logout.bind(authController));
router.post('/change-password', authenticateToken, authController.changePassword.bind(authController));
router.post('/verify-email', authenticateToken, authController.verifyEmail.bind(authController));
router.get('/me', authenticateToken, authController.getProfile.bind(authController));

module.exports = router;
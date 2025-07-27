import { Router } from 'express';
import { translationController } from '../controllers/translationController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Basic translation endpoints
router.post('/translate', authenticate, translationController.translateTexts);

// Survey translation endpoints
router.post('/survey/:id/translate', authenticate, translationController.translateSurvey);
router.get('/survey/:id/translations', authenticate, translationController.getSurveyTranslations);

// Coupon translation endpoints  
router.post('/coupon/:id/translate', authenticate, translationController.translateCoupon);
router.get('/coupon/:id/translations', authenticate, translationController.getCouponTranslations);

// Translation job management
router.get('/job/:id', authenticate, translationController.getTranslationJob);
router.get('/jobs', authenticate, translationController.getTranslationJobs);

export default router;
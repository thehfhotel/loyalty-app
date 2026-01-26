import { Request, Response, NextFunction } from 'express';
import { translationService } from '../services/translationService';
import { surveyService } from '../services/surveyService';
import { couponService } from '../services/couponService';

export const translationController = {
  // Translate arbitrary texts
  async translateTexts(req: Request, res: Response, next: NextFunction) {
    try {
      const { texts, sourceLanguage, targetLanguages, provider = 'azure' } = req.body;

      if (!texts || !Array.isArray(texts) || texts.length === 0) {
        return res.status(400).json({ error: 'Texts array is required' });
      }

      if (!sourceLanguage || !targetLanguages || !Array.isArray(targetLanguages)) {
        return res.status(400).json({ error: 'Source and target languages are required' });
      }

      const result = await translationService.translateTexts({
        texts,
        sourceLanguage,
        targetLanguages,
        provider
      });

      return res.json(result);
    } catch (error) {
      return next(error);
    }
  },

  // Start survey translation job
  async translateSurvey(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const { sourceLanguage, targetLanguages, provider = 'azure' } = req.body;

      if (!sourceLanguage || !targetLanguages || !Array.isArray(targetLanguages)) {
        return res.status(400).json({ error: 'Source and target languages are required' });
      }

      // Get the survey first
      const survey = await surveyService.getSurveyById(id);
      if (!survey) {
        return res.status(404).json({ error: 'Survey not found' });
      }

      const translationJob = await translationService.translateSurvey(
        id,
        sourceLanguage,
        targetLanguages,
        provider,
        req.user!.id
      );

      return res.json(translationJob);
    } catch (error) {
      return next(error);
    }
  },

  // Get survey translations
  async getSurveyTranslations(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);

      const translations = await surveyService.getAllSurveyTranslations(id);
      if (!translations) {
        return res.status(404).json({ error: 'Survey not found' });
      }

      return res.json(translations);
    } catch (error) {
      return next(error);
    }
  },

  // Start coupon translation job
  async translateCoupon(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const { sourceLanguage, targetLanguages, provider = 'azure' } = req.body;

      if (!sourceLanguage || !targetLanguages || !Array.isArray(targetLanguages)) {
        return res.status(400).json({ error: 'Source and target languages are required' });
      }

      // Get the coupon first
      const coupon = await couponService.getCouponById(id);
      if (!coupon) {
        return res.status(404).json({ error: 'Coupon not found' });
      }

      const translationJob = await translationService.translateCoupon(
        id,
        sourceLanguage,
        targetLanguages,
        provider,
        req.user!.id
      );

      return res.json(translationJob);
    } catch (error) {
      return next(error);
    }
  },

  // Get coupon translations
  async getCouponTranslations(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const { language } = req.query;

      const coupon = await couponService.getCouponWithTranslations(id, language as string);
      if (!coupon) {
        return res.status(404).json({ error: 'Coupon not found' });
      }

      return res.json(coupon);
    } catch (error) {
      return next(error);
    }
  },

  // Get translation job status
  async getTranslationJob(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);

      const job = await translationService.getTranslationJobById(id);
      if (!job) {
        return res.status(404).json({ error: 'Translation job not found' });
      }

      return res.json(job);
    } catch (error) {
      return next(error);
    }
  },

  // Get all translation jobs for user
  async getTranslationJobs(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 10, status, entityType } = req.query;

      const jobs = await translationService.getTranslationJobs({
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        status: status as string,
        entityType: entityType as string,
        userId: req.user!.id
      });

      return res.json(jobs);
    } catch (error) {
      return next(error);
    }
  },

  // Get translation service status
  async getServiceStatus(_req: Request, res: Response, next: NextFunction) {
    try {
      const status = await translationService.getServiceStatus();
      return res.json(status);
    } catch (error) {
      return next(error);
    }
  }
};
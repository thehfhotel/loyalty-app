import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../config/database';

export type SupportedLanguage = 'th' | 'en' | 'zh-CN';
export type TranslationProvider = 'azure' | 'google' | 'libretranslate';

export interface TranslationRequest {
  texts: string[];
  sourceLanguage: SupportedLanguage;
  targetLanguages: SupportedLanguage[];
  provider?: TranslationProvider;
}

export interface TranslationResponse {
  translations: { [language: string]: string[] };
  originalTexts: string[];
  sourceLanguage: string;
  provider: TranslationProvider;
  charactersTranslated: number;
}

export interface TranslationJob {
  id: string;
  entityType: 'survey' | 'coupon';
  entityId: string;
  sourceLanguage: SupportedLanguage;
  targetLanguages: SupportedLanguage[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
  createdBy?: string;
  charactersTranslated?: number;
  provider: TranslationProvider;
}

class TranslationService {
  private azureConfig = {
    endpoint: process.env.AZURE_TRANSLATION_TEXT_URI ?? 'https://api.cognitive.microsofttranslator.com',
    apiKey: process.env.AZURE_TRANSLATION_KEY_1 ?? process.env.AZURE_TRANSLATION_KEY_2,
    region: process.env.AZURE_TRANSLATION_REGION ?? 'global'
  };

  /**
   * Main translation method that routes to appropriate provider
   */
  async translateTexts(request: TranslationRequest): Promise<TranslationResponse> {
    const provider = request.provider ?? 'azure';
    
    switch (provider) {
      case 'azure':
        return this.translateWithAzure(request);
      case 'google':
        return this.translateWithGoogle(request);
      case 'libretranslate':
        return this.translateWithLibreTranslate(request);
      default:
        throw new Error(`Unsupported translation provider: ${provider}`);
    }
  }

  /**
   * Translate using Microsoft Azure Translator
   */
  private async translateWithAzure(request: TranslationRequest): Promise<TranslationResponse> {
    if (!this.azureConfig.apiKey) {
      throw new Error('Azure Translator API key not configured');
    }

    const { texts, sourceLanguage, targetLanguages } = request;
    
    // Convert language codes for Azure
    const azureSourceLang = this.toAzureLanguageCode(sourceLanguage);
    const azureTargetLangs = targetLanguages.map(lang => this.toAzureLanguageCode(lang));

    try {
      const response = await axios.post(
        `${this.azureConfig.endpoint}/translate?api-version=3.0&from=${azureSourceLang}&to=${azureTargetLangs.join('&to=')}`,
        texts.map(text => ({ text })),
        {
          headers: {
            'Ocp-Apim-Subscription-Key': this.azureConfig.apiKey,
            'Ocp-Apim-Subscription-Region': this.azureConfig.region,
            'Content-Type': 'application/json'
          }
        }
      );

      const translations: { [language: string]: string[] } = {};
      
      // Initialize arrays for each target language
      targetLanguages.forEach(lang => {
        translations[lang] = [];
      });

      // Process Azure response
      response.data.forEach((translationGroup: any) => {
        translationGroup.translations.forEach((translation: any) => {
          const ourLangCode = this.fromAzureLanguageCode(translation.to);
          if (translations[ourLangCode]) {
            translations[ourLangCode].push(translation.text);
          }
        });
      });

      const charactersTranslated = texts.reduce((sum, text) => sum + text.length, 0) * targetLanguages.length;

      return {
        translations,
        originalTexts: texts,
        sourceLanguage,
        provider: 'azure',
        charactersTranslated
      };
    } catch (error) {
      console.error('Azure translation error:', error);
      throw new Error(`Azure translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Translate using Google Translate (placeholder implementation)
   */
  private async translateWithGoogle(request: TranslationRequest): Promise<TranslationResponse> {
    // Placeholder implementation - parameters will be used when implemented
    request; // Reference to avoid unused parameter warning
    throw new Error('Google Translate integration not implemented yet');
  }

  /**
   * Translate using LibreTranslate (placeholder implementation)
   */
  private async translateWithLibreTranslate(request: TranslationRequest): Promise<TranslationResponse> {
    // Placeholder implementation - parameters will be used when implemented
    request; // Reference to avoid unused parameter warning
    throw new Error('LibreTranslate integration not implemented yet');
  }

  /**
   * Start a translation job for a survey
   */
  async translateSurvey(
    surveyId: string, 
    sourceLanguage: SupportedLanguage, 
    targetLanguages: SupportedLanguage[], 
    provider: TranslationProvider = 'azure',
    userId?: string
  ): Promise<TranslationJob> {
    const jobId = uuidv4();
    
    // Create translation job record
    const job: TranslationJob = {
      id: jobId,
      entityType: 'survey',
      entityId: surveyId,
      sourceLanguage,
      targetLanguages,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
      createdBy: userId,
      provider
    };

    // Insert job into database
    await getPool().query(
      `INSERT INTO translation_jobs (id, entity_type, entity_id, source_language, target_languages, status, progress, created_by, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [jobId, 'survey', surveyId, sourceLanguage, JSON.stringify(targetLanguages), 'pending', 0, userId, provider]
    );

    // Start translation process asynchronously
    this.processSurveyTranslation(job).catch(console.error);

    return job;
  }

  /**
   * Start a translation job for a coupon
   */
  async translateCoupon(
    couponId: string, 
    sourceLanguage: SupportedLanguage, 
    targetLanguages: SupportedLanguage[], 
    provider: TranslationProvider = 'azure',
    userId?: string
  ): Promise<TranslationJob> {
    const jobId = uuidv4();
    
    const job: TranslationJob = {
      id: jobId,
      entityType: 'coupon',
      entityId: couponId,
      sourceLanguage,
      targetLanguages,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
      createdBy: userId,
      provider
    };

    await getPool().query(
      `INSERT INTO translation_jobs (id, entity_type, entity_id, source_language, target_languages, status, progress, created_by, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [jobId, 'coupon', couponId, sourceLanguage, JSON.stringify(targetLanguages), 'pending', 0, userId, provider]
    );

    this.processCouponTranslation(job).catch(console.error);

    return job;
  }

  /**
   * Process survey translation job
   */
  private async processSurveyTranslation(job: TranslationJob): Promise<void> {
    try {
      // Update status to processing
      await this.updateJobStatus(job.id, 'processing', 10);

      // Get survey data
      const surveyResult = await getPool().query('SELECT * FROM surveys WHERE id = $1', [job.entityId]);
      if (surveyResult.rows.length === 0) {
        throw new Error('Survey not found');
      }

      const survey = surveyResult.rows[0];
      
      // Extract texts to translate
      const textsToTranslate: string[] = [];
      const textMapping: { type: string; index?: number; field: string; optionIndex?: number }[] = [];

      // Survey title and description
      if (survey.title) {
        textsToTranslate.push(survey.title);
        textMapping.push({ type: 'survey', field: 'title' });
      }
      if (survey.description) {
        textsToTranslate.push(survey.description);
        textMapping.push({ type: 'survey', field: 'description' });
      }

      // Questions and options
      const questions = survey.questions ?? [];
      questions.forEach((question: any, questionIndex: number) => {
        if (question.text) {
          textsToTranslate.push(question.text);
          textMapping.push({ type: 'question', index: questionIndex, field: 'text' });
        }
        if (question.description) {
          textsToTranslate.push(question.description);
          textMapping.push({ type: 'question', index: questionIndex, field: 'description' });
        }
        if (question.options) {
          question.options.forEach((option: any, optionIndex: number) => {
            if (option.text) {
              textsToTranslate.push(option.text);
              textMapping.push({ type: 'option', index: questionIndex, field: 'text', optionIndex });
            }
          });
        }
      });

      await this.updateJobStatus(job.id, 'processing', 30);

      // Translate texts
      const translationResult = await this.translateTexts({
        texts: textsToTranslate,
        sourceLanguage: job.sourceLanguage,
        targetLanguages: job.targetLanguages,
        provider: job.provider
      });

      await this.updateJobStatus(job.id, 'processing', 70);

      // Store translations
      for (const targetLanguage of job.targetLanguages) {
        const translations = translationResult.translations[targetLanguage];
        const translatedData = this.applyTranslationsToSurvey(
          { title: survey.title, description: survey.description, questions },
          translations,
          textMapping
        );

        // Store in database
        await getPool().query(
          `INSERT INTO survey_translations (survey_id, language, title, description, questions, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (survey_id, language) 
           DO UPDATE SET title = $3, description = $4, questions = $5, updated_at = NOW()`,
          [
            job.entityId,
            targetLanguage,
            translatedData.title,
            translatedData.description,
            JSON.stringify(translatedData.questions)
          ]
        );
      }

      // Mark job as completed
      await this.updateJobStatus(job.id, 'completed', 100, translationResult.charactersTranslated);

    } catch (error) {
      console.error('Survey translation failed:', error);
      await this.updateJobStatus(job.id, 'failed', 0, 0, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Process coupon translation job
   */
  private async processCouponTranslation(job: TranslationJob): Promise<void> {
    try {
      await this.updateJobStatus(job.id, 'processing', 10);

      const couponResult = await getPool().query('SELECT * FROM coupons WHERE id = $1', [job.entityId]);
      if (couponResult.rows.length === 0) {
        throw new Error('Coupon not found');
      }

      const coupon = couponResult.rows[0];
      
      const textsToTranslate: string[] = [];
      const textMapping: { field: string }[] = [];

      if (coupon.name) {
        textsToTranslate.push(coupon.name);
        textMapping.push({ field: 'name' });
      }
      if (coupon.description) {
        textsToTranslate.push(coupon.description);
        textMapping.push({ field: 'description' });
      }
      if (coupon.terms_and_conditions) {
        textsToTranslate.push(coupon.terms_and_conditions);
        textMapping.push({ field: 'terms_and_conditions' });
      }

      await this.updateJobStatus(job.id, 'processing', 30);

      const translationResult = await this.translateTexts({
        texts: textsToTranslate,
        sourceLanguage: job.sourceLanguage,
        targetLanguages: job.targetLanguages,
        provider: job.provider
      });

      await this.updateJobStatus(job.id, 'processing', 70);

      // Store translations
      for (const targetLanguage of job.targetLanguages) {
        const translations = translationResult.translations[targetLanguage];
        const translatedData = this.applyTranslationsToCoupon(
          { name: coupon.name, description: coupon.description, terms_and_conditions: coupon.terms_and_conditions },
          translations,
          textMapping
        );

        await getPool().query(
          `INSERT INTO coupon_translations (coupon_id, language, name, description, terms_and_conditions, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (coupon_id, language) 
           DO UPDATE SET name = $3, description = $4, terms_and_conditions = $5, updated_at = NOW()`,
          [
            job.entityId,
            targetLanguage,
            translatedData.name,
            translatedData.description,
            translatedData.terms_and_conditions
          ]
        );
      }

      await this.updateJobStatus(job.id, 'completed', 100, translationResult.charactersTranslated);

    } catch (error) {
      console.error('Coupon translation failed:', error);
      await this.updateJobStatus(job.id, 'failed', 0, 0, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Apply translations to survey data structure
   */
  private applyTranslationsToSurvey(
    original: any, 
    translations: string[], 
    textMapping: { type: string; index?: number; field: string; optionIndex?: number }[]
  ): any {
    const result = JSON.parse(JSON.stringify(original));
    
    translations.forEach((translation, index) => {
      const mapping = textMapping[index];
      if (!mapping) return;

      switch (mapping.type) {
        case 'survey':
          result[mapping.field] = translation;
          break;
        case 'question':
          if (mapping.index !== undefined && result.questions[mapping.index]) {
            result.questions[mapping.index][mapping.field] = translation;
          }
          break;
        case 'option':
          if (mapping.index !== undefined && mapping.optionIndex !== undefined && 
              result.questions[mapping.index]?.options?.[mapping.optionIndex]) {
            result.questions[mapping.index].options[mapping.optionIndex][mapping.field] = translation;
          }
          break;
      }
    });

    return result;
  }

  /**
   * Apply translations to coupon data structure
   */
  private applyTranslationsToCoupon(
    original: any, 
    translations: string[], 
    textMapping: { field: string }[]
  ): any {
    const result = { ...original };
    
    translations.forEach((translation, index) => {
      const mapping = textMapping[index];
      if (mapping) {
        result[mapping.field] = translation;
      }
    });

    return result;
  }

  /**
   * Update translation job status
   */
  private async updateJobStatus(
    jobId: string, 
    status: TranslationJob['status'], 
    progress: number, 
    charactersTranslated?: number,
    error?: string
  ): Promise<void> {
    const updateFields = ['status = $2', 'progress = $3', 'updated_at = NOW()'];
    const values: any[] = [jobId, status, progress];

    if (charactersTranslated !== undefined) {
      updateFields.push(`characters_translated = $${values.length + 1}`);
      values.push(charactersTranslated);
    }

    if (status === 'completed') {
      updateFields.push(`completed_at = $${values.length + 1}`);
      values.push(new Date().toISOString());
    }

    if (error) {
      updateFields.push(`error = $${values.length + 1}`);
      values.push(error);
    }

    await getPool().query(
      `UPDATE translation_jobs SET ${updateFields.join(', ')} WHERE id = $1`,
      values
    );
  }

  /**
   * Get translation job by ID
   */
  async getTranslationJobById(jobId: string): Promise<TranslationJob | null> {
    const result = await getPool().query('SELECT * FROM translation_jobs WHERE id = $1', [jobId]);
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      sourceLanguage: row.source_language,
      targetLanguages: row.target_languages,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      error: row.error,
      createdBy: row.created_by,
      charactersTranslated: row.characters_translated,
      provider: row.provider
    };
  }

  /**
   * Get translation jobs with filters
   */
  async getTranslationJobs(filters: {
    page: number;
    limit: number;
    status?: string;
    entityType?: string;
    userId?: string;
  }): Promise<{ jobs: TranslationJob[]; total: number; page: number; limit: number; totalPages: number }> {
    const { page, limit, status, entityType, userId } = filters;
    const offset = (page - 1) * limit;

    const whereConditions = [];
    const values = [];
    let paramCount = 0;

    if (status) {
      whereConditions.push(`status = $${++paramCount}`);
      values.push(status);
    }

    if (entityType) {
      whereConditions.push(`entity_type = $${++paramCount}`);
      values.push(entityType);
    }

    if (userId) {
      whereConditions.push(`created_by = $${++paramCount}`);
      values.push(userId);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await getPool().query(
      `SELECT COUNT(*) FROM translation_jobs ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);

    // Get jobs
    const jobsResult = await getPool().query(
      `SELECT * FROM translation_jobs ${whereClause} ORDER BY created_at DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`,
      [...values, limit, offset]
    );

    const jobs = jobsResult.rows.map(row => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      sourceLanguage: row.source_language,
      targetLanguages: row.target_languages,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      error: row.error,
      createdBy: row.created_by,
      charactersTranslated: row.characters_translated,
      provider: row.provider
    }));

    return {
      jobs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Get translation service status
   */
  async getServiceStatus(): Promise<{ available: boolean; provider: string; charactersRemaining?: number }> {
    try {
      // Check Azure service availability
      if (this.azureConfig.apiKey) {
        return {
          available: true,
          provider: 'azure',
          charactersRemaining: 2000000 // Azure free tier limit
        };
      }

      return {
        available: false,
        provider: 'none'
      };
    } catch (error) {
      return {
        available: false,
        provider: 'error'
      };
    }
  }

  /**
   * Convert our language codes to Azure language codes
   */
  private toAzureLanguageCode(language: SupportedLanguage): string {
    const mapping: { [key in SupportedLanguage]: string } = {
      'th': 'th',
      'en': 'en',
      'zh-CN': 'zh-Hans'
    };
    return mapping[language] || language;
  }

  /**
   * Convert Azure language codes to our language codes
   */
  private fromAzureLanguageCode(azureLang: string): SupportedLanguage {
    const mapping: { [key: string]: SupportedLanguage } = {
      'th': 'th',
      'en': 'en',
      'zh-Hans': 'zh-CN'
    };
    return mapping[azureLang] ?? 'en';
  }
}

export const translationService = new TranslationService();
const Joi = require('joi');

const schemas = {
  createCampaign: Joi.object({
    name: Joi.string().min(3).max(100).required(),
    description: Joi.string().max(500).optional(),
    campaignType: Joi.string().valid('push', 'email', 'sms', 'multi_channel').required(),
    content: Joi.object({
      title: Joi.string().max(100).required(),
      body: Joi.string().max(1000).required(),
      imageUrl: Joi.string().uri().optional(),
      ctaText: Joi.string().max(50).optional(),
      ctaUrl: Joi.string().uri().optional()
    }).required(),
    targetCriteria: Joi.object({
      loyalty_tier: Joi.array().items(Joi.string().valid('bronze', 'silver', 'gold', 'platinum')).optional(),
      min_total_spend: Joi.number().min(0).optional(),
      min_bookings: Joi.number().integer().min(0).optional(),
      days_since_last_stay: Joi.number().integer().min(0).optional(),
      age_range: Joi.object({
        min: Joi.number().integer().min(18).max(100),
        max: Joi.number().integer().min(18).max(100)
      }).optional()
    }).optional(),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).optional()
  }),

  updateCampaignStatus: Joi.object({
    status: Joi.string().valid('draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled').required()
  }),

  segmentPreview: Joi.object({
    criteria: Joi.object({
      loyalty_tier: Joi.array().items(Joi.string().valid('bronze', 'silver', 'gold', 'platinum')).optional(),
      min_total_spend: Joi.number().min(0).optional(),
      min_bookings: Joi.number().integer().min(0).optional(),
      days_since_last_stay: Joi.number().integer().min(0).optional(),
      days_since_registration: Joi.number().integer().min(0).optional(),
      age_range: Joi.object({
        min: Joi.number().integer().min(18).max(100),
        max: Joi.number().integer().min(18).max(100)
      }).optional()
    }).required()
  }),

  updateDeliveryStatus: Joi.object({
    status: Joi.string().valid('pending', 'sent', 'delivered', 'failed', 'bounced').required(),
    errorMessage: Joi.string().max(500).optional()
  })
};

const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    
    if (error) {
      const message = error.details.map(detail => detail.message).join(', ');
      return res.status(400).json({
        success: false,
        message: message
      });
    }
    
    next();
  };
};

module.exports = {
  schemas,
  validate
};
const Joi = require('joi');

const schemas = {
  getCoupons: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    category: Joi.string().valid('percentage_discount', 'fixed_discount', 'other').optional()
  }),

  validateCoupon: Joi.object({
    orderAmount: Joi.number().min(0).max(50000).default(0)
  }),

  redeemCoupon: Joi.object({
    orderAmount: Joi.number().min(0).max(50000).required(),
    bookingId: Joi.string().uuid().optional()
  }),

  getUsageHistory: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20)
  }),

  getWallet: Joi.object({
    status: Joi.string().valid('active', 'used', 'expired', 'all').default('active')
  }),

  markFavorite: Joi.object({
    isFavorite: Joi.boolean().required()
  }),

  validateRedemption: Joi.object({
    couponCode: Joi.string().min(3).max(50).required(),
    orderAmount: Joi.number().min(0).max(50000).required(),
    staffId: Joi.string().uuid().optional()
  })
};

const validate = (schema) => {
  return (req, res, next) => {
    const dataToValidate = req.method === 'GET' ? req.query : req.body;
    const { error, value } = schema.validate(dataToValidate);
    
    if (error) {
      const message = error.details.map(detail => detail.message).join(', ');
      return res.status(400).json({
        success: false,
        message: message
      });
    }
    
    // Replace req.query or req.body with validated data
    if (req.method === 'GET') {
      req.query = value;
    } else {
      req.body = value;
    }
    
    next();
  };
};

module.exports = {
  schemas,
  validate
};
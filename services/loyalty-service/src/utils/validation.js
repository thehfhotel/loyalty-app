const Joi = require('joi');

const schemas = {
  addPoints: Joi.object({
    userId: Joi.string().uuid().required(),
    points: Joi.number().integer().min(1).max(100000).required(),
    description: Joi.string().min(3).max(255).required(),
    referenceId: Joi.string().uuid().optional(),
    referenceType: Joi.string().valid('booking', 'survey', 'referral', 'bonus', 'admin_adjustment').optional()
  }),

  simulateBooking: Joi.object({
    bookingAmount: Joi.number().min(0).max(50000).required(),
    roomType: Joi.string().valid('standard', 'deluxe', 'suite', 'presidential').default('standard'),
    nights: Joi.number().integer().min(1).max(30).default(1)
  }),

  redeemReward: Joi.object({
    quantity: Joi.number().integer().min(1).max(10).default(1)
  }),

  getTransactions: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    transactionType: Joi.string().valid('earned', 'redeemed', 'expired', 'adjusted').optional(),
    dateFrom: Joi.date().iso().optional(),
    dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional()
  }),

  getRewards: Joi.object({
    category: Joi.string().valid('accommodation', 'dining', 'spa', 'transportation', 'service').optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20)
  }),

  getUserRedemptions: Joi.object({
    status: Joi.string().valid('pending', 'confirmed', 'used', 'expired', 'cancelled').optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20)
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
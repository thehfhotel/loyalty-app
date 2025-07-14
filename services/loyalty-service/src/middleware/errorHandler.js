const errorHandler = (err, req, res, next) => {
  console.error('Loyalty Service Error:', err);

  // Default error
  let error = {
    success: false,
    message: 'Internal server error',
    statusCode: 500
  };

  // Validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = {
      success: false,
      message,
      statusCode: 400
    };
  }

  // Postgres constraint error
  if (err.code === '23505') {
    error = {
      success: false,
      message: 'Duplicate value error',
      statusCode: 409
    };
  }

  // Postgres foreign key error
  if (err.code === '23503') {
    error = {
      success: false,
      message: 'Referenced record does not exist',
      statusCode: 400
    };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = {
      success: false,
      message: 'Invalid token',
      statusCode: 401
    };
  }

  if (err.name === 'TokenExpiredError') {
    error = {
      success: false,
      message: 'Token expired',
      statusCode: 401
    };
  }

  // Custom error
  if (err.statusCode) {
    error = {
      success: false,
      message: err.message,
      statusCode: err.statusCode
    };
  }

  // Business logic errors
  if (err.name === 'InsufficientPointsError') {
    error = {
      success: false,
      message: 'Insufficient points for this transaction',
      statusCode: 400
    };
  }

  if (err.name === 'TierRequirementError') {
    error = {
      success: false,
      message: 'User does not meet tier requirements',
      statusCode: 403
    };
  }

  // In development, include stack trace
  if (process.env.NODE_ENV === 'development') {
    error.stack = err.stack;
  }

  res.status(error.statusCode).json(error);
};

module.exports = errorHandler;
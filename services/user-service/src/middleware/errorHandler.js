const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error
  let error = {
    success: false,
    message: 'Internal server error',
    statusCode: 500
  };

  // Mongoose validation error
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
    if (err.constraint === 'users_email_key') {
      error = {
        success: false,
        message: 'Email address is already registered',
        statusCode: 409
      };
    } else {
      error = {
        success: false,
        message: 'Duplicate value error',
        statusCode: 409
      };
    }
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

  // In development, include stack trace
  if (process.env.NODE_ENV === 'development') {
    error.stack = err.stack;
  }

  res.status(error.statusCode).json(error);
};

module.exports = errorHandler;
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  let error = {
    success: false,
    message: 'Internal server error',
    statusCode: 500
  };

  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = {
      success: false,
      message,
      statusCode: 400
    };
  }

  if (err.code === '23505') {
    error = {
      success: false,
      message: 'Duplicate value error',
      statusCode: 409
    };
  }

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

  if (err.statusCode) {
    error = {
      success: false,
      message: err.message,
      statusCode: err.statusCode
    };
  }

  if (process.env.NODE_ENV === 'development') {
    error.stack = err.stack;
  }

  res.status(error.statusCode).json(error);
};

module.exports = errorHandler;
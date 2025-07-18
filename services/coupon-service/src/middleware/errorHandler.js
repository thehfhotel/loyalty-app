const errorHandler = (err, req, res, next) => {
  console.error('Error details:', err);

  // Default error
  let error = {
    success: false,
    message: err.message || 'Internal Server Error'
  };

  // Validation errors
  if (err.name === 'ValidationError') {
    error.message = Object.values(err.errors).map(val => val.message).join(', ');
    return res.status(400).json(error);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error.message = 'Invalid token';
    return res.status(401).json(error);
  }

  if (err.name === 'TokenExpiredError') {
    error.message = 'Token expired';
    return res.status(401).json(error);
  }

  // Database errors
  if (err.code === '23505') {
    error.message = 'Duplicate entry';
    return res.status(409).json(error);
  }

  if (err.code === '23503') {
    error.message = 'Foreign key constraint violation';
    return res.status(400).json(error);
  }

  // Custom API errors
  if (err.statusCode) {
    return res.status(err.statusCode).json(error);
  }

  // Default server error
  res.status(500).json(error);
};

module.exports = errorHandler;
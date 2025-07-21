import multer from 'multer';
import path from 'path';
import { Request } from 'express';
import { AppError } from '../middleware/errorHandler';

// Configure storage
const storage = multer.memoryStorage(); // Store in memory for processing

// File filter for images only
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Allowed file types
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  
  // Check extension
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  // Check mimetype
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new AppError(400, 'Only image files are allowed (jpeg, jpg, png, gif, webp)'));
  }
};

// Create multer instance for avatar upload
export const uploadAvatar = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
}).single('avatar');

// Error handler for multer
export const handleMulterError = (error: any) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      throw new AppError(400, 'File size too large. Maximum size is 5MB');
    }
    throw new AppError(400, error.message);
  }
  throw error;
};
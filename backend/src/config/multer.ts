import multer from 'multer';
import path from 'path';
import { Request } from 'express';
import type { Express } from 'express-serve-static-core';
import { AppError } from '../middleware/errorHandler';
import { storageConfig } from './storage';

// Configure storage
const storage = multer.memoryStorage(); // Store in memory for processing

// File filter for images only
const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
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
    fileSize: storageConfig.maxFileSize, // Use configured file size limit
  }
}).single('avatar');

// Error handler for multer
export const handleMulterError = (error: unknown) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      const maxSizeMB = Math.round(storageConfig.maxFileSize / (1024 * 1024));
      throw new AppError(400, `File size too large. Maximum size is ${maxSizeMB}MB`);
    }
    throw new AppError(400, error.message);
  }
  throw error;
};
import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { storageConfig } from '../config/storage';
import { authenticate } from '../middleware/auth';

const router = Router();

const slipsDir = path.join(storageConfig.baseDir, storageConfig.slipsDir);

const storage = multer.diskStorage({
  destination: slipsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: storageConfig.maxSlipFileSize },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// Upload slip - requires JWT authentication
router.post('/upload', authenticate, upload.single('slip'), (req: Request, res: Response): void => {
  // authenticate middleware already verified token and set req.user
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const url = `/storage/slips/${req.file.filename}`;
  res.json({ url });
});

export default router;

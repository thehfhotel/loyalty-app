import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';

interface ProcessImageOptions {
  width?: number;
  height?: number;
  quality?: number;
}

export class ImageProcessor {
  private static uploadDir = path.join(process.cwd(), 'uploads', 'avatars');

  // Ensure upload directory exists
  static async ensureUploadDir(): Promise<void> {
    try {
      await fs.access(this.uploadDir);
    } catch {
      await fs.mkdir(this.uploadDir, { recursive: true });
    }
  }

  // Process and save avatar image
  static async processAvatar(buffer: Buffer, originalName: string): Promise<string> {
    await this.ensureUploadDir();

    // Generate unique filename
    const hash = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(originalName).toLowerCase() || '.jpg';
    const filename = `avatar_${Date.now()}_${hash}${ext}`;
    const filepath = path.join(this.uploadDir, filename);

    // Process image: resize to 300x300, maintain aspect ratio, convert to JPEG
    await sharp(buffer)
      .resize(300, 300, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 85 })
      .toFile(filepath);

    // Return relative path for storage
    return `/uploads/avatars/${filename}`;
  }

  // Delete avatar file
  static async deleteAvatar(avatarPath: string): Promise<void> {
    if (!avatarPath) return;

    try {
      // Extract filename from path
      const filename = path.basename(avatarPath);
      const filepath = path.join(this.uploadDir, filename);
      
      await fs.unlink(filepath);
    } catch (error) {
      // Log error but don't throw - file might already be deleted
      console.error('Error deleting avatar file:', error);
    }
  }

  // Generate thumbnail (optional, for future use)
  static async generateThumbnail(
    buffer: Buffer, 
    options: ProcessImageOptions = {}
  ): Promise<Buffer> {
    const { width = 150, height = 150, quality = 80 } = options;

    return sharp(buffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality })
      .toBuffer();
  }
}
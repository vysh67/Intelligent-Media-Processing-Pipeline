import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';

// Ensure storage upload directory exists
if (!fs.existsSync(config.UPLOADS_DIR)) {
  fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });
}

// Multer disk storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  }
});

// File filter for allowed image mime types
const fileFilter = (req, file, cb) => {
  if (config.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type '${file.mimetype}'. Only JPEG, PNG, and WebP images are allowed.`), false);
  }
};

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: config.MAX_FILE_SIZE_BYTES
  },
  fileFilter
});

/**
 * Standard API error handling middleware
 */
export function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        error: 'File Too Large',
        message: `File exceeds maximum allowed limit of ${Math.round(config.MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB`
      });
    }
    return res.status(400).json({
      success: false,
      error: 'Upload Error',
      message: err.message
    });
  }

  if (err) {
    return res.status(400).json({
      success: false,
      error: 'Bad Request',
      message: err.message
    });
  }

  next();
}

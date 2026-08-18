import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export const config = {
  // Server configuration
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  HOST: process.env.HOST || '0.0.0.0',

  // Directory paths
  ROOT_DIR,
  STORAGE_DIR: path.resolve(ROOT_DIR, process.env.STORAGE_DIR || 'storage'),
  UPLOADS_DIR: path.resolve(ROOT_DIR, process.env.UPLOADS_DIR || 'storage/uploads'),
  PROCESSED_DIR: path.resolve(ROOT_DIR, process.env.PROCESSED_DIR || 'storage/processed'),
  DB_PATH: path.resolve(ROOT_DIR, process.env.DB_PATH || 'storage/database.sqlite'),
  SAMPLE_IMAGES_DIR: path.resolve(ROOT_DIR, 'sample_images'),

  // Upload limits
  MAX_FILE_SIZE_BYTES: parseInt(process.env.MAX_FILE_SIZE_BYTES || '15728640', 10), // 15MB
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'],

  // Queue and concurrency
  QUEUE_CONCURRENCY: parseInt(process.env.QUEUE_CONCURRENCY || '3', 10),
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3', 10),
  RETRY_BASE_DELAY_MS: parseInt(process.env.RETRY_BASE_DELAY_MS || '1000', 10),

  // Image Analysis Thresholds
  THRESHOLDS: {
    // Blur: Laplacian variance threshold below which an image is considered blurry
    BLUR_LAPLACIAN_MIN: parseFloat(process.env.BLUR_LAPLACIAN_MIN || '75.0'),
    BLUR_NORMALIZED_MIN: parseFloat(process.env.BLUR_NORMALIZED_MIN || '40.0'),

    // Brightness: Mean luminance (0-255)
    BRIGHTNESS_LOW_MIN: parseFloat(process.env.BRIGHTNESS_LOW_MIN || '45.0'),
    BRIGHTNESS_HIGH_MAX: parseFloat(process.env.BRIGHTNESS_HIGH_MAX || '225.0'),
    UNDEREXPOSED_RATIO_MAX: 0.40, // More than 40% near-black pixels
    OVEREXPOSED_RATIO_MAX: 0.35,  // More than 35% near-white blown-out pixels

    // Duplicate detection
    DUPLICATE_HAMMING_DISTANCE_MAX: parseInt(process.env.DUPLICATE_HAMMING_MAX || '6', 10), // <= 6 bits difference in 64-bit hash
    DUPLICATE_SIMILARITY_THRESHOLD: 0.90, // 90% or higher similarity

    // Cropping / Blank Corruption
    MAX_UNIFORM_AREA_RATIO: 0.45, // >45% single uniform color / blank border indicates bad crop/corrupted capture
    MIN_ENTROPY_THRESHOLD: 3.5    // Very low entropy indicates blank or solid color image
  }
};

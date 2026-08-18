import sharp from 'sharp';
import fs from 'fs';
import crypto from 'crypto';
import ExifParser from 'exif-parser';
import { logger } from './logger.js';

export const imageHelper = {
  /**
   * Compute SHA-256 hash of a file buffer or path
   */
  getFileSha256(filePathOrBuffer) {
    const buffer = Buffer.isBuffer(filePathOrBuffer)
      ? filePathOrBuffer
      : fs.readFileSync(filePathOrBuffer);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  },

  /**
   * Extract basic metadata using Sharp
   */
  async getMetadata(filePathOrBuffer) {
    const instance = sharp(filePathOrBuffer);
    const meta = await instance.metadata();
    return {
      width: meta.width || 0,
      height: meta.height || 0,
      format: meta.format,
      space: meta.space,
      channels: meta.channels,
      hasAlpha: meta.hasAlpha,
      aspectRatio: meta.width && meta.height ? meta.width / meta.height : 0
    };
  },

  /**
   * Extract EXIF metadata if present in JPEG / TIFF
   */
  extractExif(filePathOrBuffer) {
    try {
      const buffer = Buffer.isBuffer(filePathOrBuffer)
        ? filePathOrBuffer
        : fs.readFileSync(filePathOrBuffer);

      const parser = ExifParser.create(buffer);
      const result = parser.parse();

      if (!result || !result.tags || Object.keys(result.tags).length === 0) {
        return { hasExif: false, tags: {} };
      }

      return {
        hasExif: true,
        tags: {
          make: result.tags.Make,
          model: result.tags.Model,
          software: result.tags.Software,
          dateTimeOriginal: result.tags.DateTimeOriginal,
          createDate: result.tags.CreateDate,
          modifyDate: result.tags.ModifyDate,
          gpsLatitude: result.tags.GPSLatitude,
          gpsLongitude: result.tags.GPSLongitude,
          gpsAltitude: result.tags.GPSAltitude,
          iso: result.tags.ISO,
          focalLength: result.tags.FocalLength,
          exposureTime: result.tags.ExposureTime,
          fNumber: result.tags.FNumber
        }
      };
    } catch (err) {
      // Not a fatal error - many web images or screenshots lack EXIF headers
      return { hasExif: false, tags: {} };
    }
  },

  /**
   * Compute 64-bit Difference Hash (dHash)
   * Resizes to 9x8 grayscale, compares adjacent pixels horizontally (8x8 = 64 comparisons)
   */
  async computeDHash(filePathOrBuffer) {
    try {
      const { data } = await sharp(filePathOrBuffer)
        .grayscale()
        .resize(9, 8, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      let binaryString = '';
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const leftPixel = data[row * 9 + col];
          const rightPixel = data[row * 9 + (col + 1)];
          binaryString += leftPixel > rightPixel ? '1' : '0';
        }
      }

      // Convert 64-bit binary to 16-char hex
      let hex = '';
      for (let i = 0; i < binaryString.length; i += 4) {
        const nibble = binaryString.substring(i, i + 4);
        hex += parseInt(nibble, 2).toString(16);
      }
      return { hex, binary: binaryString };
    } catch (err) {
      logger.error('Failed to compute dHash:', err.message);
      return null;
    }
  },

  /**
   * Compute 64-bit Average Hash (aHash)
   * Resizes to 8x8 grayscale, computes mean, sets 1 if pixel >= mean, else 0
   */
  async computeAHash(filePathOrBuffer) {
    try {
      const { data } = await sharp(filePathOrBuffer)
        .grayscale()
        .resize(8, 8, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      let sum = 0;
      for (let i = 0; i < 64; i++) {
        sum += data[i];
      }
      const avg = sum / 64;

      let binaryString = '';
      for (let i = 0; i < 64; i++) {
        binaryString += data[i] >= avg ? '1' : '0';
      }

      let hex = '';
      for (let i = 0; i < binaryString.length; i += 4) {
        const nibble = binaryString.substring(i, i + 4);
        hex += parseInt(nibble, 2).toString(16);
      }
      return { hex, binary: binaryString };
    } catch (err) {
      logger.error('Failed to compute aHash:', err.message);
      return null;
    }
  },

  /**
   * Compute Hamming Distance between two hex/binary hashes (0 to 64)
   */
  calculateHammingDistance(hexA, hexB) {
    if (!hexA || !hexB) return 64;
    // Pad to 16 chars
    const a = hexA.padStart(16, '0');
    const b = hexB.padStart(16, '0');

    let dist = 0;
    for (let i = 0; i < 16; i++) {
      const valA = parseInt(a[i], 16);
      const valB = parseInt(b[i], 16);
      let xor = valA ^ valB;
      while (xor > 0) {
        dist += xor & 1;
        xor >>= 1;
      }
    }
    return dist;
  },

  /**
   * Calculate Image Shannon Entropy (measures texture/information content)
   * Low entropy (<3.5) indicates uniform blank, flat color, or corrupted missing content
   */
  calculateEntropy(grayscaleData) {
    const histogram = new Array(256).fill(0);
    const totalPixels = grayscaleData.length;

    for (let i = 0; i < totalPixels; i++) {
      histogram[grayscaleData[i]]++;
    }

    let entropy = 0;
    for (let i = 0; i < 256; i++) {
      if (histogram[i] > 0) {
        const p = histogram[i] / totalPixels;
        entropy -= p * Math.log2(p);
      }
    }
    return entropy;
  },

  /**
   * Calculate ratio of large uniform contiguous/dominant color (e.g. huge white or black blank area)
   */
  calculateUniformAreaRatio(grayscaleData) {
    const histogram = new Array(256).fill(0);
    const totalPixels = grayscaleData.length;

    for (let i = 0; i < totalPixels; i++) {
      histogram[grayscaleData[i]]++;
    }

    // Find the most frequent intensity and any near neighbors (within +/- 3 levels)
    let maxDominantCount = 0;
    for (let i = 0; i < 256; i++) {
      let clusterCount = 0;
      for (let j = Math.max(0, i - 3); j <= Math.min(255, i + 3); j++) {
        clusterCount += histogram[j];
      }
      if (clusterCount > maxDominantCount) {
        maxDominantCount = clusterCount;
      }
    }

    return maxDominantCount / totalPixels;
  }
};

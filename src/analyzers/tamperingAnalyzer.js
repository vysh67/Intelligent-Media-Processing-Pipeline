import sharp from 'sharp';
import { imageHelper } from '../utils/imageHelper.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// Suspicious editing software tags in EXIF
const SUSPICIOUS_SOFTWARE = [
  'photoshop',
  'gimp',
  'canva',
  'picsart',
  'snapseed',
  'lightroom',
  'pixelmator',
  'facetune',
  'meitu'
];

export const tamperingAnalyzer = {
  name: 'Tampering, Screenshot & Corruption Analyzer',

  /**
   * Evaluates image for:
   * 1. Corruption / Blank / Cropped canvas (e.g., sample 2 white blank space)
   * 2. Screenshot heuristics (aspect ratios, dimension anomalies)
   * 3. EXIF metadata analysis (software tampering, device presence, GPS)
   */
  async analyze(filePathOrBuffer) {
    try {
      const metadata = await imageHelper.getMetadata(filePathOrBuffer);
      const exif = imageHelper.extractExif(filePathOrBuffer);

      // Downscale to 400x400 for rapid entropy and uniformity calculation
      const { data } = await sharp(filePathOrBuffer)
        .grayscale()
        .resize(400, 400, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const entropy = imageHelper.calculateEntropy(data);
      const uniformRatio = imageHelper.calculateUniformAreaRatio(data);

      const issues = [];

      // 1. Basic decode validation
      if (!metadata.width || !metadata.height) {
        issues.push({
          category: 'CORRUPTION',
          severity: 'CRITICAL',
          message: 'Unable to decode image dimensions or zero-pixel image.',
          metric_name: 'resolution',
          metric_value: '0x0',
          threshold: '> 0x0'
        });
      }

      // 2. Corruption / Excessive Blank Area Check (e.g. Sample 2 scenario)
      const isCorruptedOrBlank =
        uniformRatio > config.THRESHOLDS.MAX_UNIFORM_AREA_RATIO ||
        entropy < config.THRESHOLDS.MIN_ENTROPY_THRESHOLD;

      if (isCorruptedOrBlank) {
        issues.push({
          category: 'CORRUPTION',
          severity: 'CRITICAL',
          message: `Corrupted or invalid upload: ${(uniformRatio * 100).toFixed(1)}% of image area is empty/blank uniform canvas (Entropy: ${entropy.toFixed(2)})`,
          metric_name: 'uniform_area_ratio',
          metric_value: `${(uniformRatio * 100).toFixed(1)}%`,
          threshold: `< ${(config.THRESHOLDS.MAX_UNIFORM_AREA_RATIO * 100).toFixed(0)}%`
        });
      }

      // 3. Screenshot Detection Heuristics
      // Common mobile phone screenshot aspect ratios: 9:16 (0.5625), 9:19.5 (0.4615), 9:20 (0.4500), 9:21 (0.4285)
      const ar = metadata.aspectRatio;
      const isScreenshotRatio =
        (ar >= 0.42 && ar <= 0.48) || // Tall smartphone screen ratio
        (ar >= 0.55 && ar <= 0.57);   // Standard 16:9 vertical screen

      let isScreenshot = false;
      if (isScreenshotRatio && !exif.hasExif && !isCorruptedOrBlank) {
        isScreenshot = true;
        issues.push({
          category: 'TAMPERING',
          severity: 'WARNING',
          message: `Potential screenshot detected: aspect ratio (${ar.toFixed(3)}) matches smartphone screen dimensions without camera hardware EXIF`,
          metric_name: 'aspect_ratio',
          metric_value: ar.toFixed(3),
          threshold: 'SCREENSHOT_HEURISTIC'
        });
      }

      // 4. EXIF Software Tampering Inspection
      let isSoftwareEdited = false;
      if (exif.hasExif && exif.tags.software) {
        const soft = String(exif.tags.software).toLowerCase();
        for (const tool of SUSPICIOUS_SOFTWARE) {
          if (soft.includes(tool)) {
            isSoftwareEdited = true;
            issues.push({
              category: 'TAMPERING',
              severity: 'WARNING',
              message: `Image editing software signature found in metadata: "${exif.tags.software}"`,
              metric_name: 'exif_software',
              metric_value: exif.tags.software,
              threshold: 'NO_EDITING_SOFTWARE'
            });
            break;
          }
        }
      }

      return {
        width: metadata.width,
        height: metadata.height,
        aspect_ratio: parseFloat(metadata.aspectRatio.toFixed(3)),
        entropy: parseFloat(entropy.toFixed(2)),
        uniform_area_ratio: parseFloat(uniformRatio.toFixed(3)),
        is_corrupted_or_blank: isCorruptedOrBlank,
        is_screenshot: isScreenshot,
        is_software_edited: isSoftwareEdited,
        exif_present: exif.hasExif,
        exif_data: exif.hasExif ? exif.tags : null,
        issues
      };
    } catch (err) {
      logger.error('TamperingAnalyzer error:', err.message);
      return {
        width: 0,
        height: 0,
        aspect_ratio: 0,
        entropy: 0,
        uniform_area_ratio: 0,
        is_corrupted_or_blank: false,
        is_screenshot: false,
        is_software_edited: false,
        exif_present: false,
        exif_data: null,
        issues: [{
          category: 'TAMPERING',
          severity: 'WARNING',
          message: `Tampering analysis error: ${err.message}`,
          metric_name: 'tampering_analysis',
          metric_value: 'ERROR',
          threshold: null
        }]
      };
    }
  }
};

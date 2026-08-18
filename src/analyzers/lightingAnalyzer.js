import sharp from 'sharp';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const lightingAnalyzer = {
  name: 'Lighting & Brightness Analyzer',

  /**
   * Analyzes brightness distribution, contrast, and highlights/shadows
   */
  async analyze(filePathOrBuffer) {
    try {
      const image = sharp(filePathOrBuffer).grayscale().resize(600, 600, {
        fit: 'inside',
        withoutEnlargement: true
      });

      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      const pixelCount = info.width * info.height;

      if (pixelCount === 0) {
        return {
          brightness_mean: 0,
          contrast_rms: 0,
          is_low_light: true,
          is_overexposed: false,
          underexposed_ratio: 1.0,
          overexposed_ratio: 0,
          issues: []
        };
      }

      // Compute histogram and luminance statistics
      const histogram = new Array(256).fill(0);
      let sum = 0;
      let darkPixels = 0;   // Luminance < 25 (shadows/underexposed)
      let brightPixels = 0; // Luminance > 235 (highlights/blown out glare)

      for (let i = 0; i < pixelCount; i++) {
        const val = data[i];
        histogram[val]++;
        sum += val;
        if (val < 25) darkPixels++;
        if (val > 235) brightPixels++;
      }

      const meanBrightness = sum / pixelCount;

      // RMS Contrast: standard deviation of luminance
      let varianceSum = 0;
      for (let i = 0; i < pixelCount; i++) {
        const diff = data[i] - meanBrightness;
        varianceSum += diff * diff;
      }
      const rmsContrast = Math.sqrt(varianceSum / pixelCount);

      const underexposedRatio = darkPixels / pixelCount;
      const overexposedRatio = brightPixels / pixelCount;

      const isLowLight =
        meanBrightness < config.THRESHOLDS.BRIGHTNESS_LOW_MIN ||
        underexposedRatio > config.THRESHOLDS.UNDEREXPOSED_RATIO_MAX;

      const isOverexposed =
        meanBrightness > config.THRESHOLDS.BRIGHTNESS_HIGH_MAX ||
        overexposedRatio > config.THRESHOLDS.OVEREXPOSED_RATIO_MAX;

      const issues = [];

      if (isLowLight) {
        const severity = meanBrightness < 25 ? 'CRITICAL' : 'WARNING';
        issues.push({
          category: 'LIGHTING',
          severity,
          message: `Poor lighting detected: image is underexposed or in low-light (Mean: ${meanBrightness.toFixed(1)}/255, dark ratio: ${(underexposedRatio * 100).toFixed(1)}%)`,
          metric_name: 'brightness_mean',
          metric_value: meanBrightness.toFixed(1),
          threshold: `> ${config.THRESHOLDS.BRIGHTNESS_LOW_MIN}`
        });
      }

      if (isOverexposed) {
        issues.push({
          category: 'LIGHTING',
          severity: 'WARNING',
          message: `Excessive glare or overexposure detected (Mean: ${meanBrightness.toFixed(1)}/255, bright ratio: ${(overexposedRatio * 100).toFixed(1)}%)`,
          metric_name: 'brightness_mean',
          metric_value: meanBrightness.toFixed(1),
          threshold: `< ${config.THRESHOLDS.BRIGHTNESS_HIGH_MAX}`
        });
      }

      return {
        brightness_mean: parseFloat(meanBrightness.toFixed(2)),
        contrast_rms: parseFloat(rmsContrast.toFixed(2)),
        is_low_light: isLowLight,
        is_overexposed: isOverexposed,
        underexposed_ratio: parseFloat(underexposedRatio.toFixed(3)),
        overexposed_ratio: parseFloat(overexposedRatio.toFixed(3)),
        issues
      };
    } catch (err) {
      logger.error('LightingAnalyzer error:', err.message);
      return {
        brightness_mean: null,
        contrast_rms: null,
        is_low_light: false,
        is_overexposed: false,
        issues: [{
          category: 'LIGHTING',
          severity: 'WARNING',
          message: `Lighting analysis error: ${err.message}`,
          metric_name: 'brightness_mean',
          metric_value: 'ERROR',
          threshold: null
        }]
      };
    }
  }
};

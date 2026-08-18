import sharp from 'sharp';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const blurAnalyzer = {
  name: 'Blur Analyzer',

  /**
   * Evaluates image sharpness using Laplacian kernel convolution and variance calculation
   * Higher variance indicates sharper edges; low variance indicates blur/out-of-focus.
   */
  async analyze(filePathOrBuffer) {
    try {
      // Resize to a standardized working resolution for consistent variance benchmarks
      // (e.g. max 800px dimension preserves aspect ratio and provides stable Laplacian benchmarks)
      const image = sharp(filePathOrBuffer).grayscale().resize(800, 800, {
        fit: 'inside',
        withoutEnlargement: true
      });

      // Standard discrete 3x3 Laplacian operator kernel
      const laplacianKernel = {
        width: 3,
        height: 3,
        kernel: [
          0,  1, 0,
          1, -4, 1,
          0,  1, 0
        ]
      };

      // Convolve with Laplacian filter
      const { data, info } = await image
        .convolve(laplacianKernel)
        .raw()
        .toBuffer({ resolveWithObject: true });

      const pixelCount = info.width * info.height;
      if (pixelCount === 0) {
        return {
          is_blurry: true,
          laplacian_variance: 0,
          sharpness_score: 0,
          confidence: 1.0,
          issues: [{
            category: 'BLUR',
            severity: 'CRITICAL',
            message: 'Image has zero pixels or failed to decode',
            metric_name: 'laplacian_variance',
            metric_value: '0',
            threshold: `< ${config.THRESHOLDS.BLUR_LAPLACIAN_MIN}`
          }]
        };
      }

      // Compute mean
      let sum = 0;
      for (let i = 0; i < pixelCount; i++) {
        sum += data[i];
      }
      const mean = sum / pixelCount;

      // Compute variance: Var = E[(X - mu)^2]
      let varianceSum = 0;
      for (let i = 0; i < pixelCount; i++) {
        const diff = data[i] - mean;
        varianceSum += diff * diff;
      }
      const variance = varianceSum / pixelCount;

      // Normalize sharpness score to 0 - 100 scale using logarithmic mapping
      // Variance typical range: 10 (very blurry) to 600+ (very sharp)
      const normalizedScore = Math.min(
        100,
        Math.max(0, Math.round((Math.log10(Math.max(variance, 1)) / Math.log10(600)) * 100))
      );

      const threshold = config.THRESHOLDS.BLUR_LAPLACIAN_MIN;
      const isBlurry = variance < threshold;

      const issues = [];
      if (isBlurry) {
        const severity = variance < (threshold * 0.5) ? 'CRITICAL' : 'WARNING';
        issues.push({
          category: 'BLUR',
          severity,
          message: `Image is blurry or out-of-focus (Laplacian Variance: ${variance.toFixed(2)}, threshold: ${threshold})`,
          metric_name: 'laplacian_variance',
          metric_value: variance.toFixed(2),
          threshold: `< ${threshold}`
        });
      }

      return {
        is_blurry: isBlurry,
        laplacian_variance: parseFloat(variance.toFixed(2)),
        sharpness_score: normalizedScore,
        confidence: parseFloat(Math.min(1.0, Math.abs(variance - threshold) / threshold + 0.5).toFixed(2)),
        issues
      };
    } catch (err) {
      logger.error('BlurAnalyzer error:', err.message);
      return {
        is_blurry: false,
        laplacian_variance: null,
        sharpness_score: null,
        confidence: 0,
        issues: [{
          category: 'BLUR',
          severity: 'WARNING',
          message: `Blur analysis failed: ${err.message}`,
          metric_name: 'laplacian_variance',
          metric_value: 'ERROR',
          threshold: null
        }]
      };
    }
  }
};

import { imageHelper } from '../utils/imageHelper.js';
import { dbRepository } from '../db/database.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const duplicateAnalyzer = {
  name: 'Duplicate & Similarity Analyzer',

  /**
   * Compares the current image against all previously processed images using:
   * 1. SHA-256 (exact duplicate check)
   * 2. Perceptual dHash / aHash (near-duplicate / resized / recompressed check)
   */
  async analyze(filePathOrBuffer, currentJobId, sha256Hash) {
    try {
      const sha256 = sha256Hash || imageHelper.getFileSha256(filePathOrBuffer);

      // Compute 64-bit perceptual hashes
      const dHashResult = await imageHelper.computeDHash(filePathOrBuffer);
      const aHashResult = await imageHelper.computeAHash(filePathOrBuffer);

      const dhash = dHashResult ? dHashResult.hex : null;
      const ahash = aHashResult ? aHashResult.hex : null;

      // 1. Exact SHA-256 match check
      const exactMatch = await dbRepository.findExactSha256Match(sha256, currentJobId);
      if (exactMatch) {
        return {
          is_duplicate: true,
          duplicate_type: 'EXACT_SHA256',
          duplicate_job_id: exactMatch.job_id,
          duplicate_similarity_score: 1.0,
          hamming_distance: 0,
          dhash,
          ahash,
          sha256,
          issues: [{
            category: 'DUPLICATE',
            severity: 'CRITICAL',
            message: `Exact duplicate detected: identical file payload previously uploaded in job ${exactMatch.job_id} (${exactMatch.original_filename})`,
            metric_name: 'sha256_hash',
            metric_value: sha256.substring(0, 12) + '...',
            threshold: 'exact_match'
          }]
        };
      }

      // 2. Perceptual near-duplicate check against previous database gallery
      const previousHashes = await dbRepository.getAllPreviousHashes(currentJobId);

      let closestMatch = null;
      let minHammingDistance = 64;

      if (dhash && previousHashes.length > 0) {
        for (const prev of previousHashes) {
          if (!prev.dhash) continue;
          const dist = imageHelper.calculateHammingDistance(dhash, prev.dhash);
          if (dist < minHammingDistance) {
            minHammingDistance = dist;
            closestMatch = prev;
          }
        }
      }

      const maxHammingAllowed = config.THRESHOLDS.DUPLICATE_HAMMING_DISTANCE_MAX;
      const isPerceptualDuplicate = closestMatch && minHammingDistance <= maxHammingAllowed;
      const similarityScore = parseFloat(((64 - minHammingDistance) / 64).toFixed(3));

      const issues = [];
      if (isPerceptualDuplicate) {
        issues.push({
          category: 'DUPLICATE',
          severity: 'CRITICAL',
          message: `Near-duplicate image detected (${(similarityScore * 100).toFixed(1)}% similarity, Hamming distance: ${minHammingDistance}). Matches previous job ${closestMatch.job_id} (${closestMatch.original_filename})`,
          metric_name: 'hamming_distance',
          metric_value: String(minHammingDistance),
          threshold: `<= ${maxHammingAllowed}`
        });
      }

      return {
        is_duplicate: isPerceptualDuplicate,
        duplicate_type: isPerceptualDuplicate ? 'PERCEPTUAL_NEAR_MATCH' : 'NONE',
        duplicate_job_id: isPerceptualDuplicate ? closestMatch.job_id : null,
        duplicate_similarity_score: similarityScore,
        hamming_distance: minHammingDistance,
        dhash,
        ahash,
        sha256,
        issues
      };
    } catch (err) {
      logger.error('DuplicateAnalyzer error:', err.message);
      return {
        is_duplicate: false,
        duplicate_type: 'ERROR',
        duplicate_job_id: null,
        duplicate_similarity_score: 0,
        hamming_distance: 64,
        dhash: null,
        ahash: null,
        issues: []
      };
    }
  }
};

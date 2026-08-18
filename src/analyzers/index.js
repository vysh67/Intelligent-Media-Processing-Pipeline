import { blurAnalyzer } from './blurAnalyzer.js';
import { lightingAnalyzer } from './lightingAnalyzer.js';
import { duplicateAnalyzer } from './duplicateAnalyzer.js';
import { plateOcrAnalyzer } from './plateOcrAnalyzer.js';
import { tamperingAnalyzer } from './tamperingAnalyzer.js';
import { qualityScorer } from './qualityScorer.js';
import { logger } from '../utils/logger.js';

export const analysisPipeline = {
  /**
   * Runs all 5 analyzers concurrently and aggregates via qualityScorer
   */
  async runPipeline({ filePath, jobId, sha256Hash }) {
    const startTime = performance.now();
    logger.info(`Starting analysis pipeline for job ${jobId}...`);

    // Execute analyzers concurrently for optimal throughput
    const [blur, lighting, duplicate, plate, tampering] = await Promise.all([
      blurAnalyzer.analyze(filePath),
      lightingAnalyzer.analyze(filePath),
      duplicateAnalyzer.analyze(filePath, jobId, sha256Hash),
      plateOcrAnalyzer.analyze(filePath),
      tamperingAnalyzer.analyze(filePath)
    ]);

    // Aggregate decision and scoring
    const decision = qualityScorer.evaluate({
      blur,
      lighting,
      duplicate,
      plate,
      tampering
    });

    const executionTimeMs = performance.now() - startTime;
    logger.perf(`Analysis pipeline for job ${jobId}`, executionTimeMs);

    return {
      job_id: jobId,
      execution_time_ms: Math.round(executionTimeMs * 100) / 100,
      decision,
      results: {
        blur,
        lighting,
        duplicate,
        plate,
        tampering
      }
    };
  }
};

export {
  blurAnalyzer,
  lightingAnalyzer,
  duplicateAnalyzer,
  plateOcrAnalyzer,
  tamperingAnalyzer,
  qualityScorer
};

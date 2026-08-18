import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { dbRepository } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { analysisPipeline } from '../analyzers/index.js';

class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.activeWorkers = 0;
    this.concurrency = config.QUEUE_CONCURRENCY;
    this.isPaused = false;
  }

  /**
   * Enqueue a new job
   */
  async enqueue(jobPayload) {
    const { jobId, filePath, sha256Hash, originalFilename } = jobPayload;

    this.queue.push({
      jobId,
      filePath,
      sha256Hash,
      originalFilename,
      enqueuedAt: Date.now(),
      retryCount: 0
    });

    this.emit('job:queued', { jobId });
    logger.info(`Job ${jobId} enqueued. Queue length: ${this.queue.length}`);

    // Trigger queue processing pump
    this.processNext();
  }

  /**
   * Process next available jobs up to concurrency limit
   */
  processNext() {
    if (this.isPaused) return;

    while (this.activeWorkers < this.concurrency && this.queue.length > 0) {
      const jobItem = this.queue.shift();
      this.activeWorkers++;
      this.executeJob(jobItem).finally(() => {
        this.activeWorkers--;
        this.processNext();
      });
    }
  }

  /**
   * Execute worker pipeline on a single job with retries
   */
  async executeJob(jobItem) {
    const { jobId, filePath, sha256Hash, retryCount } = jobItem;
    const startTime = performance.now();

    try {
      logger.info(`Processing job ${jobId} (Worker slot ${this.activeWorkers}/${this.concurrency}, Attempt ${retryCount + 1})...`);
      
      // Update job state in DB to 'processing'
      await dbRepository.updateJobStatus(jobId, 'processing', { retry_count: retryCount });
      this.emit('job:processing', { jobId, retryCount });

      // Run image analysis pipeline
      const pipelineOutput = await analysisPipeline.runPipeline({
        filePath,
        jobId,
        sha256Hash
      });

      const { decision, results, execution_time_ms } = pipelineOutput;
      const completedAt = new Date().toISOString();

      // Persist analysis results into SQLite
      const analysisId = uuidv4();
      await dbRepository.insertAnalysisResults({
        id: analysisId,
        job_id: jobId,
        blur_laplacian_variance: results.blur.laplacian_variance,
        blur_sharpness_score: results.blur.sharpness_score,
        is_blurry: results.blur.is_blurry,
        brightness_mean: results.lighting.brightness_mean,
        contrast_rms: results.lighting.contrast_rms,
        is_low_light: results.lighting.is_low_light,
        is_overexposed: results.lighting.is_overexposed,
        is_duplicate: results.duplicate.is_duplicate,
        duplicate_job_id: results.duplicate.duplicate_job_id,
        duplicate_similarity_score: results.duplicate.duplicate_similarity_score,
        dhash: results.duplicate.dhash,
        ahash: results.duplicate.ahash,
        plate_detected: results.plate.plate_detected,
        plate_number: results.plate.plate_number,
        plate_format_valid: results.plate.plate_format_valid,
        plate_state: results.plate.plate_state,
        plate_confidence: results.plate.plate_confidence,
        ocr_raw_text: results.plate.ocr_raw_text,
        task_id_extracted: results.plate.task_id_extracted,
        geotag_extracted: results.plate.geotag_extracted,
        timestamp_extracted: results.plate.timestamp_extracted,
        is_screenshot: results.tampering.is_screenshot,
        is_corrupted_or_blank: results.tampering.is_corrupted_or_blank,
        uniform_area_ratio: results.tampering.uniform_area_ratio,
        entropy: results.tampering.entropy,
        exif_present: results.tampering.exif_present,
        exif_data: results.tampering.exif_data,
        raw_metrics_json: {
          decision,
          metrics: {
            blur: results.blur,
            lighting: results.lighting,
            duplicate: results.duplicate,
            plate: results.plate,
            tampering: results.tampering
          }
        },
        created_at: completedAt
      });

      // Insert all detected issues
      if (decision.all_issues && decision.all_issues.length > 0) {
        const issuesToInsert = decision.all_issues.map((iss) => ({
          id: uuidv4(),
          job_id: jobId,
          category: iss.category,
          severity: iss.severity,
          message: iss.message,
          metric_name: iss.metric_name,
          metric_value: iss.metric_value,
          threshold: iss.threshold,
          created_at: completedAt
        }));
        await dbRepository.insertDetectedIssues(issuesToInsert);
      }

      // Mark job as 'completed'
      await dbRepository.updateJobStatus(jobId, 'completed', {
        completed_at: completedAt,
        execution_time_ms,
        overall_score: decision.overall_score,
        verdict: decision.verdict,
        risk_level: decision.risk_level
      });

      this.emit('job:completed', { jobId, verdict: decision.verdict, score: decision.overall_score });
      logger.success(`Job ${jobId} completed successfully [Verdict: ${decision.verdict}, Score: ${decision.overall_score}]`);

    } catch (err) {
      logger.error(`Error processing job ${jobId}:`, err.message);

      if (retryCount < config.MAX_RETRIES) {
        const nextRetry = retryCount + 1;
        const delay = Math.pow(2, nextRetry) * config.RETRY_BASE_DELAY_MS;
        logger.warn(`Retrying job ${jobId} in ${delay}ms (Attempt ${nextRetry}/${config.MAX_RETRIES})...`);

        setTimeout(() => {
          this.queue.unshift({
            ...jobItem,
            retryCount: nextRetry
          });
          this.processNext();
        }, delay);
      } else {
        // Exceeded retries - mark as failed
        const duration = Math.round(performance.now() - startTime);
        await dbRepository.updateJobStatus(jobId, 'failed', {
          error_message: err.message,
          completed_at: new Date().toISOString(),
          execution_time_ms: duration,
          retry_count: retryCount
        });

        this.emit('job:failed', { jobId, error: err.message });
        logger.error(`Job ${jobId} permanently failed after ${retryCount + 1} attempts`);
      }
    }
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queued: this.queue.length,
      active_workers: this.activeWorkers,
      concurrency: this.concurrency,
      is_paused: this.isPaused
    };
  }
}

export const jobQueue = new JobQueue();

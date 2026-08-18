import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { dbRepository } from '../db/database.js';
import { jobQueue } from '../queue/jobQueue.js';
import { imageHelper } from '../utils/imageHelper.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const apiControllers = {
  /**
   * POST /api/v1/upload
   * Accepts image upload, persists metadata, returns 202 Accepted + Job ID immediately
   */
  async uploadImage(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No File Uploaded',
          message: 'Please provide an image file with key "image" or "file"'
        });
      }

      const jobId = uuidv4();
      const mediaId = uuidv4();
      const filePath = req.file.path;
      const sha256Hash = imageHelper.getFileSha256(filePath);
      const metadata = await imageHelper.getMetadata(filePath);

      // 1. Create job in DB with status 'pending'
      await dbRepository.createJob(jobId);

      // 2. Insert media metadata
      await dbRepository.insertMediaFile({
        id: mediaId,
        job_id: jobId,
        original_filename: req.file.originalname,
        stored_filename: req.file.filename,
        file_path: filePath,
        file_size_bytes: req.file.size,
        mime_type: req.file.mimetype,
        sha256_hash: sha256Hash,
        width: metadata.width,
        height: metadata.height,
        aspect_ratio: metadata.aspectRatio
      });

      // 3. Enqueue job for async worker processing
      await jobQueue.enqueue({
        jobId,
        filePath,
        sha256Hash,
        originalFilename: req.file.originalname
      });

      // 4. Return immediate 202 Accepted response
      return res.status(202).json({
        success: true,
        message: 'Image uploaded successfully and queued for asynchronous processing',
        data: {
          job_id: jobId,
          status: 'pending',
          file_name: req.file.originalname,
          file_size_bytes: req.file.size,
          mime_type: req.file.mimetype,
          sha256_hash: sha256Hash,
          dimensions: {
            width: metadata.width,
            height: metadata.height,
            aspect_ratio: parseFloat(metadata.aspectRatio.toFixed(3))
          },
          created_at: new Date().toISOString(),
          links: {
            status: `/api/v1/jobs/${jobId}/status`,
            results: `/api/v1/jobs/${jobId}/results`,
            image_url: `/api/v1/media/${req.file.filename}`
          }
        }
      });
    } catch (err) {
      logger.error('Upload controller error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Upload Failed',
        message: err.message
      });
    }
  },

  /**
   * GET /api/v1/jobs/:id/status
   * Fast status polling endpoint
   */
  async getJobStatus(req, res) {
    try {
      const { id } = req.params;
      const jobData = await dbRepository.getJobById(id);

      if (!jobData) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Job with ID '${id}' does not exist`
        });
      }

      const { job, media } = jobData;

      return res.status(200).json({
        success: true,
        data: {
          job_id: job.id,
          status: job.status,
          created_at: job.created_at,
          updated_at: job.updated_at,
          completed_at: job.completed_at,
          execution_time_ms: job.execution_time_ms,
          retry_count: job.retry_count,
          verdict: job.verdict,
          overall_score: job.overall_score,
          risk_level: job.risk_level,
          error_message: job.error_message,
          file_name: media ? media.original_filename : null,
          links: {
            results: `/api/v1/jobs/${id}/results`,
            image_url: media ? `/api/v1/media/${media.stored_filename}` : null
          }
        }
      });
    } catch (err) {
      logger.error('getJobStatus error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message
      });
    }
  },

  /**
   * GET /api/v1/jobs/:id/results
   * Comprehensive structured analysis results
   */
  async getJobResults(req, res) {
    try {
      const { id } = req.params;
      const jobData = await dbRepository.getJobById(id);

      if (!jobData) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: `Job with ID '${id}' does not exist`
        });
      }

      const { job, media, analysis, issues } = jobData;

      if (job.status === 'pending' || job.status === 'processing') {
        return res.status(200).json({
          success: true,
          data: {
            job_id: job.id,
            status: job.status,
            message: `Job is currently ${job.status}. Please poll again shortly.`,
            progress_url: `/api/v1/jobs/${id}/status`
          }
        });
      }

      if (job.status === 'failed') {
        return res.status(200).json({
          success: false,
          data: {
            job_id: job.id,
            status: 'failed',
            error_message: job.error_message,
            retry_count: job.retry_count,
            failed_at: job.completed_at
          }
        });
      }

      // Format comprehensive completed result
      return res.status(200).json({
        success: true,
        data: {
          job_id: job.id,
          status: 'completed',
          overall_score: job.overall_score,
          verdict: job.verdict,
          risk_level: job.risk_level,
          execution_time_ms: job.execution_time_ms,
          created_at: job.created_at,
          completed_at: job.completed_at,
          
          media: {
            original_filename: media?.original_filename,
            file_size_bytes: media?.file_size_bytes,
            mime_type: media?.mime_type,
            sha256_hash: media?.sha256_hash,
            dimensions: {
              width: media?.width,
              height: media?.height,
              aspect_ratio: media?.aspect_ratio
            },
            image_url: `/api/v1/media/${media?.stored_filename}`
          },

          checks: {
            blur: {
              is_blurry: Boolean(analysis?.is_blurry),
              laplacian_variance: analysis?.blur_laplacian_variance,
              sharpness_score: analysis?.blur_sharpness_score,
              threshold: config.THRESHOLDS.BLUR_LAPLACIAN_MIN
            },
            lighting: {
              brightness_mean: analysis?.brightness_mean,
              contrast_rms: analysis?.contrast_rms,
              is_low_light: Boolean(analysis?.is_low_light),
              is_overexposed: Boolean(analysis?.is_overexposed)
            },
            duplicate: {
              is_duplicate: Boolean(analysis?.is_duplicate),
              duplicate_job_id: analysis?.duplicate_job_id,
              similarity_score: analysis?.duplicate_similarity_score,
              dhash: analysis?.dhash,
              ahash: analysis?.ahash
            },
            license_plate: {
              detected: Boolean(analysis?.plate_detected),
              plate_number: analysis?.plate_number,
              format_valid: Boolean(analysis?.plate_format_valid),
              state: analysis?.plate_state,
              confidence: analysis?.plate_confidence,
              task_id: analysis?.task_id_extracted,
              geotag: analysis?.geotag_extracted,
              timestamp_overlay: analysis?.timestamp_extracted
            },
            tampering_and_corruption: {
              is_screenshot: Boolean(analysis?.is_screenshot),
              is_corrupted_or_blank: Boolean(analysis?.is_corrupted_or_blank),
              uniform_area_ratio: analysis?.uniform_area_ratio,
              entropy: analysis?.entropy,
              exif_present: Boolean(analysis?.exif_present),
              exif_data: analysis?.exif_data
            }
          },

          detected_issues: (issues || []).map((iss) => ({
            id: iss.id,
            category: iss.category,
            severity: iss.severity,
            message: iss.message,
            metric_name: iss.metric_name,
            metric_value: iss.metric_value,
            threshold: iss.threshold
          })),

          raw_ocr_text: analysis?.ocr_raw_text
        }
      });
    } catch (err) {
      logger.error('getJobResults error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message
      });
    }
  },

  /**
   * GET /api/v1/jobs
   * List all jobs with filtering and pagination
   */
  async listJobs(req, res) {
    try {
      const limit = Math.min(100, parseInt(req.query.limit || '20', 10));
      const offset = parseInt(req.query.offset || '0', 10);
      const status = req.query.status || null;

      const result = await dbRepository.listJobs({ limit, offset, status });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      logger.error('listJobs error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message
      });
    }
  },

  /**
   * GET /api/v1/analytics/summary
   * System-wide statistics and metrics
   */
  async getAnalyticsSummary(req, res) {
    try {
      const summary = await dbRepository.getAnalyticsSummary();
      const queueStats = jobQueue.getStats();

      return res.status(200).json({
        success: true,
        data: {
          ...summary,
          queue_status: queueStats
        }
      });
    } catch (err) {
      logger.error('getAnalyticsSummary error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message
      });
    }
  },

  /**
   * POST /api/v1/demo/process-samples
   * Batch processes the 3 sample images from the assignment email for instant demonstration
   */
  async processSampleImages(req, res) {
    try {
      const samplesDir = config.SAMPLE_IMAGES_DIR;
      if (!fs.existsSync(samplesDir)) {
        return res.status(404).json({
          success: false,
          error: 'Sample directory not found'
        });
      }

      const files = ['sample_1.jpg', 'sample_2.jpg', 'sample_3.jpg'];
      const submittedJobs = [];

      for (const file of files) {
        const srcPath = path.join(samplesDir, file);
        if (!fs.existsSync(srcPath)) continue;

        const jobId = uuidv4();
        const mediaId = uuidv4();
        const ext = path.extname(file);
        const storedFilename = `${uuidv4()}${ext}`;
        const destPath = path.join(config.UPLOADS_DIR, storedFilename);

        // Copy file to uploads dir
        fs.copyFileSync(srcPath, destPath);

        const sha256Hash = imageHelper.getFileSha256(destPath);
        const metadata = await imageHelper.getMetadata(destPath);
        const fileStats = fs.statSync(destPath);

        await dbRepository.createJob(jobId);
        await dbRepository.insertMediaFile({
          id: mediaId,
          job_id: jobId,
          original_filename: file,
          stored_filename: storedFilename,
          file_path: destPath,
          file_size_bytes: fileStats.size,
          mime_type: 'image/jpeg',
          sha256_hash: sha256Hash,
          width: metadata.width,
          height: metadata.height,
          aspect_ratio: metadata.aspectRatio
        });

        await jobQueue.enqueue({
          jobId,
          filePath: destPath,
          sha256Hash,
          originalFilename: file
        });

        submittedJobs.push({
          sample_file: file,
          job_id: jobId,
          status: 'pending',
          links: {
            status: `/api/v1/jobs/${jobId}/status`,
            results: `/api/v1/jobs/${jobId}/results`
          }
        });
      }

      return res.status(202).json({
        success: true,
        message: `Enqueued ${submittedJobs.length} sample images for asynchronous pipeline execution`,
        jobs: submittedJobs
      });
    } catch (err) {
      logger.error('processSampleImages error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to process sample images',
        message: err.message
      });
    }
  },

  /**
   * GET /api/v1/media/:filename
   * Stream stored media file safely
   */
  async serveMedia(req, res) {
    try {
      const { filename } = req.params;
      // Sanitize against directory traversal
      const safeFilename = path.basename(filename);
      const filePath = path.join(config.UPLOADS_DIR, safeFilename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          error: 'Not Found',
          message: 'Media file not found'
        });
      }

      return res.sendFile(filePath);
    } catch (err) {
      logger.error('serveMedia error:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message
      });
    }
  }
};

import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { SCHEMA_SQL } from './schema.js';
import { logger } from '../utils/logger.js';

let dbInstance = null;

export function initDatabase() {
  if (dbInstance) return dbInstance;

  // Ensure storage directory exists
  const dbDir = path.dirname(config.DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new sqlite3.Database(config.DB_PATH, (err) => {
    if (err) {
      logger.error('Failed to connect to SQLite database:', err.message);
      throw err;
    }
  });

  // Enable WAL mode & foreign keys for concurrency and integrity
  db.serialize(() => {
    db.run('PRAGMA journal_mode = WAL;');
    db.run('PRAGMA foreign_keys = ON;');
    db.run('PRAGMA busy_timeout = 5000;');
    db.exec(SCHEMA_SQL, (err) => {
      if (err) {
        logger.error('Failed to execute database schema migrations:', err.message);
      } else {
        logger.success('Database schema initialized and ready at', config.DB_PATH);
      }
    });
  });

  dbInstance = db;
  return db;
}

export function getDb() {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

// Async wrapper helpers
export function dbRun(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

export function dbGet(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

export function dbAll(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// Repository operations
export const dbRepository = {
  async createJob(jobId) {
    const now = new Date().toISOString();
    await dbRun(
      `INSERT INTO jobs (id, status, created_at, updated_at) VALUES (?, 'pending', ?, ?)`,
      [jobId, now, now]
    );
    return { id: jobId, status: 'pending', created_at: now };
  },

  async updateJobStatus(jobId, status, extra = {}) {
    const now = new Date().toISOString();
    const sets = ['status = ?', 'updated_at = ?'];
    const params = [status, now];

    if (extra.completed_at !== undefined) {
      sets.push('completed_at = ?');
      params.push(extra.completed_at);
    }
    if (extra.execution_time_ms !== undefined) {
      sets.push('execution_time_ms = ?');
      params.push(extra.execution_time_ms);
    }
    if (extra.error_message !== undefined) {
      sets.push('error_message = ?');
      params.push(extra.error_message);
    }
    if (extra.retry_count !== undefined) {
      sets.push('retry_count = ?');
      params.push(extra.retry_count);
    }
    if (extra.overall_score !== undefined) {
      sets.push('overall_score = ?');
      params.push(extra.overall_score);
    }
    if (extra.verdict !== undefined) {
      sets.push('verdict = ?');
      params.push(extra.verdict);
    }
    if (extra.risk_level !== undefined) {
      sets.push('risk_level = ?');
      params.push(extra.risk_level);
    }

    params.push(jobId);
    await dbRun(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`, params);
  },

  async insertMediaFile(media) {
    await dbRun(
      `INSERT INTO media_files (
        id, job_id, original_filename, stored_filename, file_path,
        file_size_bytes, mime_type, sha256_hash, width, height, aspect_ratio, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        media.id,
        media.job_id,
        media.original_filename,
        media.stored_filename,
        media.file_path,
        media.file_size_bytes,
        media.mime_type,
        media.sha256_hash,
        media.width || null,
        media.height || null,
        media.aspect_ratio || null,
        media.created_at || new Date().toISOString()
      ]
    );
  },

  async insertAnalysisResults(results) {
    await dbRun(
      `INSERT OR REPLACE INTO analysis_results (
        id, job_id, blur_laplacian_variance, blur_sharpness_score, is_blurry,
        brightness_mean, contrast_rms, is_low_light, is_overexposed,
        is_duplicate, duplicate_job_id, duplicate_similarity_score, dhash, ahash,
        plate_detected, plate_number, plate_format_valid, plate_state, plate_confidence,
        ocr_raw_text, task_id_extracted, geotag_extracted, timestamp_extracted,
        is_screenshot, is_corrupted_or_blank, uniform_area_ratio, entropy,
        exif_present, exif_data, raw_metrics_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        results.id,
        results.job_id,
        results.blur_laplacian_variance,
        results.blur_sharpness_score,
        results.is_blurry ? 1 : 0,
        results.brightness_mean,
        results.contrast_rms,
        results.is_low_light ? 1 : 0,
        results.is_overexposed ? 1 : 0,
        results.is_duplicate ? 1 : 0,
        results.duplicate_job_id || null,
        results.duplicate_similarity_score || 0,
        results.dhash || null,
        results.ahash || null,
        results.plate_detected ? 1 : 0,
        results.plate_number || null,
        results.plate_format_valid ? 1 : 0,
        results.plate_state || null,
        results.plate_confidence || 0,
        results.ocr_raw_text || null,
        results.task_id_extracted || null,
        results.geotag_extracted || null,
        results.timestamp_extracted || null,
        results.is_screenshot ? 1 : 0,
        results.is_corrupted_or_blank ? 1 : 0,
        results.uniform_area_ratio || 0,
        results.entropy || 0,
        results.exif_present ? 1 : 0,
        results.exif_data ? JSON.stringify(results.exif_data) : null,
        results.raw_metrics_json ? JSON.stringify(results.raw_metrics_json) : null,
        results.created_at || new Date().toISOString()
      ]
    );
  },

  async insertDetectedIssues(issues) {
    if (!issues || issues.length === 0) return;
    for (const issue of issues) {
      await dbRun(
        `INSERT INTO detected_issues (
          id, job_id, category, severity, message, metric_name, metric_value, threshold, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          issue.id,
          issue.job_id,
          issue.category,
          issue.severity,
          issue.message,
          issue.metric_name || null,
          issue.metric_value ? String(issue.metric_value) : null,
          issue.threshold ? String(issue.threshold) : null,
          issue.created_at || new Date().toISOString()
        ]
      );
    }
  },

  async getJobById(jobId) {
    const job = await dbGet(`SELECT * FROM jobs WHERE id = ?`, [jobId]);
    if (!job) return null;

    const media = await dbGet(`SELECT * FROM media_files WHERE job_id = ?`, [jobId]);
    const results = await dbGet(`SELECT * FROM analysis_results WHERE job_id = ?`, [jobId]);
    const issues = await dbAll(`SELECT * FROM detected_issues WHERE job_id = ? ORDER BY severity ASC`, [jobId]);

    if (results && results.exif_data) {
      try { results.exif_data = JSON.parse(results.exif_data); } catch (e) {}
    }
    if (results && results.raw_metrics_json) {
      try { results.raw_metrics_json = JSON.parse(results.raw_metrics_json); } catch (e) {}
    }

    return {
      job,
      media,
      analysis: results,
      issues
    };
  },

  async getAllPreviousHashes(excludeJobId = null) {
    let sql = `
      SELECT ar.job_id, ar.dhash, ar.ahash, mf.sha256_hash, mf.original_filename
      FROM analysis_results ar
      JOIN media_files mf ON ar.job_id = mf.job_id
      JOIN jobs j ON ar.job_id = j.id
      WHERE j.status = 'completed' AND ar.dhash IS NOT NULL
    `;
    const params = [];
    if (excludeJobId) {
      sql += ` AND ar.job_id != ?`;
      params.push(excludeJobId);
    }
    return await dbAll(sql, params);
  },

  async findExactSha256Match(sha256Hash, excludeJobId = null) {
    let sql = `
      SELECT mf.job_id, mf.original_filename, j.status, j.created_at
      FROM media_files mf
      JOIN jobs j ON mf.job_id = j.id
      WHERE mf.sha256_hash = ?
    `;
    const params = [sha256Hash];
    if (excludeJobId) {
      sql += ` AND mf.job_id != ?`;
      params.push(excludeJobId);
    }
    sql += ` ORDER BY j.created_at ASC LIMIT 1`;
    return await dbGet(sql, params);
  },

  async listJobs({ limit = 50, offset = 0, status = null } = {}) {
    let sql = `
      SELECT j.*, mf.original_filename, mf.file_size_bytes, mf.mime_type, mf.stored_filename,
             ar.is_blurry, ar.is_low_light, ar.is_duplicate, ar.plate_detected, ar.plate_number,
             (SELECT COUNT(*) FROM detected_issues di WHERE di.job_id = j.id) as issue_count
      FROM jobs j
      LEFT JOIN media_files mf ON j.id = mf.job_id
      LEFT JOIN analysis_results ar ON j.id = ar.job_id
    `;
    const params = [];
    if (status) {
      sql += ` WHERE j.status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY j.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const totalCountRow = await dbGet(`SELECT COUNT(*) as total FROM jobs` + (status ? ` WHERE status = ?` : ''), status ? [status] : []);
    const items = await dbAll(sql, params);

    return {
      total: totalCountRow ? totalCountRow.total : 0,
      limit,
      offset,
      items
    };
  },

  async getAnalyticsSummary() {
    const totalJobs = (await dbGet(`SELECT COUNT(*) as count FROM jobs`))?.count || 0;
    const completedJobs = (await dbGet(`SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'`))?.count || 0;
    const failedJobs = (await dbGet(`SELECT COUNT(*) as count FROM jobs WHERE status = 'failed'`))?.count || 0;
    const pendingJobs = (await dbGet(`SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'`))?.count || 0;
    const processingJobs = (await dbGet(`SELECT COUNT(*) as count FROM jobs WHERE status = 'processing'`))?.count || 0;

    const verdictStats = await dbAll(`
      SELECT verdict, COUNT(*) as count 
      FROM jobs 
      WHERE verdict IS NOT NULL 
      GROUP BY verdict
    `);

    const issuesBreakdown = await dbAll(`
      SELECT category, severity, COUNT(*) as count 
      FROM detected_issues 
      GROUP BY category, severity
      ORDER BY count DESC
    `);

    const avgExecTime = (await dbGet(`
      SELECT AVG(execution_time_ms) as avg_time 
      FROM jobs 
      WHERE status = 'completed' AND execution_time_ms IS NOT NULL
    `))?.avg_time || 0;

    return {
      total_jobs: totalJobs,
      completed_jobs: completedJobs,
      failed_jobs: failedJobs,
      pending_jobs: pendingJobs,
      processing_jobs: processingJobs,
      average_execution_time_ms: Math.round(avgExecTime * 100) / 100,
      verdict_summary: verdictStats.reduce((acc, row) => ({ ...acc, [row.verdict]: row.count }), {}),
      issues_breakdown: issuesBreakdown
    };
  }
};

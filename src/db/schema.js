export const SCHEMA_SQL = `
-- Jobs table tracking async lifecycle
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    execution_time_ms REAL,
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    overall_score REAL,
    verdict TEXT CHECK(verdict IN ('APPROVED', 'FLAGGED_FOR_REVIEW', 'REJECTED', NULL)),
    risk_level TEXT CHECK(risk_level IN ('LOW', 'MEDIUM', 'HIGH', NULL))
);

-- Media files metadata table
CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    sha256_hash TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    aspect_ratio REAL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

-- Comprehensive image analysis results table
CREATE TABLE IF NOT EXISTS analysis_results (
    id TEXT PRIMARY KEY,
    job_id TEXT UNIQUE NOT NULL,
    
    -- Blur metrics
    blur_laplacian_variance REAL,
    blur_sharpness_score REAL,
    is_blurry INTEGER NOT NULL DEFAULT 0,
    
    -- Lighting metrics
    brightness_mean REAL,
    contrast_rms REAL,
    is_low_light INTEGER NOT NULL DEFAULT 0,
    is_overexposed INTEGER NOT NULL DEFAULT 0,
    
    -- Duplicate & Perceptual Hashing
    is_duplicate INTEGER NOT NULL DEFAULT 0,
    duplicate_job_id TEXT,
    duplicate_similarity_score REAL,
    dhash TEXT,
    ahash TEXT,
    
    -- OCR & Vehicle License Plate
    plate_detected INTEGER NOT NULL DEFAULT 0,
    plate_number TEXT,
    plate_format_valid INTEGER NOT NULL DEFAULT 0,
    plate_state TEXT,
    plate_confidence REAL,
    ocr_raw_text TEXT,
    task_id_extracted TEXT,
    geotag_extracted TEXT,
    timestamp_extracted TEXT,
    
    -- Tampering / Screenshot / Corruption heuristics
    is_screenshot INTEGER NOT NULL DEFAULT 0,
    is_corrupted_or_blank INTEGER NOT NULL DEFAULT 0,
    uniform_area_ratio REAL,
    entropy REAL,
    exif_present INTEGER NOT NULL DEFAULT 0,
    exif_data TEXT,
    
    raw_metrics_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

-- Granular detected issues table for audit trail & reporting
CREATE TABLE IF NOT EXISTS detected_issues (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('CRITICAL', 'WARNING', 'INFO')),
    message TEXT NOT NULL,
    metric_name TEXT,
    metric_value TEXT,
    threshold TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_media_files_sha256 ON media_files(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_media_files_job_id ON media_files(job_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_job_id ON analysis_results(job_id);
CREATE INDEX IF NOT EXISTS idx_detected_issues_job_id ON detected_issues(job_id);
`;

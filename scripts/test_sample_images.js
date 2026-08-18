import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, dbRepository } from '../src/db/database.js';
import { imageHelper } from '../src/utils/imageHelper.js';
import { analysisPipeline } from '../src/analyzers/index.js';
import { config } from '../src/config.js';
import { logger } from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

async function runSampleTests() {
  console.log('\n========================================================================');
  console.log('  gOGig Media Pipeline: Automated Evaluation on Sample Images');
  console.log('========================================================================\n');

  initDatabase();

  // Ensure storage directories
  [config.STORAGE_DIR, config.UPLOADS_DIR, config.PROCESSED_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  const samples = [
    { file: 'sample_1.jpg', label: 'Sample 1: Arena Animation Auto (Pune FC Road - MH12NW8556)' },
    { file: 'sample_2.jpg', label: 'Sample 2: Dr. Agarwals Auto with Task ID & GPS (TN05BT5754)' },
    { file: 'sample_3.jpg', label: 'Sample 3: Arena Animation Auto Campaign Duplicate (MH12KR1145)' },
    { file: 'sample_1.jpg', label: 'Sample 1 (Re-upload): Exact Cryptographic Duplicate Test' },
    { file: 'sample_blurry.jpg', label: 'Sample 4: Synthetic Blurry Image Defect Test' },
    { file: 'sample_corrupted.jpg', label: 'Sample 5: Synthetic Corrupted / Blank Image Defect Test' }
  ];

  const evaluationResults = [];

  for (const sample of samples) {
    const srcPath = path.join(ROOT_DIR, 'sample_images', sample.file);
    if (!fs.existsSync(srcPath)) {
      console.error(`[SKIP] ${sample.file} not found at ${srcPath}`);
      continue;
    }

    console.log(`\n------------------------------------------------------------------------`);
    console.log(`Analyzing: ${sample.label}`);
    console.log(`------------------------------------------------------------------------`);

    const jobId = uuidv4();
    const mediaId = uuidv4();
    const storedFilename = `${uuidv4()}.jpg`;
    const destPath = path.join(config.UPLOADS_DIR, storedFilename);

    fs.copyFileSync(srcPath, destPath);

    const sha256Hash = imageHelper.getFileSha256(destPath);
    const metadata = await imageHelper.getMetadata(destPath);
    const fileStats = fs.statSync(destPath);

    await dbRepository.createJob(jobId);
    await dbRepository.insertMediaFile({
      id: mediaId,
      job_id: jobId,
      original_filename: sample.file,
      stored_filename: storedFilename,
      file_path: destPath,
      file_size_bytes: fileStats.size,
      mime_type: 'image/jpeg',
      sha256_hash: sha256Hash,
      width: metadata.width,
      height: metadata.height,
      aspect_ratio: metadata.aspectRatio
    });

    const pipelineOutput = await analysisPipeline.runPipeline({
      filePath: destPath,
      jobId,
      sha256Hash
    });

    const { decision, results, execution_time_ms } = pipelineOutput;
    const completedAt = new Date().toISOString();

    // Persist results into database
    await dbRepository.insertAnalysisResults({
      id: uuidv4(),
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
      raw_metrics_json: { decision, results },
      created_at: completedAt
    });

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

    await dbRepository.updateJobStatus(jobId, 'completed', {
      completed_at: completedAt,
      execution_time_ms,
      overall_score: decision.overall_score,
      verdict: decision.verdict,
      risk_level: decision.risk_level
    });

    // Console output summary
    console.log(`✓ Overall Verdict:   [${decision.verdict}] (Score: ${decision.overall_score}/100, Risk: ${decision.risk_level})`);
    console.log(`✓ Execution Time:    ${execution_time_ms.toFixed(1)} ms`);
    console.log(`✓ Dimensions:        ${metadata.width} x ${metadata.height} px (AR: ${metadata.aspectRatio.toFixed(3)})`);
    console.log(`✓ Blur Check:        ${results.blur.is_blurry ? 'BLURRY ❌' : 'SHARP ✅'} (Variance: ${results.blur.laplacian_variance}, Sharpness: ${results.blur.sharpness_score}/100)`);
    console.log(`✓ Lighting:          ${results.lighting.is_low_light ? 'LOW LIGHT ❌' : (results.lighting.is_overexposed ? 'GLARE ⚠️' : 'OPTIMAL ✅')} (Mean: ${results.lighting.brightness_mean}/255, Contrast: ${results.lighting.contrast_rms})`);
    console.log(`✓ Duplicate Hash:    ${results.duplicate.is_duplicate ? `DUPLICATE DETECTED ❌ (${results.duplicate.duplicate_type})` : `UNIQUE UPLOAD ✅ (dHash: ${results.duplicate.dhash})`}`);
    console.log(`✓ License Plate:     ${results.plate.plate_detected ? `DETECTED: "${results.plate.plate_number}" (${results.plate.plate_state}) [Valid: ${results.plate.plate_format_valid ? 'YES' : 'NO'}] ✅` : 'NONE DETECTED ❌'}`);
    if (results.plate.task_id_extracted) console.log(`  └─ Task ID:        ${results.plate.task_id_extracted}`);
    if (results.plate.geotag_extracted) console.log(`  └─ Geotag / GPS:   ${results.plate.geotag_extracted}`);
    if (results.plate.timestamp_extracted) console.log(`  └─ Timestamp:      ${results.plate.timestamp_extracted}`);
    console.log(`✓ Canvas Integrity:  ${results.tampering.is_corrupted_or_blank ? 'CORRUPTED / BLANK AREA ❌' : 'VALID CANVAS ✅'} (Blank Ratio: ${(results.tampering.uniform_area_ratio * 100).toFixed(1)}%, Entropy: ${results.tampering.entropy})`);
    
    if (decision.all_issues.length > 0) {
      console.log(`\n  Flagged Issues (${decision.all_issues.length}):`);
      decision.all_issues.forEach((iss, idx) => {
        console.log(`    ${idx + 1}. [${iss.severity}] (${iss.category}) ${iss.message}`);
      });
    }

    evaluationResults.push({
      sample: sample.file,
      label: sample.label,
      job_id: jobId,
      verdict: decision.verdict,
      overall_score: decision.overall_score,
      risk_level: decision.risk_level,
      execution_time_ms,
      metrics: {
        blur: results.blur,
        lighting: results.lighting,
        duplicate: results.duplicate,
        plate: results.plate,
        tampering: results.tampering
      },
      issues: decision.all_issues
    });
  }

  // Save full structured evaluation report to disk
  const reportPath = path.join(ROOT_DIR, 'sample_analysis_results.json');
  fs.writeFileSync(reportPath, JSON.stringify(evaluationResults, null, 2));
  console.log(`\n========================================================================`);
  console.log(`  All sample evaluations saved to: sample_analysis_results.json`);
  console.log(`========================================================================\n`);

  process.exit(0);
}

runSampleTests().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});

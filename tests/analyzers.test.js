import assert from 'assert';
import sharp from 'sharp';
import { blurAnalyzer } from '../src/analyzers/blurAnalyzer.js';
import { lightingAnalyzer } from '../src/analyzers/lightingAnalyzer.js';
import { plateOcrAnalyzer } from '../src/analyzers/plateOcrAnalyzer.js';
import { tamperingAnalyzer } from '../src/analyzers/tamperingAnalyzer.js';
import { imageHelper } from '../src/utils/imageHelper.js';
import { qualityScorer } from '../src/analyzers/qualityScorer.js';

export async function runAnalyzerTests() {
  console.log('\n--- Running Analyzer Unit Tests ---');

  // Test 1: Indian License Plate Regex Validation
  console.log('Test 1: Indian License Plate OCR & Format Validation');
  const validPlateSamples = [
    { text: 'MH 12 NW 8556', expectedPlate: 'MH12NW8556', expectedState: 'Maharashtra' },
    { text: 'TN.05 BT5754', expectedPlate: 'TN05BT5754', expectedState: 'Tamil Nadu' },
    { text: 'MH12KR1145', expectedPlate: 'MH12KR1145', expectedState: 'Maharashtra' },
    { text: 'KA-01-AB-1234', expectedPlate: 'KA01AB1234', expectedState: 'Karnataka' },
    { text: 'DL 3C AB 9999', expectedPlate: 'DL3CAB9999', expectedState: 'Delhi' },
    { text: '22 BH 1234 AA', expectedPlate: '22BH1234AA', expectedState: 'Bharat Series (All-India)' }
  ];

  for (const sample of validPlateSamples) {
    const result = plateOcrAnalyzer.extractIndianNumberPlate(sample.text);
    assert.strictEqual(result.detected, true, `Should detect plate for "${sample.text}"`);
    assert.strictEqual(result.formatValid, true, `Plate format should be valid for "${sample.text}"`);
    assert.strictEqual(result.plateNumber, sample.expectedPlate, `Extracted plate should match ${sample.expectedPlate}`);
    assert.strictEqual(result.state, sample.expectedState, `State should be ${sample.expectedState}`);
  }
  console.log('  ✓ Successfully validated standard and BH Indian license plate regexes');

  // Test 2: Field Task ID and Geotag Extraction
  console.log('Test 2: Field Task ID and Geotag Parsing');
  const sampleBannerText = `
    Tuesday, 17 Feb 2026 11:22 AM
    Perambur High Road, CMWSSB Division 70, Chennai, Tamil Nadu, 600011
    Lat: 13.1059115 | Long: 80.2514811
    TASK ID: 22FUGV4G2K
  `;
  const taskId = plateOcrAnalyzer.extractTaskId(sampleBannerText);
  const geotag = plateOcrAnalyzer.extractGeotag(sampleBannerText);
  const timestamp = plateOcrAnalyzer.extractTimestamp(sampleBannerText);

  assert.strictEqual(taskId, '22FUGV4G2K', 'Should extract Task ID');
  assert.ok(geotag && geotag.includes('13.1059115'), 'Should extract GPS latitude');
  assert.ok(timestamp && timestamp.includes('17 Feb 2026'), 'Should extract timestamp');
  console.log('  ✓ Successfully parsed field overlay metadata (Task ID, GPS, Timestamp)');

  // Test 3: Perceptual Hashing & Hamming Distance
  console.log('Test 3: Perceptual Hashing and Hamming Distance');
  const hash1 = 'a1b2c3d4e5f60718';
  const hash2 = 'a1b2c3d4e5f60718'; // identical
  const hash3 = 'a1b2c3d4e5f60719'; // 1-bit difference (8 vs 9: 1000 vs 1001)

  assert.strictEqual(imageHelper.calculateHammingDistance(hash1, hash2), 0, 'Identical hashes should have distance 0');
  assert.strictEqual(imageHelper.calculateHammingDistance(hash1, hash3), 1, '1-bit diff should have distance 1');
  console.log('  ✓ Hamming distance calculation accurate');

  // Test 4: Synthetic Image Lighting Analysis
  console.log('Test 4: Lighting & Luminance Histogram on Synthetic Gradients');
  // Generate solid dark buffer (luminance ~10)
  const darkBuf = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 10, g: 10, b: 10 } }
  }).jpeg().toBuffer();

  const darkAnalysis = await lightingAnalyzer.analyze(darkBuf);
  assert.strictEqual(darkAnalysis.is_low_light, true, 'Dark image should be flagged as low light');
  assert.ok(darkAnalysis.brightness_mean < 20, 'Dark image mean should be < 20');

  // Generate normal bright buffer (luminance ~140)
  const normalBuf = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 140, g: 140, b: 140 } }
  }).jpeg().toBuffer();

  const normalAnalysis = await lightingAnalyzer.analyze(normalBuf);
  assert.strictEqual(normalAnalysis.is_low_light, false, 'Normal image should not be low light');
  assert.strictEqual(normalAnalysis.is_overexposed, false, 'Normal image should not be overexposed');
  console.log('  ✓ Lighting analyzer correctly distinguishes underexposed from optimal lighting');

  // Test 5: Synthetic Image Corruption / Uniform Canvas Detection
  console.log('Test 5: Canvas Corruption & Uniform Area Detection');
  // Create 90% white blank canvas with 10% line (similar to corrupted sample 2)
  const corruptedBuf = await sharp({
    create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } }
  }).jpeg().toBuffer();

  const corruptionAnalysis = await tamperingAnalyzer.analyze(corruptedBuf);
  assert.strictEqual(corruptionAnalysis.is_corrupted_or_blank, true, 'Solid canvas should be flagged as corrupted/blank');
  assert.ok(corruptionAnalysis.uniform_area_ratio > 0.8, 'Uniform ratio should be > 80%');
  console.log('  ✓ Corruption analyzer correctly detects empty/blank canvas');

  // Test 6: Quality Scorer Aggregation & Verdicts
  console.log('Test 6: Quality Scorer Aggregation');
  const cleanResult = qualityScorer.evaluate({
    blur: { is_blurry: false, sharpness_score: 90, issues: [] },
    lighting: { is_low_light: false, is_overexposed: false, issues: [] },
    duplicate: { is_duplicate: false, issues: [] },
    plate: { plate_detected: true, plate_format_valid: true, issues: [] },
    tampering: { is_corrupted_or_blank: false, is_screenshot: false, is_software_edited: false, issues: [] }
  });
  assert.strictEqual(cleanResult.verdict, 'APPROVED', 'Clean image should be APPROVED');
  assert.strictEqual(cleanResult.risk_level, 'LOW', 'Clean image risk should be LOW');
  assert.ok(cleanResult.overall_score >= 90, 'Score should be >= 90');

  const corruptedResult = qualityScorer.evaluate({
    blur: { is_blurry: false, sharpness_score: 80, issues: [] },
    lighting: { is_low_light: false, is_overexposed: false, issues: [] },
    duplicate: { is_duplicate: false, issues: [] },
    plate: { plate_detected: false, plate_format_valid: false, issues: [] },
    tampering: { is_corrupted_or_blank: true, is_screenshot: false, is_software_edited: false, issues: [{ category: 'CORRUPTION', severity: 'CRITICAL', message: 'Corrupted image' }] }
  });
  assert.strictEqual(corruptedResult.verdict, 'REJECTED', 'Corrupted image should be REJECTED');
  assert.strictEqual(corruptedResult.risk_level, 'HIGH', 'Corrupted image risk should be HIGH');
  console.log('  ✓ Quality Scorer produces consistent deterministic verdicts');

  console.log('✅ ALL ANALYZER TESTS PASSED!\n');
}

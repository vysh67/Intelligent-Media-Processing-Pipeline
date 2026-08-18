import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { logger } from '../utils/logger.js';

// Indian State / UT RTO Code mapping
const INDIAN_STATE_CODES = {
  AP: 'Andhra Pradesh',
  AR: 'Arunachal Pradesh',
  AS: 'Assam',
  BR: 'Bihar',
  CG: 'Chhattisgarh',
  CH: 'Chandigarh',
  DD: 'Daman & Diu',
  DL: 'Delhi',
  DN: 'Dadra & Nagar Haveli',
  GA: 'Goa',
  GJ: 'Gujarat',
  HP: 'Himachal Pradesh',
  HR: 'Haryana',
  JH: 'Jharkhand',
  JK: 'Jammu & Kashmir',
  KA: 'Karnataka',
  KL: 'Kerala',
  LA: 'Ladakh',
  LD: 'Lakshadweep',
  MH: 'Maharashtra',
  ML: 'Meghalaya',
  MN: 'Manipur',
  MP: 'Madhya Pradesh',
  MZ: 'Mizoram',
  NL: 'Nagaland',
  OD: 'Odisha',
  PB: 'Punjab',
  PY: 'Puducherry',
  RJ: 'Rajasthan',
  SK: 'Sikkim',
  TN: 'Tamil Nadu',
  TR: 'Tripura',
  TS: 'Telangana',
  UK: 'Uttarakhand',
  UP: 'Uttar Pradesh',
  WB: 'West Bengal'
};

let tesseractWorkerPromise = null;

async function getWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      try {
        const worker = await createWorker('eng');
        return worker;
      } catch (err) {
        logger.error('Failed to initialize Tesseract worker:', err.message);
        tesseractWorkerPromise = null;
        throw err;
      }
    })();
  }
  return tesseractWorkerPromise;
}

export const plateOcrAnalyzer = {
  name: 'Plate OCR & Format Validation Analyzer',

  /**
   * Cleans OCR raw text and searches for Indian registration numbers, Task IDs, and Geotags
   */
  async analyze(filePathOrBuffer) {
    try {
      // Preprocess image for maximum OCR text contrast and legibility
      const preprocessedBuffer = await sharp(filePathOrBuffer)
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: false })
        .grayscale()
        .normalize() // Stretch dynamic range
        .sharpen({ sigma: 1.5 })
        .toBuffer();

      const worker = await getWorker();
      const { data } = await worker.recognize(preprocessedBuffer);

      const rawText = data.text || '';
      logger.debug('OCR Extracted Raw Text:\n', rawText.substring(0, 300));

      // 1. Search for Indian Registration Plates
      // Patterns:
      // Standard: MH 12 NW 8556, MH12NW8556, TN.05 BT5754, MH 12 N W8556, MH-12-NW-8556
      // BH Series: 22 BH 1234 AA
      const plateResult = this.extractIndianNumberPlate(rawText);

      // 2. Search for Field Task ID overlay (e.g. TASK ID: 22FUGV4G2K)
      const taskIdResult = this.extractTaskId(rawText);

      // 3. Search for Geotag / Coordinates overlay
      const geotagResult = this.extractGeotag(rawText);

      // 4. Search for Timestamp overlay
      const timestampResult = this.extractTimestamp(rawText);

      const issues = [];
      if (!plateResult.detected) {
        issues.push({
          category: 'LICENSE_PLATE',
          severity: 'WARNING',
          message: 'No valid Indian vehicle license plate detected in image',
          metric_name: 'plate_detected',
          metric_value: 'FALSE',
          threshold: 'MUST_CONTAIN_VALID_PLATE'
        });
      } else if (!plateResult.formatValid) {
        issues.push({
          category: 'LICENSE_PLATE',
          severity: 'WARNING',
          message: `Detected plate candidate (${plateResult.plateNumber}) does not conform to official Indian RTO standards`,
          metric_name: 'plate_format_valid',
          metric_value: plateResult.plateNumber,
          threshold: '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$'
        });
      }

      return {
        plate_detected: plateResult.detected,
        plate_number: plateResult.plateNumber,
        plate_format_valid: plateResult.formatValid,
        plate_state: plateResult.state,
        plate_confidence: plateResult.confidence,
        ocr_raw_text: rawText.trim(),
        task_id_extracted: taskIdResult,
        geotag_extracted: geotagResult,
        timestamp_extracted: timestampResult,
        issues
      };
    } catch (err) {
      logger.error('PlateOcrAnalyzer error:', err.message);
      return {
        plate_detected: false,
        plate_number: null,
        plate_format_valid: false,
        plate_state: null,
        plate_confidence: 0,
        ocr_raw_text: '',
        task_id_extracted: null,
        geotag_extracted: null,
        timestamp_extracted: null,
        issues: [{
          category: 'LICENSE_PLATE',
          severity: 'WARNING',
          message: `OCR extraction failed: ${err.message}`,
          metric_name: 'ocr_extraction',
          metric_value: 'ERROR',
          threshold: null
        }]
      };
    }
  },

  /**
   * Helper to parse Indian number plates with state code validation
   */
  extractIndianNumberPlate(text) {
    const cleaned = text.toUpperCase();

    // Regex 1: Match standard Indian plate with flexible spacing/delimiters and optional alphanumeric RTO code (e.g., Delhi DL 3C AB 9999 or MH 12 NW 8556)
    const standardRegex = /\b([A-Z]{2})[\s\.\-]*([0-9]{1,2}[A-Z]?)[\s\.\-]*([A-Z]{0,3})[\s\.\-]*([0-9]{4})\b/g;

    let match;
    const candidates = [];

    while ((match = standardRegex.exec(cleaned)) !== null) {
      const stateCode = match[1];
      const districtRaw = match[2];
      const series = match[3] || '';
      const num = match[4];

      if (INDIAN_STATE_CODES[stateCode]) {
        // Pad single digit numbers if purely numeric
        const district = /^[0-9]$/.test(districtRaw) ? `0${districtRaw}` : districtRaw;
        const canonicalPlate = `${stateCode}${district}${series}${num}`;
        candidates.push({
          plateNumber: canonicalPlate,
          rawMatch: match[0],
          state: INDIAN_STATE_CODES[stateCode],
          formatValid: true,
          confidence: 0.92
        });
      }
    }

    // Regex 2: Match Bharat (BH) series format: e.g. 22 BH 1234 AA
    const bhRegex = /\b([0-9]{2})[\s\.\-]*BH[\s\.\-]*([0-9]{4})[\s\.\-]*([A-Z]{1,2})\b/g;
    while ((match = bhRegex.exec(cleaned)) !== null) {
      const year = match[1];
      const num = match[2];
      const series = match[3];
      const canonicalPlate = `${year}BH${num}${series}`;
      candidates.push({
        plateNumber: canonicalPlate,
        rawMatch: match[0],
        state: 'Bharat Series (All-India)',
        formatValid: true,
        confidence: 0.95
      });
    }

    if (candidates.length > 0) {
      return {
        detected: true,
        ...candidates[0]
      };
    }

    // Relaxed fallback search if plate was partially recognized
    const relaxedRegex = /\b([A-Z]{2})[0-9A-Z]{6,9}\b/g;
    while ((match = relaxedRegex.exec(cleaned.replace(/[\s\.\-]/g, ''))) !== null) {
      const stateCode = match[0].substring(0, 2);
      if (INDIAN_STATE_CODES[stateCode]) {
        return {
          detected: true,
          plateNumber: match[0],
          rawMatch: match[0],
          state: INDIAN_STATE_CODES[stateCode],
          formatValid: false,
          confidence: 0.50
        };
      }
    }

    return {
      detected: false,
      plateNumber: null,
      state: null,
      formatValid: false,
      confidence: 0
    };
  },

  /**
   * Extracts Field Task ID (e.g. TASK ID: 22FUGV4G2K)
   */
  extractTaskId(text) {
    const taskMatch = text.match(/TASK\s*ID\s*[:\-]?\s*([A-Z0-9]{6,16})/i);
    return taskMatch ? taskMatch[1].toUpperCase() : null;
  },

  /**
   * Extracts GPS Coordinates or Location overlay (e.g. Lat: 13.1059115 | Long: 80.2514811)
   */
  extractGeotag(text) {
    const latLongMatch = text.match(/(?:Lat|Latitude)[:\s]*([0-9\.]+)\s*(?:\||,)?\s*(?:Long|Longitude)[:\s]*([0-9\.]+)/i);
    if (latLongMatch) {
      return `Lat: ${latLongMatch[1]}, Long: ${latLongMatch[2]}`;
    }
    const locationLine = text.match(/(?:Chennai|Bangalore|Pune|Mumbai|Delhi|Hyderabad|Perambur|FC Road)[^\n\r]*/i);
    return locationLine ? locationLine[0].trim() : null;
  },

  /**
   * Extracts Field Verification Timestamp overlay
   */
  extractTimestamp(text) {
    const timeMatch = text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^\n\r]*\d{4}[^\n\r]*/i);
    return timeMatch ? timeMatch[0].trim() : null;
  }
};

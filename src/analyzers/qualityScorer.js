export const qualityScorer = {
  name: 'Quality & Fraud Risk Scorer',

  /**
   * Aggregates metrics and issues to determine final verdict and quality score
   */
  evaluate({ blur, lighting, duplicate, plate, tampering }) {
    let score = 100;
    const allIssues = [
      ...(blur.issues || []),
      ...(lighting.issues || []),
      ...(duplicate.issues || []),
      ...(plate.issues || []),
      ...(tampering.issues || [])
    ];

    // Penalty deductions based on specific defects
    if (tampering.is_corrupted_or_blank) {
      score -= 75;
    }
    if (duplicate.is_duplicate) {
      score -= 60;
    }
    if (blur.is_blurry) {
      score -= 30;
    }
    if (lighting.is_low_light) {
      score -= 20;
    }
    if (lighting.is_overexposed) {
      score -= 15;
    }
    if (!plate.plate_detected) {
      score -= 25;
    } else if (!plate.plate_format_valid) {
      score -= 10;
    }
    if (tampering.is_screenshot) {
      score -= 20;
    }
    if (tampering.is_software_edited) {
      score -= 30;
    }

    // Clamp score between 0 and 100
    score = Math.max(0, Math.min(100, Math.round(score)));

    // Categorize issues by severity
    const criticalIssues = allIssues.filter((i) => i.severity === 'CRITICAL');
    const warningIssues = allIssues.filter((i) => i.severity === 'WARNING');

    let verdict = 'APPROVED';
    let riskLevel = 'LOW';

    if (criticalIssues.length > 0 || score < 40) {
      verdict = 'REJECTED';
      riskLevel = 'HIGH';
    } else if (warningIssues.length > 0 || score < 75) {
      verdict = 'FLAGGED_FOR_REVIEW';
      riskLevel = 'MEDIUM';
    }

    // Generate human-readable decision summary
    const summaryReasons = [];
    if (verdict === 'APPROVED') {
      summaryReasons.push('Image passed all quality, sharpness, unique-upload, and license plate verification checks.');
    } else {
      if (tampering.is_corrupted_or_blank) {
        summaryReasons.push('Image canvas is corrupted or mostly empty.');
      }
      if (duplicate.is_duplicate) {
        summaryReasons.push(`Image is a duplicate of previous upload (${duplicate.duplicate_type}).`);
      }
      if (blur.is_blurry) {
        summaryReasons.push('Image is blurry or out of focus.');
      }
      if (lighting.is_low_light) {
        summaryReasons.push('Image has poor underexposed lighting.');
      }
      if (lighting.is_overexposed) {
        summaryReasons.push('Image suffers from severe glare or overexposure.');
      }
      if (!plate.plate_detected) {
        summaryReasons.push('No valid vehicle registration plate detected.');
      }
      if (tampering.is_screenshot) {
        summaryReasons.push('Image appears to be a mobile screenshot rather than original camera capture.');
      }
      if (tampering.is_software_edited) {
        summaryReasons.push('Detected metadata traces of photo editing software.');
      }
    }

    return {
      overall_score: score,
      risk_level: riskLevel,
      verdict,
      all_issues: allIssues,
      critical_count: criticalIssues.length,
      warning_count: warningIssues.length,
      decision_summary: summaryReasons.join(' ')
    };
  }
};

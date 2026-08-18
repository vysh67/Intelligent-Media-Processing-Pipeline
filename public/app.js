// State
let activeJobs = [];
let pollingInterval = null;
let currentFilter = 'all';

// DOM Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const btnRunAllSamples = document.getElementById('btnRunAllSamples');
const btnSample1 = document.getElementById('btnSample1');
const btnSample2 = document.getElementById('btnSample2');
const btnSample3 = document.getElementById('btnSample3');
const btnRefreshAnalytics = document.getElementById('btnRefreshAnalytics');
const jobsFeedList = document.getElementById('jobsFeedList');
const filterBtns = document.querySelectorAll('.filter-btn');

// Stats Elements
const statTotalJobs = document.getElementById('statTotalJobs');
const statApprovedJobs = document.getElementById('statApprovedJobs');
const statFlaggedJobs = document.getElementById('statFlaggedJobs');
const statRejectedJobs = document.getElementById('statRejectedJobs');
const avgLatencyDisplay = document.getElementById('avgLatencyDisplay');

// Modal Elements
const inspectModal = document.getElementById('inspectModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const modalJobTitle = document.getElementById('modalJobTitle');
const modalVerdictBadge = document.getElementById('modalVerdictBadge');
const modalJobId = document.getElementById('modalJobId');
const modalPreviewImg = document.getElementById('modalPreviewImg');
const modalMediaMeta = document.getElementById('modalMediaMeta');
const modalScoreVal = document.getElementById('modalScoreVal');
const modalRiskLabel = document.getElementById('modalRiskLabel');
const modalDecisionSummary = document.getElementById('modalDecisionSummary');
const modalIssuesList = document.getElementById('modalIssuesList');
const modalRawJson = document.getElementById('modalRawJson');

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadJobs();
  loadAnalytics();
  startAutoPolling();
});

function setupEventListeners() {
  // Drag and drop
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      uploadFile(e.target.files[0]);
    }
  });

  // Sample Presets
  btnRunAllSamples.addEventListener('click', async () => {
    btnRunAllSamples.disabled = true;
    btnRunAllSamples.innerText = '⏳ Triggering...';
    try {
      const res = await fetch('/api/v1/demo/process-samples', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        loadJobs();
        loadAnalytics();
      }
    } catch (e) {
      console.error(e);
    } finally {
      btnRunAllSamples.disabled = false;
      btnRunAllSamples.innerText = '⚡ Process All 3 Samples';
    }
  });

  btnSample1.addEventListener('click', () => triggerSampleUpload('sample_1.jpg'));
  btnSample2.addEventListener('click', () => triggerSampleUpload('sample_2.jpg'));
  btnSample3.addEventListener('click', () => triggerSampleUpload('sample_3.jpg'));

  btnRefreshAnalytics.addEventListener('click', () => {
    loadAnalytics();
    loadJobs();
  });

  // Filter Buttons
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderJobsList();
    });
  });

  // Modal Close
  btnCloseModal.addEventListener('click', () => {
    inspectModal.style.display = 'none';
  });
  window.addEventListener('click', (e) => {
    if (e.target === inspectModal) {
      inspectModal.style.display = 'none';
    }
  });
}

// Upload Single File
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetch('/api/v1/upload', {
      method: 'POST',
      body: formData
    });
    const result = await res.json();
    if (result.success) {
      loadJobs();
      loadAnalytics();
    } else {
      alert(`Upload error: ${result.message}`);
    }
  } catch (err) {
    alert(`Failed to upload file: ${err.message}`);
  }
}

// Trigger single sample image
async function triggerSampleUpload(filename) {
  try {
    const imgRes = await fetch(`/${filename}`);
    const blob = await imgRes.blob();
    const file = new File([blob], filename, { type: 'image/jpeg' });
    await uploadFile(file);
  } catch (err) {
    // If not found in root, trigger demo batch endpoint
    fetch('/api/v1/demo/process-samples', { method: 'POST' }).then(() => loadJobs());
  }
}

// Fetch All Jobs
async function loadJobs() {
  try {
    const res = await fetch('/api/v1/jobs?limit=50');
    const data = await res.json();
    if (data.success) {
      activeJobs = data.data.items || [];
      renderJobsList();
    }
  } catch (err) {
    console.error('Failed to load jobs:', err);
  }
}

// Fetch Analytics Summary
async function loadAnalytics() {
  try {
    const res = await fetch('/api/v1/analytics/summary');
    const data = await res.json();
    if (data.success) {
      const stats = data.data;
      statTotalJobs.innerText = stats.total_jobs || 0;
      statApprovedJobs.innerText = stats.verdict_summary?.APPROVED || 0;
      statFlaggedJobs.innerText = stats.verdict_summary?.FLAGGED_FOR_REVIEW || 0;
      statRejectedJobs.innerText = stats.verdict_summary?.REJECTED || 0;
      avgLatencyDisplay.innerText = `${stats.average_execution_time_ms || 0} ms`;
    }
  } catch (err) {
    console.error('Failed to load analytics:', err);
  }
}

// Auto Polling for Active Pipeline Work
function startAutoPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(() => {
    const hasPending = activeJobs.some((j) => j.status === 'pending' || j.status === 'processing');
    if (hasPending || activeJobs.length === 0) {
      loadJobs();
      loadAnalytics();
    }
  }, 2000);
}

// Render Jobs Feed
function renderJobsList() {
  let filtered = activeJobs;
  if (currentFilter === 'completed') {
    filtered = activeJobs.filter((j) => j.status === 'completed');
  } else if (currentFilter === 'pending') {
    filtered = activeJobs.filter((j) => j.status === 'pending' || j.status === 'processing');
  }

  if (filtered.length === 0) {
    jobsFeedList.innerHTML = `
      <div class="empty-state">
        <p>No jobs found for filter '${currentFilter}'.</p>
      </div>
    `;
    return;
  }

  jobsFeedList.innerHTML = filtered
    .map((job) => {
      const isPending = job.status === 'pending' || job.status === 'processing';
      const verdict = isPending ? job.status : (job.verdict || 'COMPLETED');
      const score = job.overall_score !== null ? `${job.overall_score}/100` : '--';
      const timeStr = new Date(job.created_at).toLocaleTimeString();
      const imgSrc = job.stored_filename ? `/api/v1/media/${job.stored_filename}` : '';

      return `
        <div class="feed-job-card" onclick="openJobInspection('${job.id}')">
          <div class="feed-card-thumb">
            ${imgSrc ? `<img src="${imgSrc}" alt="thumb">` : '<div style="background:#222;width:100%;height:100%;"></div>'}
          </div>
          <div class="feed-card-info">
            <div class="feed-title-line">
              <span class="feed-filename">${escapeHtml(job.original_filename || 'image_upload.jpg')}</span>
              ${job.plate_number ? `<span class="feed-plate-tag">🚗 ${escapeHtml(job.plate_number)}</span>` : ''}
            </div>
            <div class="feed-meta-line">
              <span>Time: ${timeStr}</span>
              ${job.execution_time_ms ? `<span>⚡ ${job.execution_time_ms.toFixed(0)}ms</span>` : ''}
              ${job.issue_count > 0 ? `<span class="tag-warn">⚠️ ${job.issue_count} issues</span>` : ''}
            </div>
          </div>
          <div class="feed-card-action">
            <span class="verdict-badge ${verdict}">${verdict}</span>
            <span class="feed-score">Score: <strong>${score}</strong></span>
          </div>
        </div>
      `;
    })
    .join('');
}

// Open Inspection Modal
window.openJobInspection = async function (jobId) {
  try {
    const res = await fetch(`/api/v1/jobs/${jobId}/results`);
    const data = await res.json();
    if (!data.success && data.data?.status !== 'pending' && data.data?.status !== 'processing') {
      alert(`Error loading results: ${data.data?.error_message || 'Unknown error'}`);
      return;
    }

    const jobResult = data.data;
    const checks = jobResult.checks || {};
    const media = jobResult.media || {};

    inspectModal.style.display = 'flex';
    modalJobTitle.innerText = media.original_filename || 'Image Inspection';
    modalJobId.innerText = `Job ID: ${jobResult.job_id}`;

    modalVerdictBadge.className = `verdict-badge ${jobResult.verdict || jobResult.status}`;
    modalVerdictBadge.innerText = jobResult.verdict || jobResult.status;

    if (media.image_url) {
      modalPreviewImg.src = media.image_url;
    }

    modalMediaMeta.innerHTML = `
      <div><strong>File Size:</strong> ${media.file_size_bytes ? (media.file_size_bytes / 1024).toFixed(1) + ' KB' : '--'}</div>
      <div><strong>Resolution:</strong> ${media.dimensions?.width || '--'} x ${media.dimensions?.height || '--'} px</div>
      <div><strong>Aspect Ratio:</strong> ${media.dimensions?.aspect_ratio || '--'}</div>
      <div><strong>Execution Time:</strong> ${jobResult.execution_time_ms ? jobResult.execution_time_ms + ' ms' : '--'}</div>
    `;

    modalScoreVal.innerText = jobResult.overall_score ?? '--';
    modalRiskLabel.innerText = `${jobResult.risk_level || 'ANALYZING'} RISK`;
    modalDecisionSummary.innerText = getSummaryText(jobResult);

    // 1. Blur Check
    const blur = checks.blur || {};
    document.getElementById('valSharpness').innerText = blur.sharpness_score ?? '--';
    document.getElementById('valLaplacian').innerText = blur.laplacian_variance ?? '--';
    const blurBadge = document.getElementById('blurStatus');
    blurBadge.className = `check-status ${blur.is_blurry ? 'FAIL' : 'PASS'}`;
    blurBadge.innerText = blur.is_blurry ? 'BLURRY' : 'SHARP';

    // 2. Lighting Check
    const light = checks.lighting || {};
    document.getElementById('valBrightness').innerText = light.brightness_mean ?? '--';
    document.getElementById('valContrast').innerText = light.contrast_rms ?? '--';
    const lightBadge = document.getElementById('lightStatus');
    if (light.is_low_light) {
      lightBadge.className = 'check-status FAIL';
      lightBadge.innerText = 'LOW LIGHT';
    } else if (light.is_overexposed) {
      lightBadge.className = 'check-status FLAG';
      lightBadge.innerText = 'GLARE';
    } else {
      lightBadge.className = 'check-status PASS';
      lightBadge.innerText = 'OPTIMAL';
    }

    // 3. Duplicate Check
    const dup = checks.duplicate || {};
    document.getElementById('valDHash').innerText = dup.dhash ? dup.dhash.substring(0, 12) + '...' : '--';
    document.getElementById('valDupMatch').innerText = dup.is_duplicate ? `Duplicate (${(dup.similarity_score * 100).toFixed(0)}%)` : 'Unique Upload';
    const dupBadge = document.getElementById('dupStatus');
    dupBadge.className = `check-status ${dup.is_duplicate ? 'FAIL' : 'PASS'}`;
    dupBadge.innerText = dup.is_duplicate ? 'DUPLICATE' : 'UNIQUE';

    // 4. Plate OCR Check
    const plate = checks.license_plate || {};
    document.getElementById('valPlateNum').innerText = plate.plate_number || 'None Detected';
    document.getElementById('valPlateState').innerText = plate.state || 'Unknown';
    const plateBadge = document.getElementById('plateStatus');
    plateBadge.className = `check-status ${plate.detected && plate.format_valid ? 'PASS' : (plate.detected ? 'FLAG' : 'FAIL')}`;
    plateBadge.innerText = plate.detected && plate.format_valid ? 'VALID RTO' : (plate.detected ? 'FORMAT MISMATCH' : 'NO PLATE');

    if (plate.task_id) {
      document.getElementById('valTaskIdRow').style.display = 'block';
      document.getElementById('valTaskId').innerText = plate.task_id;
    } else {
      document.getElementById('valTaskIdRow').style.display = 'none';
    }

    if (plate.geotag) {
      document.getElementById('valGeotagRow').style.display = 'block';
      document.getElementById('valGeotag').innerText = plate.geotag;
    } else {
      document.getElementById('valGeotagRow').style.display = 'none';
    }

    // 5. Tampering & Corruption Check
    const tamper = checks.tampering_and_corruption || {};
    document.getElementById('valUniform').innerText = tamper.uniform_area_ratio ? `${(tamper.uniform_area_ratio * 100).toFixed(1)}%` : '0%';
    document.getElementById('valEntropy').innerText = tamper.entropy ?? '--';
    document.getElementById('valScreenshot').innerText = tamper.is_screenshot ? 'Yes (Aspect Ratio)' : 'No';
    const tamperBadge = document.getElementById('tamperStatus');
    if (tamper.is_corrupted_or_blank) {
      tamperBadge.className = 'check-status FAIL';
      tamperBadge.innerText = 'CORRUPTED/BLANK';
    } else if (tamper.is_screenshot) {
      tamperBadge.className = 'check-status FLAG';
      tamperBadge.innerText = 'SCREENSHOT';
    } else {
      tamperBadge.className = 'check-status PASS';
      tamperBadge.innerText = 'VALID CANVAS';
    }

    // Detected Issues List
    const issues = jobResult.detected_issues || [];
    if (issues.length === 0) {
      modalIssuesList.innerHTML = `<div style="color: var(--accent-emerald); font-size: 12px;">✓ No quality, lighting, or tampering defects detected.</div>`;
    } else {
      modalIssuesList.innerHTML = issues
        .map(
          (iss) => `
        <div class="issue-pill-row ${iss.severity}">
          <div>
            <strong>[${iss.category}]</strong> ${escapeHtml(iss.message)}
          </div>
          <span class="issue-badge ${iss.severity}">${iss.severity}</span>
        </div>
      `
        )
        .join('');
    }

    // Raw JSON view
    modalRawJson.innerText = JSON.stringify(jobResult, null, 2);

  } catch (err) {
    console.error('Failed to load inspection:', err);
  }
};

function getSummaryText(res) {
  if (res.verdict === 'APPROVED') return 'Passed all sharpness, lighting, unique hash, and Indian license plate validation checks.';
  if (res.verdict === 'REJECTED') return 'Critical defects detected: unacceptable image corruption, duplication, or severe quality failure.';
  return 'Some issues detected (e.g. non-standard plate, low lighting, or potential screenshot). Requires manual supervisor review.';
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

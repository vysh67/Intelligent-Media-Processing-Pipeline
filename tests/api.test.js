import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import app from '../src/server.js';
import { config } from '../src/config.js';
import { dbRepository } from '../src/db/database.js';

export async function runApiTests() {
  console.log('\n--- Running API Integration Tests ---');

  const testPort = 3199;
  let testServer;

  await new Promise((resolve) => {
    testServer = app.listen(testPort, () => {
      console.log(`Test API Server running on port ${testPort}`);
      resolve();
    });
  });

  try {
    // 1. Health Check Test
    console.log('Test 1: GET /health');
    const healthRes = await makeRequest(`http://localhost:${testPort}/health`);
    assert.strictEqual(healthRes.statusCode, 200);
    assert.strictEqual(healthRes.body.status, 'HEALTHY');
    console.log('  ✓ /health returned 200 OK');

    // 2. Upload API Test (Multipart Form POST)
    console.log('Test 2: POST /api/v1/upload (Multipart Image Upload)');
    const dummyImgBuf = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 100, g: 150, b: 200 } }
    }).jpeg().toBuffer();

    const uploadRes = await uploadBuffer(`http://localhost:${testPort}/api/v1/upload`, dummyImgBuf, 'test_car.jpg');
    assert.strictEqual(uploadRes.statusCode, 202, 'Should return 202 Accepted');
    assert.strictEqual(uploadRes.body.success, true);
    assert.ok(uploadRes.body.data.job_id, 'Should return a job_id UUID');
    assert.strictEqual(uploadRes.body.data.status, 'pending');
    console.log(`  ✓ Upload accepted, received job_id: ${uploadRes.body.data.job_id}`);

    const jobId = uploadRes.body.data.job_id;

    // 3. Status Polling Test
    console.log('Test 3: GET /api/v1/jobs/:id/status');
    const statusRes = await makeRequest(`http://localhost:${testPort}/api/v1/jobs/${jobId}/status`);
    assert.strictEqual(statusRes.statusCode, 200);
    assert.strictEqual(statusRes.body.data.job_id, jobId);
    console.log(`  ✓ Job status endpoint returned active state: ${statusRes.body.data.status}`);

    // 4. Wait for worker processing to complete
    console.log('Test 4: Async Worker Completion & Polling');
    let attempts = 0;
    let completedJob = null;
    while (attempts < 20) {
      await new Promise((r) => setTimeout(r, 600));
      const pollRes = await makeRequest(`http://localhost:${testPort}/api/v1/jobs/${jobId}/status`);
      if (pollRes.body.data.status === 'completed' || pollRes.body.data.status === 'failed') {
        completedJob = pollRes.body.data;
        break;
      }
      attempts++;
    }

    assert.ok(completedJob, 'Job should complete within timeout');
    assert.strictEqual(completedJob.status, 'completed', 'Job should reach completed state');
    console.log(`  ✓ Worker processed job ${jobId} in ${completedJob.execution_time_ms}ms [Verdict: ${completedJob.verdict}]`);

    // 5. Results API Test
    console.log('Test 5: GET /api/v1/jobs/:id/results');
    const resultsRes = await makeRequest(`http://localhost:${testPort}/api/v1/jobs/${jobId}/results`);
    assert.strictEqual(resultsRes.statusCode, 200);
    assert.ok(resultsRes.body.data.checks, 'Results should contain checks object');
    assert.ok(resultsRes.body.data.checks.blur, 'Results should contain blur metrics');
    assert.ok(resultsRes.body.data.checks.lighting, 'Results should contain lighting metrics');
    assert.ok(resultsRes.body.data.checks.duplicate, 'Results should contain duplicate metrics');
    assert.ok(resultsRes.body.data.checks.license_plate, 'Results should contain license plate metrics');
    assert.ok(resultsRes.body.data.checks.tampering_and_corruption, 'Results should contain tampering metrics');
    console.log('  ✓ Granular analysis results returned structured JSON');

    // 6. Analytics API Test
    console.log('Test 6: GET /api/v1/analytics/summary');
    const analyticsRes = await makeRequest(`http://localhost:${testPort}/api/v1/analytics/summary`);
    assert.strictEqual(analyticsRes.statusCode, 200);
    assert.ok(analyticsRes.body.data.total_jobs >= 1, 'Total jobs should be >= 1');
    console.log('  ✓ Analytics summary aggregated successfully');

    console.log('✅ ALL API INTEGRATION TESTS PASSED!\n');
  } finally {
    testServer.close();
  }
}

// Helpers for native HTTP testing
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

function uploadBuffer(url, buffer, filename) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const parsedUrl = new URL(url);

    const postDataHeader = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="image"; filename="${filename}"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`
    );
    const postDataFooter = Buffer.from(`\r\n--${boundary}--\r\n`);
    const fullBody = Buffer.concat([postDataHeader, buffer, postDataFooter]);

    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': fullBody.length
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ statusCode: res.statusCode, body: data });
          }
        });
      }
    );

    req.on('error', reject);
    req.write(fullBody);
    req.end();
  });
}

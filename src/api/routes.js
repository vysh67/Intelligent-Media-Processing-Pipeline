import express from 'express';
import { apiControllers } from './controllers.js';
import { uploadMiddleware, errorHandler } from './middlewares.js';

const router = express.Router();

// 1. Upload API (accepts image, returns 202 + job ID immediately)
router.post(
  '/upload',
  uploadMiddleware.single('image'),
  errorHandler,
  apiControllers.uploadImage
);

// Fallback field name 'file'
router.post(
  '/upload-file',
  uploadMiddleware.single('file'),
  errorHandler,
  apiControllers.uploadImage
);

// 2. Job Status API (pending, processing, completed, failed)
router.get('/jobs/:id/status', apiControllers.getJobStatus);
router.get('/jobs/:id', apiControllers.getJobStatus); // Shorthand

// 3. Granular Analysis Results API
router.get('/jobs/:id/results', apiControllers.getJobResults);

// 4. Jobs List API
router.get('/jobs', apiControllers.listJobs);

// 5. System Analytics Summary API
router.get('/analytics/summary', apiControllers.getAnalyticsSummary);

// 6. Demo & Sample Image Processing API (1-click test for sample 1, 2, 3)
router.post('/demo/process-samples', apiControllers.processSampleImages);

// 7. Media Streaming API
router.get('/media/:filename', apiControllers.serveMedia);

export default router;

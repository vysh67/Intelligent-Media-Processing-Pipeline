import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { initDatabase } from './db/database.js';
import apiRoutes from './api/routes.js';
import { logger } from './utils/logger.js';
import { jobQueue } from './queue/jobQueue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

// Initialize Express application
const app = express();

// Ensure all essential storage directories exist
[config.STORAGE_DIR, config.UPLOADS_DIR, config.PROCESSED_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Initialize database schema
initDatabase();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Serve static frontend assets for web dashboard
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// Request logging middleware
app.use((req, res, next) => {
  const start = performance.now();
  res.on('finish', () => {
    const duration = (performance.now() - start).toFixed(1);
    if (!req.path.startsWith('/public') && !req.path.endsWith('.css') && !req.path.endsWith('.js') && !req.path.endsWith('.ico')) {
      logger.info(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// API Routes
app.use('/api/v1', apiRoutes);

// Health Check API
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'HEALTHY',
    service: 'gogig-media-processing-pipeline',
    uptime_seconds: process.uptime(),
    timestamp: new Date().toISOString(),
    queue: jobQueue.getStats()
  });
});

// Root fallback to dashboard
app.get('/', (req, res) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({
      service: 'gOGig Intelligent Media Processing Pipeline API',
      status: 'ONLINE',
      docs: '/api/v1/health',
      endpoints: {
        upload: 'POST /api/v1/upload',
        status: 'GET /api/v1/jobs/:id/status',
        results: 'GET /api/v1/jobs/:id/results',
        list_jobs: 'GET /api/v1/jobs',
        analytics: 'GET /api/v1/analytics/summary',
        process_samples: 'POST /api/v1/demo/process-samples'
      }
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled server error:', err.stack || err.message);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start HTTP server only if executed directly (not when imported in test suites)
const isDirectRun = process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server'));

let server = null;
if (isDirectRun) {
  server = app.listen(config.PORT, config.HOST, () => {
    logger.success(`=======================================================`);
    logger.success(`  gOGig Intelligent Media Processing Pipeline Online!  `);
    logger.success(`  API Server:  http://localhost:${config.PORT}              `);
    logger.success(`  Dashboard:   http://localhost:${config.PORT}              `);
    logger.success(`  Health:      http://localhost:${config.PORT}/health        `);
    logger.success(`=======================================================`);
  });
}

// Graceful shutdown handling
const shutdown = () => {
  logger.warn('Shutting down server gracefully...');
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;

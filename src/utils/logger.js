export const logger = {
  info: (msg, meta = '') => {
    console.log(`\x1b[36m[INFO]\x1b[0m \x1b[90m${new Date().toISOString()}\x1b[0m ${msg}`, meta ? meta : '');
  },
  warn: (msg, meta = '') => {
    console.warn(`\x1b[33m[WARN]\x1b[0m \x1b[90m${new Date().toISOString()}\x1b[0m ${msg}`, meta ? meta : '');
  },
  error: (msg, meta = '') => {
    console.error(`\x1b[31m[ERROR]\x1b[0m \x1b[90m${new Date().toISOString()}\x1b[0m ${msg}`, meta ? meta : '');
  },
  success: (msg, meta = '') => {
    console.log(`\x1b[32m[SUCCESS]\x1b[0m \x1b[90m${new Date().toISOString()}\x1b[0m ${msg}`, meta ? meta : '');
  },
  debug: (msg, meta = '') => {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.log(`\x1b[35m[DEBUG]\x1b[0m \x1b[90m${new Date().toISOString()}\x1b[0m ${msg}`, meta ? meta : '');
    }
  },
  perf: (label, durationMs) => {
    console.log(`\x1b[34m[PERF]\x1b[0m \x1b[90m${new Date().toISOString()}\x1b[0m ${label} completed in \x1b[1m${durationMs.toFixed(2)}ms\x1b[0m`);
  }
};

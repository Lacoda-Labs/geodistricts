/**
 * Logger utility with log levels
 * Supports: DEBUG, INFO, WARN, ERROR
 * Default level: INFO (production), DEBUG (development)
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// Get log level from environment or default to INFO for production, DEBUG for development
const getLogLevel = () => {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  if (envLevel && LOG_LEVELS.hasOwnProperty(envLevel)) {
    return LOG_LEVELS[envLevel];
  }
  // Default: INFO for production, DEBUG for development
  return process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG;
};

const currentLogLevel = getLogLevel();

const logger = {
  debug: (...args) => {
    if (currentLogLevel <= LOG_LEVELS.DEBUG) {
      console.log(...args);
    }
  },
  
  info: (...args) => {
    if (currentLogLevel <= LOG_LEVELS.INFO) {
      console.log(...args);
    }
  },
  
  warn: (...args) => {
    if (currentLogLevel <= LOG_LEVELS.WARN) {
      console.warn(...args);
    }
  },
  
  error: (...args) => {
    if (currentLogLevel <= LOG_LEVELS.ERROR) {
      console.error(...args);
    }
  },
  
  // Helper to check if a level is enabled
  isDebugEnabled: () => currentLogLevel <= LOG_LEVELS.DEBUG,
  isInfoEnabled: () => currentLogLevel <= LOG_LEVELS.INFO,
  isWarnEnabled: () => currentLogLevel <= LOG_LEVELS.WARN,
  isErrorEnabled: () => currentLogLevel <= LOG_LEVELS.ERROR
};

module.exports = logger;


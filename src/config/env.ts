// src/config/env.ts - ENHANCED ENVIRONMENT CONFIGURATION WITH VALIDATION
import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ===============================================
// ENHANCED ENVIRONMENT SCHEMA
// ===============================================

const envSchema = z.object({
  // Core Application Settings
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform((val) => {
    const num = Number(val);
    if (isNaN(num) || num < 1 || num > 65535) {
      throw new Error('PORT must be a valid port number (1-65535)');
    }
    return num;
  }).default('3000'),
  
  // WhatsApp Configuration (Required)
  WHATSAPP_TOKEN: z.string().min(50, 'WhatsApp token must be at least 50 characters'),
  PHONE_NUMBER_ID: z.string().min(10, 'Phone number ID must be at least 10 characters'),
  VERIFY_TOKEN: z.string().min(8, 'Verify token must be at least 8 characters'),
  
  // Database Configuration (Required)
  DATABASE_URL: z.string()
    .url('Must be a valid database URL')
    .refine((url) => {
      // Validate database URL format
      const validProtocols = ['postgres://', 'postgresql://', 'mysql://', 'sqlite://'];
      return validProtocols.some(protocol => url.startsWith(protocol));
    }, 'Database URL must use a supported protocol (postgres, mysql, sqlite)'),
  
  // Logging Configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  // Server Optimization Settings (Optional)
  ENABLE_QUEUE_SCHEDULER: z.string()
    .optional()
    .transform((val) => val !== 'false')
    .default('true'),
  
  RATE_LIMIT_MAX: z.string()
    .transform((val) => {
      const num = Number(val);
      return isNaN(num) ? (process.env.NODE_ENV === 'production' ? 60 : 100) : num;
    })
    .default('100'),
  
  RATE_LIMIT_WINDOW: z.string()
    .transform((val) => {
      const num = Number(val);
      return isNaN(num) ? 60000 : num; // Default 1 minute
    })
    .default('60000'),
  
  // CORS Configuration (Optional)
  ALLOWED_ORIGINS: z.string()
    .optional()
    .transform((val) => val ? val.split(',').map(origin => origin.trim()) : [])
    .default(''),
  
  // Security Settings (Optional)
  ENABLE_HELMET: z.string()
    .optional()
    .transform((val) => val !== 'false')
    .default('true'),
  
  REQUEST_SIZE_LIMIT: z.string()
    .default('5mb')
    .refine((val) => {
      // Validate size format (e.g., '5mb', '10kb')
      return /^\d+[kmg]?b$/i.test(val);
    }, 'Request size limit must be in format like "5mb", "10kb", etc.'),
  
  // Database Pool Settings (Optional)
  DB_POOL_MIN: z.string()
    .transform((val) => Number(val) || 2)
    .default('2'),
  
  DB_POOL_MAX: z.string()
    .transform((val) => Number(val) || 10)
    .default('10'),
  
  DB_CONNECTION_TIMEOUT: z.string()
    .transform((val) => Number(val) || 10000)
    .default('10000'),
  
  // Monitoring & Health Check Settings (Optional)
  HEALTH_CHECK_TIMEOUT: z.string()
    .transform((val) => Number(val) || 5000)
    .default('5000'),
  
  ENABLE_REQUEST_LOGGING: z.string()
    .optional()
    .transform((val) => val !== 'false')
    .default('true'),
  
  // Background Job Settings (Optional)
  QUEUE_PROCESS_INTERVAL: z.string()
    .transform((val) => Number(val) || 30000)
    .default('30000'),
  
  CLEANUP_INTERVAL: z.string()
    .transform((val) => Number(val) || 300000) // 5 minutes
    .default('300000'),
  
  // Performance Settings (Optional)
  ENABLE_COMPRESSION: z.string()
    .optional()
    .transform((val) => val !== 'false')
    .default('true'),
  
  TRUST_PROXY: z.string()
    .optional()
    .transform((val) => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      const num = Number(val);
      return isNaN(num) ? false : num;
    })
    .default('false')
});

// ===============================================
// ENVIRONMENT VALIDATION & EXPORT
// ===============================================

let env: z.infer<typeof envSchema>;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  console.error('🔴 Environment validation failed:');
  
  if (error instanceof z.ZodError) {
    error.errors.forEach((err) => {
      console.error(`  ❌ ${err.path.join('.')}: ${err.message}`);
    });
  } else {
    console.error('  ❌ Unknown validation error:', error);
  }
  
  console.error('\n💡 Please check your .env file and ensure all required variables are set correctly.');
  process.exit(1);
}

// ===============================================
// ENVIRONMENT VALIDATION REPORT
// ===============================================

export const validateEnvironment = () => {
  const report = {
    isValid: true,
    environment: env.NODE_ENV,
    warnings: [] as string[],
    recommendations: [] as string[]
  };

  // Production environment checks
  if (env.NODE_ENV === 'production') {
    if (!env.ALLOWED_ORIGINS.length) {
      report.warnings.push('ALLOWED_ORIGINS not set - CORS will block all origins');
      report.recommendations.push('Set ALLOWED_ORIGINS to your production domain(s)');
    }
    
    if (env.RATE_LIMIT_MAX > 100) {
      report.warnings.push('Rate limit is quite high for production');
      report.recommendations.push('Consider lowering RATE_LIMIT_MAX for better security');
    }
    
    if (env.LOG_LEVEL === 'debug') {
      report.warnings.push('Debug logging enabled in production');
      report.recommendations.push('Set LOG_LEVEL to "info" or "warn" in production');
    }
  }

  // Development environment checks
  if (env.NODE_ENV === 'development') {
    if (env.RATE_LIMIT_MAX < 50) {
      report.warnings.push('Rate limit might be too restrictive for development');
      report.recommendations.push('Consider increasing RATE_LIMIT_MAX for easier development');
    }
  }

  // General recommendations
  if (env.REQUEST_SIZE_LIMIT === '10mb') {
    report.recommendations.push('Consider if 10mb request limit is necessary - smaller limits improve security');
  }

  return report;
};

// ===============================================
// CONFIGURATION HELPERS
// ===============================================

export const getDatabaseConfig = () => ({
  url: env.DATABASE_URL,
  pool: {
    min: env.DB_POOL_MIN,
    max: env.DB_POOL_MAX
  },
  connectionTimeout: env.DB_CONNECTION_TIMEOUT
});

export const getSecurityConfig = () => ({
  helmet: env.ENABLE_HELMET,
  cors: {
    origins: env.ALLOWED_ORIGINS,
    credentials: true
  },
  rateLimit: {
    max: env.RATE_LIMIT_MAX,
    window: env.RATE_LIMIT_WINDOW
  },
  requestSizeLimit: env.REQUEST_SIZE_LIMIT,
  trustProxy: env.TRUST_PROXY
});

export const getPerformanceConfig = () => ({
  compression: env.ENABLE_COMPRESSION,
  requestLogging: env.ENABLE_REQUEST_LOGGING,
  healthCheckTimeout: env.HEALTH_CHECK_TIMEOUT,
  cleanupInterval: env.CLEANUP_INTERVAL
});

export const getWhatsAppConfig = () => ({
  token: env.WHATSAPP_TOKEN,
  phoneNumberId: env.PHONE_NUMBER_ID,
  verifyToken: env.VERIFY_TOKEN
});

export const getBackgroundJobConfig = () => ({
  enabled: env.ENABLE_QUEUE_SCHEDULER,
  processInterval: env.QUEUE_PROCESS_INTERVAL,
  cleanupInterval: env.CLEANUP_INTERVAL
});

// ===============================================
// CONFIGURATION SUMMARY
// ===============================================

export const getConfigSummary = () => {
  const summary = {
    environment: env.NODE_ENV,
    port: env.PORT,
    security: {
      helmet: env.ENABLE_HELMET,
      corsOrigins: env.ALLOWED_ORIGINS.length || 'all',
      rateLimit: `${env.RATE_LIMIT_MAX} req/${env.RATE_LIMIT_WINDOW}ms`,
      requestLimit: env.REQUEST_SIZE_LIMIT
    },
    database: {
      connected: !!env.DATABASE_URL,
      poolSize: `${env.DB_POOL_MIN}-${env.DB_POOL_MAX}`,
      timeout: `${env.DB_CONNECTION_TIMEOUT}ms`
    },
    features: {
      queueScheduler: env.ENABLE_QUEUE_SCHEDULER,
      requestLogging: env.ENABLE_REQUEST_LOGGING,
      compression: env.ENABLE_COMPRESSION
    },
    logging: {
      level: env.LOG_LEVEL
    }
  };

  return summary;
};

// ===============================================
// EXPORT ENVIRONMENT
// ===============================================

export { env };

// ===============================================
// STARTUP ENVIRONMENT CHECK
// ===============================================

// Run validation check on import
if (process.env.NODE_ENV !== 'test') {
  const validation = validateEnvironment();
  
  if (validation.warnings.length > 0) {
    console.warn('⚠️ Environment Warnings:');
    validation.warnings.forEach(warning => console.warn(`  ⚠️ ${warning}`));
    console.warn('');
  }
  
  if (validation.recommendations.length > 0) {
    console.info('💡 Recommendations:');
    validation.recommendations.forEach(rec => console.info(`  💡 ${rec}`));
    console.info('');
  }
  
  console.info('✅ Environment configuration loaded successfully');
  console.info(`📊 Running in ${env.NODE_ENV} mode on port ${env.PORT}`);
}
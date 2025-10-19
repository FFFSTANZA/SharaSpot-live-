"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = exports.getConfigSummary = exports.getBackgroundJobConfig = exports.getWhatsAppConfig = exports.getPerformanceConfig = exports.getSecurityConfig = exports.getDatabaseConfig = exports.validateEnvironment = void 0;
const zod_1 = require("zod");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    PORT: zod_1.z.string().transform((val) => {
        const num = Number(val);
        if (isNaN(num) || num < 1 || num > 65535) {
            throw new Error('PORT must be a valid port number (1-65535)');
        }
        return num;
    }).default('3000'),
    WHATSAPP_TOKEN: zod_1.z.string().min(50, 'WhatsApp token must be at least 50 characters'),
    PHONE_NUMBER_ID: zod_1.z.string().min(10, 'Phone number ID must be at least 10 characters'),
    VERIFY_TOKEN: zod_1.z.string().min(8, 'Verify token must be at least 8 characters'),
    DATABASE_URL: zod_1.z.string()
        .url('Must be a valid database URL')
        .refine((url) => {
        const validProtocols = ['postgres://', 'postgresql://', 'mysql://', 'sqlite://'];
        return validProtocols.some(protocol => url.startsWith(protocol));
    }, 'Database URL must use a supported protocol (postgres, mysql, sqlite)'),
    LOG_LEVEL: zod_1.z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    ENABLE_QUEUE_SCHEDULER: zod_1.z.string()
        .optional()
        .transform((val) => val !== 'false')
        .default('true'),
    RATE_LIMIT_MAX: zod_1.z.string()
        .transform((val) => {
        const num = Number(val);
        return isNaN(num) ? (process.env.NODE_ENV === 'production' ? 60 : 100) : num;
    })
        .default('100'),
    RATE_LIMIT_WINDOW: zod_1.z.string()
        .transform((val) => {
        const num = Number(val);
        return isNaN(num) ? 60000 : num;
    })
        .default('60000'),
    ALLOWED_ORIGINS: zod_1.z.string()
        .optional()
        .transform((val) => val ? val.split(',').map(origin => origin.trim()) : [])
        .default(''),
    ENABLE_HELMET: zod_1.z.string()
        .optional()
        .transform((val) => val !== 'false')
        .default('true'),
    REQUEST_SIZE_LIMIT: zod_1.z.string()
        .default('5mb')
        .refine((val) => {
        return /^\d+[kmg]?b$/i.test(val);
    }, 'Request size limit must be in format like "5mb", "10kb", etc.'),
    DB_POOL_MIN: zod_1.z.string()
        .transform((val) => Number(val) || 2)
        .default('2'),
    DB_POOL_MAX: zod_1.z.string()
        .transform((val) => Number(val) || 10)
        .default('10'),
    DB_CONNECTION_TIMEOUT: zod_1.z.string()
        .transform((val) => Number(val) || 10000)
        .default('10000'),
    HEALTH_CHECK_TIMEOUT: zod_1.z.string()
        .transform((val) => Number(val) || 5000)
        .default('5000'),
    ENABLE_REQUEST_LOGGING: zod_1.z.string()
        .optional()
        .transform((val) => val !== 'false')
        .default('true'),
    QUEUE_PROCESS_INTERVAL: zod_1.z.string()
        .transform((val) => Number(val) || 30000)
        .default('30000'),
    CLEANUP_INTERVAL: zod_1.z.string()
        .transform((val) => Number(val) || 300000)
        .default('300000'),
    ENABLE_COMPRESSION: zod_1.z.string()
        .optional()
        .transform((val) => val !== 'false')
        .default('true'),
    TRUST_PROXY: zod_1.z.string()
        .optional()
        .transform((val) => {
        if (val === 'true')
            return true;
        if (val === 'false')
            return false;
        const num = Number(val);
        return isNaN(num) ? false : num;
    })
        .default('false')
});
let env;
try {
    exports.env = env = envSchema.parse(process.env);
}
catch (error) {
    console.error('🔴 Environment validation failed:');
    if (error instanceof zod_1.z.ZodError) {
        error.errors.forEach((err) => {
            console.error(`  ❌ ${err.path.join('.')}: ${err.message}`);
        });
    }
    else {
        console.error('  ❌ Unknown validation error:', error);
    }
    console.error('\n💡 Please check your .env file and ensure all required variables are set correctly.');
    process.exit(1);
}
const validateEnvironment = () => {
    const report = {
        isValid: true,
        environment: env.NODE_ENV,
        warnings: [],
        recommendations: []
    };
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
    if (env.NODE_ENV === 'development') {
        if (env.RATE_LIMIT_MAX < 50) {
            report.warnings.push('Rate limit might be too restrictive for development');
            report.recommendations.push('Consider increasing RATE_LIMIT_MAX for easier development');
        }
    }
    if (env.REQUEST_SIZE_LIMIT === '10mb') {
        report.recommendations.push('Consider if 10mb request limit is necessary - smaller limits improve security');
    }
    return report;
};
exports.validateEnvironment = validateEnvironment;
const getDatabaseConfig = () => ({
    url: env.DATABASE_URL,
    pool: {
        min: env.DB_POOL_MIN,
        max: env.DB_POOL_MAX
    },
    connectionTimeout: env.DB_CONNECTION_TIMEOUT
});
exports.getDatabaseConfig = getDatabaseConfig;
const getSecurityConfig = () => ({
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
exports.getSecurityConfig = getSecurityConfig;
const getPerformanceConfig = () => ({
    compression: env.ENABLE_COMPRESSION,
    requestLogging: env.ENABLE_REQUEST_LOGGING,
    healthCheckTimeout: env.HEALTH_CHECK_TIMEOUT,
    cleanupInterval: env.CLEANUP_INTERVAL
});
exports.getPerformanceConfig = getPerformanceConfig;
const getWhatsAppConfig = () => ({
    token: env.WHATSAPP_TOKEN,
    phoneNumberId: env.PHONE_NUMBER_ID,
    verifyToken: env.VERIFY_TOKEN
});
exports.getWhatsAppConfig = getWhatsAppConfig;
const getBackgroundJobConfig = () => ({
    enabled: env.ENABLE_QUEUE_SCHEDULER,
    processInterval: env.QUEUE_PROCESS_INTERVAL,
    cleanupInterval: env.CLEANUP_INTERVAL
});
exports.getBackgroundJobConfig = getBackgroundJobConfig;
const getConfigSummary = () => {
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
exports.getConfigSummary = getConfigSummary;
if (process.env.NODE_ENV !== 'test') {
    const validation = (0, exports.validateEnvironment)();
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
//# sourceMappingURL=env.js.map
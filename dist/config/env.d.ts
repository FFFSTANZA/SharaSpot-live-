import { z } from 'zod';
declare const envSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "production", "test"]>>;
    PORT: z.ZodDefault<z.ZodEffects<z.ZodString, number, string>>;
    WHATSAPP_TOKEN: z.ZodString;
    PHONE_NUMBER_ID: z.ZodString;
    VERIFY_TOKEN: z.ZodString;
    DATABASE_URL: z.ZodEffects<z.ZodString, string, string>;
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<["error", "warn", "info", "debug"]>>;
    ENABLE_QUEUE_SCHEDULER: z.ZodDefault<z.ZodEffects<z.ZodOptional<z.ZodString>, boolean, string | undefined>>;
    RATE_LIMIT_MAX: z.ZodDefault<z.ZodEffects<z.ZodString, number, string>>;
    RATE_LIMIT_WINDOW: z.ZodDefault<z.ZodEffects<z.ZodString, number, string>>;
    ALLOWED_ORIGINS: z.ZodDefault<z.ZodEffects<z.ZodOptional<z.ZodString>, string[], string | undefined>>;
    ENABLE_HELMET: z.ZodDefault<z.ZodEffects<z.ZodOptional<z.ZodString>, boolean, string | undefined>>;
    REQUEST_SIZE_LIMIT: z.ZodEffects<z.ZodDefault<z.ZodString>, string, string | undefined>;
    DB_POOL_MIN: z.ZodDefault<z.ZodEffects<z.ZodString, number, string>>;
    DB_POOL_MAX: z.ZodDefault<z.ZodEffects<z.ZodString, number, string>>;
    DB_CONNECTION_TIMEOUT: z.ZodDefault<z.ZodEffects<z.ZodString, number, string>>;
    HEALTH_CHECK_TIMEOUT: z.ZodDefault<z.ZodEffects<z.ZodString, number, string>>;
    ENABLE_REQUEST_LOGGING: z.ZodDefault<z.ZodEffects<z.ZodOptional<z.ZodString>, boolean, string | undefined>>;
    QUEUE_PROCESS_INTERVAL: z.ZodDefault<z.ZodEffects<z.ZodString, number, string>>;
    CLEANUP_INTERVAL: z.ZodDefault<z.ZodEffects<z.ZodString, number, string>>;
    ENABLE_COMPRESSION: z.ZodDefault<z.ZodEffects<z.ZodOptional<z.ZodString>, boolean, string | undefined>>;
    TRUST_PROXY: z.ZodDefault<z.ZodEffects<z.ZodOptional<z.ZodString>, number | boolean, string | undefined>>;
}, "strip", z.ZodTypeAny, {
    NODE_ENV: "development" | "production" | "test";
    PORT: number;
    WHATSAPP_TOKEN: string;
    PHONE_NUMBER_ID: string;
    VERIFY_TOKEN: string;
    DATABASE_URL: string;
    LOG_LEVEL: "error" | "warn" | "info" | "debug";
    ENABLE_QUEUE_SCHEDULER: boolean;
    RATE_LIMIT_MAX: number;
    RATE_LIMIT_WINDOW: number;
    ALLOWED_ORIGINS: string[];
    ENABLE_HELMET: boolean;
    REQUEST_SIZE_LIMIT: string;
    DB_POOL_MIN: number;
    DB_POOL_MAX: number;
    DB_CONNECTION_TIMEOUT: number;
    HEALTH_CHECK_TIMEOUT: number;
    ENABLE_REQUEST_LOGGING: boolean;
    QUEUE_PROCESS_INTERVAL: number;
    CLEANUP_INTERVAL: number;
    ENABLE_COMPRESSION: boolean;
    TRUST_PROXY: number | boolean;
}, {
    WHATSAPP_TOKEN: string;
    PHONE_NUMBER_ID: string;
    VERIFY_TOKEN: string;
    DATABASE_URL: string;
    NODE_ENV?: "development" | "production" | "test" | undefined;
    PORT?: string | undefined;
    LOG_LEVEL?: "error" | "warn" | "info" | "debug" | undefined;
    ENABLE_QUEUE_SCHEDULER?: string | undefined;
    RATE_LIMIT_MAX?: string | undefined;
    RATE_LIMIT_WINDOW?: string | undefined;
    ALLOWED_ORIGINS?: string | undefined;
    ENABLE_HELMET?: string | undefined;
    REQUEST_SIZE_LIMIT?: string | undefined;
    DB_POOL_MIN?: string | undefined;
    DB_POOL_MAX?: string | undefined;
    DB_CONNECTION_TIMEOUT?: string | undefined;
    HEALTH_CHECK_TIMEOUT?: string | undefined;
    ENABLE_REQUEST_LOGGING?: string | undefined;
    QUEUE_PROCESS_INTERVAL?: string | undefined;
    CLEANUP_INTERVAL?: string | undefined;
    ENABLE_COMPRESSION?: string | undefined;
    TRUST_PROXY?: string | undefined;
}>;
declare let env: z.infer<typeof envSchema>;
export declare const validateEnvironment: () => {
    isValid: boolean;
    environment: "development" | "production" | "test";
    warnings: string[];
    recommendations: string[];
};
export declare const getDatabaseConfig: () => {
    url: string;
    pool: {
        min: number;
        max: number;
    };
    connectionTimeout: number;
};
export declare const getSecurityConfig: () => {
    helmet: boolean;
    cors: {
        origins: string[];
        credentials: boolean;
    };
    rateLimit: {
        max: number;
        window: number;
    };
    requestSizeLimit: string;
    trustProxy: number | boolean;
};
export declare const getPerformanceConfig: () => {
    compression: boolean;
    requestLogging: boolean;
    healthCheckTimeout: number;
    cleanupInterval: number;
};
export declare const getWhatsAppConfig: () => {
    token: string;
    phoneNumberId: string;
    verifyToken: string;
};
export declare const getBackgroundJobConfig: () => {
    enabled: boolean;
    processInterval: number;
    cleanupInterval: number;
};
export declare const getConfigSummary: () => {
    environment: "development" | "production" | "test";
    port: number;
    security: {
        helmet: boolean;
        corsOrigins: string | number;
        rateLimit: string;
        requestLimit: string;
    };
    database: {
        connected: boolean;
        poolSize: string;
        timeout: string;
    };
    features: {
        queueScheduler: boolean;
        requestLogging: boolean;
        compression: boolean;
    };
    logging: {
        level: "error" | "warn" | "info" | "debug";
    };
};
export { env };
//# sourceMappingURL=env.d.ts.map
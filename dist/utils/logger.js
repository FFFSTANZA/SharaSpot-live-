"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const env_1 = require("../config/env");
const logFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    const logMessage = stack || message;
    return `${timestamp} [${level.toUpperCase()}]: ${logMessage} ${metaStr}`;
}));
exports.logger = winston_1.default.createLogger({
    level: env_1.env.LOG_LEVEL,
    format: logFormat,
    defaultMeta: { service: 'sharaspot-bot' },
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())
        }),
        ...(env_1.env.NODE_ENV !== 'production' ? [
            new winston_1.default.transports.File({
                filename: 'logs/error.log',
                level: 'error',
                maxsize: 5242880,
                maxFiles: 5,
            }),
            new winston_1.default.transports.File({
                filename: 'logs/combined.log',
                maxsize: 5242880,
                maxFiles: 5,
            })
        ] : [])
    ],
});
if (env_1.env.NODE_ENV === 'production') {
    exports.logger.info('🚀 Logger initialized for production (console output only)');
}
//# sourceMappingURL=logger.js.map
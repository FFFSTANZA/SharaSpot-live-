"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sql = exports.db = void 0;
exports.testDatabaseConnection = testDatabaseConnection;
exports.initializeDatabase = initializeDatabase;
const neon_http_1 = require("drizzle-orm/neon-http");
const serverless_1 = require("@neondatabase/serverless");
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
const schema = __importStar(require("./schema"));
const sql = (0, serverless_1.neon)(env_1.env.DATABASE_URL);
exports.sql = sql;
exports.db = (0, neon_http_1.drizzle)(sql, { schema });
async function testDatabaseConnection() {
    try {
        await sql `SELECT 1 as test`;
        logger_1.logger.info('✅ Database connection successful');
        return true;
    }
    catch (error) {
        logger_1.logger.error('❌ Database connection failed', { error });
        return false;
    }
}
async function initializeDatabase() {
    try {
        logger_1.logger.info('🔄 Initializing database connection...');
        const isConnected = await testDatabaseConnection();
        if (!isConnected) {
            throw new Error('Failed to connect to database');
        }
        logger_1.logger.info('🎉 Database initialized successfully');
    }
    catch (error) {
        logger_1.logger.error('💥 Database initialization failed', { error });
        throw error;
    }
}
//# sourceMappingURL=connection.js.map
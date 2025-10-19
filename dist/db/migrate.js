"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const migrator_1 = require("drizzle-orm/neon-http/migrator");
const database_1 = require("../config/database");
const logger_1 = require("../utils/logger");
async function runMigrations() {
    try {
        logger_1.logger.info('🔄 Starting database migrations...');
        await (0, migrator_1.migrate)(database_1.db, { migrationsFolder: './migrations' });
        logger_1.logger.info('✅ Database migrations completed successfully');
        process.exit(0);
    }
    catch (error) {
        logger_1.logger.error('❌ Migration failed:', error);
        process.exit(1);
    }
}
if (require.main === module) {
    runMigrations();
}
//# sourceMappingURL=migrate.js.map
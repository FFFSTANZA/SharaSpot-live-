import { migrate } from 'drizzle-orm/neon-http/migrator';
import { db } from '../config/database';
import { logger } from '../utils/logger';

async function runMigrations() {
  try {
    logger.info('🔄 Starting database migrations...');
    await migrate(db, { migrationsFolder: './migrations' });
    logger.info('✅ Database migrations completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runMigrations();
}

export { runMigrations };

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import * as schema from './schema';


const sql = neon(env.DATABASE_URL);


export const db = drizzle(sql, { schema });


export async function testDatabaseConnection(): Promise<boolean> {
  try {
    
    await sql`SELECT 1 as test`;
    logger.info('✅ Database connection successful');
    return true;
  } catch (error) {
    logger.error('❌ Database connection failed', { error });
    return false;
  }
}


export async function initializeDatabase(): Promise<void> {
  try {
    logger.info('🔄 Initializing database connection...');
    
    const isConnected = await testDatabaseConnection();
    
    if (!isConnected) {
      throw new Error('Failed to connect to database');
    }
    
    logger.info('🎉 Database initialized successfully');
  } catch (error) {
    logger.error('💥 Database initialization failed', { error });
    throw error;
  }
}


export { sql };
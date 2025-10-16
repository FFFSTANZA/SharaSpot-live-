// src/scripts/check-database.ts - Check actual database structure
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql);

async function checkDatabaseStructure() {
  try {
    logger.info('🔍 Checking actual database structure...');

    // 1. Check if station_owners table exists and its structure
    logger.info('\n📋 1. Checking station_owners table structure:');
    
    const stationOwnersColumns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'station_owners' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;

    if (stationOwnersColumns.length === 0) {
      logger.error('❌ station_owners table does not exist!');
    } else {
      logger.info('✅ station_owners table found with columns:');
      stationOwnersColumns.forEach((col: any) => {
        logger.info(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : '(NULLABLE)'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
      });
    }

    // 2. Check if users table exists
    logger.info('\n📋 2. Checking users table structure:');
    
    const usersColumns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;

    if (usersColumns.length === 0) {
      logger.error('❌ users table does not exist!');
    } else {
      logger.info('✅ users table found with columns:');
      usersColumns.forEach((col: any) => {
        logger.info(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : '(NULLABLE)'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
      });
    }

    // 3. Check charging_stations table
    logger.info('\n📋 3. Checking charging_stations table structure:');
    
    const stationsColumns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'charging_stations' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;

    if (stationsColumns.length === 0) {
      logger.error('❌ charging_stations table does not exist!');
    } else {
      logger.info('✅ charging_stations table found with columns:');
      stationsColumns.forEach((col: any) => {
        logger.info(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : '(NULLABLE)'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
      });
    }

    // 4. List all tables in the database
    logger.info('\n📋 4. All tables in the database:');
    
    const allTables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;

    allTables.forEach((table: any) => {
      logger.info(`   - ${table.table_name}`);
    });

    // 5. Try a simple insert test to see what's happening
    logger.info('\n🧪 5. Testing simple insert into station_owners:');
    
    try {
      // First, let's try to insert with only the columns we know exist
      const testInsert = await sql`
        INSERT INTO station_owners (whatsapp_id, name) 
        VALUES ('test123', 'Test Owner') 
        ON CONFLICT (whatsapp_id) DO NOTHING
        RETURNING *;
      `;
      
      if (testInsert.length > 0) {
        logger.info('✅ Simple insert successful! Columns that work:');
        Object.keys(testInsert[0]).forEach(key => {
          logger.info(`   - ${key}: ${testInsert[0][key]}`);
        });
        
        // Clean up test data
        await sql`DELETE FROM station_owners WHERE whatsapp_id = 'test123';`;
      } else {
        logger.info('ℹ️ Insert was ignored (ON CONFLICT)');
      }
      
    } catch (insertError) {
      logger.error('❌ Simple insert failed:', insertError);
    }

    logger.info('\n🎯 Summary:');
    logger.info('Database structure check completed. Check the logs above for details.');

  } catch (error) {
    logger.error('💥 Database structure check failed:', error);
    throw error;
  }
}

// Run if this file is executed directly
if (require.main === module) {
  checkDatabaseStructure()
    .then(() => {
      logger.info('👍 Database check completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('👎 Database check failed:', error);
      process.exit(1);
    });
}

export { checkDatabaseStructure };
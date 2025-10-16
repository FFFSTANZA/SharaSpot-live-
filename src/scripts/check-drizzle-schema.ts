// src/scripts/check-drizzle-schema.ts - Check what Drizzle thinks the schema is
import { logger } from '../utils/logger';
import { stationOwners, users, chargingStations } from '../db/schema';
import { eq } from 'drizzle-orm'; // Import the eq function

function checkDrizzleSchema() {
  try {
    logger.info('🔍 Checking Drizzle schema definitions...');

    // Check station_owners schema from Drizzle
    logger.info('\n📋 1. Drizzle stationOwners schema:');
    
    // Get the table configuration
    const stationOwnersConfig = (stationOwners as any)[Symbol.for('drizzle:Table')];
    const stationOwnersColumns = stationOwnersConfig?.columns || {};
    
    Object.keys(stationOwnersColumns).forEach(columnKey => {
      const column = stationOwnersColumns[columnKey];
      logger.info(`   - ${columnKey} (${column.name}): ${column.dataType} ${column.notNull ? 'NOT NULL' : 'NULLABLE'}`);
    });

    // Check users schema from Drizzle
    logger.info('\n📋 2. Drizzle users schema:');
    
    const usersConfig = (users as any)[Symbol.for('drizzle:Table')];
    const usersColumns = usersConfig?.columns || {};
    
    Object.keys(usersColumns).forEach(columnKey => {
      const column = usersColumns[columnKey];
      logger.info(`   - ${columnKey} (${column.name}): ${column.dataType} ${column.notNull ? 'NOT NULL' : 'NULLABLE'}`);
    });

    // Check charging_stations schema from Drizzle
    logger.info('\n📋 3. Drizzle chargingStations schema:');
    
    const stationsConfig = (chargingStations as any)[Symbol.for('drizzle:Table')];
    const stationsColumns = stationsConfig?.columns || {};
    
    Object.keys(stationsColumns).forEach(columnKey => {
      const column = stationsColumns[columnKey];
      logger.info(`   - ${columnKey} (${column.name}): ${column.dataType} ${column.notNull ? 'NOT NULL' : 'NULLABLE'}`);
    });

    // Check what Drizzle thinks the table names are
    logger.info('\n📋 4. Drizzle table names:');
    logger.info(`   - stationOwners table name: ${stationOwnersConfig?.name}`);
    logger.info(`   - users table name: ${usersConfig?.name}`);
    logger.info(`   - chargingStations table name: ${stationsConfig?.name}`);

    // Show expected SQL for station_owners insert
    logger.info('\n📋 5. What Drizzle expects for station_owners insert:');
    logger.info('   Expected columns for insert:');
    Object.keys(stationOwnersColumns).forEach(columnKey => {
      const column = stationOwnersColumns[columnKey];
      if (!column.generated) {
        logger.info(`   - ${column.name}`);
      }
    });

  } catch (error) {
    logger.error('❌ Failed to check Drizzle schema:', error);
  }
}

// Also create a simple manual test
async function testManualInsert() {
  try {
    logger.info('\n🧪 Testing manual insert with minimal data...');
    
    const { db } = await import('../config/database');
    
    // Try a very simple insert with just the basic columns
    const simpleOwner = {
      whatsappId: 'test_manual_123',
      name: 'Test Manual Owner'
    };

    logger.info('Attempting insert with data:', simpleOwner);
    
    const result = await db.insert(stationOwners).values(simpleOwner).onConflictDoNothing().returning();
    
    if (result.length > 0) {
      logger.info('✅ Manual insert successful:', result[0]);
      
      // Clean up - FIXED: Use eq() function for comparison
      await db.delete(stationOwners).where(eq(stationOwners.whatsappId, 'test_manual_123'));
      logger.info('✅ Test data cleaned up');
    } else {
      logger.info('ℹ️ Insert was ignored (conflict)');
    }

  } catch (error) {
    logger.error('❌ Manual insert test failed:', error);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  checkDrizzleSchema();
  testManualInsert()
    .then(() => {
      logger.info('👍 Schema check completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('👎 Schema check failed:', error);
      process.exit(1);
    });
}

export { checkDrizzleSchema, testManualInsert };
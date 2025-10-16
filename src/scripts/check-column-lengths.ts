// src/scripts/check-column-lengths.ts
import { db } from '../config/database';
import { logger } from '../utils/logger';

interface ColumnInfo {
  column_name: string;
  data_type: string;
  character_maximum_length: number | null;
  is_nullable: string;
  column_default: string | null;
}

// Helper function to safely cast rows to ColumnInfo[]
function toColumnInfoArray(rows: any[]): ColumnInfo[] {
  return rows.map(row => ({
    column_name: String(row.column_name || ''),
    data_type: String(row.data_type || ''),
    character_maximum_length: row.character_maximum_length !== null && row.character_maximum_length !== undefined 
      ? Number(row.character_maximum_length) 
      : null,
    is_nullable: String(row.is_nullable || ''),
    column_default: row.column_default !== null && row.column_default !== undefined 
      ? String(row.column_default) 
      : null
  }));
}

async function checkAndFixColumnLengths() {
  try {
    logger.info('🔍 Checking column lengths for station_owners...');

    // Check current column lengths
    const columnInfo = await db.execute(`
      SELECT 
        column_name, 
        data_type, 
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'station_owners' 
      AND data_type = 'character varying'
      ORDER BY ordinal_position;
    `);
    
    logger.info('Current VARCHAR column lengths:', { columns: columnInfo.rows });

    // Safely convert rows to ColumnInfo[]
    const columnInfos = toColumnInfoArray(columnInfo.rows);

    // Check for columns that might be too short
    const problematicColumns = columnInfos.filter(col => 
      col.character_maximum_length && col.character_maximum_length < 100
    );

    if (problematicColumns.length > 0) {
      logger.info('📏 Found columns with potentially short lengths:', { columns: problematicColumns });
      
      // Fix short columns by extending them
      for (const col of problematicColumns) {
        const columnName = col.column_name;
        logger.info(`🔧 Extending ${columnName} to VARCHAR(255)...`);
        
        try {
          await db.execute(`ALTER TABLE station_owners ALTER COLUMN ${columnName} TYPE VARCHAR(255)`);
          logger.info(`✅ Successfully extended ${columnName} to VARCHAR(255)`);
        } catch (error) {
          logger.error(`❌ Failed to extend ${columnName}:`, error);
        }
      }
    } else {
      logger.info('✅ All VARCHAR columns have adequate lengths');
    }

    // Verify updated lengths
    const updatedColumnInfo = await db.execute(`
      SELECT 
        column_name, 
        data_type, 
        character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = 'station_owners' 
      AND data_type = 'character varying'
      ORDER BY ordinal_position;
    `);
    
    logger.info('Updated column lengths:', { columns: updatedColumnInfo.rows });

    // Test with shorter data first
    logger.info('🧪 Testing insert with shorter test data...');
    const { stationOwners } = await import('../db/schema');
    
    const testResult = await db
      .insert(stationOwners)
      .values({
        whatsappId: 'test_short_' + Date.now().toString().slice(-6), // Shorter ID
        name: 'Test Owner',
      })
      .onConflictDoNothing()
      .returning();

    logger.info('✅ Test insert successful!', { result: testResult });
    logger.info('🎉 Column length fix completed successfully!');

  } catch (error) {
    logger.error('❌ Failed to check/fix column lengths:', error);
    throw error;
  }
}

if (require.main === module) {
  checkAndFixColumnLengths()
    .then(() => {
      logger.info('👍 Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 Script failed:', error);
      process.exit(1);
    });
}
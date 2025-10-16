-- ====================================
-- SHARASPOT DATABASE COMPREHENSIVE FIX
-- ====================================

-- Step 1: Add missing columns to queues table
DO $$ 
BEGIN
    -- Add reservation_expiry if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'queues' AND column_name = 'reservation_expiry') THEN
        ALTER TABLE queues ADD COLUMN reservation_expiry TIMESTAMP;
        RAISE NOTICE 'Added reservation_expiry column to queues table';
    ELSE
        RAISE NOTICE 'reservation_expiry column already exists';
    END IF;

    -- Add reminder_sent if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'queues' AND column_name = 'reminder_sent') THEN
        ALTER TABLE queues ADD COLUMN reminder_sent BOOLEAN DEFAULT false;
        RAISE NOTICE 'Added reminder_sent column to queues table';
    ELSE
        RAISE NOTICE 'reminder_sent column already exists';
    END IF;

    -- Add estimated_wait_minutes if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'queues' AND column_name = 'estimated_wait_minutes') THEN
        ALTER TABLE queues ADD COLUMN estimated_wait_minutes INTEGER;
        RAISE NOTICE 'Added estimated_wait_minutes column to queues table';
    ELSE
        RAISE NOTICE 'estimated_wait_minutes column already exists';
    END IF;
END $$;

-- Step 2: Create indexes for performance (if they don't exist)
CREATE INDEX IF NOT EXISTS queues_expiry_idx ON queues(reservation_expiry);
CREATE INDEX IF NOT EXISTS queues_reminder_idx ON queues(reminder_sent);
CREATE INDEX IF NOT EXISTS queues_estimated_wait_idx ON queues(estimated_wait_minutes);

-- Step 3: Clean up old data and fix status values
UPDATE queues 
SET status = 'waiting' 
WHERE status = 'reserved' OR status IS NULL OR status = '';

-- Step 4: Remove deprecated columns (optional - uncomment if you want to clean up)
-- ALTER TABLE queues DROP COLUMN IF EXISTS is_reserved;
-- ALTER TABLE queues DROP COLUMN IF EXISTS reserved_at;

-- Step 5: Ensure charging_stations table has required fields
DO $$ 
BEGIN
    -- Add current_queue_length if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'charging_stations' AND column_name = 'current_queue_length') THEN
        ALTER TABLE charging_stations ADD COLUMN current_queue_length INTEGER DEFAULT 0;
        RAISE NOTICE 'Added current_queue_length column to charging_stations';
    END IF;

    -- Add max_queue_length if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'charging_stations' AND column_name = 'max_queue_length') THEN
        ALTER TABLE charging_stations ADD COLUMN max_queue_length INTEGER DEFAULT 10;
        RAISE NOTICE 'Added max_queue_length column to charging_stations';
    END IF;

    -- Add average_session_minutes if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'charging_stations' AND column_name = 'average_session_minutes') THEN
        ALTER TABLE charging_stations ADD COLUMN average_session_minutes INTEGER DEFAULT 30;
        RAISE NOTICE 'Added average_session_minutes column to charging_stations';
    END IF;
END $$;

-- Step 6: Insert sample charging stations for testing
INSERT INTO charging_stations (
    name, address, latitude, longitude, 
    total_ports, available_ports, connector_types, 
    max_power_kw, price_per_kwh, owner_whatsapp_id,
    current_queue_length, max_queue_length, average_session_minutes
) VALUES 
    ('Anna Nagar EV Hub', 'Anna Nagar, Chennai, Tamil Nadu 600040', 13.0878, 80.2086, 6, 4, '["CCS2", "Type2"]', 50, 12.00, '919999999999', 0, 8, 45),
    ('RS Puram Charging Point', 'RS Puram, Coimbatore, Tamil Nadu 641002', 11.0168, 76.9558, 4, 2, '["CCS2", "CHAdeMO"]', 75, 10.50, '919999999999', 1, 6, 40),
    ('Brigade Road Station', 'Brigade Road, Bangalore, Karnataka 560001', 12.9716, 77.5946, 8, 6, '["Type2", "CCS2", "CHAdeMO"]', 60, 11.00, '919999999999', 0, 10, 50),
    ('Phoenix MarketCity Hub', 'Velachery Main Road, Chennai, Tamil Nadu 600042', 12.9752, 80.2167, 10, 7, '["CCS2", "Type2"]', 100, 13.50, '919999999999', 2, 12, 35),
    ('Forum Mall Charging Center', 'Hosur Road, Bangalore, Karnataka 560029', 12.9279, 77.6271, 6, 3, '["CCS2", "Type2", "CHAdeMO"]', 80, 9.75, '919999999999', 1, 8, 42)
ON CONFLICT (name) DO NOTHING;

-- Step 7: Update station availability based on current queues
UPDATE charging_stations 
SET current_queue_length = (
    SELECT COUNT(*) 
    FROM queues 
    WHERE queues.station_id = charging_stations.id 
      AND queues.status IN ('waiting', 'ready')
);

-- Step 8: Test critical queries to ensure they work
DO $$
DECLARE
    test_count INTEGER;
BEGIN
    -- Test queue query that was failing
    SELECT COUNT(*) INTO test_count
    FROM queues 
    WHERE status = 'waiting' 
      AND (reservation_expiry IS NULL OR reservation_expiry > NOW());
    
    RAISE NOTICE 'Test query successful: Found % waiting queue entries', test_count;
    
    -- Test stations query
    SELECT COUNT(*) INTO test_count
    FROM charging_stations 
    WHERE is_active = true AND is_open = true;
    
    RAISE NOTICE 'Test query successful: Found % active stations', test_count;
END $$;

-- Step 9: Verify the fixes worked
SELECT 'VERIFICATION: Queues table structure' as check_type;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'queues' AND table_schema = 'public'
  AND column_name IN ('reservation_expiry', 'reminder_sent', 'estimated_wait_minutes')
ORDER BY column_name;

SELECT 'VERIFICATION: Sample data inserted' as check_type;
SELECT COUNT(*) as station_count FROM charging_stations;

SELECT 'VERIFICATION: Queue status values cleaned' as check_type;
SELECT status, COUNT(*) as count
FROM queues 
GROUP BY status;

-- Success message
SELECT '🎉 DATABASE FIX COMPLETED SUCCESSFULLY! 🎉' as result;
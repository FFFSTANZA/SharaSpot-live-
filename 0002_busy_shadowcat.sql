-- Move these BEFORE creating payments table:
ALTER TABLE "charging_sessions" ADD COLUMN "session_id" varchar(50) NOT NULL;
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_session_id_unique" UNIQUE("session_id");

-- THEN create payments table
CREATE TABLE "payments" (...);
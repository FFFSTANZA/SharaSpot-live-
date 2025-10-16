DROP INDEX "admins_active_idx";--> statement-breakpoint
DROP INDEX "audit_date_idx";--> statement-breakpoint
DROP INDEX "audit_resource_idx";--> statement-breakpoint
DROP INDEX "sessions_date_idx";--> statement-breakpoint
DROP INDEX "sessions_rating_idx";--> statement-breakpoint
DROP INDEX "sessions_ended_at_idx";--> statement-breakpoint
DROP INDEX "geocode_v2_locality_idx";--> statement-breakpoint
DROP INDEX "geocode_v2_location_idx";--> statement-breakpoint
DROP INDEX "notifications_type_idx";--> statement-breakpoint
DROP INDEX "notifications_schedule_idx";--> statement-breakpoint
DROP INDEX "payments_user_idx";--> statement-breakpoint
DROP INDEX "payments_station_idx";--> statement-breakpoint
DROP INDEX "payments_date_idx";--> statement-breakpoint
DROP INDEX "queues_wait_time_idx";--> statement-breakpoint
DROP INDEX "owners_business_idx";--> statement-breakpoint
DROP INDEX "owners_location_idx";--> statement-breakpoint
DROP INDEX "search_history_term_idx";--> statement-breakpoint
DROP INDEX "search_history_date_idx";--> statement-breakpoint
DROP INDEX "search_history_type_idx";--> statement-breakpoint
DROP INDEX "users_name_idx";--> statement-breakpoint
DROP INDEX "users_preferences_idx";--> statement-breakpoint
ALTER TABLE "admins" ALTER COLUMN "permissions" SET DEFAULT '["manage_owners","manage_users","view_analytics"]'::jsonb;--> statement-breakpoint
ALTER TABLE "charging_sessions" ALTER COLUMN "energy_delivered" SET DATA TYPE numeric(10, 3);--> statement-breakpoint
ALTER TABLE "charging_stations" ALTER COLUMN "operating_hours" SET DEFAULT '{"monday":"24/7","tuesday":"24/7","wednesday":"24/7","thursday":"24/7","friday":"24/7","saturday":"24/7","sunday":"24/7"}'::jsonb;--> statement-breakpoint
ALTER TABLE "charging_stations" ALTER COLUMN "amenities" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "station_owners" ALTER COLUMN "permissions" SET DEFAULT '["manage_own_stations"]'::jsonb;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "start_meter_reading" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "end_meter_reading" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "verification_status" varchar(30) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "start_verification_attempts" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "end_verification_attempts" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "manual_entry_used" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "start_reading_confidence" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "end_reading_confidence" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "meter_validated" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "validation_warnings" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
CREATE INDEX "sessions_verification_idx" ON "charging_sessions" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "payments_session_id_idx" ON "payments" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "charging_sessions" DROP COLUMN "energy_consumed";--> statement-breakpoint
ALTER TABLE "charging_sessions" DROP COLUMN "payment_method";--> statement-breakpoint
ALTER TABLE "charging_sessions" DROP COLUMN "transaction_id";--> statement-breakpoint
ALTER TABLE "charging_stations" DROP COLUMN "distance";--> statement-breakpoint
ALTER TABLE "queues" DROP COLUMN "reservation_expiry_alt";
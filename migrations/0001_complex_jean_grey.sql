ALTER TABLE "charging_sessions" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "ended_at" timestamp;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "energy_consumed" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "charging_stations" ADD COLUMN "distance" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "charging_stations" ADD COLUMN "total_slots" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "charging_stations" ADD COLUMN "available_slots" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "charging_stations" ADD COLUMN "price_per_unit" numeric(5, 2) DEFAULT '10.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "charging_stations" ADD COLUMN "rating" numeric(3, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "charging_stations" ADD COLUMN "total_reviews" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "queues" ADD COLUMN "reservation_expiry_alt" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vehicle_type" varchar(50);--> statement-breakpoint
CREATE INDEX "sessions_started_at_idx" ON "charging_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "sessions_ended_at_idx" ON "charging_sessions" USING btree ("ended_at");
CREATE TABLE "admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"whatsapp_id" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"email" varchar(150),
	"role" varchar(30) DEFAULT 'admin' NOT NULL,
	"permissions" jsonb DEFAULT '["manage_owners", "manage_users", "view_analytics"]' NOT NULL,
	"is_active" boolean DEFAULT true,
	"can_access_finance" boolean DEFAULT false,
	"can_modify_stations" boolean DEFAULT false,
	"can_ban_users" boolean DEFAULT false,
	"last_login_at" timestamp,
	"login_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "admins_whatsapp_id_unique" UNIQUE("whatsapp_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_whatsapp_id" varchar(20) NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50),
	"resource_id" varchar(50),
	"old_values" jsonb,
	"new_values" jsonb,
	"metadata" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"endpoint" varchar(200),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "charging_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(50) NOT NULL,
	"station_id" integer NOT NULL,
	"user_whatsapp" varchar(20) NOT NULL,
	"queue_id" integer,
	"status" varchar(20) DEFAULT 'initiated' NOT NULL,
	"start_time" timestamp,
	"end_time" timestamp,
	"duration" integer,
	"connector_used" varchar(20),
	"max_power_used" integer,
	"energy_delivered" numeric(8, 3),
	"peak_power_kw" numeric(6, 2),
	"average_power_kw" numeric(6, 2),
	"total_cost" numeric(10, 2),
	"rate_per_kwh" numeric(5, 2),
	"base_charge" numeric(6, 2) DEFAULT '0',
	"tax_amount" numeric(6, 2) DEFAULT '0',
	"discount_amount" numeric(6, 2) DEFAULT '0',
	"payment_status" varchar(20) DEFAULT 'pending',
	"payment_method" varchar(30),
	"transaction_id" varchar(100),
	"vehicle_model" varchar(100),
	"initial_battery_percent" integer,
	"final_battery_percent" integer,
	"stop_reason" varchar(50),
	"had_issues" boolean DEFAULT false,
	"issue_description" text,
	"customer_rating" integer,
	"customer_feedback" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "charging_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "charging_stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"address" text NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"geohash" varchar(12),
	"total_ports" integer DEFAULT 1 NOT NULL,
	"available_ports" integer DEFAULT 1 NOT NULL,
	"connector_types" jsonb NOT NULL,
	"max_power_kw" integer DEFAULT 50 NOT NULL,
	"price_per_kwh" numeric(5, 2) DEFAULT '10.00' NOT NULL,
	"is_active" boolean DEFAULT true,
	"is_open" boolean DEFAULT true,
	"is_paused" boolean DEFAULT false,
	"maintenance_mode" boolean DEFAULT false,
	"current_queue_length" integer DEFAULT 0,
	"max_queue_length" integer DEFAULT 10,
	"average_session_minutes" integer DEFAULT 30,
	"operating_hours" jsonb DEFAULT '{"monday": "24/7", "tuesday": "24/7", "wednesday": "24/7", "thursday": "24/7", "friday": "24/7", "saturday": "24/7", "sunday": "24/7"}',
	"amenities" jsonb DEFAULT '[]',
	"description" text,
	"owner_whatsapp_id" varchar(20) NOT NULL,
	"contact_number" varchar(20),
	"emergency_contact" varchar(20),
	"total_sessions" integer DEFAULT 0,
	"total_energy_delivered" numeric(12, 3) DEFAULT '0',
	"total_revenue" numeric(12, 2) DEFAULT '0',
	"average_rating" numeric(3, 2) DEFAULT '0',
	"review_count" integer DEFAULT 0,
	"last_maintenance_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "geocode_cache_v2" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_term" text NOT NULL,
	"original_address" text NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"geohash" text NOT NULL,
	"formatted_address" text,
	"locality" text,
	"sub_locality" text,
	"state" text,
	"country" text DEFAULT 'India',
	"postal_code" text,
	"confidence" numeric(3, 2) DEFAULT '1.0',
	"source" varchar(30) DEFAULT 'google',
	"hit_count" integer DEFAULT 1,
	"last_used" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "geocode_cache_v2_search_term_unique" UNIQUE("search_term")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"type" varchar(30) NOT NULL,
	"title" varchar(200) NOT NULL,
	"message" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"channel" varchar(20) DEFAULT 'whatsapp',
	"delivered_at" timestamp,
	"read_at" timestamp,
	"related_id" varchar(50),
	"related_type" varchar(30),
	"metadata" jsonb,
	"scheduled_for" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" varchar(100) NOT NULL,
	"session_id" varchar(50) NOT NULL,
	"user_whatsapp" varchar(20) NOT NULL,
	"station_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'INR',
	"status" varchar(20) DEFAULT 'pending',
	"method" varchar(30),
	"gateway_transaction_id" varchar(100),
	"gateway_response" jsonb,
	"refund_amount" numeric(10, 2) DEFAULT '0',
	"refund_reason" text,
	"refunded_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "payments_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "queues" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" integer NOT NULL,
	"user_whatsapp" varchar(20) NOT NULL,
	"position" integer NOT NULL,
	"status" varchar(20) DEFAULT 'waiting' NOT NULL,
	"estimated_wait_minutes" integer,
	"actual_wait_minutes" integer,
	"reservation_expiry" timestamp,
	"reminder_sent" boolean DEFAULT false,
	"notifications_sent" integer DEFAULT 0,
	"requested_connector_type" varchar(20),
	"requested_max_power" integer,
	"estimated_session_minutes" integer,
	"rate_per_kwh_at_booking" numeric(5, 2),
	"estimated_cost" numeric(8, 2),
	"joined_at" timestamp DEFAULT now(),
	"ready_at" timestamp,
	"expired_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "queues_user_station_active" UNIQUE("user_whatsapp","station_id")
);
--> statement-breakpoint
CREATE TABLE "station_owners" (
	"id" serial PRIMARY KEY NOT NULL,
	"whatsapp_id" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"phone_number" varchar(20),
	"email" varchar(150),
	"business_name" varchar(200),
	"business_type" varchar(50),
	"business_registration_number" varchar(50),
	"gst_number" varchar(20),
	"address" text,
	"city" varchar(100),
	"state" varchar(100),
	"pincode" varchar(10),
	"is_verified" boolean DEFAULT false,
	"kyc_status" varchar(20) DEFAULT 'pending',
	"verification_documents" jsonb,
	"verified_at" timestamp,
	"verified_by" varchar(20),
	"bank_account_number" varchar(30),
	"ifsc_code" varchar(15),
	"account_holder_name" varchar(100),
	"total_stations" integer DEFAULT 0,
	"total_revenue" numeric(12, 2) DEFAULT '0',
	"average_rating" numeric(3, 2) DEFAULT '0',
	"is_active" boolean DEFAULT true,
	"permissions" jsonb DEFAULT '["manage_own_stations"]' NOT NULL,
	"subscription_plan" varchar(30) DEFAULT 'basic',
	"subscription_expiry" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "station_owners_whatsapp_id_unique" UNIQUE("whatsapp_id")
);
--> statement-breakpoint
CREATE TABLE "user_search_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_whatsapp" varchar(20) NOT NULL,
	"search_term" text NOT NULL,
	"search_type" varchar(20) DEFAULT 'address',
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"result_count" integer DEFAULT 0,
	"selected_station_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"whatsapp_id" varchar(20) NOT NULL,
	"name" varchar(100),
	"phone_number" varchar(20),
	"ev_model" varchar(100),
	"connector_type" varchar(20),
	"charging_intent" varchar(50),
	"queue_preference" varchar(30),
	"is_active" boolean DEFAULT true,
	"is_banned" boolean DEFAULT false,
	"preferences_captured" boolean DEFAULT false,
	"profile_picture" text,
	"language" varchar(10) DEFAULT 'en',
	"timezone" varchar(50) DEFAULT 'Asia/Kolkata',
	"notifications_enabled" boolean DEFAULT true,
	"sms_notifications" boolean DEFAULT false,
	"email_notifications" boolean DEFAULT false,
	"email" varchar(150),
	"total_bookings" integer DEFAULT 0,
	"total_sessions" integer DEFAULT 0,
	"total_energy_consumed" numeric(10, 3) DEFAULT '0',
	"last_activity_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_whatsapp_id_unique" UNIQUE("whatsapp_id")
);
--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_station_id_charging_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."charging_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_user_whatsapp_users_whatsapp_id_fk" FOREIGN KEY ("user_whatsapp") REFERENCES "public"."users"("whatsapp_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_whatsapp_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("whatsapp_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_id_charging_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."charging_sessions"("session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_whatsapp_users_whatsapp_id_fk" FOREIGN KEY ("user_whatsapp") REFERENCES "public"."users"("whatsapp_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_station_id_charging_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."charging_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_station_id_charging_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."charging_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_user_whatsapp_users_whatsapp_id_fk" FOREIGN KEY ("user_whatsapp") REFERENCES "public"."users"("whatsapp_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_search_history" ADD CONSTRAINT "user_search_history_user_whatsapp_users_whatsapp_id_fk" FOREIGN KEY ("user_whatsapp") REFERENCES "public"."users"("whatsapp_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admins_whatsapp_id_idx" ON "admins" USING btree ("whatsapp_id");--> statement-breakpoint
CREATE INDEX "admins_role_idx" ON "admins" USING btree ("role");--> statement-breakpoint
CREATE INDEX "admins_active_idx" ON "admins" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actor_whatsapp_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_date_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "charging_sessions" USING btree ("user_whatsapp");--> statement-breakpoint
CREATE INDEX "sessions_station_idx" ON "charging_sessions" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "charging_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_date_idx" ON "charging_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_payment_idx" ON "charging_sessions" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "sessions_rating_idx" ON "charging_sessions" USING btree ("customer_rating");--> statement-breakpoint
CREATE INDEX "stations_location_idx" ON "charging_stations" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "stations_geohash_idx" ON "charging_stations" USING btree ("geohash");--> statement-breakpoint
CREATE INDEX "stations_owner_idx" ON "charging_stations" USING btree ("owner_whatsapp_id");--> statement-breakpoint
CREATE INDEX "stations_active_idx" ON "charging_stations" USING btree ("is_active","is_open");--> statement-breakpoint
CREATE INDEX "stations_availability_idx" ON "charging_stations" USING btree ("available_ports","current_queue_length");--> statement-breakpoint
CREATE INDEX "stations_price_idx" ON "charging_stations" USING btree ("price_per_kwh");--> statement-breakpoint
CREATE INDEX "stations_rating_idx" ON "charging_stations" USING btree ("average_rating");--> statement-breakpoint
CREATE INDEX "geocode_v2_search_term_idx" ON "geocode_cache_v2" USING btree ("search_term");--> statement-breakpoint
CREATE INDEX "geocode_v2_geohash_idx" ON "geocode_cache_v2" USING btree ("geohash");--> statement-breakpoint
CREATE INDEX "geocode_v2_locality_idx" ON "geocode_cache_v2" USING btree ("locality");--> statement-breakpoint
CREATE INDEX "geocode_v2_location_idx" ON "geocode_cache_v2" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_type_idx" ON "notifications" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notifications_schedule_idx" ON "notifications" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_whatsapp");--> statement-breakpoint
CREATE INDEX "payments_station_idx" ON "payments" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_date_idx" ON "payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "queues_station_position_idx" ON "queues" USING btree ("station_id","position");--> statement-breakpoint
CREATE INDEX "queues_status_idx" ON "queues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "queues_expiry_idx" ON "queues" USING btree ("reservation_expiry");--> statement-breakpoint
CREATE INDEX "queues_user_active_idx" ON "queues" USING btree ("user_whatsapp","status");--> statement-breakpoint
CREATE INDEX "queues_wait_time_idx" ON "queues" USING btree ("estimated_wait_minutes");--> statement-breakpoint
CREATE INDEX "owners_whatsapp_id_idx" ON "station_owners" USING btree ("whatsapp_id");--> statement-breakpoint
CREATE INDEX "owners_verification_idx" ON "station_owners" USING btree ("is_verified","kyc_status");--> statement-breakpoint
CREATE INDEX "owners_business_idx" ON "station_owners" USING btree ("business_name");--> statement-breakpoint
CREATE INDEX "owners_location_idx" ON "station_owners" USING btree ("city","state");--> statement-breakpoint
CREATE INDEX "search_history_user_idx" ON "user_search_history" USING btree ("user_whatsapp");--> statement-breakpoint
CREATE INDEX "search_history_term_idx" ON "user_search_history" USING btree ("search_term");--> statement-breakpoint
CREATE INDEX "search_history_date_idx" ON "user_search_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "search_history_type_idx" ON "user_search_history" USING btree ("search_type");--> statement-breakpoint
CREATE INDEX "users_whatsapp_id_idx" ON "users" USING btree ("whatsapp_id");--> statement-breakpoint
CREATE INDEX "users_name_idx" ON "users" USING btree ("name");--> statement-breakpoint
CREATE INDEX "users_activity_idx" ON "users" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "users_preferences_idx" ON "users" USING btree ("preferences_captured");
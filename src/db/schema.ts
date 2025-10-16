// src/db/schema.ts - COMPLETE CORRECTED SCHEMA WITH VERIFICATION COLUMNS
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  decimal,
  jsonb,
  serial,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';

// ==================== USERS ====================
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  whatsappId: varchar('whatsapp_id', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 100 }),
  phoneNumber: varchar('phone_number', { length: 20 }),

  vehicleType: varchar('vehicle_type', { length: 50 }),
  evModel: varchar('ev_model', { length: 100 }),
  connectorType: varchar('connector_type', { length: 20 }),
  chargingIntent: varchar('charging_intent', { length: 50 }),
  queuePreference: varchar('queue_preference', { length: 30 }),

  isActive: boolean('is_active').default(true),
  isBanned: boolean('is_banned').default(false),
  preferencesCaptured: boolean('preferences_captured').default(false),

  profilePicture: text('profile_picture'),
  language: varchar('language', { length: 10 }).default('en'),
  timezone: varchar('timezone', { length: 50 }).default('Asia/Kolkata'),

  notificationsEnabled: boolean('notifications_enabled').default(true),
  smsNotifications: boolean('sms_notifications').default(false),
  emailNotifications: boolean('email_notifications').default(false),
  email: varchar('email', { length: 150 }),

  totalBookings: integer('total_bookings').default(0),
  totalSessions: integer('total_sessions').default(0),
  totalEnergyConsumed: decimal('total_energy_consumed', { precision: 10, scale: 3 }).default('0'),
  lastActivityAt: timestamp('last_activity_at').defaultNow(),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  whatsappIdIdx: index('users_whatsapp_id_idx').on(table.whatsappId),
  activityIdx: index('users_activity_idx').on(table.lastActivityAt),
}));

// ==================== CHARGING STATIONS ====================
export const chargingStations = pgTable('charging_stations', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  address: text('address').notNull(),

  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  geohash: varchar('geohash', { length: 12 }),

  // ✅ Support both naming conventions
  totalPorts: integer('total_ports').notNull().default(1),
  availablePorts: integer('available_ports').notNull().default(1),
  totalSlots: integer('total_slots').notNull().default(1), // Alias
  availableSlots: integer('available_slots').notNull().default(1), // Alias
  
  connectorTypes: jsonb('connector_types').notNull(),
  maxPowerKw: integer('max_power_kw').notNull().default(50),
  
  // ✅ Support both naming conventions  
  pricePerKwh: decimal('price_per_kwh', { precision: 5, scale: 2 }).notNull().default('10.00'),
  pricePerUnit: decimal('price_per_unit', { precision: 5, scale: 2 }).notNull().default('10.00'), // Alias

  isActive: boolean('is_active').default(true),
  isOpen: boolean('is_open').default(true),
  isPaused: boolean('is_paused').default(false),
  maintenanceMode: boolean('maintenance_mode').default(false),

  currentQueueLength: integer('current_queue_length').default(0),
  maxQueueLength: integer('max_queue_length').default(10),
  averageSessionMinutes: integer('average_session_minutes').default(30),

  operatingHours: jsonb('operating_hours').default(sql`'{"monday":"24/7","tuesday":"24/7","wednesday":"24/7","thursday":"24/7","friday":"24/7","saturday":"24/7","sunday":"24/7"}'::jsonb`),
  amenities: jsonb('amenities').default(sql`'[]'::jsonb`),
  description: text('description'),

  ownerWhatsappId: varchar('owner_whatsapp_id', { length: 20 }).notNull(),
  contactNumber: varchar('contact_number', { length: 20 }),
  emergencyContact: varchar('emergency_contact', { length: 20 }),

  totalSessions: integer('total_sessions').default(0),
  totalEnergyDelivered: decimal('total_energy_delivered', { precision: 12, scale: 3 }).default('0'),
  totalRevenue: decimal('total_revenue', { precision: 12, scale: 2 }).default('0'),
  
  // ✅ Support both naming conventions
  averageRating: decimal('average_rating', { precision: 3, scale: 2 }).default('0'),
  rating: decimal('rating', { precision: 3, scale: 2 }).default('0'), // Alias
  reviewCount: integer('review_count').default(0),
  totalReviews: integer('total_reviews').default(0), // Alias

  lastMaintenanceAt: timestamp('last_maintenance_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  locationIdx: index('stations_location_idx').on(table.latitude, table.longitude),
  geohashIdx: index('stations_geohash_idx').on(table.geohash),
  ownerIdx: index('stations_owner_idx').on(table.ownerWhatsappId),
  activeIdx: index('stations_active_idx').on(table.isActive, table.isOpen),
  availabilityIdx: index('stations_availability_idx').on(table.availablePorts, table.currentQueueLength),
  priceIdx: index('stations_price_idx').on(table.pricePerKwh),
  ratingIdx: index('stations_rating_idx').on(table.averageRating),
}));

// ==================== QUEUES ====================
export const queues = pgTable('queues', {
  id: serial('id').primaryKey(),
  stationId: integer('station_id').notNull().references(() => chargingStations.id),
  userWhatsapp: varchar('user_whatsapp', { length: 20 }).notNull().references(() => users.whatsappId),

  position: integer('position').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('waiting'),
  estimatedWaitMinutes: integer('estimated_wait_minutes'),
  actualWaitMinutes: integer('actual_wait_minutes'),

  reservationExpiry: timestamp('reservation_expiry'),
  reminderSent: boolean('reminder_sent').default(false),
  notificationsSent: integer('notifications_sent').default(0),

  requestedConnectorType: varchar('requested_connector_type', { length: 20 }),
  requestedMaxPower: integer('requested_max_power'),
  estimatedSessionMinutes: integer('estimated_session_minutes'),

  ratePerKwhAtBooking: decimal('rate_per_kwh_at_booking', { precision: 5, scale: 2 }),
  estimatedCost: decimal('estimated_cost', { precision: 8, scale: 2 }),

  joinedAt: timestamp('joined_at').defaultNow(),
  readyAt: timestamp('ready_at'),
  expiredAt: timestamp('expired_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  stationPositionIdx: index('queues_station_position_idx').on(table.stationId, table.position),
  statusIdx: index('queues_status_idx').on(table.status),
  expiryIdx: index('queues_expiry_idx').on(table.reservationExpiry),
  userActiveIdx: index('queues_user_active_idx').on(table.userWhatsapp, table.status),
  userStationUnique: unique('queues_user_station_active').on(table.userWhatsapp, table.stationId),
}));

// ==================== CHARGING SESSIONS (WITH VERIFICATION COLUMNS) ====================
export const chargingSessions = pgTable('charging_sessions', {
  id: serial('id').primaryKey(),
  sessionId: varchar('session_id', { length: 50 }).notNull().unique(),

  stationId: integer('station_id').notNull().references(() => chargingStations.id),
  userWhatsapp: varchar('user_whatsapp', { length: 20 }).notNull().references(() => users.whatsappId),
  queueId: integer('queue_id').references(() => queues.id),

  status: varchar('status', { length: 20 }).notNull().default('initiated'),
  startTime: timestamp('start_time'),
  endTime: timestamp('end_time'),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  duration: integer('duration'),

  // 🔌 Meter readings (kWh) - ✅ ADDED MISSING COLUMNS
  startMeterReading: decimal('start_meter_reading', { precision: 10, scale: 3 }),
  endMeterReading: decimal('end_meter_reading', { precision: 10, scale: 3 }),
  energyDelivered: decimal('energy_delivered', { precision: 10, scale: 3 }),

  // 🔍 Verification - ✅ ADDED ALL MISSING VERIFICATION COLUMNS
  verificationStatus: varchar('verification_status', { length: 30 }).default('pending'),
  startVerificationAttempts: integer('start_verification_attempts').default(0),
  endVerificationAttempts: integer('end_verification_attempts').default(0),
  manualEntryUsed: boolean('manual_entry_used').default(false),
  startReadingConfidence: decimal('start_reading_confidence', { precision: 5, scale: 4 }),
  endReadingConfidence: decimal('end_reading_confidence', { precision: 5, scale: 4 }),
  meterValidated: boolean('meter_validated').default(false),
  validationWarnings: jsonb('validation_warnings').default(sql`'[]'::jsonb`),

  // ⚡ Charging
  connectorUsed: varchar('connector_used', { length: 20 }),
  maxPowerUsed: integer('max_power_used'),
  peakPowerKw: decimal('peak_power_kw', { precision: 6, scale: 2 }),
  averagePowerKw: decimal('average_power_kw', { precision: 6, scale: 2 }),

  // 💰 Billing
  totalCost: decimal('total_cost', { precision: 10, scale: 2 }),
  ratePerKwh: decimal('rate_per_kwh', { precision: 5, scale: 2 }),
  baseCharge: decimal('base_charge', { precision: 6, scale: 2 }).default('0'),
  taxAmount: decimal('tax_amount', { precision: 6, scale: 2 }).default('0'),
  discountAmount: decimal('discount_amount', { precision: 6, scale: 2 }).default('0'),

  paymentStatus: varchar('payment_status', { length: 20 }).default('pending'),

  // 🚗 Metadata
  vehicleModel: varchar('vehicle_model', { length: 100 }),
  initialBatteryPercent: integer('initial_battery_percent'),
  finalBatteryPercent: integer('final_battery_percent'),
  stopReason: varchar('stop_reason', { length: 50 }),

  // 📝 Feedback
  hadIssues: boolean('had_issues').default(false),
  issueDescription: text('issue_description'),
  customerRating: integer('customer_rating'),
  customerFeedback: text('customer_feedback'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  userIdx: index('sessions_user_idx').on(table.userWhatsapp),
  stationIdx: index('sessions_station_idx').on(table.stationId),
  statusIdx: index('sessions_status_idx').on(table.status),
  paymentIdx: index('sessions_payment_idx').on(table.paymentStatus),
  verificationIdx: index('sessions_verification_idx').on(table.verificationStatus),
  startedAtIdx: index('sessions_started_at_idx').on(table.startedAt),
}));

// ==================== STATION OWNERS ====================
export const stationOwners = pgTable('station_owners', {
  id: serial('id').primaryKey(),
  whatsappId: varchar('whatsapp_id', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 20 }),
  email: varchar('email', { length: 150 }),

  businessName: varchar('business_name', { length: 200 }),
  businessType: varchar('business_type', { length: 50 }),
  businessRegistrationNumber: varchar('business_registration_number', { length: 50 }),
  gstNumber: varchar('gst_number', { length: 20 }),

  address: text('address'),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 100 }),
  pincode: varchar('pincode', { length: 10 }),

  isVerified: boolean('is_verified').default(false),
  kycStatus: varchar('kyc_status', { length: 20 }).default('pending'),
  verificationDocuments: jsonb('verification_documents'),
  verifiedAt: timestamp('verified_at'),
  verifiedBy: varchar('verified_by', { length: 20 }),

  bankAccountNumber: varchar('bank_account_number', { length: 30 }),
  ifscCode: varchar('ifsc_code', { length: 15 }),
  accountHolderName: varchar('account_holder_name', { length: 100 }),

  totalStations: integer('total_stations').default(0),
  totalRevenue: decimal('total_revenue', { precision: 12, scale: 2 }).default('0'),
  averageRating: decimal('average_rating', { precision: 3, scale: 2 }).default('0'),

  isActive: boolean('is_active').default(true),
  permissions: jsonb('permissions').notNull().default(sql`'["manage_own_stations"]'::jsonb`),
  subscriptionPlan: varchar('subscription_plan', { length: 30 }).default('basic'),
  subscriptionExpiry: timestamp('subscription_expiry'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  whatsappIdIdx: index('owners_whatsapp_id_idx').on(table.whatsappId),
  verificationIdx: index('owners_verification_idx').on(table.isVerified, table.kycStatus),
}));

// ==================== ADMINS ====================
export const admins = pgTable('admins', {
  id: serial('id').primaryKey(),
  whatsappId: varchar('whatsapp_id', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 150 }),

  role: varchar('role', { length: 30 }).notNull().default('admin'),
  permissions: jsonb('permissions').notNull().default(sql`'["manage_owners","manage_users","view_analytics"]'::jsonb`),

  isActive: boolean('is_active').default(true),
  canAccessFinance: boolean('can_access_finance').default(false),
  canModifyStations: boolean('can_modify_stations').default(false),
  canBanUsers: boolean('can_ban_users').default(false),

  lastLoginAt: timestamp('last_login_at'),
  loginCount: integer('login_count').default(0),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  whatsappIdIdx: index('admins_whatsapp_id_idx').on(table.whatsappId),
  roleIdx: index('admins_role_idx').on(table.role),
}));

// ==================== GEOCODE CACHE ====================
export const geocodeCacheV2 = pgTable('geocode_cache_v2', {
  id: serial('id').primaryKey(),
  searchTerm: text('search_term').notNull().unique(),
  originalAddress: text('original_address').notNull(),
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  geohash: text('geohash').notNull(),

  formattedAddress: text('formatted_address'),
  locality: text('locality'),
  subLocality: text('sub_locality'),
  state: text('state'),
  country: text('country').default('India'),
  postalCode: text('postal_code'),

  confidence: decimal('confidence', { precision: 3, scale: 2 }).default('1.0'),
  source: varchar('source', { length: 30 }).default('google'),
  hitCount: integer('hit_count').default(1),
  lastUsed: timestamp('last_used').defaultNow(),

  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  searchTermIdx: index('geocode_v2_search_term_idx').on(table.searchTerm),
  geohashIdx: index('geocode_v2_geohash_idx').on(table.geohash),
}));

// ==================== USER SEARCH HISTORY ====================
export const userSearchHistory = pgTable('user_search_history', {
  id: serial('id').primaryKey(),
  userWhatsapp: varchar('user_whatsapp', { length: 20 }).notNull().references(() => users.whatsappId),
  searchTerm: text('search_term').notNull(),
  searchType: varchar('search_type', { length: 20 }).default('address'),
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  resultCount: integer('result_count').default(0),
  selectedStationId: integer('selected_station_id'),

  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userIdx: index('search_history_user_idx').on(table.userWhatsapp),
}));

// ==================== NOTIFICATIONS ====================
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 20 }).notNull().references(() => users.whatsappId),
  type: varchar('type', { length: 30 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  message: text('message').notNull(),

  status: varchar('status', { length: 20 }).default('pending'),
  channel: varchar('channel', { length: 20 }).default('whatsapp'),
  deliveredAt: timestamp('delivered_at'),
  readAt: timestamp('read_at'),

  relatedId: varchar('related_id', { length: 50 }),
  relatedType: varchar('related_type', { length: 30 }),
  metadata: jsonb('metadata'),

  scheduledFor: timestamp('scheduled_for').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userIdx: index('notifications_user_idx').on(table.userId),
  statusIdx: index('notifications_status_idx').on(table.status),
}));

// ==================== PAYMENTS ====================
export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  paymentId: varchar('payment_id', { length: 100 }).notNull().unique(),
  sessionId: varchar('session_id', { length: 50 }).notNull().references(() => chargingSessions.sessionId),
  userWhatsapp: varchar('user_whatsapp', { length: 20 }).notNull().references(() => users.whatsappId),
  stationId: integer('station_id').notNull().references(() => chargingStations.id),

  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 10 }).default('INR'),
  status: varchar('status', { length: 20 }).default('pending'),
  method: varchar('method', { length: 30 }),

  gatewayTransactionId: varchar('gateway_transaction_id', { length: 100 }),
  gatewayResponse: jsonb('gateway_response'),

  refundAmount: decimal('refund_amount', { precision: 10, scale: 2 }).default('0'),
  refundReason: text('refund_reason'),
  refundedAt: timestamp('refunded_at'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  sessionIdIdx: index('payments_session_id_idx').on(table.sessionId),
  statusIdx: index('payments_status_idx').on(table.status),
}));

// ==================== AUDIT LOGS ====================
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  actorWhatsappId: varchar('actor_whatsapp_id', { length: 20 }).notNull(),
  actorType: varchar('actor_type', { length: 20 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }),
  resourceId: varchar('resource_id', { length: 50 }),
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  metadata: jsonb('metadata'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  endpoint: varchar('endpoint', { length: 200 }),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  actorIdx: index('audit_actor_idx').on(table.actorWhatsappId),
  actionIdx: index('audit_action_idx').on(table.action),
}));

// ==================== RELATIONS ====================
export const usersRelations = relations(users, ({ many }) => ({
  queues: many(queues),
  sessions: many(chargingSessions),
  searchHistory: many(userSearchHistory),
  notifications: many(notifications),
  payments: many(payments),
}));

export const stationsRelations = relations(chargingStations, ({ many, one }) => ({
  queues: many(queues),
  sessions: many(chargingSessions),
  payments: many(payments),
  owner: one(stationOwners, {
    fields: [chargingStations.ownerWhatsappId],
    references: [stationOwners.whatsappId],
  }),
}));

export const queuesRelations = relations(queues, ({ one, many }) => ({
  station: one(chargingStations, {
    fields: [queues.stationId],
    references: [chargingStations.id],
  }),
  user: one(users, {
    fields: [queues.userWhatsapp],
    references: [users.whatsappId],
  }),
  sessions: many(chargingSessions),
}));

export const sessionsRelations = relations(chargingSessions, ({ one }) => ({
  station: one(chargingStations, {
    fields: [chargingSessions.stationId],
    references: [chargingStations.id],
  }),
  user: one(users, {
    fields: [chargingSessions.userWhatsapp],
    references: [users.whatsappId],
  }),
  queue: one(queues, {
    fields: [chargingSessions.queueId],
    references: [queues.id],
  }),
}));

export const ownersRelations = relations(stationOwners, ({ many }) => ({
  stations: many(chargingStations),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  session: one(chargingSessions, {
    fields: [payments.sessionId],
    references: [chargingSessions.sessionId],
  }),
  user: one(users, {
    fields: [payments.userWhatsapp],
    references: [users.whatsappId],
  }),
  station: one(chargingStations, {
    fields: [payments.stationId],
    references: [chargingStations.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.whatsappId],
  }),
}));

// ==================== TYPES ====================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ChargingStation = typeof chargingStations.$inferSelect;
export type NewChargingStation = typeof chargingStations.$inferInsert;
export type Queue = typeof queues.$inferSelect;
export type NewQueue = typeof queues.$inferInsert;
export type ChargingSession = typeof chargingSessions.$inferSelect;
export type NewChargingSession = typeof chargingSessions.$inferInsert;
export type StationOwner = typeof stationOwners.$inferSelect;
export type NewStationOwner = typeof stationOwners.$inferInsert;
export type Admin = typeof admins.$inferSelect;
export type NewAdmin = typeof admins.$inferInsert;
export type GeocacheCacheV2 = typeof geocodeCacheV2.$inferSelect;
export type NewGeocacheCacheV2 = typeof geocodeCacheV2.$inferInsert;
export type UserSearchHistory = typeof userSearchHistory.$inferSelect;
export type NewUserSearchHistory = typeof userSearchHistory.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
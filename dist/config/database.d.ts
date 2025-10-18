import * as schema from '../db/schema';
export declare const db: import("drizzle-orm/neon-http").NeonHttpDatabase<typeof schema> & {
    $client: import("@neondatabase/serverless").NeonQueryFunction<false, false>;
};
export type Database = typeof db;
//# sourceMappingURL=database.d.ts.map
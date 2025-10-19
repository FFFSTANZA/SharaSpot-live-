import { type User, type NewUser } from '../db/schema';
export declare class UserService {
    getOrCreateUser(whatsappId: string): Promise<User>;
    getUserByWhatsAppId(whatsappId: string): Promise<User | null>;
    createUser(userData: NewUser): Promise<User>;
    updateUserPreferences(whatsappId: string, preferences: {
        evModel?: string;
        connectorType?: string;
        chargingIntent?: string;
        queuePreference?: string;
    }): Promise<User | null>;
    updateUserProfile(whatsappId: string, profileData: {
        name?: string | null;
        phoneNumber?: string | null;
    }): Promise<User | null>;
    hasCompletedPreferences(whatsappId: string): Promise<boolean>;
    updateUserBanStatus(whatsappId: string, isBanned: boolean, adminWhatsappId: string): Promise<boolean>;
    isUserBanned(whatsappId: string): Promise<boolean>;
    upsertUser(whatsappId: string, userData?: Partial<NewUser>): Promise<User>;
    private logUserAction;
}
export declare const userService: UserService;
export declare function handleIncomingMessage(whatsappId: string, message: any): Promise<{
    id: number;
    whatsappId: string;
    name: string | null;
    phoneNumber: string | null;
    vehicleType: string | null;
    evModel: string | null;
    connectorType: string | null;
    chargingIntent: string | null;
    queuePreference: string | null;
    isActive: boolean | null;
    isBanned: boolean | null;
    preferencesCaptured: boolean | null;
    profilePicture: string | null;
    language: string | null;
    timezone: string | null;
    notificationsEnabled: boolean | null;
    smsNotifications: boolean | null;
    emailNotifications: boolean | null;
    email: string | null;
    totalBookings: number | null;
    totalSessions: number | null;
    totalEnergyConsumed: string | null;
    lastActivityAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;
//# sourceMappingURL=userService.d.ts.map
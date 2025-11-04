import { type User } from '../db/schema';
export declare class ProfileService {
    updateUserProfileFromWhatsApp(whatsappId: string): Promise<void>;
    private fetchWhatsAppProfile;
    requestUserName(whatsappId: string): Promise<void>;
    updateUserName(whatsappId: string, name: string): Promise<boolean>;
    showProfileSummary(whatsappId: string): Promise<void>;
    updateUserProfile(whatsappId: string, updates: {
        name?: string;
        phoneNumber?: string;
    }): Promise<User | null>;
}
export declare const profileService: ProfileService;
//# sourceMappingURL=profile.d.ts.map
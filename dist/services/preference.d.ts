import { type User } from '../db/schema';
export interface PreferenceStep {
    step: 'ev_model' | 'connector_type' | 'charging_intent' | 'queue_preference' | 'completed';
    data?: any;
}
export interface UserContext {
    whatsappId: string;
    currentStep: PreferenceStep['step'];
    preferenceData: {
        vehicleType?: string;
        evModel?: string;
        connectorType?: string;
        chargingIntent?: string;
        queuePreference?: string;
    };
    isOnboarding: boolean;
}
export declare class PreferenceService {
    private userContexts;
    startPreferenceFlow(whatsappId: string, isOnboarding?: boolean): Promise<void>;
    getUserContext(whatsappId: string): UserContext | null;
    updateUserContext(whatsappId: string, updates: Partial<UserContext>): void;
    clearUserContext(whatsappId: string): void;
    savePreferences(whatsappId: string): Promise<User | null>;
    resetUserPreferences(whatsappId: string): Promise<boolean>;
    isInPreferenceFlow(whatsappId: string): boolean;
    getNextStep(currentStep: PreferenceStep['step']): PreferenceStep['step'];
    getPreviousStep(currentStep: PreferenceStep['step']): PreferenceStep['step'];
    loadUserPreferences(whatsappId: string): Promise<UserContext | null>;
    updateSinglePreference(whatsappId: string, field: keyof UserContext['preferenceData'], value: string): Promise<boolean>;
    getPreferencesSummary(whatsappId: string): Promise<string>;
    validatePreferenceData(data: UserContext['preferenceData']): {
        isValid: boolean;
        errors: string[];
    };
    getHealthStatus(): {
        status: 'healthy' | 'degraded';
        activeContexts: number;
        uptime: string;
    };
    cleanupExpiredContexts(): void;
}
export declare const preferenceService: PreferenceService;
//# sourceMappingURL=preference.d.ts.map
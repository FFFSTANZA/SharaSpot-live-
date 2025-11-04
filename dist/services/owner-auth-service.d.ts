export declare class OwnerAuthService {
    private activeSessions;
    private readonly SESSION_DURATION;
    isAuthenticated(whatsappId: string): Promise<boolean>;
    authenticateByBusinessName(whatsappId: string, businessName: string): Promise<boolean>;
    getOwnerProfile(whatsappId: string): Promise<any | null>;
    createAuthSession(whatsappId: string): Promise<string | null>;
    validateSession(token: string): Promise<boolean>;
    getWhatsAppIdFromToken(token: string): Promise<string | null>;
    invalidateSession(token: string): Promise<boolean>;
    invalidateAllSessions(whatsappId: string): Promise<boolean>;
    cleanupExpiredSessions(): void;
    getActiveSessionsCount(): number;
    private generateSessionToken;
}
export declare const ownerAuthService: OwnerAuthService;
//# sourceMappingURL=owner-auth-service.d.ts.map
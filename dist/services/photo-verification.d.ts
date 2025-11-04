interface VerificationState {
    sessionId: string;
    userWhatsapp: string;
    stationId: number;
    type: 'start' | 'end';
    attemptCount: number;
    lastReading?: number;
    lastConfidence?: number;
    timestamp: Date;
    ocrProvider: 'vision' | 'manual';
}
interface PhotoResult {
    success: boolean;
    reading?: number;
    confidence?: number;
    message: string;
    shouldRetry?: boolean;
    processingTime?: number;
}
interface ConsumptionValidation {
    isValid: boolean;
    consumption?: number;
    warnings?: string[];
    error?: string;
}
interface OCRMetrics {
    totalAttempts: number;
    successfulReads: number;
    averageConfidence: number;
    averageProcessingTime: number;
    visionAPICallsToday: number;
}
declare class PhotoVerificationService {
    private states;
    private ocrMetrics;
    cleanupState(userWhatsapp: string): void;
    initiateStartVerification(userWhatsapp: string, sessionId: string, stationId: number): Promise<void>;
    handleStartPhoto(userWhatsapp: string, imageBuffer: Buffer): Promise<PhotoResult>;
    confirmStartReading(userWhatsapp: string): Promise<boolean>;
    retakeStartPhoto(userWhatsapp: string): Promise<void>;
    initiateEndVerification(userWhatsapp: string, sessionId: string, stationId: number): Promise<void>;
    handleEndPhoto(userWhatsapp: string, imageBuffer: Buffer): Promise<PhotoResult>;
    confirmEndReading(userWhatsapp: string): Promise<boolean>;
    retakeEndPhoto(userWhatsapp: string): Promise<void>;
    handleManualEntry(userWhatsapp: string, input: string): Promise<boolean>;
    private validateConsumption;
    private sendStartPhotoRequest;
    private sendEndPhotoRequest;
    private sendReadingConfirmation;
    private sendEndReadingConfirmation;
    private handleOCRFailure;
    private handleLowConfidence;
    private fallbackToManualEntry;
    private getSession;
    isInVerificationFlow(userWhatsapp: string): boolean;
    getVerificationState(userWhatsapp: string): VerificationState | null;
    clearVerificationState(userWhatsapp: string): void;
    cleanupExpiredStates(): void;
    getOCRMetrics(): OCRMetrics;
    getSuccessRate(): number;
    resetDailyAPICounter(): void;
    estimateMonthlyCost(): number;
    isApproachingQuota(): boolean;
    logPerformanceMetrics(): void;
    getDebugInfo(userWhatsapp: string): any;
}
export declare const photoVerificationService: PhotoVerificationService;
export type { VerificationState, PhotoResult, ConsumptionValidation, OCRMetrics };
//# sourceMappingURL=photo-verification.d.ts.map
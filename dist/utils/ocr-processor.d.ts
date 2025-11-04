export interface OCRResult {
    success: boolean;
    reading?: number;
    confidence?: number;
    rawText?: string;
    error?: string;
    suggestions?: string[];
    processingTime?: number;
}
export interface PreprocessOptions {
    enhanceContrast?: boolean;
    denoise?: boolean;
    targetSize?: {
        width: number;
        height: number;
    };
    autoRotate?: boolean;
    threshold?: boolean;
}
export declare function extractKwhReading(imageBuffer: Buffer, options?: PreprocessOptions): Promise<OCRResult>;
export declare function preprocessImage(imageBuffer: Buffer, options?: PreprocessOptions): Promise<Buffer>;
export declare function validateReading(reading: number): {
    valid: boolean;
    error?: string;
};
export declare function calculateConsumption(start: number, end: number): {
    valid: boolean;
    consumption?: number;
    error?: string;
};
export declare function validateConsumptionWithContext(consumption: number, durationMinutes: number, chargerPowerKw: number, batteryCapacityKwh?: number): {
    valid: boolean;
    warnings?: string[];
    error?: string;
};
export declare function formatReading(reading: number): string;
export declare function getRetrySuggestions(confidence?: number, rawText?: string): string[];
export declare function shouldWarnLowConfidence(confidence: number): boolean;
export declare function isGoodConfidence(confidence: number): boolean;
declare const _default: {
    extractKwhReading: typeof extractKwhReading;
    preprocessImage: typeof preprocessImage;
    validateReading: typeof validateReading;
    calculateConsumption: typeof calculateConsumption;
    validateConsumptionWithContext: typeof validateConsumptionWithContext;
    formatReading: typeof formatReading;
    getRetrySuggestions: typeof getRetrySuggestions;
    shouldWarnLowConfidence: typeof shouldWarnLowConfidence;
    isGoodConfidence: typeof isGoodConfidence;
};
export default _default;
//# sourceMappingURL=ocr-processor.d.ts.map
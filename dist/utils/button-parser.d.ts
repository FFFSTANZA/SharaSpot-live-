export interface ButtonParseResult {
    action: string;
    category: 'station' | 'queue' | 'session' | 'location' | 'system' | 'unknown';
    stationId: number;
    additionalData?: number;
    index?: number;
}
export declare function parseButtonId(buttonId: string): ButtonParseResult;
export declare function isValidButtonId(buttonId: string): boolean;
export declare function hasValidStationId(result: ButtonParseResult): boolean;
export declare function isQueueButton(buttonId: string): boolean;
export declare function isLocationButton(buttonId: string): boolean;
export declare function isStationButton(buttonId: string): boolean;
export declare function isSessionButton(buttonId: string): boolean;
export declare function getButtonDescription(result: ButtonParseResult): string;
export declare function logButtonParsing(buttonId: string, result: ButtonParseResult): void;
//# sourceMappingURL=button-parser.d.ts.map
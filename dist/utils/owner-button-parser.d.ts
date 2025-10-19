export interface OwnerButtonParseResult {
    action: string;
    category: 'auth' | 'main' | 'station' | 'profile' | 'analytics' | 'system';
    stationId?: number;
    additionalData?: any;
}
export declare function parseOwnerButtonId(buttonId: string): OwnerButtonParseResult;
export declare function generateOwnerButtonId(action: string, category: 'auth' | 'main' | 'station' | 'profile' | 'analytics' | 'system', stationId?: number, additionalData?: any): string;
export declare function isOwnerButton(buttonId: string): boolean;
//# sourceMappingURL=owner-button-parser.d.ts.map
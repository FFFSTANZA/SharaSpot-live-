export interface PaymentLinkRequest {
    amount: number;
    description: string;
    userWhatsappId: string;
    stationId: number;
    type: 'booking' | 'session';
}
declare class PaymentService {
    createBookingPayment(userWhatsappId: string, stationId: number, amount: number): Promise<string>;
    createSessionPayment(userWhatsappId: string, sessionId: string, stationId: number, amount: number, energyDelivered: number): Promise<string>;
    verifyPaymentSignature(paymentLinkId: string, paymentLinkReferenceId: string, paymentLinkStatus: string, paymentId: string, signature: string): boolean;
    handlePaymentCallback(paymentLinkId: string, paymentLinkReferenceId: string, paymentLinkStatus: string, paymentId: string, signature: string): Promise<{
        success: boolean;
        redirectUrl: string;
        message: string;
        referenceId: string;
        paymentType: 'booking' | 'session' | 'unknown';
    }>;
    checkPaymentStatus(referenceId: string): Promise<{
        status: string;
        isPaid: boolean;
    }>;
    getPaymentFromCache(referenceId: string): {
        userWhatsappId: string;
        stationId: number;
        type: "booking" | "session";
        amount: number;
        createdAt: Date;
    } | null;
}
export declare const paymentService: PaymentService;
export {};
//# sourceMappingURL=payment.d.ts.map
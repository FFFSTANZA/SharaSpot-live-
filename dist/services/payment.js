"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentService = void 0;
const razorpay_1 = __importDefault(require("razorpay"));
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("../utils/logger");
const env_1 = require("../config/env");
const paymentCache = new Map();
const razorpayClient = new razorpay_1.default({
    key_id: env_1.env.RAZORPAY_KEY_ID || '',
    key_secret: env_1.env.RAZORPAY_KEY_SECRET || '',
});
class PaymentService {
    async createBookingPayment(userWhatsappId, stationId, amount) {
        try {
            const referenceId = `book_${userWhatsappId}_${stationId}_${Date.now()}`;
            paymentCache.set(referenceId, {
                userWhatsappId,
                stationId,
                type: 'booking',
                amount,
                createdAt: new Date(),
            });
            const paymentLink = await razorpayClient.paymentLink.create({
                amount: amount * 100,
                currency: 'INR',
                description: `Booking fee for Station #${stationId}`,
                reference_id: referenceId,
                callback_url: `${env_1.env.APP_BASE_URL}/api/payment/callback`,
                callback_method: 'get',
                customer: {
                    contact: userWhatsappId,
                },
                notify: {
                    sms: false,
                    email: false,
                    whatsapp: false,
                },
            });
            logger_1.logger.info('✅ Booking payment link created', {
                userWhatsappId,
                stationId,
                amount,
                paymentLinkId: paymentLink.id,
                referenceId,
            });
            return paymentLink.short_url;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to create booking payment', {
                userWhatsappId,
                stationId,
                error: error.message,
            });
            throw error;
        }
    }
    async createSessionPayment(userWhatsappId, sessionId, stationId, amount, energyDelivered) {
        try {
            const referenceId = `session_${sessionId}_${Date.now()}`;
            paymentCache.set(referenceId, {
                userWhatsappId,
                stationId,
                type: 'session',
                amount,
                createdAt: new Date(),
            });
            const paymentLink = await razorpayClient.paymentLink.create({
                amount: amount * 100,
                currency: 'INR',
                description: `Charging fee for ${energyDelivered.toFixed(2)} kWh`,
                reference_id: referenceId,
                callback_url: `${env_1.env.APP_BASE_URL}/api/payment/callback`,
                callback_method: 'get',
                customer: {
                    contact: userWhatsappId,
                },
                notify: {
                    sms: false,
                    email: false,
                    whatsapp: false,
                },
            });
            logger_1.logger.info('✅ Session payment link created', {
                userWhatsappId,
                sessionId,
                amount,
                energyDelivered,
                paymentLinkId: paymentLink.id,
                referenceId,
            });
            return paymentLink.short_url;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to create session payment', {
                userWhatsappId,
                sessionId,
                error: error.message,
            });
            throw error;
        }
    }
    verifyPaymentSignature(paymentLinkId, paymentLinkReferenceId, paymentLinkStatus, paymentId, signature) {
        try {
            const generatedSignature = crypto_1.default
                .createHmac('sha256', env_1.env.RAZORPAY_KEY_SECRET || '')
                .update(`${paymentLinkId}|${paymentLinkReferenceId}|${paymentLinkStatus}|${paymentId}`)
                .digest('hex');
            return generatedSignature === signature;
        }
        catch (error) {
            logger_1.logger.error('❌ Signature verification failed', {
                paymentLinkId,
                error: error.message,
            });
            return false;
        }
    }
    async handlePaymentCallback(paymentLinkId, paymentLinkReferenceId, paymentLinkStatus, paymentId, signature) {
        try {
            const isValid = this.verifyPaymentSignature(paymentLinkId, paymentLinkReferenceId, paymentLinkStatus, paymentId, signature);
            if (!isValid) {
                logger_1.logger.error('❌ Invalid payment signature', { paymentLinkId });
                const whatsappNumber = env_1.env.PHONE_NUMBER_ID || env_1.env.PHONE_NUMBER_ID;
                return {
                    success: false,
                    redirectUrl: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Payment verification failed')}`,
                    message: 'Payment verification failed',
                    referenceId: paymentLinkReferenceId,
                    paymentType: 'unknown',
                };
            }
            const paymentInfo = paymentCache.get(paymentLinkReferenceId);
            const paymentType = paymentInfo?.type ||
                (paymentLinkReferenceId.startsWith('book_') ? 'booking' :
                    paymentLinkReferenceId.startsWith('session_') ? 'session' : 'unknown');
            logger_1.logger.info('✅ Payment callback verified', {
                paymentId,
                referenceId: paymentLinkReferenceId,
                status: paymentLinkStatus,
                type: paymentType,
            });
            const message = paymentLinkStatus === 'paid'
                ? '✅ Payment successful! Your booking is confirmed.'
                : '❌ Payment failed. Please try again.';
            paymentCache.delete(paymentLinkReferenceId);
            const whatsappNumber = env_1.env.PHONE_NUMBER_ID || env_1.env.PHONE_NUMBER_ID;
            return {
                success: paymentLinkStatus === 'paid',
                redirectUrl: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`,
                message,
                referenceId: paymentLinkReferenceId,
                paymentType,
            };
        }
        catch (error) {
            logger_1.logger.error('❌ Payment callback error', {
                paymentLinkId,
                error: error.message,
            });
            const whatsappNumber = env_1.env.PHONE_NUMBER_ID || env_1.env.PHONE_NUMBER_ID;
            return {
                success: false,
                redirectUrl: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Payment processing error')}`,
                message: 'Payment processing error',
                referenceId: paymentLinkReferenceId,
                paymentType: 'unknown',
            };
        }
    }
    async checkPaymentStatus(referenceId) {
        try {
            const paymentLinks = await razorpayClient.paymentLink.fetch(referenceId);
            return {
                status: paymentLinks.status,
                isPaid: paymentLinks.status === 'paid',
            };
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to check payment status', {
                referenceId,
                error: error.message,
            });
            return { status: 'error', isPaid: false };
        }
    }
    getPaymentFromCache(referenceId) {
        return paymentCache.get(referenceId) || null;
    }
}
exports.paymentService = new PaymentService();
//# sourceMappingURL=payment.js.map
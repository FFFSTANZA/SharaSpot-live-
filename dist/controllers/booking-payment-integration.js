"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleBookingWithPayment = handleBookingWithPayment;
exports.handleSessionPayment = handleSessionPayment;
const payment_1 = require("../services/payment");
const whatsapp_1 = require("../services/whatsapp");
const logger_1 = require("../utils/logger");
async function handleBookingWithPayment(whatsappId, stationId, stationName, bookingFee = 50) {
    try {
        const paymentUrl = await payment_1.paymentService.createBookingPayment(whatsappId, stationId, bookingFee);
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `*Booking Confirmation*\n\n` +
            `Station: ${stationName || `#${stationId}`}\n` +
            `*Booking Fee: ₹${bookingFee}*\n\n` +
            `Click the button below to complete payment via UPI.\n` +
            `You'll be redirected back to WhatsApp after payment.\n\n` +
            `👇 *Pay Now*\n${paymentUrl}`);
        logger_1.logger.info('✅ Booking payment link sent', {
            whatsappId,
            stationId,
            bookingFee,
        });
    }
    catch (error) {
        logger_1.logger.error('❌ Booking payment failed', {
            whatsappId,
            stationId,
            error: error.message,
        });
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to create payment link. Please try again.');
    }
}
async function handleSessionPayment(whatsappId, sessionId, stationId, energyDelivered, pricePerKwh) {
    try {
        const totalAmount = Math.round(energyDelivered * pricePerKwh);
        const paymentUrl = await payment_1.paymentService.createSessionPayment(whatsappId, sessionId, stationId, totalAmount, energyDelivered);
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `*Charging Session Complete*\n\n` +
            `*Session Summary:*\n` +
            `Energy Delivered: ${energyDelivered.toFixed(2)} kWh\n` +
            `Rate: ₹${pricePerKwh}/kWh\n` +
            `━━━━━━━━━━━━━━━━━\n` +
            `*Total Amount: ₹${totalAmount}*\n\n` +
            `Click below to complete payment:\n\n` +
            `👉 *Pay ₹${totalAmount} Now*\n${paymentUrl}`);
        logger_1.logger.info('✅ Session payment link sent', {
            whatsappId,
            sessionId,
            energyDelivered,
            totalAmount,
        });
    }
    catch (error) {
        logger_1.logger.error('❌ Session payment failed', {
            whatsappId,
            sessionId,
            error: error.message,
        });
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to create payment link. Please contact support.');
    }
}
//# sourceMappingURL=booking-payment-integration.js.map
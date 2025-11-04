"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const payment_1 = require("../services/payment");
const logger_1 = require("../utils/logger");
const booking_1 = require("../controllers/booking");
const whatsapp_1 = require("../services/whatsapp");
const router = (0, express_1.Router)();
router.get('/callback', async (req, res) => {
    try {
        const { razorpay_payment_link_id, razorpay_payment_link_reference_id, razorpay_payment_link_status, razorpay_payment_id, razorpay_signature, } = req.query;
        logger_1.logger.info('📥 Payment callback received', {
            paymentLinkId: razorpay_payment_link_id,
            referenceId: razorpay_payment_link_reference_id,
            status: razorpay_payment_link_status,
        });
        if (!razorpay_payment_link_id ||
            !razorpay_payment_link_reference_id ||
            !razorpay_payment_link_status ||
            !razorpay_payment_id ||
            !razorpay_signature) {
            logger_1.logger.error('❌ Missing payment callback parameters');
            res.status(400).send('Invalid payment callback');
            return;
        }
        const result = await payment_1.paymentService.handlePaymentCallback(razorpay_payment_link_id, razorpay_payment_link_reference_id, razorpay_payment_link_status, razorpay_payment_id, razorpay_signature);
        if (result.success && result.paymentType === 'booking') {
            const parts = result.referenceId.split('_');
            if (parts.length >= 3) {
                const whatsappId = parts[1];
                const stationId = parseInt(parts[2]);
                logger_1.logger.info('Confirming booking after payment', { whatsappId, stationId });
                setImmediate(async () => {
                    try {
                        await booking_1.bookingController.handleJoinQueue(whatsappId, stationId);
                        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Payment confirmed! Your booking is complete.\n\nYou can now join the queue or start charging.');
                    }
                    catch (error) {
                        logger_1.logger.error('❌ Failed to confirm booking', { whatsappId, stationId, error });
                    }
                });
            }
        }
        res.redirect(result.redirectUrl);
        return;
    }
    catch (error) {
        logger_1.logger.error('❌ Payment callback error', {
            error: error.message,
        });
        res.status(500).send('Payment processing error');
        return;
    }
});
router.post('/webhook', async (req, res) => {
    try {
        const webhookSignature = req.headers['x-razorpay-signature'];
        const webhookBody = req.body;
        logger_1.logger.info('📥 Payment webhook received', {
            event: webhookBody.event,
            paymentLinkId: webhookBody.payload?.payment_link?.entity?.id,
        });
        if (process.env.RAZORPAY_WEBHOOK_SECRET) {
            const crypto = require('crypto');
            const expectedSignature = crypto
                .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
                .update(JSON.stringify(webhookBody))
                .digest('hex');
            if (webhookSignature !== expectedSignature) {
                logger_1.logger.error('❌ Invalid webhook signature');
                res.status(400).json({ error: 'Invalid signature' });
                return;
            }
        }
        const event = webhookBody.event;
        if (event === 'payment_link.paid') {
            const paymentLink = webhookBody.payload?.payment_link?.entity;
            const referenceId = paymentLink?.reference_id;
            if (referenceId && referenceId.startsWith('book_')) {
                const parts = referenceId.split('_');
                if (parts.length >= 3) {
                    const whatsappId = parts[1];
                    const stationId = parseInt(parts[2]);
                    logger_1.logger.info('✅ Webhook: Booking payment confirmed', { whatsappId, stationId, referenceId });
                    setImmediate(async () => {
                        try {
                            await booking_1.bookingController.handleJoinQueue(whatsappId, stationId);
                            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '✅ Payment confirmed! Your booking is complete.\n\nYou can now join the queue or start charging.');
                        }
                        catch (error) {
                            logger_1.logger.error('❌ Webhook: Failed to confirm booking', { whatsappId, stationId, error });
                        }
                    });
                }
            }
        }
        res.status(200).json({ status: 'ok' });
        return;
    }
    catch (error) {
        logger_1.logger.error('❌ Webhook error', {
            error: error.message,
        });
        res.status(500).json({ error: 'Webhook processing error' });
        return;
    }
});
exports.default = router;
//# sourceMappingURL=payment.js.map
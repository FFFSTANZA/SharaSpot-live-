// src/routes/payment.ts - FIXED WEBHOOK ROUTE

import { Router, Request, Response } from 'express';
import { paymentService } from '../services/payment';
import { logger } from '../utils/logger';
import { bookingController } from '../controllers/booking'; // ✅ ADD THIS
import { whatsappService } from '../services/whatsapp'; // ✅ ADD THIS

const router = Router();

/**
 * ✅ Payment callback (GET) - User returns here after payment
 */
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      razorpay_payment_link_id,
      razorpay_payment_link_reference_id,
      razorpay_payment_link_status,
      razorpay_payment_id,
      razorpay_signature,
    } = req.query as Record<string, string>;

    logger.info('📥 Payment callback received', {
      paymentLinkId: razorpay_payment_link_id,
      referenceId: razorpay_payment_link_reference_id,
      status: razorpay_payment_link_status,
    });

    if (
      !razorpay_payment_link_id ||
      !razorpay_payment_link_reference_id ||
      !razorpay_payment_link_status ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      logger.error('❌ Missing payment callback parameters');
      res.status(400).send('Invalid payment callback');
      return;
    }

    // Handle callback
    const result = await paymentService.handlePaymentCallback(
      razorpay_payment_link_id,
      razorpay_payment_link_reference_id,
      razorpay_payment_link_status,
      razorpay_payment_id,
      razorpay_signature
    );

    // ✅ If payment successful and it's a booking payment, confirm booking
    if (result.success && result.paymentType === 'booking') {
      const parts = result.referenceId.split('_');
      if (parts.length >= 3) {
        const whatsappId = parts[1];
        const stationId = parseInt(parts[2]);
        
        logger.info('Confirming booking after payment', { whatsappId, stationId });
        
        // Confirm booking in background
        setImmediate(async () => {
          try {
            await bookingController.handleJoinQueue(whatsappId, stationId);
            await whatsappService.sendTextMessage(
              whatsappId,
              'Payment confirmed! Your booking is complete.\n\nYou can now join the queue or start charging.'
            );
          } catch (error) {
            logger.error('❌ Failed to confirm booking', { whatsappId, stationId, error });
          }
        });
      }
    }

    // Redirect to WhatsApp
    res.redirect(result.redirectUrl);
    return;
  } catch (error) {
    logger.error('❌ Payment callback error', {
      error: (error as Error).message,
    });
    res.status(500).send('Payment processing error');
    return;
  }
});

/**
 * ✅ Webhook endpoint (POST) - Razorpay server-to-server notification
 */
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookSignature = req.headers['x-razorpay-signature'] as string;
    const webhookBody = req.body;

    logger.info('📥 Payment webhook received', {
      event: webhookBody.event,
      paymentLinkId: webhookBody.payload?.payment_link?.entity?.id,
    });

    // Verify webhook signature (if secret is configured)
    if (process.env.RAZORPAY_WEBHOOK_SECRET) {
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(JSON.stringify(webhookBody))
        .digest('hex');

      if (webhookSignature !== expectedSignature) {
        logger.error('❌ Invalid webhook signature');
        res.status(400).json({ error: 'Invalid signature' });
        return;
      }
    }

    const event = webhookBody.event;

    // ✅ Handle payment_link.paid event
    if (event === 'payment_link.paid') {
      const paymentLink = webhookBody.payload?.payment_link?.entity;
      const referenceId = paymentLink?.reference_id;

      if (referenceId && referenceId.startsWith('book_')) {
        const parts = referenceId.split('_');
        if (parts.length >= 3) {
          const whatsappId = parts[1];
          const stationId = parseInt(parts[2]);

          logger.info('✅ Webhook: Booking payment confirmed', { whatsappId, stationId, referenceId });

          // Confirm booking
          setImmediate(async () => {
            try {
              await bookingController.handleJoinQueue(whatsappId, stationId);
              await whatsappService.sendTextMessage(
                whatsappId,
                '✅ Payment confirmed! Your booking is complete.\n\nYou can now join the queue or start charging.'
              );
            } catch (error) {
              logger.error('❌ Webhook: Failed to confirm booking', { whatsappId, stationId, error });
            }
          });
        }
      }
    }

    res.status(200).json({ status: 'ok' });
    return;
  } catch (error) {
    logger.error('❌ Webhook error', {
      error: (error as Error).message,
    });
    res.status(500).json({ error: 'Webhook processing error' });
    return;
  }
});

export default router;
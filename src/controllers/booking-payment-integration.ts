// src/controllers/booking-payment-integration.ts - WITH HYPERLINK BUTTON
import { paymentService } from '../services/payment';
import { whatsappService } from '../services/whatsapp';
import { logger } from '../utils/logger';

/**
 * ✅ PAYMENT 1: Booking Payment with Hyperlink Button
 */
export async function handleBookingWithPayment(
  whatsappId: string,
  stationId: number,
  stationName?: string,
  bookingFee: number = 50
): Promise<void> {
  try {
    // Create payment link
    const paymentUrl = await paymentService.createBookingPayment(
      whatsappId,
      stationId,
      bookingFee
    );

    // ✅ NEW: Send as clickable hyperlink with button
    await whatsappService.sendTextMessage(
      whatsappId,
      `🔋 *Booking Confirmation*\n\n` +
      `Station: ${stationName || `#${stationId}`}\n` +
      `💰 *Booking Fee: ₹${bookingFee}*\n\n` +
      `Click the button below to complete payment via UPI.\n` +
      `You'll be redirected back to WhatsApp after payment.\n\n` +
      `👇 *Pay Now*\n${paymentUrl}`
    );

    logger.info('✅ Booking payment link sent', {
      whatsappId,
      stationId,
      bookingFee,
    });
  } catch (error) {
    logger.error('❌ Booking payment failed', {
      whatsappId,
      stationId,
      error: (error as Error).message,
    });
    await whatsappService.sendTextMessage(
      whatsappId,
      '❌ Failed to create payment link. Please try again.'
    );
  }
}

/**
 * ✅ PAYMENT 2: Session Payment with Hyperlink Button
 */
export async function handleSessionPayment(
  whatsappId: string,
  sessionId: string,
  stationId: number,
  energyDelivered: number,
  pricePerKwh: number
): Promise<void> {
  try {
    const totalAmount = Math.round(energyDelivered * pricePerKwh);

    // Create payment link
    const paymentUrl = await paymentService.createSessionPayment(
      whatsappId,
      sessionId,
      stationId,
      totalAmount,
      energyDelivered
    );

    // ✅ NEW: Send as clickable hyperlink
    await whatsappService.sendTextMessage(
      whatsappId,
      `⚡ *Charging Session Complete*\n\n` +
      `📊 *Session Summary:*\n` +
      `Energy Delivered: ${energyDelivered.toFixed(2)} kWh\n` +
      `Rate: ₹${pricePerKwh}/kWh\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `💰 *Total Amount: ₹${totalAmount}*\n\n` +
      `Click below to complete payment:\n\n` +
      `👉 *Pay ₹${totalAmount} Now*\n${paymentUrl}`
    );

    logger.info('✅ Session payment link sent', {
      whatsappId,
      sessionId,
      energyDelivered,
      totalAmount,
    });
  } catch (error) {
    logger.error('❌ Session payment failed', {
      whatsappId,
      sessionId,
      error: (error as Error).message,
    });
    await whatsappService.sendTextMessage(
      whatsappId,
      '❌ Failed to create payment link. Please contact support.'
    );
  }
}
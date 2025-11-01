
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { env } from '../config/env';


export interface PaymentLinkRequest {
  amount: number;
  description: string;
  userWhatsappId: string;
  stationId: number;
  type: 'booking' | 'session';
}


const paymentCache = new Map<string, {
  userWhatsappId: string;
  stationId: number;
  type: 'booking' | 'session';
  amount: number;
  createdAt: Date;
}>();


const razorpayClient = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID || '',
  key_secret: env.RAZORPAY_KEY_SECRET || '',
});


class PaymentService {
  
  /**
   * ✅ PAYMENT 1: Create payment link for booking (NO DB)
   */
  async createBookingPayment(
    userWhatsappId: string,
    stationId: number,
    amount: number
  ): Promise<string> {
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
        amount: amount * 100, // Convert to paise
        currency: 'INR',
        description: `Booking fee for Station #${stationId}`,
        reference_id: referenceId,
        callback_url: `${env.APP_BASE_URL}/api/payment/callback`,
        callback_method: 'get',
        customer: {
          contact: userWhatsappId,
        },
        notify: {
          sms: false,
          email: false,
          whatsapp: false,
        },
      } as any); // Type assertion to handle Razorpay SDK type issues

      logger.info('✅ Booking payment link created', {
        userWhatsappId,
        stationId,
        amount,
        paymentLinkId: paymentLink.id,
        referenceId,
      });

      return paymentLink.short_url;
    } catch (error) {
      logger.error('❌ Failed to create booking payment', {
        userWhatsappId,
        stationId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * ✅ PAYMENT 2: Create payment link after session (NO DB)
   */
  async createSessionPayment(
    userWhatsappId: string,
    sessionId: string,
    stationId: number,
    amount: number,
    energyDelivered: number
  ): Promise<string> {
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
        callback_url: `${env.APP_BASE_URL}/api/payment/callback`,
        callback_method: 'get',
        customer: {
          contact: userWhatsappId,
        },
        notify: {
          sms: false,
          email: false,
          whatsapp: false,
        },
      } as any); // Type assertion

      logger.info('✅ Session payment link created', {
        userWhatsappId,
        sessionId,
        amount,
        energyDelivered,
        paymentLinkId: paymentLink.id,
        referenceId,
      });

      return paymentLink.short_url;
    } catch (error) {
      logger.error('❌ Failed to create session payment', {
        userWhatsappId,
        sessionId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * ✅ Verify Razorpay signature
   */
  verifyPaymentSignature(
    paymentLinkId: string,
    paymentLinkReferenceId: string,
    paymentLinkStatus: string,
    paymentId: string,
    signature: string
  ): boolean {
    try {
      const generatedSignature = crypto
        .createHmac('sha256', env.RAZORPAY_KEY_SECRET || '')
        .update(`${paymentLinkId}|${paymentLinkReferenceId}|${paymentLinkStatus}|${paymentId}`)
        .digest('hex');

      return generatedSignature === signature;
    } catch (error) {
      logger.error('❌ Signature verification failed', {
        paymentLinkId,
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * ✅ Handle payment callback - NO DATABASE
   */
  async handlePaymentCallback(
    paymentLinkId: string,
    paymentLinkReferenceId: string,
    paymentLinkStatus: string,
    paymentId: string,
    signature: string
  ): Promise<{ 
    success: boolean; 
    redirectUrl: string; 
    message: string;
    referenceId: string;
    paymentType: 'booking' | 'session' | 'unknown';
  }> {
    try {
      
      const isValid = this.verifyPaymentSignature(
        paymentLinkId,
        paymentLinkReferenceId,
        paymentLinkStatus,
        paymentId,
        signature
      );

      if (!isValid) {
        logger.error('❌ Invalid payment signature', { paymentLinkId });
        
        
        const whatsappNumber = env.PHONE_NUMBER_ID || env.PHONE_NUMBER_ID;
        
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

      logger.info('✅ Payment callback verified', {
        paymentId,
        referenceId: paymentLinkReferenceId,
        status: paymentLinkStatus,
        type: paymentType,
      });

      
      const message = paymentLinkStatus === 'paid' 
        ? '✅ Payment successful! Your booking is confirmed.'
        : '❌ Payment failed. Please try again.';

      
      paymentCache.delete(paymentLinkReferenceId);

      
      const whatsappNumber = env.PHONE_NUMBER_ID || env.PHONE_NUMBER_ID;

      return {
        success: paymentLinkStatus === 'paid',
        redirectUrl: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`,
        message,
        referenceId: paymentLinkReferenceId,
        paymentType,
      };
    } catch (error) {
      logger.error('❌ Payment callback error', {
        paymentLinkId,
        error: (error as Error).message,
      });
      
      
      const whatsappNumber = env.PHONE_NUMBER_ID || env.PHONE_NUMBER_ID;
      
      return {
        success: false,
        redirectUrl: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Payment processing error')}`,
        message: 'Payment processing error',
        referenceId: paymentLinkReferenceId,
        paymentType: 'unknown',
      };
    }
  }

  /**
   * ✅ Check payment status from Razorpay API (NO DB)
   */
  async checkPaymentStatus(referenceId: string): Promise<{
    status: string;
    isPaid: boolean;
  }> {
    try {
      
      const paymentLinks = await razorpayClient.paymentLink.fetch(referenceId);
      
      return {
        status: paymentLinks.status,
        isPaid: paymentLinks.status === 'paid',
      };
    } catch (error) {
      logger.error('❌ Failed to check payment status', {
        referenceId,
        error: (error as Error).message,
      });
      return { status: 'error', isPaid: false };
    }
  }

  /**
   * ✅ Get payment info from cache
   */
  getPaymentFromCache(referenceId: string) {
    return paymentCache.get(referenceId) || null;
  }
}


export const paymentService = new PaymentService();
import Razorpay from 'razorpay';
import crypto from 'crypto';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create a Razorpay order for the trip total
 * @param {number} amountInr - Total in INR (rupees, not paise)
 * @param {string} tripId - Trip ID for reference
 * @param {string} idempotencyKey - Unique key to prevent duplicate orders
 * @returns {Object} Razorpay order object
 */
export async function createOrder(amountInr, tripId, idempotencyKey) {
  const amountPaise = Math.round(amountInr * 100); // Razorpay uses paise
  
  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: `trip_${tripId}`.slice(0, 40), // max 40 chars
    notes: {
      trip_id: tripId,
      idempotency_key: idempotencyKey,
    },
  });
  
  return order;
}

/**
 * Verify Razorpay webhook signature
 * @param {Buffer} rawBody - Raw request body (must be Buffer, not parsed JSON)
 * @param {string} signature - x-razorpay-signature header value
 * @returns {boolean}
 */
export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

/**
 * Verify payment signature (from client-side checkout)
 * @param {string} orderId
 * @param {string} paymentId
 * @param {string} signature
 * @returns {boolean}
 */
export function verifyPaymentSignature(orderId, paymentId, signature) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const body = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  
  return expectedSignature === signature;
}

export default razorpay;

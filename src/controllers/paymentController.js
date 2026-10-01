const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const Payment = require('../models/Payment');
const PaymentWebhookEvent = require('../models/PaymentWebhookEvent');
const User = require('../models/User');
const { convertUsdToInr } = require('../utils/currency');
const { verifyCheckoutSignature, verifyWebhookSignature } = require('../utils/paymentSignatures');
const { creditWallet } = require('../utils/walletCredits');

const STARTER_AMOUNT_USD = 25;
const ORDER_TTL_MS = 15 * 60 * 1000;

function getRazorpayClient() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('Razorpay is not configured');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function checkoutDetails(payment) {
  return {
    paymentId: payment._id,
    orderId: payment.razorpayOrderId,
    keyId: process.env.RAZORPAY_KEY_ID,
    amount: payment.amountInrPaise,
    currency: 'INR',
    amountUsd: payment.amountUsd,
    exchangeRate: payment.exchangeRate,
    rateUpdatedAt: payment.rateUpdatedAt,
    quotedAt: payment.quotedAt,
    method: payment.method,
    expiresAt: payment.expiresAt,
  };
}

async function createOrder(req, res) {
  try {
    const { method, amount } = req.body;
    const idempotencyKey = req.get('Idempotency-Key');

    if (!['upi', 'bank'].includes(method)) {
      return res.status(400).json({ error: 'method must be upi or bank' });
    }
    if (amount !== undefined && Number(amount) !== STARTER_AMOUNT_USD) {
      return res.status(400).json({ error: `Starter payment is fixed at ${STARTER_AMOUNT_USD} USD` });
    }
    if (!idempotencyKey || !/^[\w:.-]{8,128}$/.test(idempotencyKey)) {
      return res.status(400).json({ error: 'A valid Idempotency-Key header is required' });
    }
    let razorpay;
    try {
      razorpay = getRazorpayClient();
    } catch {
      return res.status(503).json({ error: 'Payment provider is not configured' });
    }

    const now = new Date();
    await Payment.updateMany(
      { userId: req.user._id, hasOpenOrder: true, expiresAt: { $lte: now } },
      { $set: { status: 'EXPIRED', hasOpenOrder: false } }
    );
    const existing = await Payment.findOne({ userId: req.user._id, idempotencyKey });
    if (existing) {
      if (existing.status === 'CREATED') return res.json(checkoutDetails(existing));
      return res.status(409).json({ error: `Payment attempt is ${existing.status.toLowerCase()}` });
    }

    const user = await User.findById(req.user._id).select('starterPlanActive');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.starterPlanActive) {
      return res.status(409).json({ error: 'Starter plan is already active' });
    }

    const openPayment = await Payment.findOne({ userId: user._id, hasOpenOrder: true });
    if (openPayment) {
      return res.status(409).json({
        error: 'A starter payment order is already open',
        paymentId: openPayment._id,
      });
    }

    const quote = await convertUsdToInr(STARTER_AMOUNT_USD);
    const amountInrPaise = Math.round(quote.amountInr * 100);
    const expiresAt = new Date(now.getTime() + ORDER_TTL_MS);
    const payment = await Payment.create({
      userId: user._id,
      amountUsd: STARTER_AMOUNT_USD,
      amountInrPaise,
      currency: 'INR',
      exchangeRate: quote.rate,
      rateUpdatedAt: quote.rateUpdatedAt,
      quotedAt: new Date(quote.quotedAt),
      method,
      idempotencyKey,
      hasOpenOrder: true,
      expiresAt,
    });

    let order;
    try {
      order = await razorpay.orders.create({
        amount: amountInrPaise,
        currency: 'INR',
        receipt: `SE${payment._id}`,
        expire_by: Math.floor(expiresAt.getTime() / 1000),
        notes: {
          paymentId: String(payment._id),
          userId: String(user._id),
          method,
          product: 'STARTER_PLAN',
        },
      });
    } catch (error) {
      await Payment.updateOne(
        { _id: payment._id, status: 'CREATING' },
        { $set: { status: 'FAILED', hasOpenOrder: false, failureReason: 'Order creation failed' } }
      );
      console.error('[payment] Razorpay order creation failed:', error.message);
      return res.status(502).json({ error: 'Unable to create payment order' });
    }

    if (order.currency !== 'INR' || order.amount !== amountInrPaise) {
      await Payment.updateOne(
        { _id: payment._id },
        { $set: { status: 'FAILED', hasOpenOrder: false, failureReason: 'Provider order mismatch' } }
      );
      return res.status(502).json({ error: 'Payment provider returned an invalid order' });
    }

    payment.razorpayOrderId = order.id;
    payment.status = 'CREATED';
    await payment.save();
    return res.status(201).json(checkoutDetails(payment));
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'An order already exists for this payment attempt' });
    }
    if (error.message === 'Razorpay is not configured') {
      return res.status(503).json({ error: 'Payment provider is not configured' });
    }
    if (error instanceof RangeError) return res.status(400).json({ error: error.message });
    console.error('[payment] Order request failed:', error.message);
    return res.status(503).json({ error: 'Unable to prepare payment order' });
  }
}

async function applyCapturedPayment(paymentId, providerPayment, event) {
  const session = await mongoose.startSession();
  let outcome;

  try {
    await session.withTransaction(async () => {
      if (event?.eventId) {
        const duplicateEvent = await PaymentWebhookEvent.exists({ eventId: event.eventId }).session(session);
        if (duplicateEvent) {
          outcome = { duplicateEvent: true };
          return;
        }
      }

      const payment = await Payment.findById(paymentId).session(session);
      if (!payment) throw new Error('Payment record not found');
      if (
        providerPayment.order_id !== payment.razorpayOrderId ||
        providerPayment.amount !== payment.amountInrPaise ||
        providerPayment.currency !== 'INR' ||
        providerPayment.status !== 'captured'
      ) {
        throw new Error('Captured payment does not match the stored order');
      }

      if (payment.status === 'PAID') {
        outcome = { alreadyPaid: true, payment };
      } else {
        const user = await User.findById(payment.userId).session(session);
        if (!user) throw new Error('Payment user not found');

        if (user.starterPlanActive) {
          payment.status = 'DUPLICATE_PAID';
          payment.hasOpenOrder = false;
          payment.razorpayPaymentId = providerPayment.id;
          payment.capturedAt = new Date((providerPayment.created_at || Math.floor(Date.now() / 1000)) * 1000);
          await payment.save({ session });
          outcome = { duplicatePaid: true, payment };
        } else {
          await creditWallet(
            session,
            payment.userId,
            payment.amountUsd,
            'deposits',
            `payment:${payment._id}`
          );
          user.starterPlanActive = true;
          user.starterActivatedAt = new Date();
          await user.save({ session });

          payment.status = 'PAID';
          payment.hasOpenOrder = false;
          payment.razorpayPaymentId = providerPayment.id;
          payment.capturedAt = new Date((providerPayment.created_at || Math.floor(Date.now() / 1000)) * 1000);
          await payment.save({ session });
          outcome = { paid: true, payment };
        }
      }

      if (event?.eventId) {
        await PaymentWebhookEvent.create(
          [{
            eventId: event.eventId,
            eventName: event.eventName,
            paymentId: payment._id,
            providerPaymentId: providerPayment.id,
          }],
          { session }
        );
      }
    });
    return outcome;
  } finally {
    await session.endSession();
  }
}

async function verifyPayment(req, res) {
  try {
    let razorpay;
    try {
      razorpay = getRazorpayClient();
    } catch {
      return res.status(503).json({ error: 'Payment provider is not configured' });
    }
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;
    if (!verifyCheckoutSignature(orderId, paymentId, signature, process.env.RAZORPAY_KEY_SECRET)) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const payment = await Payment.findOne({ razorpayOrderId: orderId, userId: req.user._id });
    if (!payment) return res.status(404).json({ error: 'Payment order not found' });

    const providerPayment = await razorpay.payments.fetch(paymentId);
    if (providerPayment.order_id !== orderId) {
      return res.status(400).json({ error: 'Payment does not belong to this order' });
    }
    if (providerPayment.status !== 'captured') {
      return res.status(409).json({ error: 'Payment has not been captured yet', status: providerPayment.status });
    }

    const result = await applyCapturedPayment(payment._id, providerPayment);
    if (result.duplicatePaid) {
      return res.status(409).json({
        error: 'Payment was captured after the starter plan had already been activated; manual refund review is required',
        paymentStatus: result.payment.status,
      });
    }
    return res.json({ message: 'Payment verified', paymentStatus: result.payment.status });
  } catch (error) {
    console.error('[payment] Checkout verification failed:', error.message);
    return res.status(400).json({ error: error.message });
  }
}

async function storeWebhookEvent(eventId, eventName, payment, providerPayment) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const duplicate = await PaymentWebhookEvent.exists({ eventId }).session(session);
      if (duplicate) return;
      const currentPayment = await Payment.findById(payment._id).session(session);
      if (currentPayment && currentPayment.status === 'CREATED') {
        currentPayment.failureReason = providerPayment.error_description || 'Payment attempt failed';
        await currentPayment.save({ session });
      }
      await PaymentWebhookEvent.create(
        [{
          eventId,
          eventName,
          paymentId: payment._id,
          providerPaymentId: providerPayment.id,
        }],
        { session }
      );
    });
  } finally {
    await session.endSession();
  }
}

async function webhook(req, res) {
  const signature = req.get('X-Razorpay-Signature');
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!req.rawBody || !signature || !secret) {
    return res.status(400).json({ error: 'Webhook signature or raw request body is missing' });
  }

  try {
    if (!verifyWebhookSignature(req.rawBody, signature, secret)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  } catch {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const eventId = req.get('X-Razorpay-Event-Id');
  const eventName = req.body?.event;
  if (!eventId || !eventName) return res.status(400).json({ error: 'Webhook event headers are missing' });
  if (!['payment.captured', 'payment.failed'].includes(eventName)) {
    return res.json({ received: true, ignored: true });
  }

  try {
    const providerPayment = req.body?.payload?.payment?.entity;
    if (!providerPayment?.order_id || !providerPayment.id) {
      return res.status(400).json({ error: 'Webhook payment details are missing' });
    }
    const payment = await Payment.findOne({ razorpayOrderId: providerPayment.order_id });
    if (!payment) return res.status(404).json({ error: 'Payment order not found' });

    if (eventName === 'payment.failed') {
      await storeWebhookEvent(eventId, eventName, payment, providerPayment);
      return res.json({ received: true });
    }

    const result = await applyCapturedPayment(payment._id, providerPayment, { eventId, eventName });
    return res.json({
      received: true,
      duplicateEvent: Boolean(result.duplicateEvent),
      paymentStatus: result.payment?.status,
      manualRefundReview: Boolean(result.duplicatePaid),
    });
  } catch (error) {
    if (error.code === 11000) return res.json({ received: true, duplicateEvent: true });
    console.error('[payment] Webhook processing failed:', error.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

async function getPaymentStatus(req, res) {
  try {
    const payment = await Payment.findOne({ _id: req.params.paymentId, userId: req.user._id });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    return res.json({
      payment: {
        id: payment._id,
        amountUsd: payment.amountUsd,
        amountInrPaise: payment.amountInrPaise,
        currency: payment.currency,
        status: payment.status,
        razorpayOrderId: payment.razorpayOrderId,
        expiresAt: payment.expiresAt,
        capturedAt: payment.capturedAt,
      },
    });
  } catch {
    return res.status(400).json({ error: 'Invalid payment id' });
  }
}

module.exports = { createOrder, verifyPayment, webhook, getPaymentStatus };
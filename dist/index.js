"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServerMetrics = exports.getServerHealth = exports.serverManager = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const env_1 = require("./config/env");
const logger_1 = require("./utils/logger");
const webhook_1 = require("./controllers/webhook");
const queueScheduler_1 = require("./services/queueScheduler");
const connection_1 = require("./db/connection");
const payment_1 = __importDefault(require("./routes/payment"));
const booking_1 = require("./controllers/booking");
const whatsapp_1 = require("./services/whatsapp");
const payment_2 = require("./services/payment");
const crypto_1 = __importDefault(require("crypto"));
const getErrorMessage = (error) => {
    if (error instanceof Error)
        return error.message;
    if (typeof error === 'string')
        return error;
    return 'Unknown error occurred';
};
const getErrorStack = (error) => error instanceof Error ? error.stack : undefined;
const app = (0, express_1.default)();
exports.app = app;
const port = env_1.env.PORT || 3000;
app.use((0, helmet_1.default)({
    contentSecurityPolicy: env_1.env.NODE_ENV === 'production' ? undefined : false,
    crossOriginEmbedderPolicy: false,
    hsts: env_1.env.NODE_ENV === 'production',
}));
app.use((0, cors_1.default)({
    origin: env_1.env.NODE_ENV === 'production'
        ? env_1.env.ALLOWED_ORIGINS || false
        : true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.use(express_1.default.json({
    limit: env_1.env.REQUEST_SIZE_LIMIT,
    strict: true,
    type: ['application/json', 'text/plain'],
}));
app.use(express_1.default.urlencoded({
    extended: true,
    limit: env_1.env.REQUEST_SIZE_LIMIT,
    parameterLimit: 50,
}));
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = env_1.env.RATE_LIMIT_WINDOW;
const RATE_LIMIT_MAX = env_1.env.RATE_LIMIT_MAX;
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimitMap.entries()) {
        if (now > data.resetTime)
            rateLimitMap.delete(ip);
    }
}, RATE_LIMIT_WINDOW);
app.use((req, res, next) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let limitData = rateLimitMap.get(clientIp);
    if (!limitData || now > limitData.resetTime) {
        limitData = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
    }
    else {
        limitData.count += 1;
    }
    rateLimitMap.set(clientIp, limitData);
    if (limitData.count > RATE_LIMIT_MAX) {
        res.status(429).json({
            error: 'Rate limit exceeded',
            retryAfter: Math.ceil((limitData.resetTime - now) / 1000),
        });
        return;
    }
    res.set({
        'X-RateLimit-Limit': RATE_LIMIT_MAX.toString(),
        'X-RateLimit-Remaining': Math.max(0, RATE_LIMIT_MAX - limitData.count).toString(),
        'X-RateLimit-Reset': Math.ceil(limitData.resetTime / 1000).toString(),
    });
    next();
});
app.use((req, res, next) => {
    const startTime = Date.now();
    const shouldLog = env_1.env.NODE_ENV === 'development' ||
        req.path.startsWith('/webhook') ||
        req.path === '/health' ||
        req.path === '/';
    if (shouldLog) {
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
            logger_1.logger[logLevel]('HTTP Request', {
                method: req.method,
                path: req.path,
                status: res.statusCode,
                duration: `${duration}ms`,
                ip: req.ip,
                userAgent: req.get('User-Agent')?.substring(0, 100),
            });
        });
    }
    next();
});
app.use('/api/payment', payment_1.default);
app.post('/', async (req, res) => {
    const userAgent = req.headers['user-agent'] || '';
    if (userAgent.includes('Razorpay')) {
        try {
            logger_1.logger.info('📥 Razorpay webhook received at root', {
                event: req.body?.event,
                paymentLinkId: req.body?.payload?.payment_link?.entity?.id,
            });
            const webhookSignature = req.headers['x-razorpay-signature'];
            const webhookBody = req.body;
            if (env_1.env.RAZORPAY_WEBHOOK_SECRET) {
                const expectedSignature = crypto_1.default
                    .createHmac('sha256', env_1.env.RAZORPAY_WEBHOOK_SECRET)
                    .update(JSON.stringify(webhookBody))
                    .digest('hex');
                if (webhookSignature !== expectedSignature) {
                    logger_1.logger.error('❌ Invalid Razorpay webhook signature');
                    return res.status(400).json({ error: 'Invalid signature' });
                }
            }
            const event = webhookBody.event;
            if (event === 'payment_link.paid') {
                const paymentLink = webhookBody.payload?.payment_link?.entity;
                const referenceId = paymentLink?.reference_id;
                logger_1.logger.info('✅ Payment link paid event', { referenceId, event });
                if (referenceId && referenceId.startsWith('book_')) {
                    const parts = referenceId.split('_');
                    if (parts.length >= 3) {
                        const whatsappId = parts[1];
                        const stationId = parseInt(parts[2]);
                        logger_1.logger.info(' Confirming booking after payment', {
                            whatsappId,
                            stationId,
                            referenceId
                        });
                        setImmediate(async () => {
                            try {
                                await booking_1.bookingController.handleJoinQueue(whatsappId, stationId);
                                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '*Payment Confirmed!*\n\n' +
                                    'Your booking is complete.\n\n' +
                                    'You can now join the queue or start charging when you arrive at the station.');
                                logger_1.logger.info('Booking confirmed successfully after payment', {
                                    whatsappId,
                                    stationId
                                });
                            }
                            catch (error) {
                                logger_1.logger.error('Failed to confirm booking after payment', {
                                    whatsappId,
                                    stationId,
                                    error: getErrorMessage(error),
                                    stack: getErrorStack(error)
                                });
                                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Payment received but booking confirmation failed.\n\n' +
                                    'Please contact support with your payment reference.');
                            }
                        });
                    }
                }
                if (referenceId && referenceId.startsWith('session_')) {
                    logger_1.logger.info('⚡ Session payment confirmed', { referenceId });
                    const parts = referenceId.split('_');
                    if (parts.length >= 2) {
                        const sessionId = parts[1];
                        setImmediate(async () => {
                            try {
                                const paymentInfo = payment_2.paymentService.getPaymentFromCache(referenceId);
                                if (paymentInfo) {
                                    await whatsapp_1.whatsappService.sendTextMessage(paymentInfo.userWhatsappId, '*Payment Confirmed!*\n\n' +
                                        '🎉 Thank you for using SharaSpot!\n\n' +
                                        'Your charging session payment has been received.\n\n' +
                                        'Drive safe! 🚗⚡');
                                    logger_1.logger.info('✅ Session payment confirmation sent', {
                                        userWhatsapp: paymentInfo.userWhatsappId,
                                        sessionId,
                                        referenceId,
                                        amount: paymentInfo.amount
                                    });
                                }
                                else {
                                    logger_1.logger.warn('⚠️ Payment info not found in cache', {
                                        referenceId,
                                        sessionId
                                    });
                                }
                            }
                            catch (error) {
                                logger_1.logger.error('❌ Failed to send session payment confirmation', {
                                    sessionId,
                                    referenceId,
                                    error: getErrorMessage(error),
                                    stack: getErrorStack(error)
                                });
                            }
                        });
                    }
                    else {
                        logger_1.logger.error('❌ Invalid session payment reference ID format', { referenceId });
                    }
                }
            }
            if (event === 'payment_link.cancelled') {
                const paymentLink = webhookBody.payload?.payment_link?.entity;
                const referenceId = paymentLink?.reference_id;
                logger_1.logger.warn('❌ Payment link cancelled', { referenceId });
            }
            if (event === 'payment_link.expired') {
                const paymentLink = webhookBody.payload?.payment_link?.entity;
                const referenceId = paymentLink?.reference_id;
                logger_1.logger.warn('⏰ Payment link expired', { referenceId });
            }
            return res.status(200).json({ status: 'ok' });
        }
        catch (error) {
            logger_1.logger.error('❌ Razorpay webhook processing error', {
                error: getErrorMessage(error),
                stack: getErrorStack(error)
            });
            return res.status(500).json({ error: 'Webhook processing error' });
        }
    }
    return webhook_1.webhookController.handleWebhook(req, res);
});
app.get('/', (_req, res) => {
    res.status(200).json({
        name: 'SharaSpot Bot Server',
        status: 'running',
        version: process.env.npm_package_version || '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: '/health',
            whatsappWebhook: '/webhook',
            paymentCallback: '/api/payment/callback',
            razorpayWebhook: '/ (POST with Razorpay user-agent)',
        },
    });
});
app.get('/health', async (_req, res) => {
    try {
        const healthStatus = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            service: 'sharaspot-bot',
            version: process.env.npm_package_version || '1.0.0',
            environment: env_1.env.NODE_ENV,
            uptime: Math.floor(process.uptime()),
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            },
        };
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.status(200).json(healthStatus);
    }
    catch (error) {
        const errorMessage = getErrorMessage(error);
        logger_1.logger.error('Health check failed', { error: errorMessage });
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: env_1.env.NODE_ENV === 'development' ? errorMessage : 'Service unavailable',
        });
    }
});
app.get('/webhook', webhook_1.webhookController.verifyWebhook.bind(webhook_1.webhookController));
app.post('/webhook', webhook_1.webhookController.handleWebhook.bind(webhook_1.webhookController));
app.use('/api/v1', (_req, res) => {
    res.status(501).json({
        message: 'API endpoints coming soon',
        version: 'v1',
        timestamp: new Date().toISOString(),
    });
});
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString(),
        suggestion: req.originalUrl.includes('webhook')
            ? 'Check webhook configuration'
            : 'Verify endpoint URL',
    });
});
app.use((err, req, res, _next) => {
    const errorId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    const errorMessage = getErrorMessage(err);
    const errorStack = getErrorStack(err);
    const statusCode = err?.status || err?.statusCode || 500;
    logger_1.logger.error('Unhandled application error', {
        errorId,
        message: errorMessage,
        stack: env_1.env.NODE_ENV === 'development' ? errorStack : undefined,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')?.substring(0, 100),
    });
    const errorResponse = {
        error: 'Internal server error',
        errorId,
        timestamp: new Date().toISOString(),
        ...(env_1.env.NODE_ENV === 'development' && { message: errorMessage, stack: errorStack }),
    };
    res.status(statusCode).json(errorResponse);
});
class ServerManager {
    constructor() {
        this.server = null;
        this.isShuttingDown = false;
    }
    async start() {
        try {
            logger_1.logger.info('🚀 Starting SharaSpot Bot Server');
            await this.initializeDatabaseWithTimeout();
            this.server = app.listen(port, () => {
                logger_1.logger.info('✅ SharaSpot Bot Server Ready', {
                    port,
                    environment: env_1.env.NODE_ENV,
                    whatsappWebhookUrl: `${env_1.env.APP_BASE_URL}/webhook`,
                    paymentCallbackUrl: `${env_1.env.APP_BASE_URL}/api/payment/callback`,
                    razorpayWebhookUrl: `${env_1.env.APP_BASE_URL}/ (POST)`,
                    healthUrl: `${env_1.env.APP_BASE_URL}/health`,
                    pid: process.pid,
                    nodeVersion: process.version,
                });
            });
            await this.startBackgroundServices();
            this.setupGracefulShutdown();
        }
        catch (error) {
            logger_1.logger.error('💥 Server startup failed', { error: getErrorMessage(error) });
            process.exit(1);
        }
    }
    async initializeDatabaseWithTimeout() {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Database connection timeout')), 10000));
        try {
            await Promise.race([(0, connection_1.initializeDatabase)(), timeout]);
            logger_1.logger.info('✅ Database connected successfully');
        }
        catch (error) {
            logger_1.logger.error('❌ Database connection failed', { error: getErrorMessage(error) });
            throw error;
        }
    }
    async startBackgroundServices() {
        if (env_1.env.ENABLE_QUEUE_SCHEDULER) {
            try {
                await queueScheduler_1.QueueScheduler.runScheduler();
                logger_1.logger.info('🤖 Queue scheduler started');
            }
            catch (error) {
                logger_1.logger.warn('⚠️ Queue scheduler failed to start', { error: getErrorMessage(error) });
            }
        }
        else {
            logger_1.logger.info('⏸️ Queue scheduler disabled');
        }
    }
    setupGracefulShutdown() {
        const handleShutdown = async (signal) => {
            if (this.isShuttingDown)
                return;
            this.isShuttingDown = true;
            logger_1.logger.info(`🛑 ${signal} received — starting graceful shutdown`);
            const shutdownTimeout = setTimeout(() => {
                logger_1.logger.error('💥 Forced shutdown due to timeout');
                process.exit(1);
            }, 30000);
            try {
                if (this.server) {
                    await new Promise((resolve, reject) => this.server.close((err) => (err ? reject(err) : resolve())));
                    logger_1.logger.info('🛑 HTTP server stopped');
                }
                rateLimitMap.clear();
                clearTimeout(shutdownTimeout);
                logger_1.logger.info('✅ Graceful shutdown completed');
                process.exit(0);
            }
            catch (error) {
                logger_1.logger.error('💥 Error during shutdown', { error: getErrorMessage(error) });
                clearTimeout(shutdownTimeout);
                process.exit(1);
            }
        };
        process.on('SIGTERM', () => handleShutdown('SIGTERM'));
        process.on('SIGINT', () => handleShutdown('SIGINT'));
        process.on('uncaughtException', (error) => {
            logger_1.logger.error('💥 Uncaught Exception', { error: error.message, stack: error.stack });
            handleShutdown('uncaughtException');
        });
        process.on('unhandledRejection', (reason) => {
            logger_1.logger.error('💥 Unhandled Promise Rejection', { reason: getErrorMessage(reason) });
            handleShutdown('unhandledRejection');
        });
    }
}
const serverManager = new ServerManager();
exports.serverManager = serverManager;
if (require.main === module) {
    serverManager.start().catch((error) => {
        logger_1.logger.error('💥 Failed to start server', { error: getErrorMessage(error) });
        process.exit(1);
    });
}
const getServerHealth = async () => ({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    environment: env_1.env.NODE_ENV,
    activeConnections: rateLimitMap.size,
});
exports.getServerHealth = getServerHealth;
const getServerMetrics = () => ({
    activeRateLimitEntries: rateLimitMap.size,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    environment: env_1.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
});
exports.getServerMetrics = getServerMetrics;
//# sourceMappingURL=index.js.map
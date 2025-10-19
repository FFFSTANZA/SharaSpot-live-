// src/index.ts

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { logger } from './utils/logger';
import { webhookController } from './controllers/webhook';
import { QueueScheduler } from './services/queueScheduler'; // ✅ Correct import path
import { initializeDatabase } from './db/connection';

// ===============================================
// TYPE-SAFE ERROR HANDLING UTILITIES
// ===============================================

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error occurred';
};

const getErrorStack = (error: unknown): string | undefined =>
  error instanceof Error ? error.stack : undefined;

// ===============================================
// EXPRESS APP CONFIGURATION
// ===============================================

const app = express();
const port = env.PORT || 3000;

// ===============================================
// SECURITY & MIDDLEWARE STACK
// ===============================================

app.use(
  helmet({
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
    crossOriginEmbedderPolicy: false,
    hsts: env.NODE_ENV === 'production',
  })
);

app.use(
  cors({
    origin:
      env.NODE_ENV === 'production'
        ? process.env.ALLOWED_ORIGINS?.split(',') || false
        : true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

app.use(
  express.json({
    limit: '5mb',
    strict: true,
    type: ['application/json', 'text/plain'],
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '5mb',
    parameterLimit: 50,
  })
);

// ===============================================
// SMART RATE LIMITING (memory-safe)
// ===============================================

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = env.NODE_ENV === 'production' ? 60 : 100;

setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now > data.resetTime) rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW);

app.use((req: Request, res: Response, next: NextFunction) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let limitData = rateLimitMap.get(clientIp);
  if (!limitData || now > limitData.resetTime) {
    limitData = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
  } else {
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

// ===============================================
// REQUEST LOGGING
// ===============================================

app.use((req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  const shouldLog =
    env.NODE_ENV === 'development' ||
    req.path.startsWith('/webhook') ||
    req.path === '/health' ||
    req.path === '/';

  if (shouldLog) {
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const logLevel = res.statusCode >= 400 ? 'warn' : 'info';

      logger[logLevel]('HTTP Request', {
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

// ===============================================
// HEALTH & ROOT ENDPOINTS
// ===============================================

app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    name: 'SharaSpot Bot Server',
    status: 'running',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      webhook: '/webhook',
      api: '/api/v1',
    },
  });
});

app.get('/health', async (_req: Request, res: Response) => {
  try {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'sharaspot-bot',
      version: process.env.npm_package_version || '1.0.0',
      environment: env.NODE_ENV,
      uptime: Math.floor(process.uptime()),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
    };

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(200).json(healthStatus);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('Health check failed', { error: errorMessage });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: env.NODE_ENV === 'development' ? errorMessage : 'Service unavailable',
    });
  }
});

// ===============================================
// WEBHOOK ROUTES
// ===============================================

app.get('/webhook', webhookController.verifyWebhook.bind(webhookController));
app.post('/webhook', webhookController.handleWebhook.bind(webhookController));

// ===============================================
// API ROUTE PLACEHOLDER
// ===============================================

app.use('/api/v1', (_req: Request, res: Response) => {
  res.status(501).json({
    message: 'API endpoints coming soon',
    version: 'v1',
    timestamp: new Date().toISOString(),
  });
});

// ===============================================
// 404 HANDLER
// ===============================================

app.use('*', (req: Request, res: Response) => {
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

// ===============================================
// GLOBAL ERROR HANDLER
// ===============================================

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const errorId = Date.now().toString(36) + Math.random().toString(36).substring(2);
  const errorMessage = getErrorMessage(err);
  const errorStack = getErrorStack(err);
  const statusCode = (err as any)?.status || (err as any)?.statusCode || 500;

  logger.error('Unhandled application error', {
    errorId,
    message: errorMessage,
    stack: env.NODE_ENV === 'development' ? errorStack : undefined,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')?.substring(0, 100),
  });

  const errorResponse = {
    error: 'Internal server error',
    errorId,
    timestamp: new Date().toISOString(),
    ...(env.NODE_ENV === 'development' && { message: errorMessage, stack: errorStack }),
  };

  res.status(statusCode).json(errorResponse);
});

// ===============================================
// SERVER LIFECYCLE MANAGEMENT
// ===============================================

class ServerManager {
  private server: ReturnType<typeof app.listen> | null = null;
  private isShuttingDown = false;

  async start(): Promise<void> {
    try {
      logger.info('🚀 Starting SharaSpot Bot Server');
      await this.initializeDatabaseWithTimeout();

      this.server = app.listen(port, () => {
        logger.info('✅ SharaSpot Bot Server Ready', {
          port,
          environment: env.NODE_ENV,
          webhookUrl: `http://localhost:${port}/webhook`,
          healthUrl: `http://localhost:${port}/health`,
          pid: process.pid,
          nodeVersion: process.version,
        });
      });

      await this.startBackgroundServices();
      this.setupGracefulShutdown();
    } catch (error) {
      logger.error('💥 Server startup failed', { error: getErrorMessage(error) });
      process.exit(1);
    }
  }

  private async initializeDatabaseWithTimeout(): Promise<void> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Database connection timeout')), 10_000)
    );

    try {
      await Promise.race([initializeDatabase(), timeout]);
      logger.info('✅ Database connected successfully');
    } catch (error) {
      logger.error('❌ Database connection failed', { error: getErrorMessage(error) });
      throw error;
    }
  }

  private async startBackgroundServices(): Promise<void> {
    const shouldStartScheduler = process.env.ENABLE_QUEUE_SCHEDULER !== 'false';
    if (shouldStartScheduler) {
      try {
        await QueueScheduler.runScheduler();
        logger.info('🤖 Queue scheduler started');
      } catch (error) {
        logger.warn('⚠️ Queue scheduler failed to start', { error: getErrorMessage(error) });
      }
    } else {
      logger.info('⏸️ Queue scheduler disabled');
    }
  }

  private setupGracefulShutdown(): void {
    const handleShutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      logger.info(`🛑 ${signal} received — starting graceful shutdown`);

      const shutdownTimeout = setTimeout(() => {
        logger.error('💥 Forced shutdown due to timeout');
        process.exit(1);
      }, 30_000);

      try {
        if (this.server) {
          await new Promise<void>((resolve, reject) =>
            this.server!.close((err) => (err ? reject(err) : resolve()))
          );
          logger.info('🛑 HTTP server stopped');
        }

        rateLimitMap.clear();
        clearTimeout(shutdownTimeout);
        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('💥 Error during shutdown', { error: getErrorMessage(error) });
        clearTimeout(shutdownTimeout);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('uncaughtException', (error) => {
      logger.error('💥 Uncaught Exception', { error: error.message, stack: error.stack });
      handleShutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
      logger.error('💥 Unhandled Promise Rejection', { reason: getErrorMessage(reason) });
      handleShutdown('unhandledRejection');
    });
  }
}

// ===============================================
// SERVER INITIALIZATION
// ===============================================

const serverManager = new ServerManager();

if (require.main === module) {
  serverManager.start().catch((error) => {
    logger.error('💥 Failed to start server', { error: getErrorMessage(error) });
    process.exit(1);
  });
}

// ===============================================
// EXPORTS FOR TESTING / METRICS
// ===============================================

export { app, serverManager };

export const getServerHealth = async () => ({
  status: 'healthy',
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
  memory: process.memoryUsage(),
  environment: env.NODE_ENV,
  activeConnections: rateLimitMap.size,
});

export const getServerMetrics = () => ({
  activeRateLimitEntries: rateLimitMap.size,
  uptime: process.uptime(),
  memoryUsage: process.memoryUsage(),
  environment: env.NODE_ENV,
  version: process.env.npm_package_version || '1.0.0',
});

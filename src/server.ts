import 'dotenv/config';
import express, { Application, Request, Response } from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import { connectDB, createRedisClient, disconnectAll, config } from './config';
import { WalletService, AuctionService, SchedulerService } from './services';
import { AuctionController, errorHandler } from './controllers/AuctionController';
import { createAuctionRoutes } from './routes/auctionRoutes';
import { createUserRoutes } from './routes/userRoutes';
import type { Redis } from 'ioredis';

const app: Application = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

let redis: Redis;
let scheduler: SchedulerService;

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

const setupServices = (): { auctionService: AuctionService } => {
  const walletService = new WalletService();
  const auctionService = new AuctionService(walletService, redis, io);
  const auctionController = new AuctionController(auctionService);

  app.use('/api/auctions', createAuctionRoutes(auctionController));
  app.use('/api/users', createUserRoutes());

  return { auctionService };
};

const startServer = async (): Promise<void> => {
  try {
    await connectDB();
    
    redis = createRedisClient();
    
    await redis.ping();
    console.log('✅ Redis ping successful');

    const { auctionService } = setupServices();

    scheduler = new SchedulerService(auctionService, io);
    scheduler.start();

    io.on('connection', (socket: { id: string; on: (event: string, callback: () => void) => void }) => {
      console.log(`🔌 Client connected: ${socket.id}`);
      socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected: ${socket.id}`);
      });
    });

    app.use((_req: Request, res: Response) => {
      res.status(404).json({ error: 'Not Found' });
    });

    app.use(errorHandler);

    httpServer.listen(config.port, () => {
      console.log(`🚀 Server running on port ${config.port}`);
      console.log(`📍 Environment: ${config.nodeEnv}`);
      console.log(`🔌 WebSocket ready`);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

const gracefulShutdown = async (signal: string): Promise<void> => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  try {
    if (scheduler) {
      scheduler.stop();
    }
    await disconnectAll(redis);
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();

export { app, redis };

import mongoose from 'mongoose';
import Redis from 'ioredis';

export const connectDB = async (): Promise<void> => {
  const mongoUri = process.env.MONGODB_URI;
  
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not defined in environment variables');
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected successfully');
    
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected. Attempting to reconnect...');
    });

  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    throw error;
  }
};

export const createRedisClient = (): Redis => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

  const redis = new Redis({
    host: redisHost,
    port: redisPort,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      if (times > 3) {
        console.error('❌ Redis connection failed after 3 retries');
        return null;
      }
      return Math.min(times * 200, 2000);
    },
  });

  redis.on('connect', () => {
    console.log('✅ Redis connected successfully');
  });

  redis.on('error', (err) => {
    console.error('Redis connection error:', err);
  });

  redis.on('close', () => {
    console.warn('Redis connection closed');
  });

  return redis;
};

export const disconnectAll = async (redis: Redis): Promise<void> => {
  await mongoose.disconnect();
  await redis.quit();
  console.log('🔌 All database connections closed');
};

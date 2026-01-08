export * from './database';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  antiSnipeWindowSeconds: parseInt(process.env.ANTI_SNIPE_WINDOW_SECONDS || '30', 10),
  antiSnipeExtensionSeconds: parseInt(process.env.ANTI_SNIPE_EXTENSION_SECONDS || '30', 10),
};

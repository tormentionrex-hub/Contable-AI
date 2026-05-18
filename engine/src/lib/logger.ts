import winston from 'winston';
import { config } from '../config.js';

const { combine, timestamp, printf, json, errors, colorize, splat } = winston.format;

const prettyFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : '';
  return `${timestamp} [${level}] ${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: config.logLevel,
  format: config.isProd
    ? combine(timestamp(), errors({ stack: true }), splat(), json())
    : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), splat(), prettyFormat),
  transports: [new winston.transports.Console()],
  silent: config.isTest && process.env.LOG_LEVEL !== 'debug',
});

export function child(bindings: Record<string, unknown>): winston.Logger {
  return logger.child(bindings);
}

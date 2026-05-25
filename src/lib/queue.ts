import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from './logger';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

let connection: IORedis | null = null;
function getConnection() {
  if (!connection) {
    connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    connection.on('error', (e) => logger.error('Redis connection error', { err: e.message }));
  }
  return connection;
}

export const QUEUE_NAMES = {
  publish: 'socialflow:publish',
  ai: 'socialflow:ai',
  watch: 'socialflow:watch',
  automation: 'socialflow:automation',
  analytics: 'socialflow:analytics',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName, opts?: Partial<QueueOptions>): Queue {
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, {
        connection: getConnection(),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
        ...opts,
      }),
    );
  }
  return queues.get(name)!;
}

export function createWorker(
  name: QueueName,
  processor: Processor,
  opts?: Partial<WorkerOptions>,
): Worker {
  return new Worker(name, processor, {
    connection: getConnection(),
    concurrency: 5,
    ...opts,
  });
}

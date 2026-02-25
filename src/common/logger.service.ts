import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { getRequestId } from './request-context';

type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

function write(level: LogLevel, message: string, context?: string, stack?: string) {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (context) payload.context = context;
  const requestId = getRequestId();
  if (requestId) payload.requestId = requestId;
  if (stack) payload.stack = stack;
  const line = JSON.stringify(payload);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

@Injectable()
export class LoggerService implements NestLoggerService {
  log(message: string, context?: string) {
    write('log', message, context);
  }

  error(message: string, stack?: string, context?: string) {
    write('error', message, context, stack);
  }

  warn(message: string, context?: string) {
    write('warn', message, context);
  }

  debug(message: string, context?: string) {
    write('debug', message, context);
  }

  verbose(message: string, context?: string) {
    write('verbose', message, context);
  }
}

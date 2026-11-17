import { Logger } from '@nestjs/common';
import { LoggerPort } from '../../application/ports/logger.port';

/** LoggerPort backed by Nest's logger; context is appended as JSON. */
export class NestLoggerAdapter implements LoggerPort {
  private readonly logger: Logger;

  constructor(context: string) {
    this.logger = new Logger(context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.logger.log(this.format(message, context));
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.logger.warn(this.format(message, context));
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.logger.error(this.format(message, context));
  }

  private format(message: string, context?: Record<string, unknown>): string {
    return context && Object.keys(context).length > 0 ? `${message} ${JSON.stringify(context)}` : message;
  }
}

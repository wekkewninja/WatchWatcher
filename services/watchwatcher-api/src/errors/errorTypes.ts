import { AppError } from './AppError';

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) { super(422, 'VALIDATION_ERROR', message, details); }
}
export class ConflictError extends AppError {
  constructor(message: string) { super(409, 'CONFLICT', message); }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') { super(401, 'UNAUTHORIZED', message); }
}
export class ServiceUnavailableError extends AppError {
  constructor(message = 'A required service is unavailable') { super(503, 'SERVICE_UNAVAILABLE', message); }
}

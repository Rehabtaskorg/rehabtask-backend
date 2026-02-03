/**
 * Base API Error class
 */
export class APIError extends Error {
    constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Authentication errors (401)
 */
export class AuthenticationError extends APIError {
    constructor(message = "Authentication required", code = "UNAUTHORIZED") {
        super(message, 401, code);
    }
}

/**
 * Authorization errors (403)
 */
export class AuthorizationError extends APIError {
    constructor(message = "Insufficient permissions", code = "FORBIDDEN") {
        super(message, 403, code);
    }
}

/**
 * Validation errors (400)
 */
export class ValidationError extends APIError {
    constructor(message = "Validation failed", errors = null, code = "VALIDATION_ERROR") {
        super(message, 400, code);
        this.errors = errors;
    }
}

/**
 * Not found errors (404)
 */
export class NotFoundError extends APIError {
    constructor(message = "Resource not found", code = "NOT_FOUND") {
        super(message, 404, code);
    }
}

/**
 * Conflict errors (409)
 */
export class ConflictError extends APIError {
    constructor(message = "Resource already exists", code = "CONFLICT") {
        super(message, 409, code);
    }
}

/**
 * Rate limit errors (429)
 */
export class RateLimitError extends APIError {
    constructor(message = "Too many requests", code = "RATE_LIMIT_EXCEEDED") {
        super(message, 429, code);
    }
}

/**
 * Bad request errors (400)
 */
export class BadRequestError extends APIError {
    constructor(message = "Bad request", code = "BAD_REQUEST") {
        super(message, 400, code);
    }
}

/**
 * Service unavailable errors (503)
 */
export class ServiceUnavailableError extends APIError {
    constructor(message = "Service temporarily unavailable", code = "SERVICE_UNAVAILABLE") {
        super(message, 503, code);
    }
}
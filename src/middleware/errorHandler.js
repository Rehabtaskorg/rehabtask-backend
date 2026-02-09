import { APIError } from "../utils/errors.js";

/**
 * Global error handler middleware
 * Formats and sends error responses
 */
const errorHandler = (err, req, res, next) => {
    // log error for debugging
    console.error("Error occured:", {
        name: err.name,
        message: err.message,
        code: err.code,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip
    });

    // Handle operational errors (known errors)
    if (err.isOperational || err instanceof APIError) {
        return res.status(err.statusCode || 500).json({
            success: false,
            code: err.code || "ERROR",
            message: err.message,
            ...(err.errors && { errors: err.errors }),
            ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
        });
    }

    // Handle Prisma errors
    if (err.name === "PrismaClientKnownRequestError") {
        return handlePrismaError(err, res);
    }

    if (err.name === "PrismaClientValidationError") {
        return res.status(400).json({
            success: false,
            code: "VALIDATION_ERROR",
            message: "Invalid data provided",
            ...(process.env.NODE_ENV === "development" && { details: err.message }),
        });
    }

    // Handle JWT errors
    if (err.name === "JsonWebTokenError") {
        return res.status(401).json({
            success: false,
            code: "INVALID_TOKEN",
            message: "Invalid authentication token",
        });
    }

    if (err.name === "TokenExpiredError") {
        return res.status(401).json({
            success: false,
            code: "TOKEN_EXPIRED",
            message: "Authentication token has expired",
        });
    }

    // handle Zod validation errors
    if (err.name === "ZodError") {
        const formattedErrors = err.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
        }));

        return res.status(400).json({
            success: false,
            code: "VALIDATION_ERROR",
            message: "Validation failed",
            errors: formattedErrors,
        });
    }

    // Handle unknown/unexpected errors
    const statusCode = err.statusCode || 500;
    const message =
        process.env.NODE_ENV === "production"
            ? "An unexpected error occured"
            : err.message || "Internal server error";

    res.status(statusCode).json({
        success: false,
        code: err.code || "INTERNAL_ERROR",
        message,
        ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    });
};

/**
 * Handle Prisma-specific errors
 */
function handlePrismaError(err, res) {
    const statusCode = 400;
    let message = "Database operation failed";
    let code = "DATABASE_ERROR";

    switch (err.code) {
        case "P2002":
            // Unique constraint violation
            const field = err.meta?.target?.[0] || "field";
            message = `A record with this ${field} already exists`;
            code = "DUPLICATE_ENTRY";
            break;

        case "P2025":
            // Record not found
            message = "Record not found";
            code = "NOT_FOUND";
            break;

        case "P2003":
            // Foreign key constraint violation
            message = "Related record not found";
            code = "FOREIGN_KEY_VIOLATION";
            break;

        case "P2014":
            // Invalid relation
            message = "Invalid relationship between records";
            code = "INVALID_RELATION";
            break;

        default:
            message = err.message || "Database operation failed";
    }

    return res.status(statusCode).json({
        success: false,
        code,
        message,
        ...(process.env.NODE_ENV === "development" && {
            details: {
                prismaCode: err.code,
                meta: err.meta,
            },
        }),
    });
}

/**
 * 404 handler for unknown routes
 */
export const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        code: "NOT FOUND",
        message: `Route ${req.method} ${req.originalUrl} not found`,
    });
};

export default errorHandler;
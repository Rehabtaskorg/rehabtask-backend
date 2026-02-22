import winston from "winston";

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4
};

const colors = {
    error: "red",
    warn: "yellow",
    info: "green",
    http: "magenta",
    debug: "white",
};

winston.addColors(colors);

const isDevelopment = process.env.NODE_ENV !== "production";

const customFormat = winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json(),
    winston.format.printf((info) => {
        const { timestamp, level, message, ...meta } = info;
        const sanitizedMeta = sanitizePII(meta);
        return `${timestamp} [${level.toUpperCase()}]: ${message} ${Object.keys(sanitizedMeta).length ? JSON.stringify(sanitizedMeta, null, 2) : ""}`;
    })
);

const sanitizePII = (obj) => {
    const piiFields = ['password', 'password_hash', 'ssn', 'license_document_url', 'phone'];
    const sanitized = { ...obj };
    Object.keys(sanitized).forEach((key) => {
        if (piiFields.includes(key)) {
            sanitized[key] = "[REDACTED]";
        }
        if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
            sanitized[key] = sanitizePII(sanitized[key]);
        }
    });
    return sanitized;
}

export const logger = winston.createLogger({
    level: isDevelopment ? "debug" : "info",
    levels,
    format: customFormat,
    exitOnError: false,
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize({ all: true }),
                customFormat
            ),
        }),
        new winston.transports.File({
            filename: "logs/error.log",
            level: "error",
            maxsize: 5242880,
            maxFiles: 5
        }),
        new winston.transports.File({
            filename: "logs/combined.log",
            maxsize: 5242880,
            maxFiles: 5
        }),
    ],
    exceptionHandlers: [
        new winston.transports.File({ filename: "logs/exceptions.log" })
    ],
    rejectionHandlers: [
        new winston.transports.File({ filename: "logs/rejections.log" }),
    ]
});

// Helper functions
export const logInfo = (message, meta = {}) => {
    logger.info(message, meta);
};

export const logWarn = (message, meta = {}) => {
    logger.warn(message, meta);
}

export const logDebug = (message, meta = {}) => {
    logger.debug(message, meta);
}

export const logHttp = (message, meta = {}) => {
    logger.http(message, meta);
}
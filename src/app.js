import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import { env } from "./config/env.js"
import webhookRoutes from "./routes/webhook.routes.js";
import routes from "./routes/index.js";
import errorHandler, { notFoundHandler } from "./middleware/errorHandler.js";
import { apiRateLimiter } from "./middleware/rateLimiter.js";

const app = express();

// Trust proxy (important for rate limiting and IP detection)
app.set("trust proxy", 1);

// CORS configuration
app.use(
    cors({
        origin: process.env.FRONTEND_URL,
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        exposedHeaders: ["Set-Cookie"],
        maxAge: 86400, // 24hrs
    })
);

// Security headers — CSP is handled by the Next.js frontend (next.config.mjs).
// Helmet's default CSP is disabled here to avoid conflicting headers on
// proxied API responses. All other helmet defaults remain active.
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Compression
app.use(compression());

app.use("/api/webhooks", webhookRoutes);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Cookie Parser
app.use(cookieParser());

// request logging (Development)
if (env.NODE_ENV === "development") {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    })
}

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
        uptime: process.uptime(),
    });
})

// API Rate Limiting (General)
app.use("/api", apiRateLimiter);

app.use("/api", routes);

// 404 Handler (Unknown routes)
app.use(notFoundHandler);

// Global Error handler
app.use(errorHandler);

export default app;
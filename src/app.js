import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js"
import webhookRoutes from "./routes/webhook.routes.js";
import routes from "./routes/index.js";
import errorHandler, { notFoundHandler } from "./middleware/errorHandler.js";
import { apiRateLimiter } from "./middleware/rateLimiter.js";

const app = express();

// Trust proxy (important for rate limiting and IP detection)
app.set("trust proxy", 1);

app.use("/api/webhooks", webhookRoutes);

// CORS configuration
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000"

app.use(
    cors({
        origin: FRONTEND_URL,
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        exposedHeaders: ["Set-Cookie"],
        maxAge: 86400, // 24hrs
    })
);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
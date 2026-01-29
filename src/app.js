import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import webhookRoutes from "./routes/webhook.routes.js";
import routes from "./routes/index.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();

// CORS
// Only allow requests from your frontend domain
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000"

app.use("/api/webhooks", webhookRoutes);

app.use(
    cors({
        origin: FRONTEND_URL,
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    })
);

app.use(cookieParser());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
})

// API Routes
app.use("/api", routes);

// Error handler
app.use(errorHandler);

export default app;
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import routes from "./routes/index.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();

// CORS
// Only allow requests from your frontend domain
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000"

app.use(
    cors({
        origin: FRONTEND_URL,
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    })
);

app.use(cookieParser());

// Body parsing
// Important: Webhook route needs raw body
app.use((req, res, next) => {
    if (req.originalUrl === "/api/webhooks/stripe") {
        next();
    } else {
        express.json()(req, res, next);
    }
});
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
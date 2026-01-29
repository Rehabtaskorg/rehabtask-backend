// import express from "express";
// import { handleStripeWebhook } from "../controllers/webhook.controller.js";

// const router = express.Router();

// // Stripe webhook endpoint - NO AUTHENTICATION, RAW BODY REQUIRED
// router.post(
//     "/stripe",
//     express.raw({ type: "application/json" }),
//     handleStripeWebhook
// );

// export default router;

import express from "express";

const router = express.Router();

// Test endpoint to verify raw body parsing
router.post(
    "/test",
    express.raw({ type: "application/json" }),
    (req, res) => {
        console.log("=== TEST ENDPOINT HIT ===");
        console.log("Body is Buffer:", Buffer.isBuffer(req.body));
        console.log("Body length:", req.body?.length);
        console.log("Headers:", req.headers);

        res.json({
            success: true,
            bodyIsBuffer: Buffer.isBuffer(req.body),
            bodyLength: req.body?.length,
            contentType: req.headers['content-type']
        });
    }
);

// Stripe webhook endpoint - NO AUTHENTICATION, RAW BODY REQUIRED
router.post(
    "/stripe",
    express.raw({ type: "application/json" }),
    async (req, res) => {
        console.log("=== STRIPE WEBHOOK ENDPOINT HIT ===");
        console.log("Body is Buffer:", Buffer.isBuffer(req.body));
        console.log("Body:", req.body);

        // Import here to avoid circular dependencies
        const { handleStripeWebhook } = await import("../controllers/webhook.controller.js");
        return handleStripeWebhook(req, res);
    }
);

export default router;
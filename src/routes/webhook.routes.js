import express from "express";
import { handleStripeWebhook } from "../controllers/webhook.controller.js";
import {
    validateTwilioSignature,
    handleTwilioOptOut,
    handleTwilioOptIn,
} from "../controllers/twilio.webhook.controller.js";

const router = express.Router();

// Stripe webhook — no auth, raw body required for signature verification
router.post(
    "/stripe",
    express.raw({ type: "application/json" }),
    handleStripeWebhook
);

// Twilio inbound webhooks — urlencoded body (Twilio's format), signature-verified
// Fires when a user texts STOP/START to the toll-free number.
// Syncs smsOptIn in DB to match Twilio's carrier-level suppression state.
router.post(
    "/twilio/inbound",
    express.urlencoded({ extended: false }),
    validateTwilioSignature,
    (req, res, next) => {
        const keyword = (req.body?.Body ?? "").trim().toUpperCase();
        const OPT_OUT_KEYWORDS = ["STOP", "CANCEL", "QUIT", "UNSUBSCRIBE", "REVOKE", "END", "STOPALL"];
        const OPT_IN_KEYWORDS = ["START", "YES", "UNSTOP"];

        if (OPT_OUT_KEYWORDS.includes(keyword)) return handleTwilioOptOut(req, res);
        if (OPT_IN_KEYWORDS.includes(keyword)) return handleTwilioOptIn(req, res);

        res.status(200).send("<Response/>");
    }
);

export default router;
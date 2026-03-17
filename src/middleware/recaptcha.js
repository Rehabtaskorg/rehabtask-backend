import axios from "axios";

/**
 * Verify reCAPTCHA token with Google
 * 
 * @param {string} token - reCAPTCHA token from client
 * @param {string} remoteIp - Optional IP address of the user
 * @returns {Promise<Object>} Verification result
 */
export async function verifyRecaptcha(token, remoteIp = null) {
    const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY;

    if (!recaptchaSecret) {
        if (process.env.NODE_ENV === "development") {
            console.warn("reCAPTCHA secret not configured - skipping verification in development");
            return { success: true, score: 1.0, action: "development" }

        }
        throw new Error("reCAPTCHA secret key not configured");
    }

    if (!token) {
        throw new Error("reCAPTCHA token is required");
    }

    try {
        const params = new URLSearchParams({
            secret: recaptchaSecret,
            response: token,
            ...(remoteIp && { remoteip: remoteIp }),
        });

        const response = await axios.post(
            "https://www.google.com/recaptcha/api/siteverify",
            params.toString(),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                timeout: 5000,
            }
        );

        const { success, score, action, "error-codes": errorCodes } = response.data;

        if (!success) {
            console.error("reCAPTCHA verification failed:", errorCodes);
            return {
                success: false,
                score: 0,
                action,
                errors: errorCodes
            };
        }

        // For reCAPTCHA v3, check score (0.0 to 1.0)
        // Scores closer to 1.0 indicate legitimate interactions
        const minScore = parseFloat(process.env.RECAPTCHA_MIN_SCORE || "0.5");

        if (score && score < minScore) {
            console.warn(`reCAPTCHA score ${score} below minimun ${minScore}`);
            return {
                success: false,
                score,
                action,
                errors: ["score_too_low"],
            };
        }

        return {
            success: true,
            score,
            action
        };
    } catch (error) {
        console.error("reCAPTCHA verification error:", error);

        if (process.env.NODE_ENV === "development") {
            console.warn("reCAPTCHA verification failed - allowing in development");
            return { success: true, score: 0.5, action: "development_fallback" };
        }

        throw new Error("reCAPTCHA verification failed");
    }

}

/**
 * Middleware to verify reCAPTCHA token
 * Expects recaptchaToken in request body
 */
export function recaptchaMiddleware(req, res, next) {
    const { recaptchaToken } = req.body;

    if (!process.env.RECAPTCHA_SECRET_KEY && process.env.NODE_ENV === "development") {
        console.warn("reCAPTCHA bypassed in development mode");
        return next();
    }

    if (!recaptchaToken) {
        return res.status(400).json({
            success: false,
            code: "RECAPTCHA_REQUIRED",
            message: "reCAPTCHA verification is required",
        });
    }

    const clientIp = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

    verifyRecaptcha(recaptchaToken, clientIp)
        .then((result) => {
            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    code: "RECAPTCHA_FAILED",
                    message: "reCAPTCHA verification failed. Please try again.",
                    ...(process.env.NODE_ENV === "development" && {
                        debug: {
                            score: result.score,
                            errors: result.errors
                        }
                    })
                });
            }

            // store verification result for potential logging/analytics
            req.recaptchaResult = result;
            next();
        })
        .catch((error) => {
            console.error("reCAPTCHA middleware error:", error);
            return res.status(500).json({
                success: false,
                code: "RECAPTCHA_ERROR",
                message: "Unable to verify reCAPTCHA. Please try again.",
            });
        });
}
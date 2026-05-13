/**
 * Verify reCAPTCHA token with Google reCAPTCHA Enterprise
 *
 * @param {string} token - reCAPTCHA token from client
 * @param {string} expectedAction - The action name the token was generated for
 * @returns {Promise<Object>} Verification result
 */
export async function verifyRecaptcha(token, expectedAction = null) {
    const apiKey     = process.env.RECAPTCHA_API_KEY;
    const siteKey    = process.env.RECAPTCHA_SITE_KEY;
    const projectId  = process.env.GCP_PROJECT_ID;

    if (!apiKey) {
        if (process.env.NODE_ENV === "development") {
            console.warn("reCAPTCHA API key not configured - skipping verification in development");
            return { success: true, score: 1.0, action: expectedAction || "development" };
        }
        throw new Error("reCAPTCHA API key not configured");
    }

    if (!token) {
        throw new Error("reCAPTCHA token is required");
    }

    const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${apiKey}`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                event: {
                    token,
                    siteKey,
                    expectedAction,
                },
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`reCAPTCHA Enterprise API returned ${response.status}`);
        }

        const data = await response.json();
        const { tokenProperties, riskAnalysis } = data;

        if (!tokenProperties?.valid) {
            console.error("reCAPTCHA token invalid:", tokenProperties?.invalidReason);
            return {
                success: false,
                score: 0,
                action: tokenProperties?.action || null,
                errors: [tokenProperties?.invalidReason || "invalid_token"],
            };
        }

        if (expectedAction && tokenProperties.action !== expectedAction) {
            console.error(`reCAPTCHA action mismatch: expected "${expectedAction}", got "${tokenProperties.action}"`);
            return {
                success: false,
                score: 0,
                action: tokenProperties.action,
                errors: ["action_mismatch"],
            };
        }

        const score = riskAnalysis?.score ?? 0;
        const minScore = parseFloat(process.env.RECAPTCHA_MIN_SCORE || "0.5");

        if (score < minScore) {
            console.warn(`reCAPTCHA score ${score} below minimum ${minScore}`);
            return {
                success: false,
                score,
                action: tokenProperties.action,
                errors: ["score_too_low"],
            };
        }

        return {
            success: true,
            score,
            action: tokenProperties.action,
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
 * Expects recaptchaToken and recaptchaAction in request body
 */
export function recaptchaMiddleware(req, res, next) {
    const { recaptchaToken, recaptchaAction } = req.body;

    if (!process.env.RECAPTCHA_API_KEY && process.env.NODE_ENV === "development") {
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

    verifyRecaptcha(recaptchaToken, recaptchaAction)
        .then((result) => {
            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    code: "RECAPTCHA_FAILED",
                    message: "reCAPTCHA verification failed. Please try again.",
                    ...(process.env.NODE_ENV === "development" && {
                        debug: {
                            score: result.score,
                            errors: result.errors,
                        },
                    }),
                });
            }

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
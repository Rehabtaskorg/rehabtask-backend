import { TextDecoder } from "node:util";
import { AI_CONFIG, CONTACT_MARKER, HANDOVER_FALLBACK, SYSTEM_PROMPT, UNKNOWN_ANSWER } from "../config/ai.js";
import { logger } from "../config/logger.js";

const createMarkerFilter = (onChunk) => {
    let held = "";

    const couldBecomeMarker = (text) =>
        CONTACT_MARKER.startsWith(text) && text.length < CONTACT_MARKER.length;

    const emit = (text) => {
        let pending = held + text;
        held = "";

        for (let cut = Math.max(0, pending.length - CONTACT_MARKER.length + 1); cut < pending.length; cut += 1) {
            if (couldBecomeMarker(pending.slice(cut))) {
                held = pending.slice(cut);
                pending = pending.slice(0, cut);
                break;
            }
        }

        const cleaned = pending.split(CONTACT_MARKER).join("");
        if (cleaned) onChunk(cleaned);
    };

    const flush = () => {
        const remaining = held.split(CONTACT_MARKER).join("");
        held = "";
        if (remaining) onChunk(remaining);
    };

    return { emit, flush };
};

/**
 * Deterministic responder used until the xAI account has a payment method, and in
 * automated tests. Answers from the same knowledge the real model receives, by
 * keyword, so the widget, rate limiting and error handling can all be exercised.
 *
 * @param {{ messages: Array<{role: string, content: string}> }} params
 * @returns {Promise<string>}
 */
const stubResponder = async ({ messages, onChunk }) => {
    const question = messages.at(-1)?.content?.toLowerCase() ?? "";

    const canned = [
        [/\b(knee|back|shoulder|hip|ankle|pain|hurt\w*|ach\w*|sore|injur\w*|symptom\w*|diagnos\w*|medication|treatment|should i see)\b/,
            "I'm not able to give medical advice. Please speak with a qualified healthcare professional about whether therapy is right for you."],
        [/\b(join|become|apply)\w*\b.*\btherapist\w*\b|\btherapist\w*\b.*\b(join|apply)\w*\b/,
            "To join as a therapist, create an account and choose \"therapist\" at sign-up. You'll complete onboarding — personal details, ID, licence, insurance, HIPAA attestation, profile, availability and payout setup — then the RehabTask team verifies your documents before you can take cases."],
        [/\b(pay|paid|payout|cost|charge|money|refund|escrow)\w*\b/,
            "When a customer accepts an offer they pay up front, and the money is held securely until the work is done. After each session the therapist marks it complete and the customer confirms, which releases that session's payment. RehabTask takes a 10% commission."],
        [/\b(find|search|browse)\w*\b.*\btherapist\w*\b|\btherapist\w*\b.*\b(find|search)\w*\b/,
            "You can browse therapists by discipline, location and availability and send a request directly to one, or post a request and let matching therapists send you offers."],
        [/\b(book|appointment|schedul|visit|session)\w*\b/,
            "Create a request describing what you need, therapists send offers with their rates, you accept the one you want and pay, then the therapist visits and marks the session complete for you to confirm."],
        [/\b(agency|agencies|patient)\b/,
            "Agencies add the patients they manage, then create requests assigned to a patient. Therapists send offers, you accept one, and bookings run the same as any other."],
    ];

    const match = canned.find(([pattern]) => pattern.test(question));
    const answer = match ? match[1] : UNKNOWN_ANSWER;

    if (!onChunk) return answer;

    const words = answer.split(" ");
    for (const [index, word] of words.entries()) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        onChunk(index === 0 ? word : ` ${word}`);
    }

    return answer;
};

/**
 * Always fails. Set AI_PROVIDER=failing to exercise the outage path from the brief
 * without touching the real API.
 */
const failingResponder = async () => {
    throw new Error("Simulated AI provider failure");
};

/**
 * Strips every field except role and content, and drops any role other than user or
 * assistant. The route validates too, but a client-supplied system message is the one
 * injection that would override SYSTEM_PROMPT, so it is also blocked here — this
 * responder stays safe even if a future caller forgets.
 *
 * @param {Array<{role: string, content: string}>} messages
 */
const sanitize = (messages) =>
    messages
        .filter((m) => m?.role === "user" || m?.role === "assistant")
        .map(({ role, content }) => ({
            role,
            content: String(content).split(CONTACT_MARKER).join(""),
        }));

/**
 * Calls xAI's OpenAI-compatible chat completions endpoint.
 *
 * @param {{ messages: Array<{role: string, content: string}> }} params
 * @returns {Promise<string>}
 */
const readStream = async (response, onChunk) => {
    const decoder = new TextDecoder();
    const filter = createMarkerFilter(onChunk);
    let buffer = "";
    let answer = "";
    let finishReason = null;
    let skipped = 0;

    const handleLine = (line) => {
        if (!line.startsWith("data:")) return;

        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") return;

        let event;
        try {
            event = JSON.parse(payload);
        } catch {
            skipped += 1;
            return;
        }

        if (event.error) {
            throw new Error(`xAI stream error: ${event.error.message ?? JSON.stringify(event.error)}`);
        }

        const choice = event.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;

        const text = choice?.delta?.content;
        if (text) {
            answer += text;
            filter.emit(text);
        }
    };

    for await (const part of response.body) {
        buffer += decoder.decode(part, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(handleLine);
    }

    buffer += decoder.decode();
    if (buffer) handleLine(buffer);
    filter.flush();

    if (skipped) logger.warn("[AI] Skipped unreadable stream chunks", { skipped });

    const spoken = answer.split(CONTACT_MARKER).join("").trim();

    if (!spoken) {
        if (!answer.includes(CONTACT_MARKER)) {
            throw new Error(`xAI returned no content (finish_reason: ${finishReason ?? "none"})`);
        }

        logger.warn("[AI] Reply was marker only, using fallback text", { model: AI_CONFIG.model });
        answer = `${HANDOVER_FALLBACK} ${CONTACT_MARKER}`;
        onChunk(HANDOVER_FALLBACK);
    }

    if (finishReason === "length") {
        logger.warn("[AI] Response truncated at max_tokens", { chars: answer.length });
    }

    logger.info("[AI] Streamed response complete", {
        model: AI_CONFIG.model,
        chars: answer.length,
        finishReason,
    });

    return answer.trim();
};

const callGrok = async ({ messages, systemPrompt, onChunk }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_CONFIG.requestTimeoutMs);

    try {
        const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${AI_CONFIG.apiKey}`,
            },
            body: JSON.stringify({
                model: AI_CONFIG.model,
                max_tokens: AI_CONFIG.maxOutputTokens,
                stream: Boolean(onChunk),
                messages: [
                    { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
                    ...sanitize(messages),
                ],
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            logger.error("[AI] xAI rejected the request", {
                status: response.status,
                retryAfter: response.headers.get("retry-after"),
                detail: detail.slice(0, 500),
            });

            const error = new Error(`xAI responded ${response.status}`);
            error.status = response.status;
            error.retryAfter = response.headers.get("retry-after");
            throw error;
        }

        if (onChunk) return readStream(response, onChunk);

        const body = await response.json();
        const answer = body.choices?.[0]?.message?.content?.trim();
        if (!answer) throw new Error("xAI returned no content");

        logger.info("[AI] Response received", {
            model: AI_CONFIG.model,
            promptTokens: body.usage?.prompt_tokens,
            completionTokens: body.usage?.completion_tokens,
        });

        return answer;
    } finally {
        clearTimeout(timeout);
    }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const grokResponder = async (params) => {
    try {
        return await callGrok(params);
    } catch (error) {
        if (error.status !== 429) throw error;

        logger.warn("[AI] xAI at capacity, retrying once", { waitMs: AI_CONFIG.capacityRetryMs });
        await sleep(AI_CONFIG.capacityRetryMs);
        return callGrok(params);
    }
};

const RESPONDERS = {
    stub: stubResponder,
    failing: failingResponder,
    grok: grokResponder,
};

const { provider, apiKey } = AI_CONFIG;

if (!RESPONDERS[provider]) {
    throw new Error(
        `Invalid AI_PROVIDER "${provider}". Expected one of: ${Object.keys(RESPONDERS).join(", ")}`
    );
}

if (process.env.NODE_ENV === "production" && provider !== "grok") {
    throw new Error(
        `AI_PROVIDER must be "grok" in production — refusing to serve "${provider}" answers to real users`
    );
}

if (provider === "grok" && !apiKey) {
    throw new Error("AI_PROVIDER is \"grok\" but XAI_API_KEY is not set");
}

/**
 * Produces an assistant reply for a conversation.
 *
 * The provider is chosen by AI_PROVIDER and validated at import, so a missing,
 * misspelled or non-production value fails the deploy rather than silently serving
 * stub answers to real users.
 *
 * @param {{ messages: Array<{role: string, content: string}>, systemPrompt?: string }} params
 * @returns {Promise<string>}
 */
export const generateReply = async (params) => RESPONDERS[provider](params);

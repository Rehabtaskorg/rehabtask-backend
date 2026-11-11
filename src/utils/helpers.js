import { randomBytes } from "node:crypto";

/**
 * Escapes a value for safe interpolation into HTML. Use for anything that did not
 * originate in our own code, such as values submitted from a public form.
 *
 * @param {unknown} input
 * @returns {string}
 */
export const subjectSafe = (input, max = 60) =>
    String(input ?? "")
        .replace(/[\r\n]+/g, " ")
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, max);

export const escapeHtml = (input) =>
    String(input ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const REFERENCE_LENGTH = 8;

export const createTicketReference = () => {
    const bytes = randomBytes(REFERENCE_LENGTH);
    let out = "";
    for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
    return `RT-${out}`;
};

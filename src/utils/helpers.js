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

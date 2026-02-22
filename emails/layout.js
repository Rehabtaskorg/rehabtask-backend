/**
 * Shared email layout and helpers — pure HTML strings
 */

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

export const button = (href, text) => `
  <a href="${href}"
     style="background-color:#2563EB;border-radius:6px;color:#ffffff;display:inline-block;
            font-size:14px;font-weight:600;padding:12px 24px;text-decoration:none;">
    ${text}
  </a>
`;

export const hr = () => `<hr style="border:none;border-top:1px solid #e6ebf1;margin:24px 0;" />`;

export const label = (text) => `
  <p style="color:#6b7280;font-size:12px;font-weight:600;text-transform:uppercase;margin:0 0 2px;">
    ${text}
  </p>
`;

export const value = (text) => `
  <p style="color:#1a1a1a;font-size:14px;margin:0 0 16px;">${text}</p>
`;

export const field = (labelText, valueText) => `${label(labelText)}${value(valueText)}`;

export const layout = (content, preview) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="background-color:#f6f9fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;margin:0;padding:0;">
  <div style="background-color:#ffffff;margin:40px auto;padding:40px 32px;max-width:600px;border-radius:8px;">
    ${content}
    <p style="color:#8898aa;font-size:12px;line-height:18px;margin-top:40px;border-top:1px solid #e6ebf1;padding-top:20px;text-align:center;">
      RehabTask — Steadfast Rehabilitation Services<br/>
      <a href="${FRONTEND_URL}/help" style="color:#8898aa;">Help Center</a>
      &middot;
      <a href="${FRONTEND_URL}/contact" style="color:#8898aa;">Contact Us</a>
      &middot;
      <a href="${FRONTEND_URL}/privacy" style="color:#8898aa;">Privacy Policy</a>
    </p>
  </div>
</body>
</html>
`;

export const heading = (text) => `
  <h1 style="color:#1a1a1a;font-size:22px;font-weight:700;margin:0 0 16px;">${text}</h1>
`;

export const text = (content) => `
  <p style="color:#1a1a1a;font-size:14px;line-height:24px;">${content}</p>
`;

export const muted = (content) => `
  <p style="color:#6b7280;font-size:13px;line-height:20px;">${content}</p>
`;

export const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
        return new Date(dateStr).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    } catch {
        return 'N/A';
    }
};

export const formatCurrency = (amount) => {
    return `$${Number(amount).toFixed(2)}`;
};

export { FRONTEND_URL };
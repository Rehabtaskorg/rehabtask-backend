import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    // Server
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().default('5000'),

    // URLs
    FRONTEND_URL: z.url(),
    API_URL: z.url(),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // Supabase
    SUPABASE_URL: z.url('SUPABASE_URL must be a valid URL'),
    SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

    // reCAPTCHA (optional)
    RECAPTCHA_SECRET_KEY: z.string().optional(),
    RECAPTCHA_MIN_SCORE: z.preprocess(
        (val) => (val === "" || val == null ? "0.5" : val),
        z.string()
    ),

    // Stripe
    STRIPE_SECRET_KEY: z.string(),
    STRIPE_WEBHOOK_SECRET: z.string(),
    STRIPE_WEBHOOK_SECRET_CONNECT: z.string(),

    // Platform Settings
    PLATFORM_FEE_PERCENTAGE: z.string().default('10'),
    OFFER_EXPIRY_HOURS: z.string().default('48'),
    AUTO_CONFIRM_HOURS: z.string().default('72'),
    DEFAULT_SERVICE_RADIUS_MILES: z.string().default('25'),

    // Email (Resend - production)
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string(),
    ADMIN_EMAIL: z.email(),

    // Email (Gmail — local development transport)
    GMAIL_USER: z.string().optional(),
    GMAIL_APP_PASSWORD: z.string().optional(),
    EMAIL_FROM_NAME: z.string().default('RehabTask'),

    // Google Maps
    GOOGLE_MAPS_API_KEY: z.string(),

    // Sentry
    SENTRY_DSN: z.string().optional(),

    // Better Stack
    BETTERSTACK_LOG_TOKEN: z.string().optional(),
});

/**
 * Validate environment variables
 */
function validateEnv() {
    try {
        const env = envSchema.parse(process.env);
        return env;
    } catch (error) {
        console.error('❌ Invalid environment variables:');

        if (error instanceof z.ZodError) {
            error.errors.forEach((err) => {
                console.error(`  - ${err.path.join('.')}: ${err.message}`);
            });
        }

        console.error('\n⚠️  Missing Supabase variables? You need to add:');
        console.error('   SUPABASE_URL=https://xxxxx.supabase.co');
        console.error('   SUPABASE_ANON_KEY=eyJhbGc...');
        console.error('   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...');
        console.error('\nPlease check your .env file and ensure all required variables are set.');

        process.exit(1);
    }
}

export const env = validateEnv();

// Helper to check if running in production
export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

// Export commonly used values
export const {
    NODE_ENV,
    PORT,
    FRONTEND_URL,
    API_URL,
    DATABASE_URL,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
    RECAPTCHA_SECRET_KEY,
    RECAPTCHA_MIN_SCORE,
    STRIPE_SECRET_KEY,
    STRIPE_PUBLISHABLE_KEY,
    STRIPE_WEBHOOK_SECRET,
    STRIPE_WEBHOOK_SECRET_CONNECT,
    PLATFORM_FEE_PERCENTAGE,
    OFFER_EXPIRY_HOURS,
    AUTO_CONFIRM_HOURS,
    DEFAULT_SERVICE_RADIUS_MILES,
    RESEND_API_KEY,
    EMAIL_FROM,
    ADMIN_EMAIL,
    GMAIL_USER,
    GMAIL_APP_PASSWORD,
    GOOGLE_MAPS_API_KEY,
    SENTRY_DSN,
    BETTERSTACK_LOG_TOKEN,
} = env;
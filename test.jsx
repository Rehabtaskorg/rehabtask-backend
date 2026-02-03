/**
 * The database.js (Prisma + RLS injection)
 * - How withRLS works: When you call SET LOCAL
 * request.jwt.claim.sub, you are telling the Postgres
 * database: "For this specific transaction, pretend
 * the person logged in is User X"
 * 
 * - The Result: Even though Prisma is using a "Gold Mode"
 * connection string, the database will now apply your RLS
 * policies to that transaction
 * 
 * Use Case: You use this for your main applicatin logic
 * where you want Prisma's nice syntax (type safety, joins)
 * but you want the database to double-check that User X
 * isn't snooping on User Y's data.
 * 
 * 
 * 2. The supabase.js (The management tools)
 * The supabase (Anon) Client
 * - Why you still need it: Prisma handles database tables, but it doesnt
 * handle Authentication flow
 * - Primary job: You use this client to call supabase.auth.signInWithPassword()
 * or supabase.auth.getUser()
 * - The Flow: 
 * 1. User logs in via supabase client
 * 2. You get the user.id from that login
 * 3. You pass that user.id into your withRLS(user,...)
 * function in Prisma
 */

/**
 * Why the custom class Errors is Important
 * 
 * Consistency in API Responses
 * - Without this file, your frontend might receive different error
 * formats from different parts of your app. With this setup,
 * every error has a message, statusCode, and code, making it much easier
 * for frontend developers to handle issues
 * 
 * Cleaner Business Logic
 * - Instead of writing complex logic inside your controllers
 * to set status code, you can simply "fire and forget"
 * 
 * // instead of this:
 * res.status(404).json({error: "User not found"})
 * 
 * // You do this:
 * throw new NotFoundError("User not found");
 */

/**
 * How they Work together
 * 1. The Trigger (Service Layer): When you call throw new NotFoundError("User not found")
 * , you're just sending a string. You are creating a rich object that contains:
 * - message: "User not found"
 * - statusCode: 404 (inherited from the class)
 * - isOperational: true
 * 
 * 2. The Catch (Express): Express catches this error and passes it to your errorHandler
 * middleware
 * 
 * 3. The Formatting (Middleware): Your middleware sees err instance of APIError, extracts
 * the 404 and the message, and sends a beautiful JSON response to the user
 */


/**
 * A. The Login Flow (Issuance)
 * When a user logs in, the "handshaking" happens like this:
 * 1. Request: The user sends credentials to your Express API (POST /api/auth/login)
 * 2. Verification: Your backend uses the supabase-js Admin SDK to vertify these credentials with Supabase Auth
 * 3. Token Generattion: Supabase verifies the user and returns a session object containing an access_token (JWT)
 * and a refresh_token
 * 4. Cookie Setting: Your Express server does not just send this back to the frontend as JSON, it attaches them as httpOnly,
 * Secure cookies to the response.
 * - Why? This prevents "Cross-Site-Scripting (XSS) attacks; JS on the frontend can't read these tokens"
 * 
 * B. The Authenticated Request (Validation)
 * When the user later tries to fetch their therapy requests, the flow looks like this
 * 1. Browser: Automatically attaches the sb_access_token cookie to the request to your Express API
 * 2. Middleware: Your auth.js middleware extracts the JWT from the cookie
 * 3. Local Validation: Your BE validates the JWT using the Supabase JWT Secret
 * - Crucial Point: Your BE doesn't necessarily have to ask Supabase if the token is valid every time. It uses the secret key
 * to cryptographically verify the signature locally. THis is very fast
 * 4. User Context: The middleware decodes the user's UUID from the JWT
 * 
 * 
 * C. The Prisma + RLS Bridge (The magic part)
 * - This is where your specific setup with Row Level Security becomes powerful. Even though your BE is "authenticated", your
 * database still needs to know which user is asking to ensure they only see their own data.
 * 1. Setting Local variables: Before running a Prisma query, your BE executes a small SQL command inside a transaction:
 * SET LOCAL auth.uid = 'user-uuid-here'
 * 2. Database enforcement: When Prisma sends the actual query (e.g SELECT * FROM "TherapyRequest", the PostgreSQL engine checks
 * the RLS policy)
 * 3. RLS Policy: The policy you ran in the SQL Editor looks something like this:
 * "Allow SELECT if request.user_id matches auth.uid()"
 * 4.PostgreSQL filters the rows before Prisma even sees them. if a hacker tries to guess an ID they don't own, the database returns 0 result
 */

/**
 * What you get:
 * - Customer & Therapist registration
 * - Email verification (Supabase)
 * - Login / Logout with JWT cookies
 * - Pasword reset and change
 * - Rate limiting (no Redis)
 * - Input validation (Zod)
 * - Row Level Security
 * - OAuth Security
 * - Complete error handling
 */
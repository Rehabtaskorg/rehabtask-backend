import { Server } from "socket.io";
import cookie from "cookie";
import { supabase } from "../config/supabase.js";
import { prisma } from "../config/prisma.js";
import { addUser, removeUser } from "./presence.js";
import { logger } from "../config/logger.js";
import { socketTickets } from "../routes/auth.routes.js";

let io = null;

/**
 * Initialize Socket.io server and attach to the HTTP server.
 * Auth middleware replicates the same pattern as middleware/auth.js.
 */
export function initSocketIO(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: process.env.FRONTEND_URL,
            credentials: true,
        },
        // Ping every 25s, timeout after 20s — keeps connections alive through load balancers
        pingInterval: 25000,
        pingTimeout: 20000,
    });

    // ─── Auth Middleware ─────────────────────────────────────────────────
    // Supports three auth methods in priority order:
    // 1. One-time ticket (safe for cross-origin, no token exposure)
    // 2. httpOnly cookie (same-origin or when cross-origin cookies work)
    // 3. Handshake auth token (fallback for OAuth users with Supabase session)
    io.use(async (socket, next) => {
        try {
            const ticket = socket.handshake.auth?.ticket;
            const cookies = cookie.parse(socket.handshake.headers.cookie || "");
            const token = cookies.sb_access_token || socket.handshake.auth?.token;

            let userId = null;

            // Method 1: One-time ticket (preferred for cross-origin)
            if (ticket && socketTickets.has(ticket)) {
                const ticketData = socketTickets.get(ticket);
                socketTickets.delete(ticket); // Single use — delete immediately
                if (Date.now() - ticketData.createdAt > 30000) {
                    return next(new Error("Ticket expired"));
                }
                userId = ticketData.userId;
            }
            // Method 2 & 3: Cookie or handshake token
            else if (token) {
                const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);
                if (error || !supabaseUser) {
                    return next(new Error("Invalid or expired token"));
                }
                userId = supabaseUser.id;
            }

            if (!userId) {
                return next(new Error("Authentication required"));
            }

            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, role: true, email: true },
            });

            if (!user) {
                return next(new Error("User not found"));
            }

            socket.userId = user.id;
            socket.userRole = user.role;
            next();
        } catch (err) {
            logger.error("[Socket] Auth middleware error", { error: err.message });
            next(new Error("Authentication failed"));
        }
    });

    // ─── Connection Handler ──────────────────────────────────────────────
    io.on("connection", (socket) => {
        addUser(socket.userId, socket.id);

        // Auto-join personal room for direct notifications (unread counts, etc.)
        socket.join(`user:${socket.userId}`);

        // Client joins a specific conversation room
        socket.on("join:conversation", ({ contextType, contextId }) => {
            if (!contextType || !contextId) return;
            const room = `conversation:${contextType}:${contextId}`;
            socket.join(room);
        });

        // Client leaves a conversation room
        socket.on("leave:conversation", ({ contextType, contextId }) => {
            if (!contextType || !contextId) return;
            const room = `conversation:${contextType}:${contextId}`;
            socket.leave(room);
        });

        socket.on("disconnect", () => {
            removeUser(socket.userId, socket.id);
        });
    });

    logger.info("[Socket] Socket.io server initialized");
    return io;
}

/**
 * Get the initialized Socket.io server instance.
 * Returns null if not yet initialized (safe for optional usage).
 */
export function getIO() {
    return io;
}

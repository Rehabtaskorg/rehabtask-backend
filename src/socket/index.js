import { Server } from "socket.io";
import cookie from "cookie";
import { supabase } from "../config/supabase.js";
import { prisma } from "../config/prisma.js";
import { addUser, removeUser } from "./presence.js";
import { logger } from "../config/logger.js";

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
    io.use(async (socket, next) => {
        try {
            // Extract token from cookies (same cookie as REST auth) or handshake auth
            const cookies = cookie.parse(socket.handshake.headers.cookie || "");
            const token = cookies.sb_access_token || socket.handshake.auth?.token;

            if (!token) {
                return next(new Error("Authentication required"));
            }

            const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);
            if (error || !supabaseUser) {
                return next(new Error("Invalid or expired token"));
            }

            const user = await prisma.user.findUnique({
                where: { id: supabaseUser.id },
                select: { id: true, role: true, email: true },
            });

            if (!user) {
                return next(new Error("User not found"));
            }

            // Attach user info to socket for downstream use
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

import { Server } from "socket.io";
import cookie from "cookie";
import { getIdentityPlatformAuth } from "../config/identityPlatform.js";
import { prisma } from "../config/prisma.js";
import { addUser, removeUser } from "./presence.js";
import { logger } from "../config/logger.js";
import { socketTickets } from "../routes/auth.routes.js";

let io = null;

/**
 * Initialise Socket.io server and attach to the HTTP server.
 *
 * @param {import("http").Server} httpServer
 * @returns {import("socket.io").Server}
 */
export function initSocketIO(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: process.env.FRONTEND_URL,
            credentials: true,
        },
        pingInterval: 25000,
        pingTimeout: 20000,
    });

    io.use(async (socket, next) => {
        try {
            const ticket = socket.handshake.auth?.ticket;
            const cookies = cookie.parse(socket.handshake.headers.cookie || "");
            const token = cookies.sb_access_token || socket.handshake.auth?.token;

            let userId = null;

            if (ticket && socketTickets.has(ticket)) {
                const ticketData = socketTickets.get(ticket);
                socketTickets.delete(ticket);
                if (Date.now() - ticketData.createdAt > 30000) {
                    return next(new Error("Ticket expired"));
                }
                userId = ticketData.userId;
            } else if (token) {
                try {
                    const auth = getIdentityPlatformAuth();
                    const decoded = await auth.verifyIdToken(token);
                    userId = decoded.uid;
                } catch {
                    return next(new Error("Invalid or expired token"));
                }
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

    io.on("connection", (socket) => {
        addUser(socket.userId, socket.id);

        socket.join(`user:${socket.userId}`);

        socket.on("join:conversation", (data) => {
            if (data.conversationId) {
                socket.join(`conversation:${data.conversationId}`);
            }
        });

        socket.on("leave:conversation", (data) => {
            if (data.conversationId) {
                socket.leave(`conversation:${data.conversationId}`);
            }
        });

        socket.on("disconnect", () => {
            removeUser(socket.userId, socket.id);
        });
    });

    logger.info("[Socket] Socket.io server initialized");
    return io;
}

/**
 * Get the initialised Socket.io server instance.
 * Returns null if not yet initialised.
 *
 * @returns {import("socket.io").Server|null}
 */
export function getIO() {
    return io;
}
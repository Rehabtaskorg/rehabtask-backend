import { logger } from "../config/logger.js";

/**
 * In-memory presence tracker.
 * Maps userId → Set<socketId> to support multiple tabs/devices.
 */
const onlineUsers = new Map();

export function addUser(userId, socketId) {
    if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socketId);
    logger.info(`[Presence] User ${userId} connected (${onlineUsers.get(userId).size} tab(s))`);
}

export function removeUser(userId, socketId) {
    const sockets = onlineUsers.get(userId);
    if (!sockets) return;

    sockets.delete(socketId);
    if (sockets.size === 0) {
        onlineUsers.delete(userId);
        logger.info(`[Presence] User ${userId} fully disconnected`);
    } else {
        logger.info(`[Presence] User ${userId} closed a tab (${sockets.size} remaining)`);
    }
}

export function isUserOnline(userId) {
    return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
}

export function getOnlineCount() {
    return onlineUsers.size;
}
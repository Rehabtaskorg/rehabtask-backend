import { prisma } from "../config/prisma.js";

/**
 * @param {string[]} conversationIds
 * @returns {Promise<Array>}
 */
export const queryLatestMessagesPerConversation = async (conversationIds) => {
    return prisma.$queryRaw`
        SELECT DISTINCT ON (conversation_id)
            id, sender_id AS "senderId", content, created_at AS "createdAt",
            read_at AS "readAt", conversation_id AS "conversationId", system_type AS "systemType",
            EXISTS (
                SELECT 1 FROM message_attachments WHERE message_id = messages.id
            ) AS "hasAttachments"
        FROM messages
        WHERE conversation_id = ANY(${conversationIds}::uuid[])
        ORDER BY conversation_id, created_at DESC
    `;
};

/**
 * @param {string[]} conversationIds
 * @returns {Promise<Array>}
 */
export const queryContextMessagesPerConversation = async (conversationIds) => {
    return prisma.$queryRaw`
        SELECT DISTINCT ON (conversation_id)
            conversation_id AS "conversationId",
            offer_id AS "offerId",
            booking_id AS "bookingId",
            patient_id AS "patientId"
        FROM messages
        WHERE conversation_id = ANY(${conversationIds}::uuid[])
          AND (offer_id IS NOT NULL OR booking_id IS NOT NULL)
        ORDER BY conversation_id, created_at DESC
    `;
};

/**
 * @param {string[]} conversationIds
 * @returns {Promise<Array>}
 */
export const queryPatientMessagesPerConversation = async (conversationIds) => {
    return prisma.$queryRaw`
        SELECT DISTINCT ON (conversation_id)
            conversation_id AS "conversationId",
            patient_id AS "patientId"
        FROM messages
        WHERE conversation_id = ANY(${conversationIds}::uuid[])
          AND patient_id IS NOT NULL
        ORDER BY conversation_id, created_at DESC
    `;
};

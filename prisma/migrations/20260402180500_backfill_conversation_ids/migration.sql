-- Phase 2: Backfill — link all existing messages to a DirectConversation.
-- This is idempotent — safe to run multiple times.

-- Step 1: Create DirectConversation rows for every unique user pair
-- that has messages but no DirectConversation yet.
-- Normalize order: LEAST = user1, GREATEST = user2 (matches app-level convention).
INSERT INTO direct_conversations (id, user1_id, user2_id, created_at, updated_at)
SELECT
    gen_random_uuid(),
    LEAST(sender_id, recipient_id),
    GREATEST(sender_id, recipient_id),
    MIN(created_at),   -- use earliest message date as conversation creation time
    MAX(created_at)    -- use latest message date as last updated
FROM messages
WHERE conversation_id IS NULL
GROUP BY LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id)
ON CONFLICT (user1_id, user2_id) DO NOTHING;

-- Step 2: Set conversation_id on all messages that don't have one yet.
-- Match via the sender-recipient pair to the DirectConversation.
UPDATE messages m
SET conversation_id = dc.id
FROM direct_conversations dc
WHERE m.conversation_id IS NULL
  AND LEAST(m.sender_id, m.recipient_id) = dc.user1_id
  AND GREATEST(m.sender_id, m.recipient_id) = dc.user2_id;

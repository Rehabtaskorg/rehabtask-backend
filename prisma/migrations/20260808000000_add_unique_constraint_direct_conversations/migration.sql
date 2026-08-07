ALTER TABLE direct_conversations
  ADD CONSTRAINT direct_conversations_user1_id_user2_id_key
  UNIQUE (user1_id, user2_id);
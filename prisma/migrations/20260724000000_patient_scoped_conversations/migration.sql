ALTER TABLE direct_conversations
    ADD COLUMN patient_id UUID REFERENCES patients(id) ON DELETE SET NULL;

DROP INDEX direct_conversations_user1_id_user2_id_key;

CREATE UNIQUE INDEX direct_conversations_user1_id_user2_id_patient_id_key
    ON direct_conversations (user1_id, user2_id, COALESCE(patient_id, '00000000-0000-0000-0000-000000000000'::uuid));

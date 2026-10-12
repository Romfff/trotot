-- S5-02: existing listing states and owner-approved D-S5-05/06/07; no booking/ledger changes.
BEGIN;
CREATE TABLE chat_conversations (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
 guest_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 host_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
 CHECK(guest_id<>host_id), UNIQUE(property_id,guest_id,host_id)
);
CREATE INDEX chat_conversations_guest_id_created_at_id_idx ON chat_conversations(guest_id,created_at,id);
CREATE INDEX chat_conversations_host_id_created_at_id_idx ON chat_conversations(host_id,created_at,id);
CREATE TABLE chat_messages (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE RESTRICT,
 sender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 client_message_id UUID NOT NULL,
 text VARCHAR(3000) NOT NULL CHECK(length(btrim(text)) BETWEEN 1 AND 3000),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(conversation_id,sender_id,client_message_id)
);
CREATE INDEX chat_messages_conversation_id_created_at_id_idx ON chat_messages(conversation_id,created_at,id);
COMMIT;

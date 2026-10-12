BEGIN;
CREATE TABLE chat_read_cursors (
 conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE RESTRICT,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE RESTRICT,
 PRIMARY KEY(conversation_id,user_id)
);
CREATE INDEX chat_read_cursors_user_id_idx ON chat_read_cursors(user_id);
COMMIT;

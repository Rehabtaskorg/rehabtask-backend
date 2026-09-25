ALTER TABLE patients ADD COLUMN gender VARCHAR(10) CHECK (gender IN ('male', 'female', 'other'));

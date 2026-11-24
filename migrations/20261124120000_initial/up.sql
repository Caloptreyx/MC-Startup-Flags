-- Saved custom JVM startup flag presets, scoped to a user account so they work across all of
-- the user's servers.
CREATE TABLE dev_caloptreyx_startupflags_presets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_uuid uuid NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    description VARCHAR(255) NOT NULL DEFAULT '',
    config JSONB NOT NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dev_caloptreyx_startupflags_presets_user_uuid_idx
    ON dev_caloptreyx_startupflags_presets (user_uuid);

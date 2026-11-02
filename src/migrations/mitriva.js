'use strict';

const { getPool } = require('../db');

const migrationName = '20260929_mitriva_001_prefixed_schema';

const statements = [
`CREATE TABLE IF NOT EXISTS mtr_users (
  id CHAR(36) NOT NULL,
  legacy_user_id BIGINT NOT NULL AUTO_INCREMENT,
  phone_e164 VARCHAR(20) NULL,
  email VARCHAR(320) NULL,
  is_phone_verified TINYINT(1) NOT NULL DEFAULT 0,
  auth_provider VARCHAR(40) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  role VARCHAR(20) NOT NULL DEFAULT 'member',
  last_active_at DATETIME(6) NULL,
  deactivated_at DATETIME(6) NULL,
  deleted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mtr_users_legacy (legacy_user_id),
  UNIQUE KEY uq_mtr_users_phone (phone_e164),
  KEY idx_mtr_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_city_master (
  id BIGINT NOT NULL,
  name VARCHAR(120) NOT NULL,
  state VARCHAR(120) NULL,
  country VARCHAR(120) NOT NULL DEFAULT 'India',
  search_key VARCHAR(255) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), KEY idx_mtr_city_search(search_key), KEY idx_mtr_city_name(name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_user_profiles (
  user_id CHAR(36) NOT NULL, display_name VARCHAR(80) NOT NULL, birth_date DATE NOT NULL,
  gender VARCHAR(40) NOT NULL, city VARCHAR(100) NOT NULL, city_id BIGINT NULL,
  profession VARCHAR(120) NULL, bio VARCHAR(1000) NOT NULL DEFAULT '', interests_json JSON NULL,
  is_profile_complete TINYINT(1) NOT NULL DEFAULT 0, verified TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(user_id), KEY idx_mtr_profile_city(city_id), KEY idx_mtr_profile_gender(gender),
  CONSTRAINT fk_mtr_profile_user FOREIGN KEY(user_id) REFERENCES mtr_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_user_preferences (
  user_id CHAR(36) NOT NULL, interested_in VARCHAR(40) NOT NULL DEFAULT 'Everyone',
  relationship_goal VARCHAR(80) NOT NULL DEFAULT 'Any', minimum_age INT NOT NULL DEFAULT 23,
  maximum_age INT NOT NULL DEFAULT 35, distance_km INT NOT NULL DEFAULT 50,
  verified_only TINYINT(1) NOT NULL DEFAULT 0, recently_active_only TINYINT(1) NOT NULL DEFAULT 0,
  discovery_mode VARCHAR(20) NOT NULL DEFAULT 'near_me', selected_city VARCHAR(100) NULL,
  selected_city_id BIGINT NULL, interest_filters_json JSON NULL,
  discovery_relationship_goal VARCHAR(80) NOT NULL DEFAULT 'Any',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(user_id), CONSTRAINT fk_mtr_pref_user FOREIGN KEY(user_id) REFERENCES mtr_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_user_locations (
  user_id CHAR(36) NOT NULL, latitude DOUBLE NOT NULL, longitude DOUBLE NOT NULL, city VARCHAR(100) NULL,
  city_id BIGINT NULL, accuracy_m DOUBLE NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(user_id), KEY idx_mtr_location_latlng(latitude,longitude),
  CONSTRAINT fk_mtr_location_user FOREIGN KEY(user_id) REFERENCES mtr_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_user_photos (
  id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, storage_path TEXT NOT NULL,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'image/jpeg', position INT NOT NULL DEFAULT 0,
  is_primary TINYINT(1) NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'active',
  moderation_status VARCHAR(20) NOT NULL DEFAULT 'pending', moderation_adult TINYINT(1) NULL,
  moderation_racy TINYINT(1) NULL, moderation_note VARCHAR(1000) NULL, moderated_at DATETIME(6) NULL,
  moderated_by CHAR(36) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id), KEY idx_mtr_photo_user(user_id,position),
  CONSTRAINT fk_mtr_photo_user FOREIGN KEY(user_id) REFERENCES mtr_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_user_profile_prompts (
  id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, prompt_key VARCHAR(80) NOT NULL,
  answer VARCHAR(240) NOT NULL, position INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id), KEY idx_mtr_prompt_user(user_id,position),
  CONSTRAINT fk_mtr_prompt_user FOREIGN KEY(user_id) REFERENCES mtr_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_user_interactions (
  id BIGINT NOT NULL AUTO_INCREMENT, actor_user_id CHAR(36) NOT NULL, target_user_id CHAR(36) NOT NULL,
  action VARCHAR(20) NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id), UNIQUE KEY uq_mtr_interaction(actor_user_id,target_user_id), KEY idx_mtr_interaction_target(target_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_interaction_history (
  id CHAR(36) NOT NULL, actor_user_id CHAR(36) NOT NULL, target_user_id CHAR(36) NOT NULL,
  action VARCHAR(20) NOT NULL, previous_action VARCHAR(20) NULL, matched TINYINT(1) NOT NULL DEFAULT 0,
  rewound_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id), KEY idx_mtr_history_actor(actor_user_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_matches (
  id CHAR(36) NOT NULL, user_one_id CHAR(36) NOT NULL, user_two_id CHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active', conversation_started_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id), KEY idx_mtr_match_u1(user_one_id,status), KEY idx_mtr_match_u2(user_two_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_match_user_settings (
  match_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, muted TINYINT(1) NOT NULL DEFAULT 0,
  hidden_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(match_id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_messages (
  id BIGINT NOT NULL AUTO_INCREMENT, match_id CHAR(36) NOT NULL, sender_user_id CHAR(36) NOT NULL,
  message_text TEXT NOT NULL, read_at DATETIME(6) NULL, deleted_at DATETIME(6) NULL,
  deleted_by_user_id CHAR(36) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id), KEY idx_mtr_messages_match(match_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_user_blocks (
  blocker_user_id CHAR(36) NOT NULL, blocked_user_id CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY(blocker_user_id,blocked_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_user_reports (
  id BIGINT NOT NULL AUTO_INCREMENT, reporter_user_id CHAR(36) NOT NULL, reported_user_id CHAR(36) NOT NULL,
  reason VARCHAR(80) NOT NULL, details VARCHAR(1000) NULL, status VARCHAR(20) NOT NULL DEFAULT 'open',
  moderation_note VARCHAR(1000) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  reviewed_at DATETIME(6) NULL, reviewed_by CHAR(36) NULL, PRIMARY KEY(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_user_settings (
  user_id CHAR(36) NOT NULL, push_notifications TINYINT(1) NOT NULL DEFAULT 1,
  message_notifications TINYINT(1) NOT NULL DEFAULT 1, match_notifications TINYINT(1) NOT NULL DEFAULT 1,
  show_online_status TINYINT(1) NOT NULL DEFAULT 1, show_distance TINYINT(1) NOT NULL DEFAULT 1,
  profile_visible TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_notification_events (
  id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, type VARCHAR(40) NOT NULL, title VARCHAR(160) NOT NULL,
  body VARCHAR(1000) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'queued', data_json JSON NULL,
  sent_at DATETIME(6) NULL, read_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id), KEY idx_mtr_notifications_user(user_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_subscriptions (
  user_id CHAR(36) NOT NULL, plan_code VARCHAR(40) NOT NULL DEFAULT 'free', status VARCHAR(20) NOT NULL DEFAULT 'free',
  provider VARCHAR(40) NULL, provider_subscription_id VARCHAR(255) NULL, starts_at DATETIME(6) NULL,
  ends_at DATETIME(6) NULL, auto_renew TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_daily_entitlement_usage (
  user_id CHAR(36) NOT NULL, usage_date DATE NOT NULL, likes_used INT NOT NULL DEFAULT 0,
  super_likes_used INT NOT NULL DEFAULT 0, rewinds_used INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(user_id,usage_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_identity_verifications (
  id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
  selfie_storage_path TEXT NOT NULL, document_type VARCHAR(40) NOT NULL DEFAULT 'none',
  document_last4 VARCHAR(8) NULL, document_storage_path TEXT NULL, notes VARCHAR(1000) NULL,
  submitted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), reviewed_at DATETIME(6) NULL,
  reviewed_by CHAR(36) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_device_tokens (
  id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, token VARCHAR(500) NOT NULL,
  platform VARCHAR(20) NOT NULL, device_id VARCHAR(120) NULL, enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id), UNIQUE KEY uq_mtr_device_token(token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_legal_documents (
  type VARCHAR(40) NOT NULL, version VARCHAR(40) NOT NULL, title VARCHAR(160) NOT NULL,
  summary VARCHAR(1000) NOT NULL DEFAULT '', content LONGTEXT NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1,
  published_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY(type,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_legal_consents (
  id BIGINT NOT NULL AUTO_INCREMENT, user_id CHAR(36) NOT NULL, document_type VARCHAR(40) NOT NULL,
  version VARCHAR(40) NOT NULL, accepted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  ip_address VARCHAR(64) NULL, user_agent VARCHAR(500) NULL, PRIMARY KEY(id),
  UNIQUE KEY uq_mtr_consent(user_id,document_type,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_auth_sessions (
  id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, refresh_token_hash VARCHAR(255) NOT NULL,
  device_id VARCHAR(120) NULL, device_name VARCHAR(160) NULL, expires_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL, last_used_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY(id), KEY idx_mtr_session_user(user_id,expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_otp_codes (
  id BIGINT NOT NULL AUTO_INCREMENT, phone_e164 VARCHAR(20) NOT NULL, otp_hash CHAR(64) NOT NULL,
  purpose VARCHAR(20) NOT NULL DEFAULT 'login', expires_at DATETIME(6) NOT NULL, consumed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY(id),
  KEY idx_mtr_otp_phone(phone_e164,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS mtr_otp_request_logs (
  id BIGINT NOT NULL AUTO_INCREMENT, phone_e164 VARCHAR(20) NOT NULL,
  requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ip_address VARCHAR(64) NULL,
  PRIMARY KEY(id), KEY idx_mtr_otp_req_phone(phone_e164,requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

async function tableExists(conn, tableName) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(rows[0]?.count || 0) === 1;
}

async function applyMitrivaMigration() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    // A new managed database has no migration ledger yet; create it before
    // recording this additive Mitriva schema migration.
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name VARCHAR(255) NOT NULL,
      applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (migration_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const sql of statements) await conn.query(sql);
    await conn.execute('INSERT IGNORE INTO schema_migrations (migration_name) VALUES (?)', [migrationName]);
    const required = ['mtr_users','mtr_city_master','mtr_user_profiles','mtr_user_preferences','mtr_user_locations','mtr_user_photos','mtr_user_interactions','mtr_matches','mtr_messages','mtr_auth_sessions'];
    const missing=[];
    for (const t of required) if (!(await tableExists(conn,t))) missing.push(t);
    if (missing.length) {
      const error=new Error(`Mitriva schema bootstrap incomplete. Missing tables: ${missing.join(', ')}`);
      error.code='MTR_SCHEMA_RECOVERY_INCOMPLETE';
      throw error;
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('[Mitriva] additive schema bootstrap verified.');
  } catch (error) {
    try { await conn.query('SET FOREIGN_KEY_CHECKS = 1'); } catch (_) {}
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { applyMitrivaMigration };

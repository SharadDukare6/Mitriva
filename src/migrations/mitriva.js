'use strict';

const crypto = require('crypto');
const { getPool } = require('../db');

const migrationName = '20260929_mitriva_001_prefixed_schema';

// Canonical cities used by registration and city-based discovery. This runs on every
// bootstrap so a previously-created empty database is repaired automatically.
const citySeed = [
  [1001,'Pune','Maharashtra'],[1002,'Mumbai','Maharashtra'],[1003,'Nagpur','Maharashtra'],[1004,'Nashik','Maharashtra'],[1005,'Thane','Maharashtra'],[1006,'Aurangabad','Maharashtra'],[1007,'Kolhapur','Maharashtra'],[1008,'Solapur','Maharashtra'],
  [1101,'Delhi','Delhi'],[1102,'New Delhi','Delhi'],[1103,'Gurugram','Haryana'],[1104,'Noida','Uttar Pradesh'],[1105,'Faridabad','Haryana'],[1106,'Ghaziabad','Uttar Pradesh'],
  [1201,'Bengaluru','Karnataka'],[1202,'Mysuru','Karnataka'],[1203,'Mangaluru','Karnataka'],[1204,'Hubballi','Karnataka'],
  [1301,'Hyderabad','Telangana'],[1302,'Warangal','Telangana'],[1303,'Secunderabad','Telangana'],
  [1401,'Chennai','Tamil Nadu'],[1402,'Coimbatore','Tamil Nadu'],[1403,'Madurai','Tamil Nadu'],[1404,'Tiruchirappalli','Tamil Nadu'],[1405,'Salem','Tamil Nadu'],
  [1501,'Kolkata','West Bengal'],[1502,'Howrah','West Bengal'],[1503,'Siliguri','West Bengal'],[1504,'Durgapur','West Bengal'],
  [1601,'Ahmedabad','Gujarat'],[1602,'Surat','Gujarat'],[1603,'Vadodara','Gujarat'],[1604,'Rajkot','Gujarat'],[1605,'Gandhinagar','Gujarat'],
  [1701,'Jaipur','Rajasthan'],[1702,'Jodhpur','Rajasthan'],[1703,'Udaipur','Rajasthan'],[1704,'Kota','Rajasthan'],
  [1801,'Lucknow','Uttar Pradesh'],[1802,'Kanpur','Uttar Pradesh'],[1803,'Agra','Uttar Pradesh'],[1804,'Varanasi','Uttar Pradesh'],[1805,'Prayagraj','Uttar Pradesh'],[1806,'Meerut','Uttar Pradesh'],
  [1901,'Bhopal','Madhya Pradesh'],[1902,'Indore','Madhya Pradesh'],[1903,'Jabalpur','Madhya Pradesh'],[1904,'Gwalior','Madhya Pradesh'],
  [2001,'Patna','Bihar'],[2002,'Ranchi','Jharkhand'],[2003,'Bhubaneswar','Odisha'],[2004,'Guwahati','Assam'],[2005,'Chandigarh','Chandigarh'],[2006,'Kochi','Kerala'],[2007,'Thiruvananthapuram','Kerala'],[2008,'Visakhapatnam','Andhra Pradesh'],[2009,'Vijayawada','Andhra Pradesh'],[2010,'Amritsar','Punjab'],[2011,'Ludhiana','Punjab'],[2012,'Dehradun','Uttarakhand']
];

const demoCities = [
  ['Pune',1001,18.5204,73.8567],['Mumbai',1002,19.0760,72.8777],
  ['Delhi',1101,28.6139,77.2090],['Bengaluru',1201,12.9716,77.5946],
  ['Hyderabad',1301,17.3850,78.4867],['Chennai',1401,13.0827,80.2707],
  ['Kolkata',1501,22.5726,88.3639],['Ahmedabad',1601,23.0225,72.5714],
  ['Jaipur',1701,26.9124,75.7873],['Lucknow',1801,26.8467,80.9462]
];
const demoMen = ['Aarav','Vivaan','Aditya','Arjun','Rohan'];
const demoWomen = ['Ananya','Aadhya','Diya','Isha','Kavya'];

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

async function seedCities(conn) {
  for (const [id, name, state] of citySeed) {
    await conn.execute(
      `INSERT INTO mtr_city_master(id,name,state,country,search_key,active) VALUES(?,?,?,'India',?,1)
       ON DUPLICATE KEY UPDATE name=VALUES(name),state=VALUES(state),country=VALUES(country),search_key=VALUES(search_key),active=1`,
      [id, name, state, `${name} ${state}`.toLowerCase()]
    );
  }
}

function demoUserId(seed) {
  const hex = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function seedDemoProfiles(conn) {
  if (process.env.MITRIVA_DEMO_PROFILES_ENABLED !== 'true') return;
  for (let cityIndex = 0; cityIndex < demoCities.length; cityIndex += 1) {
    const [city, cityId, latitude, longitude] = demoCities[cityIndex];
    for (const [gender, names] of [['Man', demoMen], ['Woman', demoWomen]]) {
      for (let index = 0; index < names.length; index += 1) {
        const firstName = names[index];
        const seed = `${city.toLowerCase()}-${gender.toLowerCase()}-${index + 1}`;
        const id = demoUserId(seed);
        const displayName = `${firstName} (Demo)`;
        const email = `mitriva.demo.${seed}@example.invalid`;
        const interests = JSON.stringify(index % 2 ? ['Travel','Music','Food'] : ['Books','Movies','Coffee']);
        await conn.execute(`INSERT IGNORE INTO mtr_users(id,email,is_phone_verified,auth_provider,status,role,last_active_at)
          VALUES(?,?,1,'demo','active','demo',UTC_TIMESTAMP(6))`, [id, email]);
        await conn.execute(`INSERT INTO mtr_user_profiles(user_id,display_name,birth_date,gender,city,city_id,profession,bio,interests_json,is_profile_complete,verified)
          VALUES(?,?,?, ?,?,?,?, ?,?,1,0)
          ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),city=VALUES(city),city_id=VALUES(city_id),profession=VALUES(profession),bio=VALUES(bio),interests_json=VALUES(interests_json),is_profile_complete=1,verified=0`, [
          id, displayName, `199${(cityIndex + index) % 10}-0${(index % 8) + 1}-15`, gender, city, cityId,
          index % 2 ? 'Designer' : 'Engineer',
          `AI demo profile for Mitriva testing only — not a real member.`, interests
        ]);
        await conn.execute(`INSERT IGNORE INTO mtr_user_preferences(user_id,interested_in,relationship_goal,discovery_relationship_goal,minimum_age,maximum_age,distance_km)
          VALUES(?,'Everyone','Any','Any',18,80,200)`, [id]);
        await conn.execute(`INSERT IGNORE INTO mtr_user_settings(user_id,profile_visible) VALUES(?,1)`, [id]);
        await conn.execute(`INSERT INTO mtr_user_locations(user_id,latitude,longitude,city,city_id,accuracy_m)
          VALUES(?,?,?,?,?,25) ON DUPLICATE KEY UPDATE latitude=VALUES(latitude),longitude=VALUES(longitude),city=VALUES(city),city_id=VALUES(city_id)`,
          [id, latitude + (index * 0.002), longitude + (index * 0.002), city, cityId]);
      }
    }
  }
}

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
    await seedCities(conn);
    await seedDemoProfiles(conn);
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

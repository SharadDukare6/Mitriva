'use strict';

const fs = require('fs');
const path = require('path');
const { getPool } = require('../db');

const MARKER = '20260930_mitriva_supabase_data_import_v1';
// mysql2 execute() rejects undefined parameters; Supabase records contain nullable fields.
async function safeExecute(conn, statement, params = []) {
  return conn.execute(statement, params.map(v => v === undefined ? null : v));
}


function enabled() {
  // All-in-one cutover: if the Supabase server key is deployed, run the import once.
  // Explicit MITRIVA_MIGRATE_FROM_SUPABASE=0 can still disable it.
  const flag = String(process.env.MITRIVA_MIGRATE_FROM_SUPABASE || '').trim();
  return flag === '1';
}

function supabaseConfig() {
  const url = String(process.env.MITRIVA_SUPABASE_URL || 'https://yycjtheyfpqaayzfqzts.supabase.co').replace(/\/$/, '');
  const key = String(process.env.MITRIVA_SUPABASE_SECRET_KEY || process.env.MITRIVA_SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key) {
    const e = new Error('Mitriva Supabase migration is enabled but MITRIVA_SUPABASE_SECRET_KEY / MITRIVA_SUPABASE_SERVICE_ROLE_KEY is missing.');
    e.code = 'MTR_SUPABASE_KEY_MISSING';
    throw e;
  }
  return { url, key };
}

async function sbFetchJson(table, select = '*') {
  const { url, key } = supabaseConfig();
  const endpoint = `${url}/rest/v1/${encodeURIComponent(table)}?select=${encodeURIComponent(select)}`;
  const r = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
  });
  if (!r.ok) {
    const body = await r.text();
    const e = new Error(`Supabase ${table} export failed (HTTP ${r.status})`);
    e.code = 'MTR_SUPABASE_EXPORT_FAILED';
    throw e;
  }
  return r.json();
}

function mysqlDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 23).replace('T', ' ');
}

function json(v) {
  return v == null ? null : JSON.stringify(v);
}

async function downloadPhoto(bucket, storagePath, userId, photoId, mimeType) {
  const { url, key } = supabaseConfig();
  const encoded = String(storagePath).split('/').map(encodeURIComponent).join('/');
  const r = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key }
  });
  if (!r.ok) {
    throw Object.assign(new Error(`Photo migration failed: HTTP ${r.status}`), { code: 'MTR_PHOTO_COPY_FAILED' });
  }
  const bytes = Number(r.headers.get('content-length') || 0);
  if (bytes > 15 * 1024 * 1024) throw new Error('Mitriva photo exceeds 15 MB migration limit');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) throw new Error('Mitriva photo exceeds 15 MB migration limit');
  const ext = String(mimeType || '').includes('png') ? 'png' : String(mimeType || '').includes('webp') ? 'webp' : 'jpg';
  const rel = `photos/${userId}/${photoId}.${ext}`;
  const root = path.resolve(__dirname, '..', '..', 'public', 'mitriva-media');
  const full = path.resolve(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return rel;
}

async function markerExists(conn) {
  const [rows] = await safeExecute(conn, 'SELECT 1 FROM schema_migrations WHERE migration_name=? LIMIT 1', [MARKER]);
  return rows.length > 0;
}

async function importMitrivaSupabaseData() {
  if (!enabled()) {
    console.log('[Mitriva migration] Supabase data import disabled (MITRIVA_MIGRATE_FROM_SUPABASE != 1).');
    return { skipped: true, reason: 'disabled' };
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    if (await markerExists(conn)) {
      console.log('[Mitriva migration] Supabase data import already completed; skipping.');
      return { skipped: true, reason: 'already_completed' };
    }

    console.log('[Mitriva migration] Reading Supabase data...');
    const [cities, users, profiles, prefs, locations, settings, usage, subscriptions, photos, interactions, history, matches, matchSettings, messages, notifications, blocks, reports] = await Promise.all([
      sbFetchJson('city_master'), sbFetchJson('users'), sbFetchJson('user_profiles'), sbFetchJson('user_preferences'),
      sbFetchJson('user_locations', 'user_id,latitude,longitude,city,city_id,accuracy_m,created_at,updated_at'), sbFetchJson('user_settings'),
      sbFetchJson('daily_entitlement_usage'), sbFetchJson('subscriptions'), sbFetchJson('user_photos'), sbFetchJson('user_interactions'),
      sbFetchJson('interaction_history'), sbFetchJson('matches'), sbFetchJson('match_user_settings'), sbFetchJson('messages'),
      sbFetchJson('notification_events'), sbFetchJson('user_blocks'), sbFetchJson('user_reports')
    ]);

    await conn.beginTransaction();
    await conn.query('SET FOREIGN_KEY_CHECKS=0');

    for (const r of cities) await safeExecute(conn, 
      `INSERT INTO mtr_city_master(id,name,state,country,search_key,active,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),state=VALUES(state),country=VALUES(country),search_key=VALUES(search_key),active=VALUES(active),updated_at=VALUES(updated_at)`,
      [r.id,r.name,r.state,r.country,r.search_key,r.active?1:0,mysqlDate(r.created_at),mysqlDate(r.updated_at)]
    );

    for (const r of users) await safeExecute(conn, 
      `INSERT INTO mtr_users(id,legacy_user_id,phone_e164,email,is_phone_verified,auth_provider,status,role,last_active_at,deactivated_at,deleted_at,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE phone_e164=VALUES(phone_e164),email=VALUES(email),is_phone_verified=VALUES(is_phone_verified),auth_provider=VALUES(auth_provider),status=VALUES(status),role=VALUES(role),last_active_at=VALUES(last_active_at),deactivated_at=VALUES(deactivated_at),deleted_at=VALUES(deleted_at),updated_at=VALUES(updated_at)`,
      [r.id,r.legacy_user_id,r.phone_e164,r.email,r.is_phone_verified?1:0,r.auth_provider,r.status,r.role,mysqlDate(r.last_active_at),mysqlDate(r.deactivated_at),mysqlDate(r.deleted_at),mysqlDate(r.created_at),mysqlDate(r.updated_at)]
    );

    for (const r of profiles) await safeExecute(conn, 
      `INSERT INTO mtr_user_profiles(user_id,display_name,birth_date,gender,city,city_id,profession,bio,interests_json,is_profile_complete,verified,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),birth_date=VALUES(birth_date),gender=VALUES(gender),city=VALUES(city),city_id=VALUES(city_id),profession=VALUES(profession),bio=VALUES(bio),interests_json=VALUES(interests_json),is_profile_complete=VALUES(is_profile_complete),verified=VALUES(verified),updated_at=VALUES(updated_at)`,
      [r.user_id,r.display_name,r.birth_date,r.gender,r.city,r.city_id,r.profession,r.bio,json(r.interests_json),r.is_profile_complete?1:0,r.verified?1:0,mysqlDate(r.created_at),mysqlDate(r.updated_at)]
    );

    for (const r of prefs) await safeExecute(conn, 
      `INSERT INTO mtr_user_preferences(user_id,interested_in,relationship_goal,minimum_age,maximum_age,distance_km,verified_only,recently_active_only,discovery_mode,selected_city,selected_city_id,interest_filters_json,discovery_relationship_goal,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE interested_in=VALUES(interested_in),relationship_goal=VALUES(relationship_goal),minimum_age=VALUES(minimum_age),maximum_age=VALUES(maximum_age),distance_km=VALUES(distance_km),verified_only=VALUES(verified_only),recently_active_only=VALUES(recently_active_only),discovery_mode=VALUES(discovery_mode),selected_city=VALUES(selected_city),selected_city_id=VALUES(selected_city_id),interest_filters_json=VALUES(interest_filters_json),discovery_relationship_goal=VALUES(discovery_relationship_goal),updated_at=VALUES(updated_at)`,
      [r.user_id,r.interested_in,r.relationship_goal,r.minimum_age,r.maximum_age,r.distance_km,r.verified_only?1:0,r.recently_active_only?1:0,r.discovery_mode,r.selected_city,r.selected_city_id,json(r.interest_filters_json),r.discovery_relationship_goal,mysqlDate(r.created_at),mysqlDate(r.updated_at)]
    );

    for (const r of locations) await safeExecute(conn, 
      `INSERT INTO mtr_user_locations(user_id,latitude,longitude,city,city_id,accuracy_m,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE latitude=VALUES(latitude),longitude=VALUES(longitude),city=VALUES(city),city_id=VALUES(city_id),accuracy_m=VALUES(accuracy_m),updated_at=VALUES(updated_at)`,
      [r.user_id,r.latitude,r.longitude,r.city,r.city_id,r.accuracy_m,mysqlDate(r.created_at),mysqlDate(r.updated_at)]
    );

    for (const r of settings) await safeExecute(conn, 
      `INSERT INTO mtr_user_settings(user_id,push_notifications,message_notifications,match_notifications,show_online_status,show_distance,profile_visible,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE push_notifications=VALUES(push_notifications),message_notifications=VALUES(message_notifications),match_notifications=VALUES(match_notifications),show_online_status=VALUES(show_online_status),show_distance=VALUES(show_distance),profile_visible=VALUES(profile_visible),updated_at=VALUES(updated_at)`,
      [r.user_id,r.push_notifications?1:0,r.message_notifications?1:0,r.match_notifications?1:0,r.show_online_status?1:0,r.show_distance?1:0,r.profile_visible?1:0,mysqlDate(r.created_at),mysqlDate(r.updated_at)]
    );

    for (const r of usage) await safeExecute(conn, 
      `INSERT INTO mtr_daily_entitlement_usage(user_id,usage_date,likes_used,super_likes_used,rewinds_used,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE likes_used=VALUES(likes_used),super_likes_used=VALUES(super_likes_used),rewinds_used=VALUES(rewinds_used),updated_at=VALUES(updated_at)`,
      [r.user_id,r.usage_date,r.likes_used,r.super_likes_used,r.rewinds_used,mysqlDate(r.created_at),mysqlDate(r.updated_at)]
    );

    for (const r of subscriptions) await safeExecute(conn, 
      `INSERT INTO mtr_subscriptions(user_id,plan_code,status,provider,provider_subscription_id,starts_at,ends_at,auto_renew,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE plan_code=VALUES(plan_code),status=VALUES(status),provider=VALUES(provider),provider_subscription_id=VALUES(provider_subscription_id),starts_at=VALUES(starts_at),ends_at=VALUES(ends_at),auto_renew=VALUES(auto_renew),updated_at=VALUES(updated_at)`,
      [r.user_id,r.plan_code,r.status,r.provider,r.provider_reference || null,mysqlDate(r.starts_at),mysqlDate(r.ends_at),r.auto_renew?1:0,mysqlDate(r.created_at),mysqlDate(r.updated_at)]
    );

    for (const r of interactions) await safeExecute(conn, 
      `INSERT INTO mtr_user_interactions(id,actor_user_id,target_user_id,action,created_at,updated_at) VALUES(?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE action=VALUES(action),updated_at=VALUES(updated_at)`,
      [r.id,r.actor_user_id,r.target_user_id,r.action,mysqlDate(r.created_at),mysqlDate(r.updated_at)]
    );

    for (const r of history) await safeExecute(conn, 
      `INSERT INTO mtr_interaction_history(id,actor_user_id,target_user_id,action,previous_action,matched,rewound_at,created_at) VALUES(?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE action=VALUES(action),previous_action=VALUES(previous_action),matched=VALUES(matched),rewound_at=VALUES(rewound_at)`,
      [r.id,r.actor_user_id,r.target_user_id,r.action,r.previous_action,r.matched?1:0,mysqlDate(r.rewound_at),mysqlDate(r.created_at)]
    );

    for (const r of matches) await safeExecute(conn, 
      `INSERT INTO mtr_matches(id,user_one_id,user_two_id,status,conversation_started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status=VALUES(status),conversation_started_at=VALUES(conversation_started_at),updated_at=VALUES(updated_at)`,
      [r.id,r.user_one_id,r.user_two_id,r.status,mysqlDate(r.conversation_started_at),mysqlDate(r.created_at),mysqlDate(r.updated_at)]
    );

    for (const r of matchSettings) await safeExecute(conn, 
      `INSERT INTO mtr_match_user_settings(match_id,user_id,muted,hidden_at,created_at,updated_at) VALUES(?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE muted=VALUES(muted),hidden_at=VALUES(hidden_at),updated_at=VALUES(updated_at)`,
      [r.match_id,r.user_id,r.muted?1:0,mysqlDate(r.hidden_at),mysqlDate(r.created_at),mysqlDate(r.updated_at)]
    );

    for (const r of messages) await safeExecute(conn, 
      `INSERT INTO mtr_messages(id,match_id,sender_user_id,message_text,read_at,deleted_at,deleted_by_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE message_text=VALUES(message_text),read_at=VALUES(read_at),deleted_at=VALUES(deleted_at),deleted_by_user_id=VALUES(deleted_by_user_id)`,
      [r.id,r.match_id,r.sender_user_id,r.message_text,mysqlDate(r.read_at),mysqlDate(r.deleted_at),r.deleted_by_user_id,mysqlDate(r.created_at)]
    );

    for (const r of notifications) await safeExecute(conn, 
      `INSERT INTO mtr_notification_events(id,user_id,type,title,body,status,data_json,sent_at,read_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status=VALUES(status),data_json=VALUES(data_json),sent_at=VALUES(sent_at),read_at=VALUES(read_at)`,
      [r.id,r.user_id,r.type,r.title,r.body,r.status,json(r.data_json),mysqlDate(r.sent_at),mysqlDate(r.read_at),mysqlDate(r.created_at)]
    );

    for (const r of blocks) await safeExecute(conn, 
      `INSERT IGNORE INTO mtr_user_blocks(blocker_user_id,blocked_user_id,created_at) VALUES(?,?,?)`,
      [r.blocker_user_id,r.blocked_user_id,mysqlDate(r.created_at)]
    );

    for (const r of reports) await safeExecute(conn, 
      `INSERT INTO mtr_user_reports(id,reporter_user_id,reported_user_id,reason,details,status,moderation_note,created_at,reviewed_at,reviewed_by)
       VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),moderation_note=VALUES(moderation_note),reviewed_at=VALUES(reviewed_at),reviewed_by=VALUES(reviewed_by)`,
      [r.id,r.reporter_user_id,r.reported_user_id,r.reason,r.details,r.status,r.moderation_note,mysqlDate(r.created_at),mysqlDate(r.reviewed_at),r.reviewed_by]
    );

    // Photos: copy bytes from Supabase Storage to GoDaddy local media, then preserve the original photo UUID.
    for (const r of photos) {
      const localPath = await downloadPhoto(r.storage_bucket || 'profile-photos', r.storage_path, r.user_id, r.id, r.mime_type);
      await safeExecute(conn, 
        `INSERT INTO mtr_user_photos(id,user_id,storage_path,mime_type,position,is_primary,status,moderation_status,moderation_adult,moderation_racy,moderation_note,moderated_at,moderated_by,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE storage_path=VALUES(storage_path),mime_type=VALUES(mime_type),position=VALUES(position),is_primary=VALUES(is_primary),status=VALUES(status),moderation_status=VALUES(moderation_status),moderation_adult=VALUES(moderation_adult),moderation_racy=VALUES(moderation_racy),moderation_note=VALUES(moderation_note),moderated_at=VALUES(moderated_at),moderated_by=VALUES(moderated_by),updated_at=VALUES(updated_at)`,
        [r.id,r.user_id,localPath,r.mime_type,r.position,r.is_primary?1:0,r.status,r.moderation_status,r.moderation_adult==null?null:(r.moderation_adult?1:0),r.moderation_racy==null?null:(r.moderation_racy?1:0),r.moderation_note,mysqlDate(r.moderated_at),r.moderated_by,mysqlDate(r.created_at),mysqlDate(r.updated_at)]
      );
    }

    await safeExecute(conn, 'INSERT IGNORE INTO schema_migrations(migration_name) VALUES(?)', [MARKER]);
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
    await conn.commit();

    const counts = {
      cities:cities.length, users:users.length, profiles:profiles.length, preferences:prefs.length, locations:locations.length,
      settings:settings.length, usage:usage.length, subscriptions:subscriptions.length, photos:photos.length,
      interactions:interactions.length, history:history.length, matches:matches.length, messages:messages.length,
      notifications:notifications.length, blocks:blocks.length, reports:reports.length
    };
    console.log('[Mitriva migration] Supabase -> GoDaddy import completed:', counts);
    return { skipped:false, counts };
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    try { await conn.query('SET FOREIGN_KEY_CHECKS=1'); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { importMitrivaSupabaseData };

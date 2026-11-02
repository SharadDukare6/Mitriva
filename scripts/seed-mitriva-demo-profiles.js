'use strict';

/**
 * Seeds 100 clearly marked fictional adult profiles for QA, screenshots and internal testing.
 * It is intentionally disabled by default and profiles remain hidden from public discovery.
 *
 * Required:
 *   MITRIVA_ALLOW_DEMO_SEED=true
 * Optional:
 *   DEMO_ASSET_ROOT=/absolute/path/to/assets  (expects portraits/<slug>.jpg)
 *   MITRIVA_ALLOW_PRODUCTION_DEMOS=true       (required in production; profiles still hidden)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../src/db');

if (process.env.MITRIVA_ALLOW_DEMO_SEED !== 'true') {
  throw new Error('Refusing to seed: set MITRIVA_ALLOW_DEMO_SEED=true.');
}
if (process.env.NODE_ENV === 'production' && process.env.MITRIVA_ALLOW_PRODUCTION_DEMOS !== 'true') {
  throw new Error('Refusing production seed: set MITRIVA_ALLOW_PRODUCTION_DEMOS=true. Demo profiles remain hidden.');
}

const cities = [
  ['Pune', 18.5204, 73.8567], ['Mumbai', 19.0760, 72.8777],
  ['Delhi', 28.6139, 77.2090], ['Bengaluru', 12.9716, 77.5946],
  ['Hyderabad', 17.3850, 78.4867], ['Chennai', 13.0827, 80.2707],
  ['Kolkata', 22.5726, 88.3639], ['Ahmedabad', 23.0225, 72.5714],
  ['Jaipur', 26.9124, 75.7873], ['Kochi', 9.9312, 76.2673],
];
const men = ['Aarav','Vivaan','Arjun','Kabir','Rohan'];
const women = ['Aanya','Ira','Meera','Kavya','Nisha'];
const professions = ['Product designer','Teacher','Architect','Marketing specialist','Software engineer','Photographer','Nutritionist','Entrepreneur','Research analyst','Consultant'];
const interestSets = [['Travel','Coffee','Music'],['Books','Food','Movies'],['Fitness','Art','Weekend trips'],['Photography','Pets','Culture'],['Cricket','Cooking','Podcasts']];
const goals = ['Long-term relationship','Serious dating','Friendship first','Marriage','Still exploring','Friendship and dating','Casual dating'];
const assetRoot = process.env.DEMO_ASSET_ROOT || '';
const mediaRoot = path.resolve(__dirname, '..', 'public', 'mitriva-media');

function slug(city, gender, index) {
  return `demo-${city.toLowerCase().replace(/[^a-z]+/g, '-')}-${gender}-${String(index + 1).padStart(2, '0')}`;
}
function ageDate(index, gender) {
  const year = 1988 + ((index * 3 + (gender === 'female' ? 2 : 0)) % 12);
  const month = String((index * 2) % 12 + 1).padStart(2, '0');
  const day = String((index * 5) % 26 + 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function coordinate(base, offset) { return Number((base + offset).toFixed(6)); }
async function cityRecord(pool, name) {
  const [rows] = await pool.execute('SELECT id,name FROM mtr_city_master WHERE LOWER(name)=LOWER(?) AND active=1 LIMIT 1', [name]);
  if (!rows[0]) throw new Error(`Active city master record missing: ${name}`);
  return rows[0];
}
function copyPortrait(userId, profileSlug) {
  if (!assetRoot) return null;
  const source = path.join(assetRoot, 'portraits', `${profileSlug}.jpg`);
  if (!fs.existsSync(source)) return null;
  const relative = path.join('profile-photos', userId, `${profileSlug}.jpg`).replace(/\\/g, '/');
  const destination = path.join(mediaRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return relative;
}
async function createProfile(pool, city, cityId, baseLat, baseLon, gender, index) {
  const profileSlug = slug(city, gender, index);
  const email = `${profileSlug}@example.invalid`;
  const [existing] = await pool.execute('SELECT id FROM mtr_users WHERE email=? LIMIT 1', [email]);
  if (existing[0]) return { created: false, profileSlug };

  const userId = uuidv4();
  const firstName = gender === 'male' ? men[index] : women[index];
  const displayName = `${firstName} (Demo)`;
  const profileIndex = gender === 'male' ? index : index + 5;
  const dx = ((profileIndex % 5) - 2) * 0.012;
  const dy = ((profileIndex % 3) - 1) * 0.012;
  const bio = 'Demo profile • fictional adult account for Mitriva QA and store-preview testing. Not a real member.';
  const interests = interestSets[profileIndex % interestSets.length];
  const goal = goals[profileIndex % goals.length];

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO mtr_users(id,email,is_phone_verified,auth_provider,status,role,last_active_at)
       VALUES(?,?,0,'demo','active','demo',UTC_TIMESTAMP(6))`,
      [userId, email]
    );
    await connection.execute(
      `INSERT INTO mtr_user_profiles(user_id,display_name,birth_date,gender,city,city_id,profession,bio,interests_json,is_profile_complete,verified)
       VALUES(?,?,?,?,?,?,?,?,?,?,0)`,
      [userId, displayName, ageDate(profileIndex, gender), gender === 'male' ? 'Man' : 'Woman', city, cityId, professions[profileIndex % professions.length], bio, JSON.stringify(interests), 1]
    );
    await connection.execute(
      `INSERT INTO mtr_user_preferences(user_id,interested_in,relationship_goal,discovery_relationship_goal,minimum_age,maximum_age,distance_km)
       VALUES(?,'Everyone',?,'Any',21,45,100)`,
      [userId, goal]
    );
    await connection.execute(
      `INSERT INTO mtr_user_locations(user_id,latitude,longitude,city,city_id,accuracy_m)
       VALUES(?,?,?,?,?,50)`,
      [userId, coordinate(baseLat, dx), coordinate(baseLon, dy), city, cityId]
    );
    // Demo accounts cannot appear to real users. Enable only in a separate QA/staging environment.
    await connection.execute(
      `INSERT INTO mtr_user_settings(user_id,profile_visible) VALUES(?,0)`,
      [userId]
    );
    const relativePhoto = copyPortrait(userId, profileSlug);
    if (relativePhoto) {
      await connection.execute(
        `INSERT INTO mtr_user_photos(id,user_id,storage_path,mime_type,position,is_primary,status,moderation_status,moderation_note,moderated_at)
         VALUES(?,?,?,'image/jpeg',0,1,'active','approved','Synthetic QA portrait',UTC_TIMESTAMP(6))`,
        [uuidv4(), userId, relativePhoto]
      );
    }
    await connection.commit();
    return { created: true, profileSlug, hasPortrait: Boolean(relativePhoto) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

(async () => {
  const pool = getPool();
  let created = 0;
  let portraitCount = 0;
  for (const [city, lat, lon] of cities) {
    const master = await cityRecord(pool, city);
    for (let i = 0; i < 5; i += 1) {
      for (const gender of ['male', 'female']) {
        const result = await createProfile(pool, master.name, master.id, lat, lon, gender, i);
        if (result.created) {
          created += 1;
          if (result.hasPortrait) portraitCount += 1;
          console.log(`Created ${result.profileSlug}`);
        }
      }
    }
  }
  console.log(JSON.stringify({ success: true, created, portraitsAttached: portraitCount, totalRequested: 100, publicVisibility: 'hidden' }));
  await pool.end();
})().catch(async error => {
  console.error(error);
  process.exitCode = 1;
});

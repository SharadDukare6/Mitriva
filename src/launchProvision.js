'use strict';
// One-time/idempotent provisioning for explicitly labeled, non-discoverable Mitriva QA fixtures
// and a complimentary owner subscription. No public administrative endpoint is exposed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {getPool} = require('./db');

const positions = {
  Mumbai:[19.0760,72.8777],Delhi:[28.6139,77.2090],Bengaluru:[12.9716,77.5946],
  Hyderabad:[17.3850,78.4867],Chennai:[13.0827,80.2707],Kolkata:[22.5726,88.3639],
  Pune:[18.5204,73.8567],Ahmedabad:[23.0225,72.5714],Jaipur:[26.9124,75.7873],
  Surat:[21.1702,72.8311]
};

function fixtureUuid(seed) {
  const h=crypto.createHash('sha256').update('mitriva-qa-fixture-v1/'+seed).digest('hex').slice(0,32);
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}

async function provisionDemoFixtures() {
  const root=path.resolve(__dirname,'..');
  const list=JSON.parse(fs.readFileSync(path.join(root,'scripts','mitriva-demo-manifest.json'),'utf8'));
  if(list.length!==100) throw new Error('QA fixture manifest must contain exactly 100 entries');
  const cityCounts={};
  for(const p of list) {
    const key=p.city+'/'+p.gender;
    cityCounts[key]=(cityCounts[key]||0)+1;
    const filename=path.basename(String(p.photo||''));
    if(!/^(test-m|test-w)\d{2}\.jpg$/.test(filename) || !fs.existsSync(path.join(root,'public','mitriva-media','demo-fixtures',filename))) {
      throw new Error('Missing QA portrait for '+p.demoId);
    }
    if(p.isDemo!==true || p.allowsInteractions!==false || !String(p.displayName).includes('(Demo)')) {
      throw new Error('A QA fixture is missing mandatory demo labeling');
    }
  }
  for(const city of Object.keys(positions)){
    if(cityCounts[city+'/Man']!==5 || cityCounts[city+'/Woman']!==5) {
      throw new Error('Expected 5 demo men + 5 demo women for '+city);
    }
  }
  if(Object.keys(cityCounts).length!==20) throw new Error('Unexpected QA city or gender');

  const pool=getPool();
  // Existing generic demo profiles must never appear among actual members.
  await pool.execute("UPDATE mtr_user_settings s JOIN mtr_users u ON u.id=s.user_id SET s.profile_visible=0 WHERE u.role='demo'");
  const [cities]=await pool.query("SELECT id,name FROM mtr_city_master WHERE active=1");
  const cityMap=new Map(cities.map(c=>[c.name,c.id]));
  for(const city of Object.keys(positions)) if(!cityMap.has(city)) throw new Error('Missing active QA city '+city);

  let linked=0,created=0;
  for(const p of list) {
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction();
      const id=fixtureUuid(p.demoId);
      const email='mitriva.qa.'+p.demoId.toLowerCase().replace(/[^a-z0-9-]/g,'')+'@example.invalid';
      const [existing]=await conn.execute('SELECT id FROM mtr_users WHERE id=? LIMIT 1',[id]);
      await conn.execute("INSERT IGNORE INTO mtr_users(id,email,is_phone_verified,auth_provider,status,role,last_active_at) VALUES(?,?,0,'demo','active','demo',NULL)",[id,email]);
      const cityId=cityMap.get(p.city);
      await conn.execute(
        'INSERT INTO mtr_user_profiles(user_id,display_name,birth_date,gender,city,city_id,profession,bio,interests_json,is_profile_complete,verified) VALUES(?,?,?,?,?,?,?,?,?,1,0) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),birth_date=VALUES(birth_date),gender=VALUES(gender),city=VALUES(city),city_id=VALUES(city_id),profession=VALUES(profession),bio=VALUES(bio),interests_json=VALUES(interests_json),is_profile_complete=1,verified=0',
        [id,p.displayName,p.birthDate,p.gender,p.city,cityId,p.profession,p.bio,JSON.stringify(p.interests||[])]
      );
      await conn.execute("INSERT IGNORE INTO mtr_user_preferences(user_id,interested_in,relationship_goal,discovery_relationship_goal,minimum_age,maximum_age,distance_km) VALUES(?,'Everyone',?,'Any',18,80,100)",[id,p.relationshipGoal||'Any']);
      await conn.execute('INSERT INTO mtr_user_settings(user_id,profile_visible) VALUES(?,0) ON DUPLICATE KEY UPDATE profile_visible=0',[id]);
      const [lat,lon]=positions[p.city];
      await conn.execute('INSERT INTO mtr_user_locations(user_id,latitude,longitude,city,city_id,accuracy_m) VALUES(?,?,?,?,?,50) ON DUPLICATE KEY UPDATE latitude=VALUES(latitude),longitude=VALUES(longitude),city=VALUES(city),city_id=VALUES(city_id)',[id,lat+((Number(p.demoId.slice(-3))%5)-2)*0.005,lon+((Number(p.demoId.slice(-3))%3)-1)*0.005,p.city,cityId]);
      const filename=path.basename(p.photo);
      const storage='demo-fixtures/'+filename;
      const [photos]=await conn.execute('SELECT id FROM mtr_user_photos WHERE user_id=? AND storage_path=? LIMIT 1',[id,storage]);
      if(!photos.length) {
        await conn.execute("INSERT INTO mtr_user_photos(id,user_id,storage_path,mime_type,position,is_primary,status,moderation_status,moderation_note,moderated_at) VALUES(?,?,?,'image/jpeg',0,1,'active','approved','Synthetic QA image; not a real person',UTC_TIMESTAMP(6))",[crypto.randomUUID(),id,storage]);
      }
      await conn.commit();
      if(!existing.length) created++;
      linked++;
    } catch(err) {
      await conn.rollback();
      throw err;
    } finally { conn.release(); }
  }
  const [rows]=await pool.query("SELECT p.city,p.gender,COUNT(*) total FROM mtr_users u JOIN mtr_user_profiles p ON p.user_id=u.id JOIN mtr_user_settings s ON s.user_id=u.id WHERE u.role='demo' AND u.email LIKE 'mitriva.qa.%@example.invalid' AND s.profile_visible=0 GROUP BY p.city,p.gender");
  const counts=new Map(rows.map(r=>[r.city+'/'+r.gender,Number(r.total)]));
  if(Object.keys(positions).some(city=>counts.get(city+'/Man')!==5||counts.get(city+'/Woman')!==5)) throw new Error('QA fixture database count did not verify');
  console.log('[Mitriva QA] 100 hidden demo profiles verified; linked='+linked+' newlyCreated='+created+' portraits=100');
}

async function grantOwnerLifetime() {
  const phone=String(process.env.MITRIVA_OWNER_PHONE||'').replace(/\D/g,'');
  const email=String(process.env.MITRIVA_OWNER_EMAIL||'').trim().toLowerCase();
  if(!/^91[6-9]\d{9}$/.test(phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.warn('[Mitriva owner] grant pending: missing or invalid owner identifiers');
    return;
  }
  const pool=getPool();
  const [matches]=await pool.execute(
    "SELECT id,role,status,deleted_at,phone_e164,email,is_phone_verified,auth_provider FROM mtr_users WHERE phone_e164=? OR LOWER(email)=?",
    [phone,email]
  );
  if(!matches.length || matches.length>2){
    console.warn('[Mitriva owner] grant pending: unexpected matching account count='+matches.length);
    return;
  }
  // A separately created SMS account and verified Google account may legitimately be two records.
  // Grant both only when each individual login identifier has been verified by its provider.
  for(const user of matches){
    const phoneMatch=user.phone_e164===phone && Number(user.is_phone_verified)===1;
    const emailMatch=String(user.email||'').toLowerCase()===email && user.auth_provider==='google';
    if(user.role==='demo'||user.status!=='active'||user.deleted_at||(!phoneMatch&&!emailMatch)){
      console.warn('[Mitriva owner] grant pending: a matching account is not verified and active');
      return;
    }
    const [paid]=await pool.execute(
      "SELECT id FROM mtr_billing_subscriptions WHERE user_id=? AND status IN ('active','pending') AND auto_renew=1 LIMIT 1",
      [user.id]
    );
    if(paid.length){
      console.warn('[Mitriva owner] grant pending: an auto-renewing paid subscription needs review');
      return;
    }
  }
  for(const user of matches){
    await pool.execute(
      "INSERT INTO mtr_subscriptions(user_id,plan_code,status,provider,provider_subscription_id,starts_at,ends_at,auto_renew) VALUES(?,'lifetime','active','complimentary',NULL,UTC_TIMESTAMP(6),NULL,0) ON DUPLICATE KEY UPDATE plan_code='lifetime',status='active',provider='complimentary',provider_subscription_id=NULL,starts_at=COALESCE(starts_at,UTC_TIMESTAMP(6)),ends_at=NULL,auto_renew=0",
      [user.id]
    );
    const [check]=await pool.execute('SELECT plan_code,status,ends_at,auto_renew FROM mtr_subscriptions WHERE user_id=?',[user.id]);
    if(check.length!==1||check[0].plan_code!=='lifetime'||check[0].status!=='active'||check[0].ends_at!==null||Number(check[0].auto_renew)!==0){
      throw new Error('Lifetime premium verification failed');
    }
  }
  console.log('[Mitriva owner] lifetime premium verified for accounts='+matches.length+'; no expiry and no auto-renewal');
}

async function runLaunchProvisioning(){
  if(process.env.MITRIVA_QA_PROVISION==='true') await provisionDemoFixtures();
  if(process.env.MITRIVA_OWNER_LIFETIME_GRANT==='true') await grantOwnerLifetime();
}
module.exports={runLaunchProvisioning};

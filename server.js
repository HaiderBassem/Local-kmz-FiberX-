const express  = require('express');
const multer   = require('multer');
const fs       = require('fs');
const path     = require('path');
const AdmZip   = require('adm-zip');
const { DOMParser } = require('xmldom');
const toGeoJSON = require('@mapbox/togeojson');

const app  = express();
const PORT = 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(__dirname, 'users.json');

[UPLOAD_DIR, DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ===== المستخدمون =====
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    const def = [{ username:'admin', password:'admin123', role:'admin', createdAt: new Date().toISOString() }];
    fs.writeFileSync(USERS_FILE, JSON.stringify(def, null, 2));
    return def;
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }
function authAdmin(username, password) {
  const users = loadUsers();
  return users.find(u => u.username === username && u.password === password && u.role === 'admin');
}

app.use(express.static('public'));
app.use(express.json());

// ===== تسجيل الدخول =====
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const user  = users.find(u => u.username === username && u.password === password);
  if (user) res.json({ success: true, role: user.role });
  else res.status(401).json({ success: false, error: 'يوزر أو باسورد غلط' });
});

// ===== إدارة الأكاونتات =====
app.post('/api/users/list', (req, res) => {
  if (!authAdmin(req.body.username, req.body.password)) return res.status(403).json({ error: 'غير مصرح' });
  const users = loadUsers();
  res.json(users.map(u => ({ username: u.username, role: u.role, createdAt: u.createdAt })));
});

app.post('/api/users/add', (req, res) => {
  if (!authAdmin(req.body.username, req.body.password)) return res.status(403).json({ error: 'غير مصرح' });
  const { newUser, newPass, newRole } = req.body;
  if (!newUser || !newPass) return res.status(400).json({ error: 'أدخل اليوزر والباسورد' });
  const users = loadUsers();
  if (users.find(u => u.username === newUser)) return res.status(400).json({ error: 'اليوزر موجود مسبقاً' });
  users.push({ username: newUser, password: newPass, role: newRole || 'user', createdAt: new Date().toISOString() });
  saveUsers(users);
  res.json({ success: true });
});

app.post('/api/users/delete', (req, res) => {
  if (!authAdmin(req.body.username, req.body.password)) return res.status(403).json({ error: 'غير مصرح' });
  const { targetUser } = req.body;
  if (targetUser === req.body.username) return res.status(400).json({ error: 'ما تقدر تحذف نفسك' });
  const users = loadUsers();
  const filtered = users.filter(u => u.username !== targetUser);
  if (filtered.length === users.length) return res.status(404).json({ error: 'المستخدم غير موجود' });
  saveUsers(filtered);
  res.json({ success: true });
});

app.post('/api/users/changepass', (req, res) => {
  if (!authAdmin(req.body.username, req.body.password)) return res.status(403).json({ error: 'غير مصرح' });
  const { targetUser, newPass } = req.body;
  const users = loadUsers();
  const target = users.find(u => u.username === targetUser);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  target.password = newPass;
  saveUsers(users);
  res.json({ success: true });
});

// ===== ملفات KMZ =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

function cleanKml(kml) {
  return kml.replace(/xmlns:xsi="[^"]*"/g,'').replace(/xsi:schemaLocation="[^"]*"/g,'').replace(/schemaLocation="[^"]*"/g,'');
}
function getKmlFromKmz(fp) {
  const zip = new AdmZip(fp);
  const e   = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.kml'));
  if (!e) throw new Error('No KML in KMZ');
  return e.getData().toString('utf8');
}
function parseKml(kmlContent) {
  const dom = new DOMParser().parseFromString(cleanKml(kmlContent), 'text/xml');
  const geo = toGeoJSON.kml(dom);
  if (!geo || !geo.features) throw new Error('Conversion failed');
  try {
    const pms = dom.getElementsByTagNameNS('*','Placemark');
    geo.features.forEach((f,i) => {
      let node = pms[i] && pms[i].parentNode;
      while (node) {
        if (node.localName==='Folder' || node.nodeName==='Folder') {
          const n = (node.getElementsByTagNameNS ? node.getElementsByTagNameNS('*','name') : node.getElementsByTagName('name'))[0];
          if (n) { f.properties=f.properties||{}; f.properties._folder=n.textContent||''; }
          break;
        }
        node = node.parentNode;
      }
    });
  } catch(e) {}
  return geo;
}

app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(n => n.endsWith('.json'))
      .map(n => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR,n),'utf8')).meta; } catch(e){ return null; } })
      .filter(Boolean)
      .sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
    res.json(files);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/data/:file', (req, res) => {
  try {
    const fp = path.join(DATA_DIR, req.params.file);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
    res.json(JSON.parse(fs.readFileSync(fp,'utf8')).geojson);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload', upload.any(), (req, res) => {
  try {
    const f = (req.files||[])[0];
    if (!f) return res.status(400).json({ error: 'No file' });
    if (path.extname(f.originalname).toLowerCase() !== '.kmz') return res.status(400).json({ error: 'KMZ only' });
    const geo        = parseKml(getKmlFromKmz(f.path));
    const savedFile  = `${Date.now()}.json`;
    const meta       = { id: savedFile, originalName: f.originalname, savedFile, createdAt: new Date().toISOString(), featureCount: (geo.features||[]).length };
    fs.writeFileSync(path.join(DATA_DIR, savedFile), JSON.stringify({ meta, geojson: geo }, null, 2));
    res.json({ success: true, file: savedFile, meta });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== حذف ملف KMZ =====
app.delete('/api/data/:file', (req, res) => {
  try {
    const fp = path.join(DATA_DIR, req.params.file);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
    fs.unlinkSync(fp);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Google Places API proxy
const GOOGLE_API_KEY = 'AIzaSyAoNwpsCL397qH_VQljP6-3pqeARafyiWM';
const https = require('https');

app.get('/api/google-places', (req, res) => {
  const query  = req.query.q || '';
  const lat    = req.query.lat || '31.0';
  const lon    = req.query.lon || '47.0';
  const type   = req.query.type || '';
  
  if (!query && !type) return res.json({ results: [] });
  
  let url;
  if (query) {
    // Text Search - أدق للبحث بالاسم
    url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lon}&radius=50000&language=ar&key=${GOOGLE_API_KEY}`;
  } else {
    url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lon}&radius=10000&type=${type}&language=ar&key=${GOOGLE_API_KEY}`;
  }
  
  https.get(url, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try { res.json(JSON.parse(data)); }
      catch(e) { res.status(500).json({ error: 'Parse error' }); }
    });
  }).on('error', (e) => res.status(500).json({ error: e.message }));
});

app.get('/api/places', (req, res) => {
  const p = path.join(__dirname,'public','places.json');
  fs.existsSync(p) ? res.sendFile(p) : res.json([]);
});

app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`));

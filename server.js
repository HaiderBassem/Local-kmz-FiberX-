const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const AdmZip  = require('adm-zip');
const { DOMParser } = require('xmldom');
const toGeoJSON = require('@mapbox/togeojson');

const app  = express();
const PORT = 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(__dirname, 'users.json');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR,   { recursive: true });

// ====== إدارة المستخدمين ======
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    // المستخدم الافتراضي
    const defaults = [
      { username: 'admin', password: 'admin123', role: 'admin', createdAt: new Date().toISOString() }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaults, null, 2), 'utf8');
    return defaults;
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

app.use(express.static('public'));
app.use(express.json());

// ====== تسجيل الدخول ======
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const user  = users.find(u => u.username === username && u.password === password);
  if (user) {
    res.json({ success: true, role: user.role });
  } else {
    res.status(401).json({ success: false, error: 'يوزر أو باسورد غلط' });
  }
});

// ====== APIs الأكاونتات (admin فقط) ======

// جلب كل المستخدمين
app.post('/api/users/list', (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const me = users.find(u => u.username === username && u.password === password && u.role === 'admin');
  if (!me) return res.status(403).json({ error: 'غير مصرح' });
  // نرجع بدون الباسورد
  res.json(users.map(u => ({ username: u.username, role: u.role, createdAt: u.createdAt })));
});

// إضافة مستخدم
app.post('/api/users/add', (req, res) => {
  const { username, password, newUser, newPass, newRole } = req.body;
  const users = loadUsers();
  const me = users.find(u => u.username === username && u.password === password && u.role === 'admin');
  if (!me) return res.status(403).json({ error: 'غير مصرح' });
  if (!newUser || !newPass) return res.status(400).json({ error: 'أدخل اليوزر والباسورد' });
  if (users.find(u => u.username === newUser)) return res.status(400).json({ error: 'اليوزر موجود مسبقاً' });
  users.push({ username: newUser, password: newPass, role: newRole || 'user', createdAt: new Date().toISOString() });
  saveUsers(users);
  res.json({ success: true });
});

// حذف مستخدم
app.post('/api/users/delete', (req, res) => {
  const { username, password, targetUser } = req.body;
  const users = loadUsers();
  const me = users.find(u => u.username === username && u.password === password && u.role === 'admin');
  if (!me) return res.status(403).json({ error: 'غير مصرح' });
  if (targetUser === username) return res.status(400).json({ error: 'ما تقدر تحذف نفسك' });
  const filtered = users.filter(u => u.username !== targetUser);
  if (filtered.length === users.length) return res.status(404).json({ error: 'المستخدم غير موجود' });
  saveUsers(filtered);
  res.json({ success: true });
});

// تغيير باسورد
app.post('/api/users/changepass', (req, res) => {
  const { username, password, targetUser, newPass } = req.body;
  const users = loadUsers();
  const me = users.find(u => u.username === username && u.password === password && u.role === 'admin');
  if (!me) return res.status(403).json({ error: 'غير مصرح' });
  const target = users.find(u => u.username === targetUser);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  target.password = newPass;
  saveUsers(users);
  res.json({ success: true });
});

// ====== KMZ ======
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

function cleanKml(kml) {
  return kml
    .replace(/xmlns:xsi="[^"]*"/g, '')
    .replace(/xsi:schemaLocation="[^"]*"/g, '')
    .replace(/schemaLocation="[^"]*"/g, '');
}

function getKmlFromKmz(filePath) {
  const zip = new AdmZip(filePath);
  const kmlEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.kml'));
  if (!kmlEntry) throw new Error('No KML file found inside KMZ');
  return kmlEntry.getData().toString('utf8');
}

function parseKmlToGeoJson(kmlContent) {
  const dom     = new DOMParser().parseFromString(cleanKml(kmlContent), 'text/xml');
  const geojson = toGeoJSON.kml(dom);
  if (!geojson || !geojson.features) throw new Error('GeoJSON conversion failed');
  try {
    const pms = dom.getElementsByTagNameNS('*', 'Placemark');
    geojson.features.forEach((f, i) => {
      let node = pms[i] && pms[i].parentNode;
      while (node) {
        if (node.localName === 'Folder' || node.nodeName === 'Folder') {
          const n = (node.getElementsByTagNameNS ? node.getElementsByTagNameNS('*','name') : node.getElementsByTagName('name'))[0];
          if (n) { f.properties = f.properties||{}; f.properties._folder = n.textContent||n.text||''; }
          break;
        }
        node = node.parentNode;
      }
    });
  } catch(e) {}
  return geojson;
}

app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(n => n.endsWith('.json'))
      .map(n => JSON.parse(fs.readFileSync(path.join(DATA_DIR,n),'utf8')).meta)
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
    if (path.extname(f.originalname).toLowerCase() !== '.kmz')
      return res.status(400).json({ error: 'KMZ only' });
    const geojson    = parseKmlToGeoJson(getKmlFromKmz(f.path));
    const savedFile  = `${Date.now()}.json`;
    const meta       = { id:savedFile, originalName:f.originalname, savedFile, createdAt:new Date().toISOString(), featureCount:(geojson.features||[]).length };
    fs.writeFileSync(path.join(DATA_DIR,savedFile), JSON.stringify({meta,geojson},null,2),'utf8');
    res.json({ success:true, file:savedFile, meta });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/places', (req, res) => {
  const p = path.join(__dirname,'public','places.json');
  fs.existsSync(p) ? res.sendFile(p) : res.json([]);
});

app.listen(PORT, () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
});

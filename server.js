const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { DOMParser } = require('xmldom');
const toGeoJSON = require('@mapbox/togeojson');

const app = express();
const PORT = 9999;
const HOST = '0.0.0.0';

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.static('public'));
app.use(express.json());

// ======= المستخدمين =======
const USERS = [
  { username: 'admin',  password: 'admin123', role: 'admin'  },
  { username: 'viewer', password: 'view123',  role: 'viewer' }
];

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username && u.password === password);
  if (user) res.json({ success: true, role: user.role });
  else res.status(401).json({ success: false, error: 'يوزر أو باسورد غلط' });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

function cleanKml(kmlContent) {
  if (!kmlContent) return '';
  let kml = kmlContent;
  kml = kml.replace(/xmlns:xsi="[^"]*"/g, '');
  kml = kml.replace(/xsi:schemaLocation="[^"]*"/g, '');
  kml = kml.replace(/schemaLocation="[^"]*"/g, '');
  return kml;
}

function getKmlFromKmz(filePath) {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const kmlEntry = entries.find(e => e.entryName.toLowerCase().endsWith('.kml'));
  if (!kmlEntry) throw new Error('No KML file found inside KMZ');
  return kmlEntry.getData().toString('utf8');
}

function parseKmlToGeoJson(kmlContent) {
  const cleaned = cleanKml(kmlContent);
  const dom = new DOMParser().parseFromString(cleaned, 'text/xml');
  const geojson = toGeoJSON.kml(dom);
  if (!geojson || !geojson.features) throw new Error('GeoJSON conversion failed');
  return geojson;
}

function buildMeta(originalName, geojson, savedFile) {
  return {
    id: savedFile, originalName, savedFile,
    createdAt: new Date().toISOString(),
    featureCount: Array.isArray(geojson.features) ? geojson.features.length : 0,
    type: 'kmz'
  };
}

app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(name => name.endsWith('.json'))
      .map(name => { const raw = fs.readFileSync(path.join(DATA_DIR, name), 'utf8'); return JSON.parse(raw).meta; })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(files);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/data/:file', (req, res) => {
  try {
    const filePath = path.join(DATA_DIR, req.params.file);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')).geojson);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== حذف ملف =====
app.delete('/api/files/:file', (req, res) => {
  try {
    // أمان: تأكد الاسم JSON فقط وما فيه مسارات خطرة
    const fileName = path.basename(req.params.file);
    if (!fileName.endsWith('.json')) return res.status(400).json({ error: 'Invalid file' });

    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/upload', upload.any(), (req, res) => {
  try {
    const uploadedFiles = req.files || [];
    if (!uploadedFiles.length) return res.status(400).json({ error: 'No file uploaded' });
    const uploadedFile = uploadedFiles[0];
    const ext = path.extname(uploadedFile.originalname).toLowerCase();
    if (ext !== '.kmz') return res.status(400).json({ error: 'Only KMZ files are allowed' });
    const kmlContent = getKmlFromKmz(uploadedFile.path);
    const geojson = parseKmlToGeoJson(kmlContent);
    const savedFile = `${Date.now()}.json`;
    const output = { meta: buildMeta(uploadedFile.originalname, geojson, savedFile), geojson };
    fs.writeFileSync(path.join(DATA_DIR, savedFile), JSON.stringify(output, null, 2), 'utf8');
    res.json({ success: true, message: 'تم رفع الملف بنجاح', file: savedFile, meta: output.meta });
  } catch (err) { res.status(500).json({ error: err.message || 'Error processing file' }); }
});

app.listen(PORT, HOST, () => console.log(`Local KMZ map server is running on http://${HOST}:${PORT}`));

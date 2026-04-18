# Local KMZ Map

نظام داخلي بسيط لرفع ملفات KMZ وتحويلها تلقائياً إلى GeoJSON وعرضها على خريطة محلية عبر المتصفح.

## المتطلبات
- Ubuntu 22.04 أو 24.04
- Node.js 20+
- npm

## التثبيت السريع
```bash
sudo apt update
sudo apt install -y nodejs npm
cd /opt
sudo mkdir -p local-kmz-map
sudo chown $USER:$USER local-kmz-map
cd local-kmz-map
# انسخ ملفات المشروع هنا
npm install
node server.js
```

بعد التشغيل افتح:

```bash
http://IP-VM:3000
```

## تشغيل كخدمة systemd
أنشئ الملف التالي:

```ini
[Unit]
Description=Local KMZ Map Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/local-kmz-map
ExecStart=/usr/bin/node /opt/local-kmz-map/server.js
Restart=always
User=root
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

ثم:

```bash
sudo systemctl daemon-reload
sudo systemctl enable local-kmz-map
sudo systemctl start local-kmz-map
sudo systemctl status local-kmz-map
```

## ملاحظات
- النظام يقبل KMZ فقط.
- بعض ملفات KMZ التي تحتوي Network Links أو GroundOverlay قد لا تعمل بالكامل.
- هذه النسخة تستخدم OpenStreetMap كخلفية، وإذا تريدها أوفلاين نضيف Tile Server محلي بالمرحلة الثانية.
# Local-kmz-FiberX-

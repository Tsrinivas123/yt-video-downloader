const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const util = require('util');

const execPromise = util.promisify(exec);
const app = express();
const PORT = process.env.PORT || 5000;

// Cookies file path
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://vidvault-frontend.onrender.com'
  ],
  credentials: true
}));

app.use(express.json());
app.use('/downloads', express.static('downloads'));

// Create downloads folder
if (!fs.existsSync('./downloads')) {
  fs.mkdirSync('./downloads');
}

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'Backend Running ✅',
    endpoints: {
      videoInfo: '/api/video-info',
      getLink: '/api/get-link',
      download: '/api/download'
    }
  });
});


// ================= VIDEO INFO =================
app.post('/api/video-info', async (req, res) => {
  try {

    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    console.log('Fetching info:', url);

    const command = `
      python3 -m yt_dlp 
      --cookies "${COOKIES_PATH}" 
      --dump-json 
      --no-playlist 
      "${url}"
    `;

    const { stdout } = await execPromise(command);

    const data = JSON.parse(stdout);

    const formats = data.formats
      .filter(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.height)
      .map(f => ({
        quality: `${f.height}p`,
        ext: f.ext,
        fps: f.fps || 30,
        size: f.filesize || 'Unknown'
      }))
      .sort((a, b) => parseInt(b.quality) - parseInt(a.quality));

    res.json({
      title: data.title,
      thumbnail: data.thumbnail,
      duration: data.duration,
      uploader: data.uploader,
      views: data.view_count,
      formats,
      url
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: 'Failed to fetch info',
      details: err.message
    });
  }
});


// ================= GET LINK =================
app.post('/api/get-link', async (req, res) => {
  try {

    const { url, quality } = req.body;

    let format = 'bestvideo+bestaudio/best';

    if (quality) {
      const q = quality.replace('p', '');
      format = `bestvideo[height<=${q}]+bestaudio/best`;
    }

    const command = `
      python3 -m yt_dlp 
      --cookies "${COOKIES_PATH}"
      -f "${format}"
      --get-url
      "${url}"
    `;

    const { stdout } = await execPromise(command);

    const link = stdout.trim().split('\n')[0];

    res.json({
      success: true,
      directUrl: link
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: 'Failed to get link',
      details: err.message
    });
  }
});


// ================= DOWNLOAD =================
app.post('/api/download', async (req, res) => {
  try {

    const { url, quality } = req.body;

    const time = Date.now();

    const output = `./downloads/video_${time}.%(ext)s`;

    let format = 'bestvideo+bestaudio/best';

    if (quality) {
      const q = quality.replace('p', '');
      format = `bestvideo[height<=${q}]+bestaudio/best`;
    }

    const command = `
      python3 -m yt_dlp
      --cookies "${COOKIES_PATH}"
      -f "${format}"
      --merge-output-format mp4
      -o "${output}"
      "${url}"
    `;

    await execPromise(command);

    const files = fs.readdirSync('./downloads');

    const file = files.find(f => f.includes(`video_${time}`));

    if (!file) throw new Error('File missing');

    const link = `${req.protocol}://${req.get('host')}/downloads/${file}`;

    res.json({
      success: true,
      filename: file,
      downloadUrl: link
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: 'Download failed',
      details: err.message
    });
  }
});


// ================= CLEANUP =================
setInterval(() => {

  if (!fs.existsSync('./downloads')) return;

  const files = fs.readdirSync('./downloads');

  const now = Date.now();

  files.forEach(f => {

    const p = path.join('./downloads', f);

    const s = fs.statSync(p);

    if (now - s.mtimeMs > 3600000) {
      fs.unlinkSync(p);
    }

  });

}, 3600000);


// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});

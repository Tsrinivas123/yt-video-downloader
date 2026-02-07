const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const util = require('util');

const execPromise = util.promisify(exec);
const app = express();
const PORT = process.env.PORT || 5000;

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

// Create downloads directory
if (!fs.existsSync('./downloads')) {
  fs.mkdirSync('./downloads');
}

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'YouTube Downloader Backend is running!',
    endpoints: {
      videoInfo: 'POST /api/video-info',
      download: 'POST /api/download',
      getLink: 'POST /api/get-link'
    }
  });
});


// ================= VIDEO INFO =================
app.post('/api/video-info', async (req, res) => {
  try {

    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log('Fetching video info:', url);

    const { stdout } = await execPromise(
      `python3 -m yt_dlp --dump-json --no-playlist "${url}"`
    );

    const videoData = JSON.parse(stdout);

    const formats = videoData.formats
      .filter(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.height)
      .map(f => ({
        format_id: f.format_id,
        quality: `${f.height}p`,
        ext: f.ext,
        filesize: f.filesize || 'Unknown',
        fps: f.fps || 30
      }));

    const uniqueFormats = Array.from(
      new Map(formats.map(item => [item.quality, item])).values()
    ).sort((a, b) => parseInt(b.quality) - parseInt(a.quality));

    res.json({
      title: videoData.title,
      thumbnail: videoData.thumbnail,
      duration: videoData.duration,
      uploader: videoData.uploader,
      view_count: videoData.view_count,
      formats: uniqueFormats,
      url
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'Failed to fetch video info',
      details: error.message
    });
  }
});


// ================= GET LINK =================
app.post('/api/get-link', async (req, res) => {
  try {

    const { url, quality } = req.body;

    let command;

    if (quality) {
      const q = quality.replace('p', '');

      command = `python3 -m yt_dlp -f "bestvideo[height<=${q}]+bestaudio/best" --get-url "${url}"`;
    }
    else {
      command = `python3 -m yt_dlp -f "bestvideo+bestaudio/best" --get-url "${url}"`;
    }

    const { stdout } = await execPromise(command);

    const directUrl = stdout.trim().split('\n')[0];

    res.json({
      success: true,
      directUrl
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'Failed to get link',
      details: error.message
    });
  }
});


// ================= DOWNLOAD =================
app.post('/api/download', async (req, res) => {
  try {

    const { url, quality } = req.body;

    const time = Date.now();

    const output = `./downloads/video_${time}.%(ext)s`;

    let command;

    if (quality) {
      const q = quality.replace('p', '');

      command = `python3 -m yt_dlp -f "bestvideo[height<=${q}]+bestaudio/best" --merge-output-format mp4 -o "${output}" "${url}"`;
    }
    else {
      command = `python3 -m yt_dlp -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "${output}" "${url}"`;
    }

    await execPromise(command);

    const files = fs.readdirSync('./downloads');

    const file = files.find(f => f.includes(`video_${time}`));

    if (!file) throw new Error('File not found');

    const downloadUrl = `${req.protocol}://${req.get('host')}/downloads/${file}`;

    res.json({
      success: true,
      filename: file,
      downloadUrl
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: 'Download failed',
      details: error.message
    });
  }
});


// Cleanup
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


app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

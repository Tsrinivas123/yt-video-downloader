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

// Create downloads directory if it doesn't exist
if (!fs.existsSync('./downloads')) {
  fs.mkdirSync('./downloads');
}

// Health check endpoint
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

// Get video info and available formats
app.post('/api/video-info', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate YouTube URL
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    if (!youtubeRegex.test(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    console.log('Fetching video info for:', url);

    // Get video information using yt-dlp
    const { stdout } = await execPromise(
      `yt-dlp --dump-json --no-playlist "${url}"`
    );

    const videoData = JSON.parse(stdout);

    // Extract available formats with video (not audio-only)
    const formats = videoData.formats
      .filter(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.height)
      .map(f => ({
        format_id: f.format_id,
        quality: `${f.height}p`,
        ext: f.ext,
        filesize: f.filesize || 'Unknown',
        fps: f.fps || 30
      }));

    // Remove duplicates and sort by quality
    const uniqueFormats = Array.from(
      new Map(formats.map(item => [item.quality, item])).values()
    ).sort((a, b) => parseInt(b.quality) - parseInt(a.quality));

    const videoInfo = {
      title: videoData.title,
      thumbnail: videoData.thumbnail,
      duration: videoData.duration,
      uploader: videoData.uploader,
      view_count: videoData.view_count,
      formats: uniqueFormats,
      url: url
    };

    res.json(videoInfo);
  } catch (error) {
    console.error('Error fetching video info:', error);
    res.status(500).json({ 
      error: 'Failed to fetch video information',
      details: error.message 
    });
  }
});

// Get direct download link (faster method)
app.post('/api/get-link', async (req, res) => {
  try {
    const { url, quality } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log(`Getting direct link for: ${url} at quality: ${quality || 'best'}`);

    // Get direct download URL using yt-dlp
    let command;
    if (quality) {
      const qualityNum = quality.replace('p', '');
      command = `yt-dlp -f "bestvideo[height<=${qualityNum}]+bestaudio/best[height<=${qualityNum}]" --get-url "${url}"`;
    } else {
      command = `yt-dlp -f "bestvideo+bestaudio/best" --get-url "${url}"`;
    }

    const { stdout } = await execPromise(command);
    const directUrl = stdout.trim().split('\n')[0];

    res.json({
      success: true,
      directUrl: directUrl
    });

  } catch (error) {
    console.error('Error getting direct link:', error);
    res.status(500).json({ 
      error: 'Failed to get download link',
      details: error.message 
    });
  }
});

// Download video (server-side)
app.post('/api/download', async (req, res) => {
  try {
    const { url, quality } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log(`Downloading video: ${url} at quality: ${quality || 'best'}`);

    const timestamp = Date.now();
    const outputTemplate = path.join('./downloads', `video_${timestamp}.%(ext)s`);

    let command;
    if (quality) {
      const qualityNum = quality.replace('p', '');
      command = `yt-dlp -f "bestvideo[height<=${qualityNum}]+bestaudio/best[height<=${qualityNum}]" --merge-output-format mp4 -o "${outputTemplate}" "${url}"`;
    } else {
      command = `yt-dlp -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "${outputTemplate}" "${url}"`;
    }

    await execPromise(command);

    const files = fs.readdirSync('./downloads');
    const downloadedFile = files.find(f => f.startsWith(`video_${timestamp}`));

    if (!downloadedFile) {
      throw new Error('Download completed but file not found');
    }

    const downloadUrl = `${req.protocol}://${req.get('host')}/downloads/${downloadedFile}`;

    res.json({
      success: true,
      message: 'Video downloaded successfully',
      downloadUrl: downloadUrl,
      filename: downloadedFile
    });

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ 
      error: 'Failed to download video',
      details: error.message 
    });
  }
});

// Clean up old downloads (run every hour)
setInterval(() => {
  const downloadsDir = './downloads';
  if (!fs.existsSync(downloadsDir)) return;
  
  const files = fs.readdirSync(downloadsDir);
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  files.forEach(file => {
    const filePath = path.join(downloadsDir, file);
    const stats = fs.statSync(filePath);
    
    if (now - stats.mtimeMs > oneHour) {
      fs.unlinkSync(filePath);
      console.log(`Deleted old file: ${file}`);
    }
  });
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🚀 Backend Server Running!          ║
║   📍 Port: ${PORT}                      ║
║   🌐 URL: http://localhost:${PORT}     ║
╚════════════════════════════════════════╝
  `);
});

/**
 * QuickClip v1.0.0
 * Developed by Kaan Kayali (@KaanKayali)
 *
 * @license MIT
 * @repository https://github.com/KaanKayali/QuickClip
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes');
const { getOrInitYtDlp, getFfmpegPath } = require('./ytdlp');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount API routes
app.use('/api', apiRoutes);

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start Server
app.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(`🚀 YouTube Downloader Web App running!`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`🎵 Author: @KaanKayali | Version: v1.0.0`);
  console.log(`===============================================`);

  try {
    const ffmpeg = getFfmpegPath();
    console.log(`[Dependencies] FFmpeg binary resolved at: ${ffmpeg}`);
    console.log(`[Dependencies] Checking yt-dlp binary...`);
    await getOrInitYtDlp();
    console.log(`[Dependencies] All media tools initialized and ready!`);
  } catch (err) {
    console.error(`[Dependencies Warning] Binary initialization issue:`, err.message);
  }
});

/**
 * QuickClip v1.0.0
 * Developed by Kaan Kayali (@KaanKayali)
 *
 * @license MIT
 * @repository https://github.com/KaanKayali/QuickClip
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  getOrInitYtDlp,
  getFfmpegPath,
  getFfmpegDir,
  getVideoInfo,
  executeDownloadWithProgress,
  sanitizeFileName,
  DOWNLOADS_DIR
} = require('./ytdlp');

const router = express.Router();

// File Registry for SSE downloaded files
const fileRegistry = new Map();

// Rate Limiting Store
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 20;

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  const record = rateLimitStore.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_LIMIT_WINDOW;
  } else {
    record.count++;
  }

  rateLimitStore.set(ip, record);

  if (record.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests. Please wait a minute before trying again.'
    });
  }
  next();
}

router.use(rateLimiter);

// Helper to validate YouTube URL strictly
function isValidYoutubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  // Prevent any shell injections or unusual protocols
  if (trimmed.startsWith('-') || trimmed.includes('\n') || trimmed.includes('\r')) return false;
  const ytRegex = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}/;
  return ytRegex.test(trimmed);
}

/**
 * POST /api/info
 * Fetch metadata for given video URL
 */
router.post('/info', async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidYoutubeUrl(url)) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid YouTube video URL.'
    });
  }

  try {
    const info = await getVideoInfo(url.trim());
    return res.json({
      success: true,
      data: info
    });
  } catch (err) {
    console.error('[API /info Error]:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch video information.'
    });
  }
});

/**
 * GET /api/download-progress (SSE Stream)
 * Real-time percentage progress streaming (0-100%)
 */
router.get('/download-progress', async (req, res) => {
  const { url, format, quality } = req.query;

  if (!url || !isValidYoutubeUrl(url)) {
    return res.status(400).send('Invalid or missing YouTube URL.');
  }

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const selectedFormat = (format || 'mp4').toLowerCase();
  const fileExtension = selectedFormat === 'mp3' ? 'mp3' : 'mp4';

  let videoTitle = 'download';
  try {
    const metadata = await getVideoInfo(url.trim());
    if (metadata.title) {
      videoTitle = sanitizeFileName(metadata.title);
    }
  } catch (e) {}

  const outputFileName = `${videoTitle}.${fileExtension}`;

  try {
    sendEvent({ percent: 0, status: 'downloading' });

    const actualFile = await executeDownloadWithProgress(
      { url, format: selectedFormat, quality, fileId },
      (percent) => {
        sendEvent({ percent, status: 'downloading' });
      }
    );

    fileRegistry.set(fileId, {
      filePath: actualFile,
      fileName: outputFileName,
      format: selectedFormat
    });

    sendEvent({
      percent: 100,
      ready: true,
      fileId,
      fileName: outputFileName
    });

    res.end();
  } catch (err) {
    console.error('[SSE Download Error]:', err);
    sendEvent({ error: err.message || 'Download failed.' });
    res.end();
  }
});

/**
 * GET /api/file/:fileId
 * Streams the generated file to the client for download
 */
router.get('/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  const regEntry = fileRegistry.get(fileId);

  let filePath = regEntry ? regEntry.filePath : null;
  let fileName = regEntry ? regEntry.fileName : 'download';
  let selectedFormat = regEntry ? regEntry.format : 'mp4';

  if (!filePath || !fs.existsSync(filePath)) {
    // Fallback search in DOWNLOADS_DIR
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const matched = files.find(f => f.startsWith(fileId));
    if (matched) {
      filePath = path.join(DOWNLOADS_DIR, matched);
      fileName = matched;
      selectedFormat = matched.endsWith('.mp3') ? 'mp3' : 'mp4';
    } else {
      return res.status(404).send('File not found or link expired.');
    }
  }

  const stat = fs.statSync(filePath);
  const contentType = selectedFormat === 'mp3' ? 'audio/mpeg' : 'video/mp4';

  const encodedFilename = encodeURIComponent(fileName).replace(/['()]/g, escape);
  const fallbackFilename = fileName.replace(/[^\x20-\x7E]/g, '_');

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
    'Cache-Control': 'no-cache'
  });

  const readStream = fs.createReadStream(filePath);
  readStream.pipe(res);

  const cleanup = () => {
    try {
      fileRegistry.delete(fileId);
      const files = fs.readdirSync(DOWNLOADS_DIR);
      for (const f of files) {
        if (f.startsWith(fileId)) {
          const p = path.join(DOWNLOADS_DIR, f);
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            console.log(`[Cleanup] Deleted file: ${p}`);
          }
        }
      }
    } catch (cleanErr) {
      console.warn(`[Cleanup Warning]:`, cleanErr.message);
    }
  };

  res.on('finish', cleanup);
  res.on('close', cleanup);
  readStream.on('error', (err) => {
    console.error('[File Stream Error]:', err);
    cleanup();
  });
});

/**
 * GET /api/download (Direct fallback)
 */
router.get('/download', async (req, res) => {
  const { url, format, quality } = req.query;

  if (!url || !isValidYoutubeUrl(url)) {
    return res.status(400).send('Invalid or missing YouTube URL.');
  }

  const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const selectedFormat = (format || 'mp4').toLowerCase();
  const fileExtension = selectedFormat === 'mp3' ? 'mp3' : 'mp4';

  let videoTitle = 'download';
  try {
    const metadata = await getVideoInfo(url.trim());
    if (metadata.title) {
      videoTitle = sanitizeFileName(metadata.title);
    }
  } catch (e) {}

  const outputFileName = `${videoTitle}.${fileExtension}`;

  try {
    const actualFile = await executeDownloadWithProgress(
      { url, format: selectedFormat, quality, fileId },
      () => {}
    );

    const stat = fs.statSync(actualFile);
    const contentType = selectedFormat === 'mp3' ? 'audio/mpeg' : 'video/mp4';

    const encodedFilename = encodeURIComponent(outputFileName).replace(/['()]/g, escape);
    const fallbackFilename = outputFileName.replace(/[^\x20-\x7E]/g, '_');

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
      'Cache-Control': 'no-cache'
    });

    const readStream = fs.createReadStream(actualFile);
    readStream.pipe(res);

    const cleanup = () => {
      try {
        const files = fs.readdirSync(DOWNLOADS_DIR);
        for (const f of files) {
          if (f.startsWith(fileId)) {
            const p = path.join(DOWNLOADS_DIR, f);
            if (fs.existsSync(p)) fs.unlinkSync(p);
          }
        }
      } catch (_) {}
    };

    res.on('finish', cleanup);
    res.on('close', cleanup);
  } catch (err) {
    console.error('[Download Direct Error]:', err);
    if (!res.headersSent) {
      res.status(500).send(`Download failed: ${err.message || 'Unknown error'}`);
    }
  }
});

module.exports = router;

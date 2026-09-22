const path = require('path');
const fs = require('fs');
const YTDlpWrap = require('yt-dlp-wrap').default || require('yt-dlp-wrap');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

// Ensure bin and downloads directories exist
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BIN_DIR = path.join(PROJECT_ROOT, 'bin');
const DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'downloads');

if (!fs.existsSync(BIN_DIR)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const IS_WIN = process.platform === 'win32';
const BIN_NAME = IS_WIN ? 'yt-dlp.exe' : 'yt-dlp';
const FFMPEG_NAME = IS_WIN ? 'ffmpeg.exe' : 'ffmpeg';
const FFPROBE_NAME = IS_WIN ? 'ffprobe.exe' : 'ffprobe';

const LOCAL_YT_DLP_PATH = path.join(BIN_DIR, BIN_NAME);
const LOCAL_FFMPEG_PATH = path.join(BIN_DIR, FFMPEG_NAME);
const LOCAL_FFPROBE_PATH = path.join(BIN_DIR, FFPROBE_NAME);

let ytDlpInstance = null;

/**
 * Copies ffmpeg and ffprobe into bin directory if not already present
 */
function ensureFfmpegTools() {
  try {
    const ffmpegPath = ffmpegInstaller && ffmpegInstaller.path;
    if (!fs.existsSync(LOCAL_FFMPEG_PATH) && ffmpegPath && fs.existsSync(ffmpegPath)) {
      console.log('[Dependencies] Copying ffmpeg to bin folder...');
      fs.copyFileSync(ffmpegPath, LOCAL_FFMPEG_PATH);
    }
    const ffprobePath = ffprobeInstaller && ffprobeInstaller.path;
    if (!fs.existsSync(LOCAL_FFPROBE_PATH) && ffprobePath && fs.existsSync(ffprobePath)) {
      console.log('[Dependencies] Copying ffprobe to bin folder...');
      fs.copyFileSync(ffprobePath, LOCAL_FFPROBE_PATH);
    }
  } catch (err) {
    console.warn('[Dependencies Warning] Error copying ffmpeg/ffprobe to bin:', err.message);
  }
}

/**
 * Ensures yt-dlp binary is available. Downloads if not present locally or in PATH.
 */
async function getOrInitYtDlp() {
  ensureFfmpegTools();

  if (ytDlpInstance) {
    return ytDlpInstance;
  }

  // 1. Check local bin
  if (fs.existsSync(LOCAL_YT_DLP_PATH)) {
    console.log(`[yt-dlp] Using local binary at ${LOCAL_YT_DLP_PATH}`);
    ytDlpInstance = new YTDlpWrap(LOCAL_YT_DLP_PATH);
    return ytDlpInstance;
  }

  // 2. Try default system binary
  try {
    const defaultWrap = new YTDlpWrap();
    await defaultWrap.getVersion();
    console.log('[yt-dlp] Using system PATH binary');
    ytDlpInstance = defaultWrap;
    return ytDlpInstance;
  } catch (err) {
    console.log('[yt-dlp] Binary not found in PATH. Downloading to local bin directory...');
  }

  // 3. Download from GitHub
  try {
    console.log(`[yt-dlp] Downloading latest release into ${LOCAL_YT_DLP_PATH}...`);
    await YTDlpWrap.downloadFromGithub(LOCAL_YT_DLP_PATH);
    if (!IS_WIN) {
      fs.chmodSync(LOCAL_YT_DLP_PATH, '755');
    }
    console.log('[yt-dlp] Download complete.');
    ytDlpInstance = new YTDlpWrap(LOCAL_YT_DLP_PATH);
    return ytDlpInstance;
  } catch (downloadErr) {
    console.error('[yt-dlp] Failed to auto-download binary:', downloadErr);
    throw new Error(`Failed to obtain yt-dlp binary: ${downloadErr.message}`);
  }
}

/**
 * Returns the resolved ffmpeg directory containing ffmpeg and ffprobe
 */
function getFfmpegDir() {
  ensureFfmpegTools();
  return BIN_DIR;
}

function getFfmpegPath() {
  ensureFfmpegTools();
  return fs.existsSync(LOCAL_FFMPEG_PATH) ? LOCAL_FFMPEG_PATH : ffmpegStatic;
}

/**
 * Helper to sanitize filename
 */
function sanitizeFileName(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim();
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const MAX_DURATION_SECONDS = 10800; // 3 hours limit

/**
 * Fetches video metadata
 */
async function getVideoInfo(url) {
  const ytdlp = await getOrInitYtDlp();

  const stdout = await ytdlp.execPromise([
    url,
    '--dump-single-json',
    '--no-playlist',
    '--no-check-certificates',
    '--force-ipv4',
    '--socket-timeout', '30',
    '--geo-bypass'
  ]);

  const rawInfo = JSON.parse(stdout);

  if (rawInfo.duration && rawInfo.duration > MAX_DURATION_SECONDS) {
    throw new Error(`Security notice: Video duration (${formatDuration(rawInfo.duration)}) exceeds the maximum 3-hour limit.`);
  }

  // Extract available heights for MP4
  const availableHeights = new Set();
  if (Array.isArray(rawInfo.formats)) {
    for (const f of rawInfo.formats) {
      if (f.height && typeof f.height === 'number') {
        availableHeights.add(f.height);
      }
    }
  }

  const standardHeights = [1080, 720, 480, 360];
  const detectedHeights = standardHeights.filter(h => availableHeights.has(h));
  // If none of standard match, sort available descending
  const mp4Qualities = detectedHeights.length > 0 
    ? detectedHeights.map(h => `${h}p`)
    : Array.from(availableHeights).sort((a, b) => b - a).slice(0, 4).map(h => `${h}p`);

  if (mp4Qualities.length === 0) {
    mp4Qualities.push('1080p', '720p', '480p', '360p');
  }

  const mp3Qualities = ['320 kbps', '256 kbps', '192 kbps', '128 kbps'];

  return {
    id: rawInfo.id,
    title: rawInfo.title || 'YouTube Video',
    thumbnail: rawInfo.thumbnail || (rawInfo.thumbnails && rawInfo.thumbnails.length ? rawInfo.thumbnails[rawInfo.thumbnails.length - 1].url : ''),
    duration: rawInfo.duration,
    durationFormatted: formatDuration(rawInfo.duration),
    uploader: rawInfo.uploader || rawInfo.channel || 'Unknown Channel',
    viewCount: rawInfo.view_count ? Number(rawInfo.view_count).toLocaleString() : 'N/A',
    formats: ['mp4', 'mp3'],
    qualities: {
      mp4: mp4Qualities,
      mp3: mp3Qualities
    }
  };
}

/**
 * Downloads media with real-time percentage progress callback
 */
async function executeDownloadWithProgress({ url, format, quality, fileId }, onProgress) {
  const ytdlp = await getOrInitYtDlp();
  const ffmpegLocation = getFfmpegDir();

  const info = await getVideoInfo(url);
  if (info.duration && info.duration > MAX_DURATION_SECONDS) {
    throw new Error(`Security notice: Video duration exceeds the maximum 3-hour limit.`);
  }

  const selectedFormat = (format || 'mp4').toLowerCase();
  const fileExtension = selectedFormat === 'mp3' ? 'mp3' : 'mp4';
  const tempOutputBase = path.join(DOWNLOADS_DIR, `${fileId}`);
  const tempOutputFile = `${tempOutputBase}.${fileExtension}`;

  let ytdlpArgs = [];

  if (selectedFormat === 'mp3') {
    let bitrate = '320k';
    if (quality) {
      const match = quality.match(/\d+/);
      if (match) bitrate = `${match[0]}k`;
    }

    ytdlpArgs = [
      url.trim(),
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', bitrate,
      '--ffmpeg-location', ffmpegLocation,
      '-o', `${tempOutputBase}.%(ext)s`,
      '--no-playlist',
      '--no-check-certificates',
      '--force-ipv4',
      '--socket-timeout', '30',
      '--max-filesize', '2G',
      '--geo-bypass'
    ];
  } else {
    let heightLimit = 1080;
    if (quality) {
      const match = quality.match(/\d+/);
      if (match) heightLimit = parseInt(match[0], 10);
    }

    const formatSelector = `bestvideo[height<=?${heightLimit}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=?${heightLimit}]+bestaudio/best[height<=?${heightLimit}]/best`;

    ytdlpArgs = [
      url.trim(),
      '-f', formatSelector,
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', ffmpegLocation,
      '-o', `${tempOutputBase}.%(ext)s`,
      '--no-playlist',
      '--no-check-certificates',
      '--force-ipv4',
      '--socket-timeout', '30',
      '--max-filesize', '2G',
      '--geo-bypass'
    ];
  }

  return new Promise((resolve, reject) => {
    try {
      const ee = ytdlp.exec(ytdlpArgs);

      ee.on('progress', (p) => {
        if (p && typeof p.percent === 'number') {
          const rounded = Math.min(99, Math.round(p.percent));
          onProgress(rounded);
        }
      });

      ee.on('error', (err) => {
        reject(err);
      });

      ee.on('close', () => {
        // Locate output file
        let actualFile = tempOutputFile;
        if (!fs.existsSync(actualFile)) {
          const files = fs.readdirSync(DOWNLOADS_DIR);
          const matched = files.find(f => f.startsWith(fileId));
          if (matched) {
            actualFile = path.join(DOWNLOADS_DIR, matched);
          } else {
            return reject(new Error('Downloaded file not found on disk.'));
          }
        }
        onProgress(100);
        resolve(actualFile);
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  getOrInitYtDlp,
  getFfmpegPath,
  getFfmpegDir,
  getVideoInfo,
  executeDownloadWithProgress,
  sanitizeFileName,
  BIN_DIR,
  DOWNLOADS_DIR
};

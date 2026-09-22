/**
 * QuickClip v1.0.0
 * Developed by Kaan Kayali (@KaanKayali)
 *
 * @license MIT
 * @repository https://github.com/KaanKayali/QuickClip
 */

const { getOrInitYtDlp, getFfmpegPath } = require('./ytdlp');

async function main() {
  console.log('--- Initializing Dependencies & Binaries ---');
  const ffmpegPath = getFfmpegPath();
  console.log('✓ FFmpeg path:', ffmpegPath);

  console.log('Checking / downloading yt-dlp binary...');
  const ytDlp = await getOrInitYtDlp();
  const version = await ytDlp.getVersion();
  console.log('✓ yt-dlp version:', version);

  console.log('✓ All dependencies ready!');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});


# QuickClip

QuickClip is a webapp for downloading YouTube videos as MP4 or MP3. It uses Express for the server and `yt-dlp` plus FFmpeg for media processing.

> This webapp is for personal use only

<img alt="alt_text" width="160px" src="public/assets/favicon.png" />


## Features

- MP4 video downloads with selectable quality up to 1080p when available.
- MP3 audio extraction with selectable bitrate.
- Server-sent progress updates during downloads.
- Strict YouTube URL validation, with a three-hour duration limit, and a 2 GB file-size limit.
- Automatic local setup of the `yt-dlp`, FFmpeg, and FFprobe binaries.

## Requirements

- Node.js 20 or newer
- npm

## Getting Started

```bash
git clone https://github.com/KaanKayali/QuickClip.git
cd QuickClip
npm install
npm run setup-bin
npm start
```

Open [http://localhost:3000](http://localhost:3000) in a browser. The server uses port `3000` by default; set the `PORT` environment variable to use another port.

For development with automatic server restarts:

```bash
npm run dev
```

## API

### `POST /api/info`

Fetches metadata and available qualities for a YouTube video.

```json
{ "url": "https://www.youtube.com/watch?v=VIDEO_ID" }
```

### `GET /api/download-progress`

Starts a download and returns an [SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) stream. Query parameters:

- `url`: YouTube video URL
- `format`: `mp4` or `mp3` (defaults to `mp4`)
- `quality`: a supported quality such as `720p` or `192 kbps`

When the download is ready, the stream provides a `fileId` for `GET /api/file/:fileId`.

### `GET /api/download`

Direct-download fallback using the same `url`, `format`, and `quality` query parameters.

## Project Structure

```text
public/       Browser application
src/          Express server and media-processing
bin/          Generated yt-dlp/FFmpeg binaries (ignored by Git)
downloads/    Temporary media files (ignored by Git)
```

## npm Scripts

- `npm start` starts the production server.
- `npm run dev` starts the server with Node's watch mode.
- `npm run setup-bin` verifies or downloads the required media binaries.

## Contributing

1. Create a feature branch.
2. Run `npm ci` and `npm run setup-bin` locally.
3. Run the JavaScript syntax checks used by CI:

   ```bash
   node --check src/routes.js
   node --check src/server.js
   node --check src/setup-bin.js
   node --check src/ytdlp.js
   node --check public/app.js
   ```

4. Open a pull request with a concise description of the change and how it was tested.

## License

This project is released under the [MIT License](LICENSE).

/**
 * QuickClip v1.0.0
 * Developed by Kaan Kayali (@KaanKayali)
 *
 * @license MIT
 * @repository https://github.com/KaanKayali/QuickClip
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const videoUrlInput = document.getElementById('videoUrl');
  const fetchBtn = document.getElementById('fetchBtn');
  const statusContainer = document.getElementById('statusContainer');
  const statusMessage = document.getElementById('statusMessage');
  const statusPercent = document.getElementById('statusPercent');
  const progressBar = document.getElementById('progressBar');
  const previewSection = document.getElementById('previewSection');
  const videoThumb = document.getElementById('videoThumb');
  const videoTitle = document.getElementById('videoTitle');
  const videoAuthor = document.getElementById('videoAuthor');
  const videoViews = document.getElementById('videoViews');
  const videoDuration = document.getElementById('videoDuration');
  const qualitySelect = document.getElementById('qualitySelect');
  const downloadBtn = document.getElementById('downloadBtn');
  const formatRadios = document.querySelectorAll('input[name="downloadFormat"]');

  // Application State
  let currentVideoData = null;
  let isFetching = false;
  let isDownloading = false;
  let activeEventSource = null;

  // Theme Management (Light / Dark Mode with localStorage)
  function initTheme() {
    const savedTheme = localStorage.getItem('quickclip_theme');
    const initialTheme = savedTheme || 'dark';
    applyTheme(initialTheme);
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      themeIcon.textContent = '☀️';
      themeToggle.setAttribute('title', 'Switch to Light Mode');
    } else {
      document.documentElement.removeAttribute('data-theme');
      themeIcon.textContent = '🌙';
      themeToggle.setAttribute('title', 'Switch to Dark Mode');
    }
    localStorage.setItem('quickclip_theme', theme);
  }

  themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    applyTheme(isDark ? 'light' : 'dark');
  });

  initTheme();

  // Status Indicator Helpers
  function showStatus(message, isIndeterminate = false, isError = false) {
    statusContainer.classList.remove('hidden');
    statusMessage.textContent = message;
    
    if (isError) {
      statusMessage.style.color = 'var(--error-color)';
      statusPercent.textContent = '';
      progressBar.classList.remove('indeterminate');
      progressBar.style.width = '0%';
    } else {
      statusMessage.style.color = 'var(--text-primary)';
      if (isIndeterminate) {
        statusPercent.textContent = '';
        progressBar.classList.add('indeterminate');
      } else {
        progressBar.classList.remove('indeterminate');
      }
    }
  }

  function updateProgress(percent) {
    progressBar.classList.remove('indeterminate');
    const safePercent = Math.min(100, Math.max(0, percent));
    progressBar.style.width = safePercent + '%';
    statusPercent.textContent = safePercent + '%';
  }

  function hideStatus() {
    statusContainer.classList.add('hidden');
    progressBar.style.width = '0%';
    statusPercent.textContent = '0%';
  }

  // Dynamic Quality Dropdown Population
  function updateQualityOptions(format) {
    qualitySelect.innerHTML = '';

    let qualities = [];
    if (format === 'mp3') {
      qualities = (currentVideoData && currentVideoData.qualities && currentVideoData.qualities.mp3) || [
        '320 kbps', '256 kbps', '192 kbps', '128 kbps'
      ];
    } else {
      qualities = (currentVideoData && currentVideoData.qualities && currentVideoData.qualities.mp4) || [
        '1080p', '720p', '480p', '360p'
      ];
    }

    qualities.forEach((q, idx) => {
      const option = document.createElement('option');
      option.value = q;
      option.textContent = `${q} ${idx === 0 ? '(Best Quality)' : ''}`.trim();
      qualitySelect.appendChild(option);
    });
  }

  formatRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      updateQualityOptions(e.target.value);
    });
  });

  // Analyze / Fetch Video Info
  async function fetchVideoInfo() {
    const url = videoUrlInput.value.trim();

    if (!url) {
      showStatus('Please enter a YouTube video link.', false, true);
      return;
    }

    if (isFetching || isDownloading) return;
    isFetching = true;
    fetchBtn.disabled = true;
    previewSection.classList.add('hidden');
    showStatus('Fetching video...', true);

    try {
      const response = await fetch('/api/info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to fetch video information.');
      }

      currentVideoData = result.data;
      renderVideoPreview(currentVideoData);
      hideStatus();
    } catch (err) {
      console.error(err);
      showStatus(err.message || 'Error communicating with the server.', false, true);
    } finally {
      isFetching = false;
      fetchBtn.disabled = false;
    }
  }

  function renderVideoPreview(data) {
    videoThumb.src = data.thumbnail || 'https://via.placeholder.com/640x360?text=No+Thumbnail';
    videoThumb.alt = data.title || 'Thumbnail';
    videoTitle.textContent = data.title || 'Untitled Video';
    videoAuthor.textContent = `Channel: ${data.uploader || 'Unknown'}`;
    videoViews.textContent = `Views: ${data.viewCount || 'N/A'}`;
    videoDuration.textContent = data.durationFormatted || '0:00';

    const selectedFormat = document.querySelector('input[name="downloadFormat"]:checked').value;
    updateQualityOptions(selectedFormat);

    previewSection.classList.remove('hidden');
  }

  fetchBtn.addEventListener('click', fetchVideoInfo);

  videoUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fetchVideoInfo();
    }
  });

  videoUrlInput.addEventListener('paste', () => {
    setTimeout(() => {
      const val = videoUrlInput.value.trim();
      if (val.includes('youtube.com') || val.includes('youtu.be')) {
        fetchVideoInfo();
      }
    }, 100);
  });

  // Real-Time SSE Download Handler
  downloadBtn.addEventListener('click', () => {
    const url = videoUrlInput.value.trim();
    if (!url) {
      showStatus('Please provide a valid YouTube URL first.', false, true);
      return;
    }

    if (isDownloading) return;
    isDownloading = true;
    downloadBtn.disabled = true;

    const selectedFormat = document.querySelector('input[name="downloadFormat"]:checked').value;
    const selectedQuality = qualitySelect.value;

    showStatus('Your download has started...', false);
    updateProgress(0);

    const sseUrl = `/api/download-progress?url=${encodeURIComponent(url)}&format=${encodeURIComponent(selectedFormat)}&quality=${encodeURIComponent(selectedQuality)}`;

    if (activeEventSource) {
      activeEventSource.close();
    }

    activeEventSource = new EventSource(sseUrl);

    activeEventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        if (data.error) {
          showStatus(`Error: ${data.error}`, false, true);
          activeEventSource.close();
          isDownloading = false;
          downloadBtn.disabled = false;
          return;
        }

        if (typeof data.percent === 'number') {
          updateProgress(data.percent);
        }

        if (data.ready && data.fileId) {
          // Reached 100%! Trigger file download
          updateProgress(100);
          statusMessage.textContent = 'Your download has started...';

          activeEventSource.close();
          activeEventSource = null;

          // Trigger browser file download
          const downloadFileUrl = `/api/file/${data.fileId}`;
          const tempLink = document.createElement('a');
          tempLink.href = downloadFileUrl;
          tempLink.style.display = 'none';
          document.body.appendChild(tempLink);
          tempLink.click();
          document.body.removeChild(tempLink);

          setTimeout(() => {
            isDownloading = false;
            downloadBtn.disabled = false;
            setTimeout(() => {
              hideStatus();
            }, 4000);
          }, 1500);
        }
      } catch (parseErr) {
        console.error('[SSE Parse Error]:', parseErr);
      }
    };

    activeEventSource.onerror = (err) => {
      console.error('[SSE Error]:', err);
      showStatus('Download connection interrupted. Retrying...', false, true);
      if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
      }
      isDownloading = false;
      downloadBtn.disabled = false;
    };
  });
});

// Presentation only. Authentication remains in login.js.
(() => {
  const video = document.getElementById('loginFilm');
  const button = document.getElementById('filmToggle');
  if (!video || !button) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = motion.matches;
  let failed = false;
  const render = () => {
    const paused = video.paused;
    button.disabled = failed;
    button.setAttribute('aria-label', failed ? 'Film unavailable' : paused ? 'Play film' : 'Pause film');
    button.firstElementChild.innerHTML = '<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">' + (paused ? '<path d="M3 1.5 10 6 3 10.5Z"/>' : '<path d="M2 2h3v8H2zM7 2h3v8H7z"/>') + '</svg>';
    button.querySelector('.film-toggle-label').textContent = failed ? 'Unavailable' : paused ? 'Play film' : 'Pause film';
  };
  const play = async () => {
    if (failed || document.hidden) return;
    try { await video.play(); } catch { /* Poster and manual play remain available. */ }
    render();
  };
  video.muted = true;
  button.disabled = false;
  button.addEventListener('click', () => {
    userPaused = !video.paused;
    if (userPaused) video.pause();
    else void play();
  });
  video.addEventListener('play', render);
  video.addEventListener('pause', render);
  const fail = () => { failed = true; video.pause(); render(); };
  video.addEventListener('error', fail);
  video.querySelector('source')?.addEventListener('error', fail);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) video.pause();
    else if (!userPaused && !motion.matches) void play();
  });
  motion.addEventListener('change', () => {
    if (motion.matches) { userPaused = true; video.pause(); }
  });
  // Start loading after error listeners exist, including on slow or failed requests.
  video.preload = 'metadata';
  video.load();
  render();
  if (!motion.matches) void play();
})();

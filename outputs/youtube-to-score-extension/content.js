// Runs on YouTube. Reads the player, cues the excerpt, and tells the recorder
// whether the tab is playing the video right now (not an ad, not buffering).
(() => {
  if (window.__ytScoreCapture) return;
  window.__ytScoreCapture = true;

  const player = () => document.querySelector('#movie_player');
  const video = () => document.querySelector('#movie_player video') || document.querySelector('video');
  const adShowing = () => !!player()?.classList.contains('ad-showing');
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

  let session = null;
  let poll = 0;

  function title() {
    const heading = document.querySelector('ytd-watch-metadata h1, h1.ytd-watch-metadata, ytmusic-player-bar .title');
    return (heading?.textContent || document.title.replace(/ - YouTube( Music)?$/, '')).trim();
  }

  function channel() {
    const owner = document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a, ytmusic-player-bar .byline a');
    return (owner?.textContent || '').trim();
  }

  const seconds = (text) => {
    const parts = String(text || '').trim().split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return NaN;
    return parts.reduce((total, p) => total * 60 + Number(p), 0);
  };

  /**
   * The video's chapters: YouTube's own chapter list when the page has one,
   * else timestamp lines in the description ("1:23 Chorus"), which is where
   * YouTube reads chapters from.
   */
  function chapters(duration) {
    let found = [...document.querySelectorAll('ytd-macro-markers-list-item-renderer')].map((item) => ({
      title: (item.querySelector('h4')?.textContent || '').trim(),
      start: seconds(item.querySelector('#time')?.textContent),
    }));
    if (found.filter((c) => Number.isFinite(c.start)).length < 2) {
      const text = document.querySelector('#description-inline-expander, ytd-text-inline-expander, #description')?.innerText || '';
      found = text.split('\n').map((line) => {
        const match = /^\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|]?\s*(.*)$/.exec(line);
        return match ? {title: match[2].trim(), start: seconds(match[1])} : null;
      }).filter(Boolean);
    }
    const unique = [];
    for (const c of found.filter((c) => Number.isFinite(c.start)).sort((a, b) => a.start - b.start)) {
      if (!unique.length || c.start > unique[unique.length - 1].start) unique.push(c);
    }
    // YouTube only treats a list as chapters when it starts at 0:00.
    if (unique.length < 2 || unique[0].start !== 0) return [];
    return unique.map((c, i) => ({
      title: c.title || `Part ${i + 1}`,
      start: c.start,
      end: i + 1 < unique.length ? unique[i + 1].start : duration,
    })).filter((c) => c.end == null || c.end > c.start);
  }

  function info() {
    const v = video();
    const duration = v && Number.isFinite(v.duration) ? v.duration : null;
    return {
      title: title(),
      channel: channel(),
      chapters: chapters(duration),
      url: location.href,
      videoId: new URL(location.href).searchParams.get('v'),
      time: v ? v.currentTime : 0,
      duration: v && Number.isFinite(v.duration) ? v.duration : null,
      ad: adShowing(),
      ready: !!v,
    };
  }

  function evaluate() {
    if (!session) return;
    const v = video();
    const ad = adShowing();
    const live = !!v && !ad && !v.paused && !v.ended && !v.seeking && v.readyState > 2;
    if (live !== session.live || ad !== session.ad) {
      session.live = live;
      session.ad = ad;
      send({type: 'gate', live, ad});
    }
  }

  function ended() {
    if (!session || adShowing()) return;
    session = null;
    clearInterval(poll);
    send({type: 'video-ended'});
  }

  // Media events don't bubble, so listen in the capture phase.
  for (const name of ['playing', 'pause', 'waiting', 'seeking', 'seeked', 'timeupdate', 'stalled']) {
    document.addEventListener(name, evaluate, true);
  }
  document.addEventListener('ended', ended, true);
  // YouTube navigates between videos without reloading the page.
  window.addEventListener('yt-navigate-start', ended);

  function seek(v, time) {
    return new Promise((resolve) => {
      if (Math.abs(v.currentTime - time) < 0.05) return resolve();
      const done = () => { v.removeEventListener('seeked', done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 5000);
      v.addEventListener('seeked', done);
      v.currentTime = time;
    });
  }

  // ---- playing the engraved score along with the video ----
  // The video plays (muted, unless the reader wants to hear the song too) while
  // the extension plays the sheet; it reports where it is so the sheet can
  // follow it bar by bar.
  let sync = null;
  const reportSync = () => {
    const v = video();
    if (!sync || !v) return;
    send({
      type: 'video-time', videoId: info().videoId, time: v.currentTime, rate: v.playbackRate,
      paused: v.paused || v.ended || v.seeking || v.readyState < 3 || adShowing(),
    });
  };
  for (const name of ['play', 'playing', 'pause', 'waiting', 'seeking', 'seeked', 'ratechange']) {
    document.addEventListener(name, () => reportSync(), true);
  }
  function stopSync() {
    if (!sync) return;
    const v = video();
    if (v) v.muted = sync.wasMuted;
    clearInterval(sync.timer);
    sync = null;
  }

  // Another video, another score: give this one its sound back.
  window.addEventListener('yt-navigate-start', () => stopSync());

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    const v = video();
    switch (msg.type) {
      case 'sync-start':
        if (!v) return reply({error: 'No video found on this page.'});
        stopSync();
        sync = {wasMuted: v.muted, muted: msg.muted !== false, timer: setInterval(reportSync, 150)};
        v.muted = sync.muted;
        if (msg.rate) v.playbackRate = msg.rate;
        seek(v, msg.at).then(() => v.play().catch(() => {})).then(() => reply({ok: true}));
        return true;
      case 'sync-control':
        if (!v || !sync) return reply({error: 'Not playing along.'});
        if (typeof msg.muted === 'boolean') sync.muted = msg.muted;
        v.muted = sync.muted;
        if (msg.rate) v.playbackRate = msg.rate;
        if (msg.action === 'pause') v.pause();
        if (msg.action === 'seek') v.currentTime = msg.at;
        if (msg.action === 'play') v.play().catch(() => {});
        reportSync();
        reply({ok: true});
        return;
      case 'sync-stop':
        if (msg.pause) v?.pause();
        stopSync();
        reply({ok: true});
        return;
      case 'info':
        reply(info());
        return;
      case 'prepare':
        if (!v) return reply({error: 'No video found on this page.'});
        if (adShowing()) return reply({error: 'An ad is playing. Wait for it to finish, then record.'});
        v.pause();
        seek(v, msg.start).then(() => reply({ok: true}));
        return true;
      case 'play':
        session = {live: null, ad: null};
        clearInterval(poll);
        poll = setInterval(evaluate, 200);
        v?.play().catch(() => {});
        evaluate();
        reply({ok: true});
        return;
      case 'stop':
        session = null;
        clearInterval(poll);
        v?.pause();
        reply({ok: true});
        return;
    }
  });
})();

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

  function info() {
    const v = video();
    return {
      title: title(),
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

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    const v = video();
    switch (msg.type) {
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

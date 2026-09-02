(function () {
  var stage = document.getElementById('stage');
  var pin = document.getElementById('pin');
  var video = document.getElementById('scrubVideo');
  var flood = document.getElementById('flood');
  var reveal = document.getElementById('reveal');
  var revealCta = reveal ? reveal.querySelector('.cta') : null;
  var introOverlay = document.getElementById('introOverlay');
  var cap1 = document.getElementById('cap1');
  var cap2 = document.getElementById('cap2');
  var railFill = document.getElementById('railFill');

  var DEBUG = /(?:^|[?&])debug(?:=1|$)/.test(window.location.search);
  var FPS = 24;
  var SEEK_EPS = 1 / FPS / 2;
  var HAVE_METADATA = 1;
  var HAVE_CURRENT_DATA = 2;
  var mobileMq = window.matchMedia('(max-width: 760px)');
  var touchDevice = window.matchMedia('(hover: none) and (pointer: coarse)');

  var duration = 0;
  var targetTime = 0;
  var pendingSeekTime = null;
  var videoReady = false;
  var videoUnlocked = false;
  var frameVisible = false;
  var lastLogAt = 0;
  var lastStatusBucket = -1;
  var stageOffsetTop = 0;

  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.muted = true;

  function isMobile() { return mobileMq.matches || touchDevice.matches; }

  function viewportHeight() {
    if (window.visualViewport && window.visualViewport.height > 0) {
      return window.visualViewport.height;
    }
    return window.innerHeight;
  }

  function scrollY() {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }

  function introFadeEnd() { return isMobile() ? 0.10 : 0.08; }
  function cap1Range() { return isMobile() ? [0.07, 0.36] : [0.10, 0.44]; }
  function cap2Range() { return isMobile() ? [0.40, 0.68] : [0.46, 0.78]; }

  if (location.protocol === 'file:') {
    console.error('[scrub] file:// seek calismaz. Proje klasorunde: npx serve .');
  }

  function log() {
    if (!DEBUG) return;
    console.log.apply(console, ['[scrub]'].concat([].slice.call(arguments)));
  }

  function measureStage() {
    stageOffsetTop = stage.offsetTop;
  }

  function showVideoFrame() {
    if (frameVisible) return;
    frameVisible = true;
    video.classList.add('is-ready');
    if (pin) pin.style.backgroundImage = 'none';
  }

  function markVideoReady(source) {
    duration = video.duration || 0;
    if (duration > 0 && video.readyState >= HAVE_METADATA) {
      videoReady = true;
      showVideoFrame();
      log('video ready (' + source + ')', {
        duration: duration.toFixed(2) + 's',
        readyState: video.readyState
      });
    }
  }

  function canSeekNow() {
    if (!videoReady && video.duration > 0 && video.readyState >= HAVE_METADATA) {
      markVideoReady('canSeekNow');
    }
    return (videoReady || (video.duration > 0 && video.readyState >= HAVE_METADATA)) && (!isMobile() || videoUnlocked);
  }

  function unlockVideo() {
    if (videoUnlocked) return;
    videoUnlocked = true;
    video.muted = true;

    var playAttempt = video.play();
    if (playAttempt && playAttempt.then) {
      playAttempt.then(function () {
        video.pause();
        markVideoReady('unlock');
        applyVideoTime(computeProgress());
      }).catch(function (err) {
        log('unlock play blocked', err);
        markVideoReady('unlock-fallback');
      });
    } else {
      markVideoReady('unlock-sync');
      applyVideoTime(computeProgress());
    }
  }

  function armFirstFrame() {
    markVideoReady('loadeddata');
    video.pause();
    showVideoFrame();
    if (!isMobile()) {
      queueSeek(0.001, 'armFirstFrame');
    }
  }

  video.addEventListener('loadedmetadata', function () {
    markVideoReady('loadedmetadata');
    if (!isMobile()) queueSeek(0.001, 'loadedmetadata');
  });
  video.addEventListener('loadeddata', armFirstFrame);
  video.addEventListener('canplay', function () { markVideoReady('canplay'); });
  video.addEventListener('canplaythrough', function () { markVideoReady('canplaythrough'); });
  video.addEventListener('play', function () { video.pause(); });
  video.addEventListener('error', function () {
    console.error('[scrub] video error', video.error);
  });
  video.addEventListener('seeked', function () {
    showVideoFrame();
    log('seeked', { currentTime: video.currentTime, targetTime: targetTime });

    if (pendingSeekTime !== null && !video.seeking) {
      var next = pendingSeekTime;
      pendingSeekTime = null;
      queueSeek(next, 'seeked-flush');
    }
  });

  if (isMobile()) {
    ['touchstart', 'touchend', 'click'].forEach(function (evt) {
      window.addEventListener(evt, unlockVideo, { passive: true });
    });
  } else {
    videoUnlocked = true;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function remap(v, a, b) { return clamp((v - a) / (b - a), 0, 1); }
  function easeInQuad(t) { return t * t; }

  function snapTime(t) {
    var maxD = (duration > 0 ? duration : (video.duration || 5));
    return Math.round(clamp(t, 0, maxD - SEEK_EPS) * FPS) / FPS;
  }

  function fadeStyle(el, t0, t1, p, dir) {
    var lp = remap(p, t0, t1);
    el.style.opacity = dir === 'out' ? (1 - lp) : lp;
  }

  function capStyle(el, t0, t1, p) {
    var lp = remap(p, t0, t1);
    var fadeIn = remap(lp, 0, 0.2);
    var fadeOut = remap(lp, 0.75, 1);
    var op = Math.min(fadeIn, 1 - fadeOut);
    el.style.opacity = op;
    el.style.transform = 'translateY(' + (18 * (1 - fadeIn)) + 'px)';
  }

  function computeProgress() {
    var vh = viewportHeight();
    var total = stage.offsetHeight - vh;
    if (total <= 0) return 0;

    var rect = stage.getBoundingClientRect();
    return clamp(-rect.top / total, 0, 1);
  }

  var smoothProgress = 0;

  function queueSeek(time, reason) {
    if (!canSeekNow()) return;

    var next = snapTime(time);
    if (video.seeking) {
      pendingSeekTime = next;
      return;
    }

    if (Math.abs(video.currentTime - next) < SEEK_EPS) return;

    try {
      video.currentTime = next;
      log('seek ->', next, reason || '');
    } catch (err) {}
  }

  function applyVideoTime(p) {
    if (!canSeekNow()) return;

    var curDuration = duration || video.duration || 0;
    if (curDuration <= 0) return;

    // Scroll 0..1 maps linearly to video timeline; last ~4% reserved for reveal.
    var videoP = remap(p, 0, 0.96);
    targetTime = snapTime(videoP * curDuration);

    queueSeek(targetTime, 'scroll');
  }

  function maybeLogFrame(p) {
    if (!isMobile()) return;

    var bucket = Math.floor(p * 20);
    if (bucket !== lastStatusBucket && p > 0.01) {
      lastStatusBucket = bucket;
      console.log('[scrub] mobile scroll', {
        progress: p.toFixed(3),
        targetTime: targetTime.toFixed(3),
        currentTime: video.currentTime.toFixed(3),
        unlocked: videoUnlocked
      });
    }

    if (!DEBUG) return;
    var now = performance.now();
    if (now - lastLogAt < 250) return;
    lastLogAt = now;
    log('frame', { progress: p.toFixed(3), targetTime: targetTime, currentTime: video.currentTime });
  }

  function tick() {
    var rawP = computeProgress();

    // Smooth lerp on desktop for cinematic glide; direct response on touch
    if (isMobile()) {
      smoothProgress = rawP;
    } else {
      var diff = rawP - smoothProgress;
      if (Math.abs(diff) < 0.0001) {
        smoothProgress = rawP;
      } else {
        smoothProgress += diff * 0.18;
      }
    }

    var p = smoothProgress;
    maybeLogFrame(p);

    railFill.style.height = (p * 100) + '%';
    fadeStyle(introOverlay, 0, introFadeEnd(), p, 'out');

    applyVideoTime(p);

    if (pendingSeekTime !== null && !video.seeking) {
      queueSeek(pendingSeekTime, 'pending');
    }

    var floodT = remap(p, 0.80, 0.97);
    flood.style.opacity = easeInQuad(floodT);

    var revealT = remap(p, 0.90, 1);
    reveal.style.opacity = revealT;
    if (revealCta) {
      revealCta.style.pointerEvents = revealT > 0.6 ? 'auto' : 'none';
    }

    var c1 = cap1Range();
    var c2 = cap2Range();
    capStyle(cap1, c1[0], c1[1], p);
    capStyle(cap2, c2[0], c2[1], p);

    requestAnimationFrame(tick);
  }

  function onLayoutChange() {
    measureStage();
  }

  window.addEventListener('resize', onLayoutChange);
  window.addEventListener('scroll', function () {
    if (isMobile() && !videoUnlocked) unlockVideo();
  }, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onLayoutChange);
    window.visualViewport.addEventListener('scroll', onLayoutChange);
  }

  mobileMq.addEventListener('change', onLayoutChange);
  touchDevice.addEventListener('change', onLayoutChange);

  measureStage();
  markVideoReady('init');
  if (video.readyState >= HAVE_CURRENT_DATA) showVideoFrame();
  requestAnimationFrame(tick);
})();

"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const master = $("sgvc-video");
  const reference = $("reference-video");
  const stage = $("video-stage");
  const split = $("split-slider");
  const timeline = $("timeline");
  const playButton = $("play-button");
  const errorBox = $("video-error");
  const state = { sequences: [], sequence: null, method: null, generation: 0, playAttempt: 0, controller: new AbortController(), seekController: null, playing: false, loading: true, scrubbing: false, resumeAfterScrub: false, desiredPlay: false, mediaPrepared: false, restorePausedFrame: false, pendingTime: 0, preparation: null };
  master.muted = reference.muted = true;
  let loadingMessage = "Loading synchronized videos…";
  let presentationHeld = false;
  let presentationEpoch = 0;
  const frameTracks = [master, reference].map((video, index) => ({
    video, output: $(index ? "reference-frame" : "sgvc-frame"), callback: null,
    frames: Array.from({ length: 3 }, () => ({ canvas: document.createElement("canvas"), index: -1 })), next: 0,
  }));

  function frameRate() { return state.sequence?.playbackFps || state.sequence?.fps || 12; }

  function copyFrame(source, canvas) {
    const width = source.videoWidth || source.width;
    const height = source.videoHeight || source.height;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    canvas.getContext("2d", { alpha: false }).drawImage(source, 0, 0);
  }

  function presentPair() {
    if (presentationHeld) return;
    const common = frameTracks[0].frames.filter((frame) => frame.index >= (state.sequence?.firstDisplayFrame || 0)
      && frameTracks[1].frames.some((other) => other.index === frame.index));
    if (!common.length) return;
    const index = Math.max(...common.map((frame) => frame.index));
    if (stage.dataset.frameEpoch === String(presentationEpoch) && Number(stage.dataset.frameIndex) >= index) return;
    // Both canvases change in one JS task; never expose independently decoded video frames.
    for (const track of frameTracks) {
      copyFrame(track.frames.find((frame) => frame.index === index).canvas, track.output);
      track.output.dataset.frameIndex = String(index);
    }
    stage.dataset.frameIndex = String(index);
    stage.dataset.frameEpoch = String(presentationEpoch);
    stage.dataset.paired = "true";
  }

  function captureFrame(track, index) {
    const frame = track.frames[track.next];
    copyFrame(track.video, frame.canvas);
    frame.index = index;
    track.next = (track.next + 1) % track.frames.length;
  }

  function watchFrame(track) {
    if (!track.video.requestVideoFrameCallback) return;
    const epoch = presentationEpoch;
    track.callback = track.video.requestVideoFrameCallback((_, metadata) => {
      if (epoch !== presentationEpoch) return;
      if (!track.video.seeking && !state.seekController && !state.scrubbing && track.video.readyState >= 2) {
        // Capture pixels now, not when the other decoder eventually delivers its frame.
        captureFrame(track, Math.round(metadata.mediaTime * frameRate()));
        presentPair();
      }
      watchFrame(track);
    });
  }

  function resetFrameQueues() {
    presentationEpoch++;
    for (const track of frameTracks) {
      if (track.callback !== null) track.video.cancelVideoFrameCallback?.(track.callback);
      for (const frame of track.frames) frame.index = -1;
      track.next = 0;
      watchFrame(track);
    }
  }

  function updateLoadingStatus() {
    if (!state.loading || !state.sequence) return;
    const fraction = Math.min(...[master, reference].map((video) => {
      let seconds = 0;
      for (let i = 0; i < video.buffered.length; i++) seconds += video.buffered.end(i) - video.buffered.start(i);
      return seconds / (video.duration || state.sequence.duration || 8);
    }));
    $("loading-text").textContent = `${loadingMessage} ${Math.min(100, Math.floor(fraction * 100))}% buffered`;
  }

  function setLoading(value, text = "Loading synchronized videos…") {
    state.loading = value;
    loadingMessage = text;
    $("loading-status").hidden = !value;
    $("loading-text").textContent = text;
    stage.setAttribute("aria-busy", String(value));
    playButton.disabled = value;
    timeline.disabled = value || !state.mediaPrepared;
    if (value) updateLoadingStatus();
  }

  function showError(message) {
    pausePair();
    state.controller.abort();
    errorBox.textContent = message;
    errorBox.hidden = false;
    setLoading(false);
    playButton.disabled = !state.sequence;
    timeline.disabled = true;
  }

  function pausePair(updateIntent = true) {
    state.playAttempt++;
    if (updateIntent) state.desiredPlay = false;
    master.pause();
    reference.pause();
    state.playing = false;
    updatePlayButton();
  }

  function updatePlayButton() {
    $("play-icon").hidden = state.playing;
    $("pause-icon").hidden = !state.playing;
    playButton.setAttribute("aria-label", state.playing ? "Pause both videos" : "Play both videos");
    playButton.title = state.playing ? "Pause both videos" : "Play both videos";
  }

  async function playPair() {
    state.desiredPlay = true;
    if (state.loading || document.hidden) return;
    const generation = state.generation;
    if (!state.mediaPrepared) {
      try { await preparePair(generation); }
      catch (error) {
        if (generation === state.generation && error.name !== "AbortError") showError("The download stopped responding. Press Play to retry.");
        return;
      }
    }
    if (generation !== state.generation || !state.desiredPlay || document.hidden) return;
    if (currentTime() >= duration() - .02) {
      try { await seekPair(0, generation); } catch (_) { return; }
    }
    if (generation !== state.generation || !state.desiredPlay || state.loading || document.hidden) return;
    if (Math.abs(reference.currentTime - master.currentTime) > .025) {
      try { await seekPair(currentTime(), generation); } catch (_) { return; }
    }
    if (generation !== state.generation || !state.desiredPlay) return;
    const attempt = ++state.playAttempt;
    const results = await Promise.allSettled([master.play(), reference.play()]);
    if (generation !== state.generation || attempt !== state.playAttempt || state.loading || !state.desiredPlay) return;
    if (results.some((result) => result.status === "rejected")) {
      showError("Playback could not start. Press Play to retry.");
      return;
    }
    state.playing = true;
    updatePlayButton();
  }

  function duration() {
    const values = [master.duration, reference.duration].filter(Number.isFinite);
    return Math.max(0, (state.mediaPrepared && values.length ? Math.min(...values) : state.sequence?.duration || 0) - startTime());
  }

  function startTime() {
    return (state.sequence?.firstDisplayFrame || 0) / (state.sequence?.playbackFps || state.sequence?.fps || 12);
  }

  function currentTime() {
    return state.mediaPrepared ? Math.max(0, master.currentTime - startTime()) : state.pendingTime;
  }

  function timeLabel(value) {
    const seconds = Math.max(0, Math.floor(value || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function updateProgress() {
    const total = duration();
    const time = currentTime();
    if (!state.scrubbing) timeline.value = total ? Math.round(time / total * 1000) : 0;
    $("time-label").textContent = `${timeLabel(time)} / ${timeLabel(total)}`;
    const fps = state.sequence?.playbackFps || state.sequence?.fps;
    const count = state.sequence ? state.sequence.frameCount - (state.sequence.firstDisplayFrame || 0) : 0;
    $("frame-label").textContent = fps && count ? `P-frame ${Math.min(count, Math.floor(time * fps + .0001) + 1)} / ${count}` : "";
    timeline.setAttribute("aria-valuetext", `${time.toFixed(1)} of ${total.toFixed(1)} seconds`);
  }

  function waitForMedia(video, { signal, event, condition, action, timeout = 60000 }) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException("Superseded video request", "AbortError"));
      if (condition()) return resolve();
      let timer, poll;
      // A slow, progressing download is not a failed download. Watch several
      // media events: loadeddata/canplay can be omitted on mobile or while paused.
      const events = [...new Set([event, "loadedmetadata", "loadeddata", "canplay", "progress", "seeked", "suspend"])];
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(poll);
        for (const name of events) video.removeEventListener(name, onReady);
        video.removeEventListener("error", onError);
        signal.removeEventListener("abort", onAbort);
      };
      const restartTimeout = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { cleanup(); reject(new Error("Video download stopped responding")); }, timeout);
      };
      let lastProgress = "";
      const onReady = (event) => {
        const progress = `${video.readyState}:${Array.from({ length: video.buffered.length }, (_, i) => `${video.buffered.start(i)}-${video.buffered.end(i)}`).join(",")}`;
        if (event?.type === "progress" || progress !== lastProgress) {
          lastProgress = progress;
          restartTimeout();
        }
        if (condition()) { cleanup(); resolve(); }
      };
      const onError = () => { cleanup(); reject(new Error("Video could not be loaded")); };
      const onAbort = () => { cleanup(); reject(new DOMException("Superseded video request", "AbortError")); };
      for (const name of events) video.addEventListener(name, onReady);
      video.addEventListener("error", onError, { once: true });
      signal.addEventListener("abort", onAbort, { once: true });
      restartTimeout();
      poll = setInterval(onReady, 250);
      try { if (action) action(); onReady(); }
      catch (error) { cleanup(); reject(error); }
    });
  }

  function ready(video, signal) {
    return waitForMedia(video, { signal, event: "loadeddata", condition: () => video.readyState >= 2 });
  }

  function bufferedAhead(video, time) {
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= time + .01 && video.buffered.end(i) > time) return video.buffered.end(i) - time;
    }
    return 0;
  }

  function waitForBuffer(video, time, signal, seconds) {
    return waitForMedia(video, { signal, event: "progress", condition: () => {
      const remaining = Math.max(0, video.duration - time - .02);
      return video.readyState >= 2 && bufferedAhead(video, time) >= Math.min(seconds, remaining);
    } });
  }

  function seek(video, time, signal) {
    return waitForMedia(video, {
      signal, event: "seeked", condition: () => Math.abs(video.currentTime - time) < .001 && !video.seeking,
      action: () => { video.currentTime = time; },
    });
  }

  async function seekPair(time, generation = state.generation, holdPresentation = false) {
    if (generation !== state.generation) throw new DOMException("Superseded video request", "AbortError");
    state.seekController?.abort();
    const controller = new AbortController();
    state.seekController = controller;
    presentationHeld = true;
    resetFrameQueues();
    const sourceSignal = state.controller.signal;
    const cancel = () => controller.abort();
    sourceSignal.addEventListener("abort", cancel, { once: true });
    if (sourceSignal.aborted) cancel();
    const target = startTime() + Math.max(0, Math.min(time, Math.max(0, duration() - .001)));
    try {
      await Promise.all([seek(master, target, controller.signal), seek(reference, target, controller.signal)]);
      await Promise.all([ready(master, controller.signal), ready(reference, controller.signal)]);
      if (generation === state.generation) {
        // A paused, unchanged source may not issue another video-frame callback.
        // seeked + HAVE_CURRENT_DATA makes its target frame available to drawImage.
        for (const track of frameTracks) captureFrame(track, Math.floor(target * frameRate() + .0001));
        presentationHeld = holdPresentation;
        presentPair();
        updateProgress();
      }
    } finally {
      controller.abort();
      sourceSignal.removeEventListener("abort", cancel);
      if (state.seekController === controller) state.seekController = null;
    }
  }

  function setSource(video, item) {
    if (item.poster) video.poster = item.poster;
    else video.removeAttribute("poster");
    if (video.dataset.source !== item.video || video.error) {
      video.preload = "none";
      video.removeAttribute("src");
      if (video.dataset.source) video.load();
      video.dataset.source = item.video;
    }
  }

  async function preparePair(generation = state.generation) {
    if (state.preparation?.generation === generation) return state.preparation.promise;
    const signal = state.controller.signal;
    setLoading(true);
    const promise = (async () => {
      for (const video of [master, reference]) {
        if (!video.getAttribute("src")) {
          video.preload = "auto";
          video.src = video.dataset.source;
          video.load();
        }
      }
      await Promise.all([ready(master, signal), ready(reference, signal)]);
      if (generation !== state.generation) throw new DOMException("Superseded video request", "AbortError");
      await seekPair(state.pendingTime, generation);
      if (generation !== state.generation) throw new DOMException("Superseded video request", "AbortError");
      if (state.desiredPlay) await Promise.all([master, reference].map((video) => waitForBuffer(video, video.currentTime, signal, 1.5)));
      if (generation !== state.generation) throw new DOMException("Superseded video request", "AbortError");
      state.mediaPrepared = true;
      state.restorePausedFrame = false;
      stage.dataset.preview = "false";
      setLoading(false);
      updateProgress();
    })();
    state.preparation = { generation, promise };
    try { await promise; }
    finally { if (state.preparation?.generation === generation) state.preparation = null; }
  }

  function formatRate(item) {
    return item.bppLabel || (typeof item.bpp === "number" ? `${item.bpp.toFixed(6)} bpp` : (item.rateLabel || ""));
  }

  function setRateNote(element, item) {
    const note = typeof item.rateNote === "string" ? item.rateNote.trim() : "";
    for (const attribute of ["title", "aria-description"]) {
      if (note) element.setAttribute(attribute, note);
      else element.removeAttribute(attribute);
    }
  }

  async function loadPair(sequence, method, keepTime = false) {
    state.controller.abort();
    state.controller = new AbortController();
    const generation = ++state.generation;
    const previousTime = keepTime ? currentTime() : 0;
    const restorePausedFrame = keepTime && (state.mediaPrepared || state.restorePausedFrame);
    state.restorePausedFrame = restorePausedFrame;
    const shouldPlay = state.desiredPlay;
    pausePair(false);
    state.scrubbing = false;
    state.resumeAfterScrub = false;
    state.sequence = sequence;
    state.method = method;
    state.mediaPrepared = false;
    state.pendingTime = previousTime;
    errorBox.hidden = true;
    stage.dataset.preview = "true";
    stage.dataset.paired = "false";
    presentationHeld = true;
    resetFrameQueues();
    $("sgvc-poster").src = sequence.sgvc.poster;
    $("reference-poster").src = method.poster;
    $("reference-poster").alt = `${method.label} first P-frame preview`;
    stage.style.aspectRatio = `${sequence.width || 16} / ${sequence.height || 9}`;
    $("reference-label").textContent = method.label;
    $("reference-rate").textContent = formatRate(method);
    $("sgvc-rate").textContent = formatRate(sequence.sgvc);
    setRateNote($("reference-rate"), method);
    setRateNote($("sgvc-rate"), sequence.sgvc);
    reference.setAttribute("aria-label", `${method.label}, ${sequence.label}`);
    master.setAttribute("aria-label", `SGVC reconstruction, ${sequence.label}`);
    for (const button of $("sequence-tabs").children) button.setAttribute("aria-pressed", String(button.dataset.id === sequence.id));
    renderMethods(sequence);
    setSource(master, sequence.sgvc);
    setSource(reference, method);
    setLoading(false);
    updateProgress();
    try {
      if (shouldPlay) await playPair();
      else if (restorePausedFrame) await preparePair(generation);
    } catch (_) {
      if (generation === state.generation) showError("This video could not be loaded. Choose another reference or dataset, or reload the page.");
    }
  }

  function renderMethods(sequence) {
    const container = $("method-buttons");
    const activeMethod = container.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    container.replaceChildren();
    for (const method of sequence.methods) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "method-button";
      button.textContent = method.label;
      button.dataset.id = method.id;
      button.setAttribute("aria-pressed", String(method.id === state.method?.id));
      setRateNote(button, method);
      button.addEventListener("click", () => {
        if (state.method?.id !== method.id || !errorBox.hidden) loadPair(sequence, method, errorBox.hidden);
      });
      container.append(button);
      if (method.id === activeMethod) button.focus({ preventScroll: true });
    }
  }

  function renderSequences() {
    const container = $("sequence-tabs");
    for (const sequence of state.sequences) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sequence-tab";
      button.textContent = sequence.label;
      button.dataset.id = sequence.id;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        if (state.sequence?.id === sequence.id && errorBox.hidden) return;
        const method = sequence.methods.find((item) => item.id === state.method?.id) || sequence.methods[0];
        loadPair(sequence, method);
      });
      container.append(button);
    }
  }

  function renderFigures(figures) {
    for (const item of figures) {
      const figure = document.createElement("figure");
      figure.className = `paper-figure${item.layout === "half" ? " half" : ""}`;
      const link = document.createElement("a");
      link.className = "figure-image-link";
      link.href = item.pdf || item.src;
      link.target = "_blank";
      link.rel = "noopener";
      link.setAttribute("aria-label", `Open full-resolution ${item.label}`);
      const image = document.createElement("img");
      image.src = item.src;
      image.alt = item.alt || item.label;
      image.loading = "lazy";
      image.decoding = "async";
      if (item.width) image.width = item.width;
      if (item.height) image.height = item.height;
      link.append(image);
      const caption = document.createElement("figcaption");
      const title = document.createElement("strong");
      title.textContent = item.label;
      caption.append(title);
      if (item.caption) {
        const text = document.createElement("span");
        text.className = "figure-caption";
        text.textContent = item.caption;
        caption.append(text);
      }
      figure.append(link);
      if (item.showCaption !== false) figure.append(caption);
      const target = $(`${item.category}-figures`);
      if (target) target.append(figure);
    }
  }

  split.addEventListener("input", () => {
    const value = Number(split.value);
    stage.style.setProperty("--split", `${value}%`);
    split.setAttribute("aria-valuetext", `${Math.round(value)} percent reference, ${Math.round(100 - value)} percent SGVC`);
  });
  playButton.addEventListener("click", () => {
    if (!errorBox.hidden && state.sequence) {
      // Explicit retry also restarts a stalled request; changing datasets is not required.
      for (const video of [master, reference]) { video.removeAttribute("src"); video.load(); }
      state.desiredPlay = true;
      loadPair(state.sequence, state.method);
    } else if (state.playing) pausePair();
    else playPair();
  });

  function beginScrub() {
    if (state.scrubbing || !state.mediaPrepared) return;
    state.seekController?.abort();
    state.scrubbing = true;
    presentationHeld = true;
    state.resumeAfterScrub = state.desiredPlay;
    pausePair(false);
  }
  timeline.addEventListener("pointerdown", beginScrub);
  timeline.addEventListener("keydown", (event) => { if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) beginScrub(); });
  timeline.addEventListener("input", () => {
    const time = Number(timeline.value) / 1000 * duration();
    if (!state.mediaPrepared) return;
    master.currentTime = reference.currentTime = startTime() + Math.min(time, Math.max(0, duration() - .001));
    updateProgress();
  });
  async function finishScrub() {
    if (!state.scrubbing) return;
    state.scrubbing = false;
    const generation = state.generation;
    const resume = state.resumeAfterScrub;
    try {
      await seekPair(Number(timeline.value) / 1000 * duration(), generation);
      if (generation === state.generation && resume && state.desiredPlay) playPair();
    } catch (error) {
      if (generation === state.generation && error.name !== "AbortError") showError("Seeking timed out. Choose a dataset again or reload the page.");
    }
  }
  timeline.addEventListener("change", finishScrub);
  timeline.addEventListener("pointerup", finishScrub);
  timeline.addEventListener("pointercancel", finishScrub);
  timeline.addEventListener("keyup", finishScrub);
  timeline.addEventListener("blur", finishScrub);

  master.addEventListener("ended", async () => {
    const generation = state.generation;
    const resume = state.desiredPlay;
    pausePair(false);
    try {
      await seekPair(0, generation);
      if (generation === state.generation && resume && state.desiredPlay) playPair();
    } catch (error) {
      if (generation === state.generation && error.name !== "AbortError") showError("The video loop could not restart. Choose a dataset again or reload the page.");
    }
  });
  async function bufferPair() {
    if (!state.desiredPlay || !state.mediaPrepared || state.loading || state.scrubbing || state.seekController) return;
    const generation = state.generation;
    const signal = state.controller.signal;
    presentationHeld = true;
    pausePair(false);
    setLoading(true, "Buffering synchronized videos…");
    try {
      // Align first, then wait for enough data at that position. canplay alone
      // resumes too early on slow connections and causes repeated pause/play cycles.
      const displayed = Number(stage.dataset.frameIndex);
      const target = Number.isFinite(displayed) ? displayed / frameRate() : master.currentTime;
      await seekPair(Math.max(0, target - startTime()), generation, true);
      if (generation !== state.generation) return;
      await Promise.all([master, reference].map((video) => waitForBuffer(video, video.currentTime, signal, 2)));
      if (generation !== state.generation) return;
      setLoading(false);
      presentationHeld = false;
      presentPair();
      if (state.desiredPlay && !document.hidden) playPair();
    } catch (error) {
      if (generation === state.generation && error.name !== "AbortError") showError("The download stopped responding. Press Play to retry.");
    }
  }
  for (const video of [master, reference]) {
    video.addEventListener("progress", updateLoadingStatus);
    video.addEventListener("waiting", bufferPair);
    video.addEventListener("stalled", () => { if (video.readyState < 3) bufferPair(); });
    video.addEventListener("error", () => {
      if (video.error) showError("A comparison video could not be loaded. Press Play to retry.");
    });
  }
  master.addEventListener("timeupdate", updateProgress);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pausePair(false);
    else if (state.desiredPlay && !state.loading) playPair();
  });
  $("fullscreen-button").addEventListener("click", async () => {
    const shell = document.querySelector(".player-shell");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (shell.requestFullscreen) await shell.requestFullscreen();
    } catch (_) { /* The comparison remains available when full screen is unavailable. */ }
  });
  if (!document.querySelector(".player-shell").requestFullscreen) $("fullscreen-button").hidden = true;
  document.addEventListener("fullscreenchange", () => {
    const label = document.fullscreenElement ? "Exit full screen" : "Expand video comparison";
    $("fullscreen-button").setAttribute("aria-label", label);
    $("fullscreen-button").title = label;
  });

  function synchronize() {
    // Compatibility fallback for older browsers without video-frame callbacks.
    if (!master.requestVideoFrameCallback && !state.seekController && !state.scrubbing) {
      for (const track of frameTracks) if (track.video.readyState >= 2 && !track.video.seeking) {
        captureFrame(track, Math.floor(track.video.currentTime * frameRate() + .0001));
      }
      presentPair();
    }
    if (state.playing && !state.loading && !state.scrubbing && !master.seeking && !reference.seeking) {
      const delta = reference.currentTime - master.currentTime;
      const frame = 1 / (state.sequence?.playbackFps || state.sequence?.fps || 30);
      if (Math.abs(delta) > Math.max(frame * .6, .025)) bufferPair();
      updateProgress();
    }
    requestAnimationFrame(synchronize);
  }
  requestAnimationFrame(synchronize);

  fetch("assets/media-manifest.json?v=paired-frames")
    .then((response) => { if (!response.ok) throw new Error("Manifest unavailable"); return response.json(); })
    .then((data) => {
      state.sequences = data.sequences || [];
      renderFigures(data.figures || []);
      if (!state.sequences.length) throw new Error("No video sequences");
      renderSequences();
      const initialSequence = state.sequences.find((sequence) => sequence.id === "uvg") || state.sequences[0];
      const initialMethod = initialSequence.methods.find((method) => method.id === "yoda") || initialSequence.methods[0];
      loadPair(initialSequence, initialMethod);
    })
    .catch(() => showError("The comparison assets could not be loaded. Please reload the page."));
})();

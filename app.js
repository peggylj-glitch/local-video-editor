const state = {
  media: [],
  mediaDirectory: "",
  clips: [],
  selectedIndex: 0,
  outputName: "local_editor_export.mp4",
  playing: false,
  playIndex: 0,
  playStopIndex: null,
  previewMode: "timeline",
  selectedMediaName: null,
  draggedIndex: null,
};

const mediaList = document.querySelector("#mediaList");
const timeline = document.querySelector("#timeline");
const selectedClip = document.querySelector("#selectedClip");
const timelineMeta = document.querySelector("#timelineMeta");
const preview = document.querySelector("#preview");
const playhead = document.querySelector("#playhead");
const folderStatus = document.querySelector("#folderStatus");
const chooseSourceMenu = document.querySelector("#chooseSourceMenu");
const chooseSourceVideos = document.querySelector("#chooseSourceVideos");
const timelineButtons = {
  playWhole: document.querySelector("#playWholeTimeline"),
  previewSource: document.querySelector("#previewSelectedSource"),
  playClip: document.querySelector("#playSelectedClip"),
};

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const mins = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function mediaByName(name) {
  return state.media.find((item) => item.name === name);
}

function clipIndexForMediaName(name) {
  if (!name) return -1;
  const selectedClip = state.clips[state.selectedIndex];
  if (selectedClip?.filename === name) return state.selectedIndex;
  return state.clips.findIndex((clip) => clip.filename === name);
}

function isMediaInTimeline(name) {
  return state.clips.some((clip) => clip.filename === name);
}

function previewObjectPosition(framing = "center") {
  return {
    left: "35% center",
    right: "65% center",
    top: "center 35%",
    bottom: "center 65%",
    center: "center center",
  }[framing] || "center center";
}

function totalDuration() {
  return state.clips.reduce((sum, clip) => sum + Number(clip.duration || 0), 0);
}

function clipOffset(index) {
  return state.clips.slice(0, index).reduce((sum, clip) => sum + Number(clip.duration || 0), 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function filenameOrder(filename) {
  const match = String(filename || "").match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function filenameSeed(filename) {
  const order = filenameOrder(filename);
  if (Number.isFinite(order)) return order;
  return String(filename || "")
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function recommendedClipTiming(media) {
  const sourceDuration = Number(media?.duration || 0);
  if (!sourceDuration) return { start: 0, duration: 8 };

  if (sourceDuration <= 7) {
    return { start: 0, duration: Number(Math.max(0.25, sourceDuration - 0.2).toFixed(1)) };
  }

  const seed = filenameSeed(media.name);
  const variation = (seed % 7) / 6;
  const durationRatio = sourceDuration > 70 ? 0.16 : sourceDuration > 35 ? 0.24 : 0.42;
  const targetDuration = clamp(sourceDuration * durationRatio + variation * 4, 7, sourceDuration > 70 ? 20 : 15);
  const maxStart = Math.max(0, sourceDuration - targetDuration - 0.5);

  let startRatio;
  if (sourceDuration > 70) startRatio = 0.18 + variation * 0.45;
  else if (sourceDuration > 35) startRatio = 0.14 + variation * 0.36;
  else startRatio = 0.08 + variation * 0.22;

  const start = clamp(sourceDuration * startRatio, sourceDuration > 25 ? 2 : 0.5, maxStart);
  return {
    start: Number(start.toFixed(1)),
    duration: Number(Math.min(targetDuration, sourceDuration - start).toFixed(1)),
  };
}

function probeVideoDuration(url) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      video.removeAttribute("src");
      video.load();
      resolve(duration);
    };
    video.onerror = () => resolve(0);
  });
}

async function mediaWithDuration(media) {
  if (Number(media?.duration || 0) > 0) return media;
  const duration = await probeVideoDuration(media.url);
  if (duration > 0) {
    media.duration = duration;
    renderMedia();
  }
  return media;
}

function clipStoryScore(clip) {
  const duration = Number(clip.duration || 0);
  if (duration <= 6) return 0;
  if (duration <= 10) return 1;
  if (duration <= 15) return 2;
  return 3;
}

function clipEnergyScore(clip) {
  return Number(clip.duration || 0) + Number(clip.start || 0) * 0.08;
}

function autoArrangeTimeline() {
  if (state.clips.length < 2) return;
  const selectedClip = state.clips[state.selectedIndex];
  const ordered = state.clips
    .map((clip, index) => ({ clip, index }))
    .sort((a, b) => filenameOrder(a.clip.filename) - filenameOrder(b.clip.filename) || a.index - b.index);

  if (ordered.length < 4) {
    state.clips = ordered.map((item) => item.clip);
  } else {
    const introCount = Math.max(1, Math.round(ordered.length * 0.25));
    const endingCount = Math.max(1, Math.round(ordered.length * 0.15));
    const intro = ordered.slice(0, introCount);
    const rest = ordered.slice(introCount);
    const ending = rest
      .slice()
      .sort((a, b) => clipEnergyScore(a.clip) - clipEnergyScore(b.clip) || b.index - a.index)
      .slice(0, endingCount);
    const endingSet = new Set(ending);
    const middle = rest.filter((item) => !endingSet.has(item));
    const peak = middle
      .slice()
      .sort((a, b) => clipEnergyScore(b.clip) - clipEnergyScore(a.clip) || a.index - b.index)
      .slice(0, 1);
    const peakSet = new Set(peak);
    const build = middle.filter((item) => !peakSet.has(item));
    const peakIndex = Math.max(0, Math.floor(build.length * 0.65));
    state.clips = [
      ...intro,
      ...build.slice(0, peakIndex),
      ...peak,
      ...build.slice(peakIndex),
      ...ending,
    ].map((item) => item.clip);
  }

  state.selectedIndex = Math.max(0, state.clips.indexOf(selectedClip));
  renderAll();
  cueSelectedClip();
}

async function loadMedia() {
  setFolderStatus("Scanning current source...");
  mediaList.innerHTML = "<p>Scanning videos...</p>";
  const response = await fetch(`/api/media?t=${Date.now()}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || "Could not refresh videos");
  state.media = payload.videos || [];
  state.mediaDirectory = payload.directory || "";
  setFolderStatus(`Loaded ${state.media.length} source videos from ${state.mediaDirectory}`);
  renderMedia();
  renderAll();
}

async function clearSource() {
  setFolderStatus("Clearing current source...");
  mediaList.innerHTML = "<p>Clearing source videos...</p>";
  const response = await fetch("/api/clear-source", { method: "POST" });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || "Could not clear source");
  state.media = payload.videos || [];
  state.mediaDirectory = payload.directory || "";
  state.selectedMediaName = null;
  preview.pause();
  preview.removeAttribute("src");
  setFolderStatus("Source cleared. Choose Source to load new videos.");
  renderMedia();
  renderAll();
}

async function importSelectedVideos(files, label = "selection") {
  const videos = Array.from(files).filter((file) => /\.(mov|mp4)$/i.test(file.name));
  if (!videos.length) {
    setFolderStatus("No .MOV or .MP4 files found in the selected videos.", true);
    return;
  }

  mediaList.innerHTML = `<p>Importing ${label}...</p>`;
  for (let index = 0; index < videos.length; index += 1) {
    const file = videos[index];
    setFolderStatus(`Importing ${index + 1}/${videos.length}: ${file.name}`);
    const response = await fetch(`/api/import-video?filename=${encodeURIComponent(file.name)}`, {
      method: "PUT",
      body: file,
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || `Could not import ${file.name}`);
    state.mediaDirectory = payload.directory || state.mediaDirectory;
  }

  setFolderStatus(`Added ${videos.length} videos from ${label}. Scanning durations...`);
  await loadMedia();
}

function setFolderStatus(message, isError = false) {
  folderStatus.textContent = message;
  folderStatus.classList.toggle("error", isError);
}

function renderMedia() {
  if (!state.media.length) {
    mediaList.innerHTML = "<p>No .MOV or .MP4 files found in this folder.</p>";
    return;
  }
  mediaList.innerHTML = "";
  state.media.forEach((item) => {
    const node = document.createElement("article");
    const alreadyAdded = isMediaInTimeline(item.name);
    node.className = `media-item${item.name === state.selectedMediaName ? " selected" : ""}${alreadyAdded ? " in-timeline" : ""}`;
    node.innerHTML = `
      <strong>${item.name}</strong>
      <span>${formatTime(item.duration)} · ${(item.size / 1024 / 1024).toFixed(1)} MB</span>
      <div class="media-actions">
        <button data-action="preview">Preview</button>
        <button data-action="add" ${alreadyAdded ? "disabled" : ""}>${alreadyAdded ? "Added" : "Add to timeline"}</button>
      </div>
    `;
    node.querySelector('[data-action="preview"]').addEventListener("click", (event) => {
      event.stopPropagation();
      previewSource(item, true);
    });
    node.querySelector('[data-action="add"]').addEventListener("click", async (event) => {
      event.stopPropagation();
      if (alreadyAdded) return;
      const readyItem = await mediaWithDuration(item);
      const recommendation = recommendedClipTiming(readyItem);
      state.clips.push({
        filename: readyItem.name,
        start: recommendation.start,
        duration: recommendation.duration,
        volume: 0.94,
        framing: "center",
      });
      state.selectedIndex = state.clips.length - 1;
      state.previewMode = "timeline";
      renderMedia();
      renderAll();
      cueSelectedClip();
    });
    node.addEventListener("click", () => {
      previewSource(item, true);
    });
    mediaList.appendChild(node);
  });
}

function removeTimelineClip(index) {
  if (index < 0 || index >= state.clips.length) return;
  const wasSelected = index === state.selectedIndex;
  state.clips.splice(index, 1);
  if (index < state.selectedIndex) state.selectedIndex -= 1;
  state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, state.clips.length - 1));
  renderMedia();
  renderAll();
  if (state.clips.length && wasSelected) cueSelectedClip();
  else if (!state.clips.length) stopTimeline();
}

function renderTimeline() {
  timeline.innerHTML = "";
  timeline.classList.toggle("empty", !state.clips.length);
  timelineMeta.textContent = `${state.clips.length} clips · ${formatTime(totalDuration())}`;

  if (!state.clips.length) {
    timeline.textContent = "Add clips from the video list.";
    return;
  }

  state.clips.forEach((clip, index) => {
    const card = document.createElement("article");
    card.className = `clip-card${index === state.selectedIndex ? " selected" : ""}`;
    card.draggable = true;
    card.style.setProperty("--clip-width", `${Math.max(104, Math.min(340, clip.duration * 8))}px`);
    card.innerHTML = `
      <button class="clip-remove" data-action="remove" title="Remove this clip" aria-label="Remove this clip">×</button>
      <strong>${index + 1}. ${clip.filename}</strong>
      <span>${formatTime(clip.start)} + ${formatTime(clip.duration)}</span>
      <span>Timeline ${formatTime(clipOffset(index))}</span>
    `;
    const removeButton = card.querySelector('[data-action="remove"]');
    removeButton.addEventListener("pointerdown", (event) => event.stopPropagation());
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeTimelineClip(index);
    });
    card.addEventListener("click", () => {
      state.selectedIndex = index;
      renderAll();
      playClipAt(index, index);
    });
    card.addEventListener("dragstart", () => {
      state.draggedIndex = index;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      state.draggedIndex = null;
      card.classList.remove("dragging");
    });
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      if (state.draggedIndex === null || state.draggedIndex === index) return;
      const [moved] = state.clips.splice(state.draggedIndex, 1);
      state.clips.splice(index, 0, moved);
      state.selectedIndex = index;
      renderAll();
    });
    timeline.appendChild(card);
  });
}

function renderSelectedClip() {
  if (state.previewMode === "source" && clipIndexForMediaName(state.selectedMediaName) === -1) {
    selectedClip.className = "selected-clip empty";
    selectedClip.textContent = "This source video is not in the timeline yet. Use Add to timeline before using the timeline playback buttons.";
    return;
  }

  const clip = state.clips[state.selectedIndex];
  if (!clip) {
    selectedClip.className = "selected-clip empty";
    selectedClip.textContent = "Select a clip to adjust timing.";
    return;
  }

  selectedClip.className = "selected-clip";
  const template = document.querySelector("#clipEditorTemplate");
  const node = template.content.cloneNode(true);
  const media = mediaByName(clip.filename);
  node.querySelector('[data-field="name"]').textContent = `${state.selectedIndex + 1}. ${clip.filename}`;
  node.querySelector('[data-field="hint"]').textContent = media
    ? `Source duration ${formatTime(media.duration)}. Preview starts from this clip.`
    : "This file is not currently in the media list.";

  const startInput = node.querySelector('[data-field="start"]');
  const startRange = node.querySelector('[data-field="startRange"]');
  const durationInput = node.querySelector('[data-field="duration"]');
  const durationRange = node.querySelector('[data-field="durationRange"]');
  const framingInput = node.querySelector('[data-field="framing"]');
  const volumeInput = node.querySelector('[data-field="volume"]');
  const outputInput = node.querySelector("#outputName");

  startInput.value = clip.start;
  startRange.value = clip.start;
  startRange.max = Math.max(0, (media?.duration || clip.start + clip.duration) - 0.25);
  durationInput.value = clip.duration;
  durationRange.value = clip.duration;
  durationRange.max = Math.max(0.25, (media?.duration || clip.start + clip.duration) - clip.start);
  framingInput.value = clip.framing || "center";
  volumeInput.value = clip.volume;
  outputInput.value = state.outputName;

  const changeStart = (value, refreshEditor = false) => {
    const maxStart = Math.max(0, (media?.duration || value + clip.duration) - 0.25);
    const nextStart = Math.max(0, Math.min(maxStart, Number(value)));
    startInput.value = nextStart;
    startRange.value = nextStart;
    updateClip({ start: nextStart }, refreshEditor);
  };
  const changeDuration = (value, refreshEditor = false) => {
    const maxDuration = Math.max(0.25, (media?.duration || clip.start + Number(value)) - clip.start);
    const nextDuration = Math.max(0.25, Math.min(maxDuration, Number(value)));
    durationInput.value = nextDuration;
    durationRange.value = nextDuration;
    updateClip({ duration: nextDuration }, refreshEditor);
  };

  startInput.addEventListener("input", () => changeStart(startInput.value));
  startRange.addEventListener("input", () => changeStart(startRange.value));
  durationInput.addEventListener("input", () => changeDuration(durationInput.value));
  durationRange.addEventListener("input", () => changeDuration(durationRange.value));
  framingInput.addEventListener("input", () => updateClip({ framing: framingInput.value }));
  volumeInput.addEventListener("input", () => updateClip({ volume: Number(volumeInput.value) }));
  outputInput.addEventListener("input", () => {
    state.outputName = outputInput.value || "local_editor_export.mp4";
  });
  node.querySelector('[data-action="startMinus"]').addEventListener("click", () => changeStart(clip.start - 1, true));
  node.querySelector('[data-action="startPlus"]').addEventListener("click", () => changeStart(clip.start + 1, true));
  node.querySelector('[data-action="shorter"]').addEventListener("click", () => changeDuration(clip.duration - 1, true));
  node.querySelector('[data-action="longer"]').addEventListener("click", () => changeDuration(clip.duration + 1, true));
  node.querySelector('[data-action="finishPhrase"]').addEventListener("click", () => changeDuration(clip.duration + 2, true));
  node.querySelector('[data-action="remove"]').addEventListener("click", () => {
    removeTimelineClip(state.selectedIndex);
  });

  selectedClip.replaceChildren(node);
}

function updateClip(patch, refreshEditor = false) {
  const clip = state.clips[state.selectedIndex];
  if (!clip) return;
  Object.assign(clip, patch);
  if (clip.start < 0) clip.start = 0;
  if (clip.duration < 0.25) clip.duration = 0.25;
  if (clip.volume < 0) clip.volume = 0;
  if (!clip.framing) clip.framing = "center";
  renderTimeline();
  if (refreshEditor) renderSelectedClip();
  if (state.previewMode !== "source") cueSelectedClip(false);
}

function renderAll() {
  renderTimeline();
  renderSelectedClip();
  updatePlayhead();
  updateTransportState();
}

function updateTransportState() {
  const sourceClipIndex = clipIndexForMediaName(state.selectedMediaName);
  const hasTimeline = state.clips.length > 0;
  const hasSelectedTimelineClip = Boolean(state.clips[state.selectedIndex]) && (state.previewMode !== "source" || sourceClipIndex !== -1);
  const hasSourcePreview = Boolean(state.selectedMediaName);
  timelineButtons.playWhole.disabled = !hasTimeline;
  timelineButtons.previewSource.disabled = !hasSelectedTimelineClip && !hasSourcePreview;
  timelineButtons.playClip.disabled = !hasSelectedTimelineClip;
}

function updatePlayhead() {
  if (state.previewMode === "source") {
    const current = Number.isFinite(preview.currentTime) ? preview.currentTime : 0;
    const duration = Number.isFinite(preview.duration) ? preview.duration : mediaByName(state.selectedMediaName)?.duration || 0;
    playhead.textContent = `Source ${formatTime(current)} / ${formatTime(duration)}`;
    return;
  }

  const index = state.playing ? state.playIndex : state.selectedIndex;
  const clip = state.clips[index];
  if (!clip) {
    playhead.textContent = `${formatTime(0)} / ${formatTime(totalDuration())}`;
    return;
  }
  const elapsedInClip = Math.max(0, preview.currentTime - clip.start);
  const elapsed = clipOffset(index) + Math.min(elapsedInClip, clip.duration);
  playhead.textContent = `${formatTime(Math.min(elapsed, totalDuration()))} / ${formatTime(totalDuration())}`;
}

function previewSource(media, autoplay = false) {
  state.playing = false;
  state.previewMode = "source";
  state.selectedMediaName = media.name;
  const timelineIndex = clipIndexForMediaName(media.name);
  if (timelineIndex !== -1) state.selectedIndex = timelineIndex;
  state.playStopIndex = null;
  renderMedia();
  renderTimeline();
  if (!preview.src.endsWith(media.url)) preview.src = media.url;
  preview.style.objectPosition = "center center";
  preview.currentTime = 0;
  preview.volume = 1;
  updatePlayhead();
  renderSelectedClip();
  updateTransportState();
  if (autoplay) preview.play();
}

function previewSelectedSource() {
  if (state.previewMode === "source" && state.selectedMediaName) {
    const sourceMedia = mediaByName(state.selectedMediaName);
    if (sourceMedia) previewSource(sourceMedia, true);
    return;
  }

  const clip = state.clips[state.selectedIndex];
  if (!clip) return;
  const media = mediaByName(clip.filename);
  if (!media) return;
  previewSource(media, true);
}

function cueSelectedClip(autoplay = false, mode = "timeline") {
  const clip = state.clips[state.selectedIndex];
  if (!clip) {
    preview.removeAttribute("src");
    return;
  }
  const media = mediaByName(clip.filename);
  if (!media) return;
  state.previewMode = mode;
  state.selectedMediaName = clip.filename;
  if (!preview.src.endsWith(media.url)) preview.src = media.url;
  preview.style.objectPosition = previewObjectPosition(clip.framing);
  preview.currentTime = clip.start;
  preview.volume = Math.max(0, Math.min(1, clip.volume));
  updatePlayhead();
  if (autoplay) preview.play();
}

function playClipAt(index, stopAfterIndex = null) {
  const clip = state.clips[index];
  if (!clip) return stopTimeline();
  state.playing = true;
  state.previewMode = stopAfterIndex === index ? "clip" : "timeline";
  state.playIndex = index;
  state.playStopIndex = stopAfterIndex;
  state.selectedIndex = index;
  renderAll();
  cueSelectedClip(true, state.previewMode);
}

function stopTimeline(resetToSelected = true) {
  state.playing = false;
  state.playStopIndex = null;
  preview.pause();
  if (state.previewMode !== "source" && resetToSelected) cueSelectedClip(false);
  updatePlayhead();
}

preview.addEventListener("timeupdate", () => {
  if (state.previewMode === "source") {
    updatePlayhead();
    return;
  }

  const clip = state.clips[state.playIndex] || state.clips[state.selectedIndex];
  if (!clip) return;
  updatePlayhead();
  if (state.playing && preview.currentTime >= clip.start + clip.duration) {
    if (state.playStopIndex === state.playIndex) return stopTimeline(false);
    playClipAt(state.playIndex + 1);
  }
});

preview.addEventListener("loadedmetadata", () => {
  if (state.previewMode === "source") {
    updatePlayhead();
    return;
  }
  const clip = state.clips[state.playing ? state.playIndex : state.selectedIndex];
  if (clip && Math.abs(preview.currentTime - clip.start) > 0.25) preview.currentTime = clip.start;
});

document.querySelector("#playWholeTimeline").addEventListener("click", () => playClipAt(0));
document.querySelector("#previewSelectedSource").addEventListener("click", previewSelectedSource);
document.querySelector("#playSelectedClip").addEventListener("click", () => playClipAt(state.selectedIndex || 0, state.selectedIndex || 0));
document.querySelector("#stopTimeline").addEventListener("click", () => stopTimeline());
document.querySelector("#clearSource").addEventListener("click", () => {
  clearSource().catch((error) => {
    setFolderStatus(error.message, true);
    mediaList.textContent = "Current source could not be cleared.";
  });
});
chooseSourceMenu.addEventListener("click", () => {
  chooseSourceVideos.click();
});
chooseSourceVideos.addEventListener("change", (event) => {
  importSelectedVideos(event.target.files, "selected videos").catch((error) => {
    setFolderStatus(error.message, true);
    mediaList.textContent = "Videos could not be imported.";
  });
  event.target.value = "";
});
document.querySelector("#autoArrangeTimeline").addEventListener("click", autoArrangeTimeline);

document.querySelector("#clearTimeline").addEventListener("click", () => {
  state.clips = [];
  state.selectedIndex = 0;
  renderMedia();
  renderAll();
  stopTimeline();
});

document.querySelector("#saveProject").addEventListener("click", () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          outputName: state.outputName,
          clips: state.clips,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "video-timeline.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

document.querySelector("#loadProject").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const project = JSON.parse(await file.text());
  state.clips = Array.isArray(project.clips) ? project.clips : [];
  state.outputName = project.outputName || "local_editor_export.mp4";
  state.selectedIndex = 0;
  renderMedia();
  renderAll();
  cueSelectedClip();
});

document.querySelector("#exportVideo").addEventListener("click", async () => {
  const button = document.querySelector("#exportVideo");
  button.disabled = true;
  button.textContent = "Exporting...";
  try {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outputName: state.outputName, clips: state.clips }),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || "Export failed");
    alert(`Exported ${result.output} (${formatTime(result.duration)})`);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Export MP4";
  }
});

loadMedia().catch((error) => {
  mediaList.textContent = error.message;
});

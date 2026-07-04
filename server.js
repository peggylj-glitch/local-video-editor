const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1";
const FFMPEG = path.join(ROOT, "build/python_pkgs/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1");
const FALLBACK_FFMPEG = "ffmpeg";
const W = 1080;
const H = 1920;
const FPS = 30;
const IMPORT_DIR = path.join(ROOT, "build", "imported_media");
let mediaDir = ROOT;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".MOV": "video/quicktime",
};

function ffmpegPath() {
  return fs.existsSync(FFMPEG) ? FFMPEG : FALLBACK_FFMPEG;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { "Content-Type": MIME[".json"] });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000_000) req.destroy(new Error("Request body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function writeRequestToFile(req, filePath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    req.pipe(out);
    req.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
  });
}

function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { cwd: ROOT });
    let output = "";
    proc.stdout.on("data", (chunk) => (output += chunk.toString()));
    proc.stderr.on("data", (chunk) => (output += chunk.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output || `ffmpeg exited ${code}`));
    });
  });
}

async function probeDuration(file) {
  try {
    const output = await run(["-hide_banner", "-i", file]);
    const match = output.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  } catch (error) {
    const match = String(error.message).match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }
}

async function listMedia() {
  const entries = await fs.promises.readdir(mediaDir);
  const videos = entries
    .filter((name) => /\.(mov|mp4)$/i.test(name))
    .filter((name) => !name.startsWith("Enno_Cheng_concert_diary"))
    .filter((name) => !name.endsWith("_export.mp4"))
    .sort();

  const result = [];
  for (const name of videos) {
    const fullPath = path.join(mediaDir, name);
    const stat = await fs.promises.stat(fullPath);
    result.push({
      name,
      size: stat.size,
      duration: await probeDuration(fullPath),
      url: `/media/${encodeURIComponent(name)}`,
    });
  }
  return {
    directory: mediaDir,
    videos: result,
  };
}

function safeMediaPath(name) {
  const base = path.basename(name);
  if (!/\.(mov|mp4)$/i.test(base)) return null;
  const fullPath = path.join(mediaDir, base);
  if (!fs.existsSync(fullPath)) return null;
  return fullPath;
}

function normalizeDirectoryInput(rawDirectory) {
  let input = String(rawDirectory || "").trim();
  if (!input) return ROOT;

  input = input.replace(/^['"]|['"]$/g, "");
  input = input.replace(/\\ /g, " ");

  if (input.startsWith("file://")) {
    input = decodeURIComponent(new URL(input).pathname);
  }

  if (input === "~" || input.startsWith("~/")) {
    input = path.join(os.homedir(), input.slice(2));
  }

  return path.resolve(input);
}

async function setMediaDir(rawDirectory) {
  const nextDir = normalizeDirectoryInput(rawDirectory);
  const stat = await fs.promises.stat(nextDir);
  if (!stat.isDirectory()) throw new Error(`Not a folder: ${nextDir}`);
  mediaDir = nextDir;
  return listMedia();
}

async function importVideo(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const filename = path.basename(url.searchParams.get("filename") || "");
  if (!/\.(mov|mp4)$/i.test(filename)) throw new Error(`Unsupported video file: ${filename}`);

  await fs.promises.mkdir(IMPORT_DIR, { recursive: true });
  await writeRequestToFile(req, path.join(IMPORT_DIR, filename));
  mediaDir = IMPORT_DIR;
  return {
    imported: filename,
    directory: mediaDir,
  };
}

async function clearSource() {
  await fs.promises.rm(IMPORT_DIR, { recursive: true, force: true });
  await fs.promises.mkdir(IMPORT_DIR, { recursive: true });
  mediaDir = IMPORT_DIR;
  return listMedia();
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const fullPath = path.resolve(PUBLIC, `.${requested}`);
  if (!fullPath.startsWith(PUBLIC)) return send(res, 403, "Forbidden");
  fs.readFile(fullPath, (error, data) => {
    if (error) return send(res, 404, "Not found");
    send(res, 200, data, {
      "Content-Type": MIME[path.extname(fullPath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
  });
}

function serveMedia(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const mediaPath = safeMediaPath(decodeURIComponent(url.pathname.replace("/media/", "")));
  if (!mediaPath) return send(res, 404, "Media not found");

  const stat = fs.statSync(mediaPath);
  const range = req.headers.range;
  const contentType = MIME[path.extname(mediaPath)] || "application/octet-stream";

  if (!range) {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(mediaPath).pipe(res);
    return;
  }

  const [startText, endText] = range.replace(/bytes=/, "").split("-");
  const start = Number(startText);
  const end = endText ? Number(endText) : stat.size - 1;
  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Content-Type": contentType,
  });
  fs.createReadStream(mediaPath, { start, end }).pipe(res);
}

function normalizeClip(raw) {
  const filename = path.basename(String(raw.filename || ""));
  const start = Math.max(0, Number(raw.start || 0));
  const duration = Math.max(0.25, Number(raw.duration || 5));
  const volume = Math.max(0, Math.min(2, Number(raw.volume ?? 0.94)));
  if (!safeMediaPath(filename)) throw new Error(`Missing media: ${filename}`);
  return { filename, start, duration, volume };
}

async function exportTimeline(rawProject) {
  const clips = (rawProject.clips || []).map(normalizeClip);
  if (!clips.length) throw new Error("Add at least one clip before exporting.");

  const outName = String(rawProject.outputName || "local_editor_export.mp4").replace(/[^\w.-]+/g, "_");
  const finalPath = path.join(ROOT, outName.endsWith(".mp4") ? outName : `${outName}.mp4`);
  const segmentDir = path.join(ROOT, "build", "local_editor_segments");
  await fs.promises.mkdir(segmentDir, { recursive: true });

  const segmentPaths = [];
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    const segmentPath = path.join(segmentDir, `${String(index + 1).padStart(3, "0")}_${path.parse(clip.filename).name}.mp4`);
    const fadeOutStart = Math.max(0, clip.duration - 0.22);
    await run([
      "-hide_banner",
      "-y",
      "-ss",
      String(clip.start),
      "-t",
      String(clip.duration),
      "-i",
      safeMediaPath(clip.filename),
      "-ignore_unknown",
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-map_metadata",
      "-1",
      "-vf",
      `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p`,
      "-af",
      `volume=${clip.volume},afade=t=in:st=0:d=0.12,afade=t=out:st=${fadeOutStart}:d=0.22`,
      "-r",
      String(FPS),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-shortest",
      "-movflags",
      "+faststart",
      segmentPath,
    ]);
    segmentPaths.push(segmentPath);
  }

  const concatPath = path.join(segmentDir, "concat.txt");
  await fs.promises.writeFile(concatPath, segmentPaths.map((item) => `file '${item}'\n`).join(""));
  await run(["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", "-movflags", "+faststart", finalPath]);

  return {
    output: path.basename(finalPath),
    path: finalPath,
    duration: clips.reduce((sum, clip) => sum + clip.duration, 0),
  };
}

async function handle(req, res) {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/media/")) return serveMedia(req, res);
    if (url.pathname === "/api/import-video" && req.method === "PUT") {
      return sendJson(res, 200, await importVideo(req));
    }
    if (url.pathname === "/api/clear-source" && req.method === "POST") {
      return sendJson(res, 200, await clearSource());
    }
    if (url.pathname === "/api/media") return sendJson(res, 200, await listMedia());
    if (url.pathname === "/api/media-dir" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req));
      return sendJson(res, 200, await setMediaDir(payload.directory));
    }
    if (url.pathname === "/api/export" && req.method === "POST") {
      const project = JSON.parse(await readBody(req));
      return sendJson(res, 200, await exportTimeline(project));
    }
    return serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

http.createServer(handle).listen(PORT, HOST, () => {
  console.log(`Local video editor: http://${HOST}:${PORT}`);
  console.log(`Workspace: ${ROOT}`);
});

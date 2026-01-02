console.log("Internet Condom");

let faceMatcher = null;
let modelsLoaded = false;
let scannedImages = new Set();
let blockedImageUrls = new Map();
let pendingScans = new Map();
let blockWomen = true;

// Parallel processing config
const MAX_CONCURRENT_SCANS = 4;
let activeScans = 0;

// Detect page type
function getPageType() {
  const path = window.location.pathname;
  if (path === "/home" || path === "/") return "timeline";
  if (path.match(/^\/[^/]+$/) && !path.includes("/status/")) return "profile";
  if (path.includes("/status/")) return "tweet";
  return "other";
}

// Load face-api models
async function loadModels() {
  if (modelsLoaded) return true;
  const MODEL_URL = chrome.runtime.getURL("models");
  console.log("Loading face-api models...");
  try {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
    console.log("✅ Models loaded!");
    return true;
  } catch (e) {
    console.error("❌ Failed to load models:", e);
    return false;
  }
}

// Fetch image via background script (cached)
const imageCache = new Map();
async function fetchImageAsDataUrl(url) {
  if (imageCache.has(url)) return imageCache.get(url);

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url }, (response) => {
      const dataUrl = response?.dataUrl || null;
      if (dataUrl) imageCache.set(url, dataUrl);
      resolve(dataUrl);
    });
  });
}

// Load image element
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Initialize
loadModels().then(() => {
  chrome.storage.local.get(["savedFaces", "blockWomen"], (result) => {
    if (result.blockWomen !== undefined) blockWomen = result.blockWomen;
    console.log(`👩 Block women: ${blockWomen ? "ON" : "OFF"}`);

    if (result.savedFaces?.length > 0) {
      faceMatcher = new faceapi.FaceMatcher(
        result.savedFaces.map(
          (f) =>
            new faceapi.LabeledFaceDescriptors(
              f.label,
              f.descriptors.map((d) => new Float32Array(d))
            )
        ),
        0.6
      );
      console.log(`✅ Loaded ${result.savedFaces.length} blocked face(s)`);
    }
    console.log(`📍 Page: ${getPageType()}`);
    startObserving();
  });
});

// Message handler
chrome.runtime.onMessage.addListener((msg, _, reply) => {
  if (msg.type === "BLOCK_FACE" && msg.src) {
    handleBlockFace(msg.src, msg.originalSrc);
    reply({ ok: true });
    return true;
  }

  if (msg.type === "REFRESH_SETTINGS") {
    chrome.storage.local.get(["savedFaces", "blockWomen"], (result) => {
      if (result.blockWomen !== undefined) blockWomen = result.blockWomen;
      console.log(`🔄 Settings refreshed: blockWomen=${blockWomen}`);

      if (result.savedFaces?.length > 0) {
        faceMatcher = new faceapi.FaceMatcher(
          result.savedFaces.map(
            (f) =>
              new faceapi.LabeledFaceDescriptors(
                f.label,
                f.descriptors.map((d) => new Float32Array(d))
              )
          ),
          0.6
        );
      } else {
        faceMatcher = null;
      }

      // Clear and rescan
      scannedImages = new Set();
      blockedImageUrls = new Map();
      imageCache.clear();

      document.querySelectorAll(".blocked-image-wrapper").forEach((wrapper) => {
        const img = wrapper.querySelector("img");
        if (img) {
          img.style.filter = "";
          img.dataset.hasOverlay = "";
          wrapper.parentNode.insertBefore(img, wrapper);
          wrapper.remove();
        }
      });

      scanAllVisible();
    });
    reply({ ok: true });
    return true;
  }
});

async function handleBlockFace(src, originalSrc) {
  if (!modelsLoaded) await loadModels();
  console.log("Blocking face from:", originalSrc || src);

  try {
    const img = await loadImage(src);
    const detection = await faceapi
      .detectSingleFace(img)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (detection) {
      console.log("✅ Face detected! Saving...");

      const box = detection.detection.box;
      const padding = 40;
      const x = Math.max(0, box.x - padding);
      const y = Math.max(0, box.y - padding);
      const width = Math.min(img.width - x, box.width + padding * 2);
      const height = Math.min(img.height - y, box.height + padding * 2);

      const canvas = document.createElement("canvas");
      canvas.width = 80;
      canvas.height = 80;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, x, y, width, height, 0, 0, 80, 80);
      const thumbnail = canvas.toDataURL("image/jpeg", 0.7);

      const data = await chrome.storage.local.get(["savedFaces"]);
      const savedFaces = data.savedFaces || [];
      savedFaces.push({
        label: `blocked_${Date.now()}`,
        descriptors: [Array.from(detection.descriptor)],
        thumbnail,
      });
      await chrome.storage.local.set({ savedFaces });

      faceMatcher = new faceapi.FaceMatcher(
        savedFaces.map(
          (f) =>
            new faceapi.LabeledFaceDescriptors(
              f.label,
              f.descriptors.map((d) => new Float32Array(d))
            )
        ),
        0.6
      );

      console.log("✅ Face blocked! Rescanning...");
      scannedImages = new Set();
      blockedImageUrls = new Map();
      imageCache.clear();
      scanAllVisible();
    } else {
      console.log("❌ No face detected");
    }
  } catch (e) {
    console.log("❌ Error:", e.message);
  }
}

// Add overlay
function addOverlay(imgElement, reason, emoji = "🚫") {
  if (imgElement.dataset.hasOverlay) return;
  imgElement.dataset.hasOverlay = "true";

  const imgUrl = imgElement.src.split("?")[0];
  blockedImageUrls.set(imgUrl, { reason, emoji });

  console.log(`${emoji} ${reason}`);

  imgElement.style.filter = "blur(25px)";

  const wrapper = document.createElement("div");
  wrapper.className = "blocked-image-wrapper";
  wrapper.style.cssText = `
    position: relative;
    display: inline-block;
    width: ${imgElement.width}px;
    height: ${imgElement.height}px;
    overflow: hidden;
  `;
  imgElement.parentNode.insertBefore(wrapper, imgElement);
  wrapper.appendChild(imgElement);

  const overlay = document.createElement("div");
  overlay.className = "blocked-overlay";
  overlay.dataset.revealed = "false";
  overlay.style.cssText = `
    position: absolute;
    top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.95);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 100;
    cursor: pointer;
    transition: opacity 0.2s;
  `;

  overlay.innerHTML = `
    <div style="text-align: center;">
      <div style="font-size: 48px; margin-bottom: 10px;">${emoji}</div>
      <div style="color: white; font-size: 16px; font-weight: bold;">${reason}</div>
      <div style="color: #888; font-size: 12px; margin-top: 5px;">Click to reveal/hide</div>
    </div>
  `;

  overlay.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const isRevealed = overlay.dataset.revealed === "true";
    if (isRevealed) {
      imgElement.style.filter = "blur(25px)";
      overlay.style.opacity = "1";
      overlay.dataset.revealed = "false";
    } else {
      imgElement.style.filter = "none";
      overlay.style.opacity = "0";
      overlay.dataset.revealed = "true";
    }
  };

  wrapper.appendChild(overlay);
}

// Scan a single image (runs in parallel)
async function scanImage(img) {
  const imgUrl = img.src.split("?")[0];

  if (
    img.dataset.hasOverlay ||
    scannedImages.has(imgUrl) ||
    pendingScans.has(imgUrl)
  ) {
    return;
  }

  // Check if already blocked
  if (blockedImageUrls.has(imgUrl)) {
    const { reason, emoji } = blockedImageUrls.get(imgUrl);
    addOverlay(img, reason, emoji);
    return;
  }

  scannedImages.add(imgUrl);
  pendingScans.set(imgUrl, true);
  activeScans++;

  try {
    const dataUrl = await fetchImageAsDataUrl(img.src);
    if (!dataUrl || img.dataset.hasOverlay) {
      return;
    }

    const loadedImg = await loadImage(dataUrl);

    // Single detection call for both gender and descriptors
    const detections = await faceapi
      .detectAllFaces(loadedImg)
      .withFaceLandmarks()
      .withFaceDescriptors()
      .withAgeAndGender();

    if (detections.length === 0) return;

    let shouldBlock = false;
    let blockReason = "";
    let blockEmoji = "🚫";

    for (const detection of detections) {
      // Check gender - aggressive threshold (45%) to catch edge cases
      if (
        blockWomen &&
        detection.gender === "female" &&
        detection.genderProbability > 0.45
      ) {
        console.log(
          `👩 Female detected (${(detection.genderProbability * 100).toFixed(
            0
          )}%)`
        );
        shouldBlock = true;
        blockReason = "Foid Detected";
        blockEmoji = "👩";
        break;
      }

      // Check blocked faces
      if (faceMatcher && detection.descriptor) {
        const match = faceMatcher.findBestMatch(detection.descriptor);
        if (match.label !== "unknown" && match.distance < 0.6) {
          shouldBlock = true;
          blockReason = "Blocked Face Detected";
          blockEmoji = "🚫";
          break;
        }
      }
    }

    if (shouldBlock && !img.dataset.hasOverlay) {
      addOverlay(img, blockReason, blockEmoji);
    }
  } catch (e) {
    // Silent fail
  } finally {
    pendingScans.delete(imgUrl);
    activeScans--;
    processNextBatch();
  }
}

// Process images in batches
let imageQueue = [];

function processNextBatch() {
  while (activeScans < MAX_CONCURRENT_SCANS && imageQueue.length > 0) {
    const img = imageQueue.shift();
    if (img && img.isConnected && !img.dataset.hasOverlay) {
      scanImage(img);
    }
  }
}

function queueImage(img) {
  const imgUrl = img.src.split("?")[0];
  if (
    img.dataset.hasOverlay ||
    scannedImages.has(imgUrl) ||
    pendingScans.has(imgUrl)
  ) {
    // Re-apply overlay if needed
    if (blockedImageUrls.has(imgUrl) && !img.dataset.hasOverlay) {
      const { reason, emoji } = blockedImageUrls.get(imgUrl);
      addOverlay(img, reason, emoji);
    }
    return;
  }

  if (!imageQueue.includes(img)) {
    imageQueue.push(img);
  }
  processNextBatch();
}

// Scan all visible images
function scanAllVisible() {
  const images = document.querySelectorAll('img[src*="twimg.com"]');
  for (const img of images) {
    if (img.width < 50 || img.height < 50) continue;
    queueImage(img);
  }
}

// Intersection Observer - detect images BEFORE they're visible
let imageObserver;

function startObserving() {
  // Observe images with 1500px margin (preload ahead of scroll)
  imageObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const img = entry.target;
          queueImage(img);
        }
      }
    },
    {
      rootMargin: "1500px 0px", // Preload 1500px ahead
      threshold: 0,
    }
  );

  // Observe existing images
  observeAllImages();

  // Watch for new images
  const mutationObserver = new MutationObserver(() => {
    observeAllImages();
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
}

function observeAllImages() {
  const images = document.querySelectorAll('img[src*="twimg.com"]');
  for (const img of images) {
    if (img.width < 50 || img.height < 50) continue;
    if (!img.dataset.observed) {
      img.dataset.observed = "true";
      imageObserver.observe(img);
    }
  }
}

// Initial scan after short delay
setTimeout(scanAllVisible, 500);

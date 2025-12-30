console.log("Internet Condom X: Face Blocker Active");

let faceMatcher = null;
let modelsLoaded = false;
let scannedImages = new Set(); // URLs we've analyzed
let blockedImageUrls = new Map(); // URL -> {reason, emoji} for re-applying on scroll
let scanQueue = [];
let isScanning = false;

// Settings
let blockWomen = true;

// Detect what page we're on
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
    console.log("✅ Models loaded (including gender detection)!");
    return true;
  } catch (e) {
    console.error("❌ Failed to load models:", e);
    return false;
  }
}

// Request image from background script
function fetchImageAsDataUrl(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url }, (response) => {
      resolve(response?.dataUrl || null);
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
    if (result.blockWomen !== undefined) {
      blockWomen = result.blockWomen;
    }
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
    queueVisibleImages();
  });
});

// Handle messages from background
chrome.runtime.onMessage.addListener((msg, _, reply) => {
  if (msg.type === "BLOCK_FACE" && msg.src) {
    handleBlockFace(msg.src, msg.originalSrc);
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
      const data = await chrome.storage.local.get(["savedFaces"]);
      const savedFaces = data.savedFaces || [];
      savedFaces.push({
        label: `blocked_${Date.now()}`,
        descriptors: [Array.from(detection.descriptor)],
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
      queueVisibleImages();
    } else {
      console.log("❌ No face detected");
    }
  } catch (e) {
    console.log("❌ Error:", e.message);
  }
}

// Add overlay on the image with toggle support
function addOverlay(imgElement, reason, emoji = "🚫") {
  if (imgElement.dataset.hasOverlay) return;
  imgElement.dataset.hasOverlay = "true";

  // Store for re-applying on scroll
  const imgUrl = imgElement.src.split("?")[0];
  blockedImageUrls.set(imgUrl, { reason, emoji });

  console.log(`${emoji} ${reason}`);

  // Blur the image
  imgElement.style.filter = "blur(25px)";

  // Create wrapper
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

  // Full overlay covering the image
  const overlay = document.createElement("div");
  overlay.className = "blocked-overlay";
  overlay.dataset.revealed = "false";
  overlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
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
    <div class="overlay-content">
      <div style="font-size: 48px; margin-bottom: 10px;">${emoji}</div>
      <div style="color: white; font-size: 16px; font-weight: bold;">${reason}</div>
      <div style="color: #888; font-size: 12px; margin-top: 5px;">Click to reveal/hide</div>
    </div>
  `;

  // Toggle on click
  overlay.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();

    const isRevealed = overlay.dataset.revealed === "true";

    if (isRevealed) {
      // Hide again (re-blur)
      imgElement.style.filter = "blur(25px)";
      overlay.style.opacity = "1";
      overlay.dataset.revealed = "false";
    } else {
      // Reveal
      imgElement.style.filter = "none";
      overlay.style.opacity = "0";
      overlay.dataset.revealed = "true";
    }
  };

  wrapper.appendChild(overlay);
}

// Queue images for scanning
function queueVisibleImages() {
  const images = document.querySelectorAll('img[src*="twimg.com"]');

  for (const img of images) {
    if (img.width < 80 || img.height < 80) continue;
    if (img.dataset.hasOverlay) continue;

    const imgUrl = img.src.split("?")[0];

    // Re-apply overlay if this URL was previously blocked (handles scroll back up)
    if (blockedImageUrls.has(imgUrl)) {
      const { reason, emoji } = blockedImageUrls.get(imgUrl);
      addOverlay(img, reason, emoji);
      continue;
    }

    // Skip if already scanned
    if (scannedImages.has(imgUrl)) continue;

    scannedImages.add(imgUrl);
    scanQueue.push(img);
  }

  processQueue();
}

// Process scan queue one at a time
async function processQueue() {
  if (isScanning || scanQueue.length === 0) return;
  isScanning = true;

  const img = scanQueue.shift();

  if (img && img.src && !img.dataset.hasOverlay) {
    try {
      const dataUrl = await fetchImageAsDataUrl(img.src);
      if (dataUrl) {
        const loadedImg = await loadImage(dataUrl);

        const detection = await faceapi
          .detectSingleFace(loadedImg)
          .withFaceLandmarks()
          .withFaceDescriptor()
          .withAgeAndGender();

        if (detection) {
          const { gender, genderProbability } = detection;
          console.log(
            `🔍 Face detected: ${gender} (${(genderProbability * 100).toFixed(
              0
            )}% confident)`
          );

          // Check for blocked face match
          if (faceMatcher) {
            const match = faceMatcher.findBestMatch(detection.descriptor);
            if (match.label !== "unknown" && match.distance < 0.6) {
              console.log(`🚨 BLOCKED FACE MATCH!`);
              addOverlay(img, "Blocked Face Detected", "🚫");
              isScanning = false;
              if (scanQueue.length > 0) setTimeout(processQueue, 100);
              return;
            }
          }

          // Check for female
          if (blockWomen && gender === "female" && genderProbability > 0.7) {
            console.log(
              `👩 Foid detected (${(genderProbability * 100).toFixed(0)}%)`
            );
            addOverlay(img, "Foid Detected", "👩");
          }
        }
      }
    } catch (e) {
      // Silent fail
    }
  }

  isScanning = false;

  if (scanQueue.length > 0) {
    setTimeout(processQueue, 100);
  }
}

// Watch for new content and scroll (debounced)
let debounceTimer;
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(queueVisibleImages, 300);
});
observer.observe(document.body, { childList: true, subtree: true });

// Also check on scroll for images that reappear
let scrollTimer;
window.addEventListener(
  "scroll",
  () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(queueVisibleImages, 200);
  },
  { passive: true }
);

// Initial scan
setTimeout(queueVisibleImages, 1000);

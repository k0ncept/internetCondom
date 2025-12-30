// popup.js — Manage blocked faces and settings

const blockedList = document.getElementById("blocked-list");
const blockedCount = document.getElementById("blocked-count");
const toggleWomen = document.getElementById("toggle-women");
const clearAllBtn = document.getElementById("clear-all");

// Load settings and blocked faces on popup open
async function loadData() {
  const data = await chrome.storage.local.get(["savedFaces", "blockWomen"]);

  // Load toggle state
  const blockWomen = data.blockWomen !== undefined ? data.blockWomen : true;
  toggleWomen.classList.toggle("active", blockWomen);

  // Load blocked faces
  const savedFaces = data.savedFaces || [];
  renderBlockedFaces(savedFaces);
}

// Render the list of blocked faces
function renderBlockedFaces(faces) {
  blockedCount.textContent = faces.length;

  if (faces.length === 0) {
    blockedList.innerHTML = `
      <div class="empty-state">
        No blocked faces yet.<br>
        Right-click an image on X to block a face.
      </div>
    `;
    return;
  }

  blockedList.innerHTML = faces
    .map((face, index) => {
      // Extract timestamp from label
      const timestamp = face.label.replace("blocked_", "");
      const date = new Date(parseInt(timestamp));
      const dateStr = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      // Show thumbnail if available
      const thumbnailHtml = face.thumbnail
        ? `<img src="${face.thumbnail}" class="face-thumb" alt="Face">`
        : `<div class="face-thumb no-thumb">🚫</div>`;

      return `
        <div class="blocked-item" data-index="${index}">
          <div class="blocked-info">
            ${thumbnailHtml}
            <div>
              <div class="blocked-label">Face #${index + 1}</div>
              <div class="blocked-date">${dateStr}</div>
            </div>
          </div>
          <button class="remove-btn" data-index="${index}">Remove</button>
        </div>
      `;
    })
    .join("");

  // Add click handlers for remove buttons
  blockedList.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const index = parseInt(e.target.dataset.index);
      await removeFace(index);
    });
  });
}

// Remove a single blocked face
async function removeFace(index) {
  const data = await chrome.storage.local.get(["savedFaces"]);
  const savedFaces = data.savedFaces || [];

  if (index >= 0 && index < savedFaces.length) {
    savedFaces.splice(index, 1);
    await chrome.storage.local.set({ savedFaces });
    renderBlockedFaces(savedFaces);

    // Notify content script to refresh
    notifyContentScript();
  }
}

// Clear all blocked faces
async function clearAllFaces() {
  if (confirm("Remove all blocked faces? This cannot be undone.")) {
    await chrome.storage.local.set({ savedFaces: [] });
    renderBlockedFaces([]);
    notifyContentScript();
  }
}

// Toggle block women setting
async function toggleBlockWomen() {
  const data = await chrome.storage.local.get(["blockWomen"]);
  const newValue = !(data.blockWomen !== undefined ? data.blockWomen : true);
  await chrome.storage.local.set({ blockWomen: newValue });
  toggleWomen.classList.toggle("active", newValue);
  notifyContentScript();
}

// Notify content script to refresh
function notifyContentScript() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "REFRESH_SETTINGS" });
    }
  });
}

// Event listeners
toggleWomen.addEventListener("click", toggleBlockWomen);
clearAllBtn.addEventListener("click", clearAllFaces);

// Drag and drop (for future use)
const drop = document.getElementById("drop");
if (drop) {
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
  });

  ["dragover", "dragenter"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("dragover");
    })
  );

  ["dragleave", "dragend"].forEach((ev) =>
    drop.addEventListener(ev, () => drop.classList.remove("dragover"))
  );
}

// Initialize
loadData();

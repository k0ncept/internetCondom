chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "blockFace",
    title: "Block this face forever",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "blockFace" && info.srcUrl) {
    try {
      // Fetch the image as a blob (bypasses CORS)
      const response = await fetch(info.srcUrl);
      const blob = await response.blob();

      // Convert blob to base64 data URL
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        console.log("Image fetched and converted to data URL");
        chrome.tabs.sendMessage(tab.id, {
          type: "BLOCK_FACE",
          src: dataUrl,
          originalSrc: info.srcUrl,
        });
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.error("Failed to fetch image:", e);
      // Fallback to original URL
      chrome.tabs.sendMessage(tab.id, {
        type: "BLOCK_FACE",
        src: info.srcUrl,
      });
    }
  }
});

// Handle image fetch requests from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_IMAGE" && msg.url) {
    fetchImageAsDataUrl(msg.url).then(sendResponse);
    return true; // Keep channel open for async response
  }
});

async function fetchImageAsDataUrl(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({ dataUrl: reader.result });
      };
      reader.onerror = () => {
        resolve({ dataUrl: null });
      };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Failed to fetch image:", url, e);
    return { dataUrl: null };
  }
}

// popup.js — FINAL: grabs the REAL image URL from X, not dataURL
const drop = document.getElementById('drop');
const previews = document.getElementById('previews');

drop.addEventListener('drop', e => {
  e.preventDefault();
  drop.classList.remove('dragover');

  // Just show preview from file
  for (const file of e.dataTransfer.files) {
    if (!file.type.startsWith('image/')) continue;
    const url = URL.createObjectURL(file);
    previews.innerHTML += `<img src="${url}" style="max-height:90px;margin:8px;border-radius:8px;">`;
  }

  // Tell content script: "block the image under the mouse"
  chrome.tabs.query({active: true, currentWindow: true}, tabs => {
    chrome.tabs.sendMessage(tabs[0].id, {type: 'BLOCK_CURRENT_IMAGE'});
  });
});

['dragover','dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dragover'); }));
['dragleave','dragend'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('dragover')));
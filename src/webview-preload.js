// 포트폴리오 페이지 안에서의 마우스 위치를 앱(캐릭터)으로 전달한다
const { ipcRenderer } = require('electron');

// (requestAnimationFrame은 웹뷰가 가려졌다고 판단되면 멈추므로, 시간 간격으로 보낼 양을 줄인다)
let lastSent = 0;
let trailing = null;
window.addEventListener('mousemove', e => {
  const x = e.clientX, y = e.clientY;
  const now = Date.now();
  clearTimeout(trailing);
  if (now - lastSent >= 16) {
    lastSent = now;
    ipcRenderer.sendToHost('mouse', x, y);
  } else {
    trailing = setTimeout(() => { lastSent = Date.now(); ipcRenderer.sendToHost('mouse', x, y); }, 16);
  }
}, { passive: true, capture: true });

window.addEventListener('keydown', e => {
  // 페이지에 포커스가 있어도 단축키가 동작하도록 앱으로 전달
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
  if (['F1', 'F2', 'F3', 'F4', 'Escape'].includes(e.key)) {
    e.preventDefault();
    ipcRenderer.sendToHost('key', e.key);
  }
});

// 👆 설명 모드: 마우스를 올린 부분을 점선으로 표시하고, 클릭하면 그 부분의 글을 앱으로 보낸다
let explainMode = false;
let hovered = null;
ipcRenderer.on('explain-mode', (_e, on) => {
  explainMode = on;
  document.documentElement.style.cursor = on ? 'help' : '';
  if (!on) unmark();
});

function blockOf(el) {
  // 너무 짧은 글자(단어 하나)가 아니라, 의미 있는 덩어리(카드·문단)를 고른다
  let cur = el;
  while (cur && cur !== document.body) {
    const len = (cur.innerText || '').trim().length;
    if (len >= 30 || cur.tagName === 'IMG') break;
    cur = cur.parentElement;
  }
  if (cur && (cur.innerText || '').trim().length > 1500) return el;
  return cur && cur !== document.body ? cur : el;
}
function unmark() {
  if (hovered) { hovered.style.outline = hovered.dataset.lingOutline || ''; hovered = null; }
}
window.addEventListener('mouseover', e => {
  if (!explainMode) return;
  const b = blockOf(e.target);
  if (b === hovered) return;
  unmark();
  hovered = b;
  b.dataset.lingOutline = b.style.outline;
  b.style.outline = '2px dashed #c9a25e';
}, true);
window.addEventListener('click', e => {
  if (!explainMode) return;
  e.preventDefault();
  e.stopPropagation();
  const b = blockOf(e.target);
  const text = b.tagName === 'IMG' ? (b.alt || '이미지') : (b.innerText || '').trim().slice(0, 1200);
  ipcRenderer.sendToHost('explain', text, e.clientX, e.clientY);
}, true);

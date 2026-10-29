// 포트폴리오 사이트를 숨은 창으로 열어 페이지별 본문 텍스트를 수집한다.
// (사이트가 클라이언트에서 렌더링되므로 HTML만 받아서는 내용이 보이지 않는다)
const { BrowserWindow } = require('electron');

const MAX_PAGES = 40;
const MAX_CHARS_PER_PAGE = 5000;
const EXCLUDE = /^\/(admin|api|login)(\/|$)/;

const EXTRACT_JS = `(() => {
  const root = document.querySelector('main') || document.body;
  const text = (root.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
  const links = [...document.querySelectorAll('a[href]')].map(a => a.href);
  return { title: document.title, text, links };
})()`;

async function extractStable(win) {
  // 로딩 문구가 사라지고 텍스트 길이가 안정될 때까지 기다린다 (최대 12초)
  let last = null, stableCount = 0, result = null;
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 500));
    result = await win.webContents.executeJavaScript(EXTRACT_JS);
    const loading = /불러오는 중|로딩|Loading/i.test(result.text) && result.text.length < 200;
    if (!loading && result.text.length === last) {
      if (++stableCount >= 2) break;
    } else stableCount = 0;
    last = result.text.length;
  }
  return result;
}

async function crawlSite(startUrl, onProgress = () => {}) {
  const origin = new URL(startUrl).origin;
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: false } });
  win.webContents.setAudioMuted(true);
  const queue = [new URL(startUrl).pathname || '/'];
  const seen = new Set(queue);
  const pages = [];
  try {
    while (queue.length && pages.length < MAX_PAGES) {
      const path = queue.shift();
      onProgress({ done: pages.length, current: path });
      try {
        await win.loadURL(origin + path);
      } catch {
        continue; // 일부 페이지 로드 실패는 건너뛴다
      }
      const { title, text, links } = await extractStable(win);
      // 삭제된 과제처럼 '찾을 수 없음' 페이지는 내용에 넣지 않는다
      const notFound = text.length < 120 && /찾을 수 없|not found|404/i.test(text);
      if (text && !notFound) pages.push({ path, title, text: text.slice(0, MAX_CHARS_PER_PAGE) });
      for (const href of links) {
        let u;
        try { u = new URL(href); } catch { continue; }
        if (u.origin !== origin) continue;
        const p = u.pathname.replace(/\/$/, '') || '/';
        if (EXCLUDE.test(p) || /\.(pdf|png|jpe?g|gif|mp4|zip)$/i.test(p) || seen.has(p)) continue;
        seen.add(p);
        queue.push(p);
      }
    }
  } finally {
    win.destroy();
  }
  onProgress({ done: pages.length, current: null });
  return pages;
}

module.exports = { crawlSite };

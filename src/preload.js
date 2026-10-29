const { contextBridge, ipcRenderer } = require('electron');

// IPC 오류는 Electron이 "Error invoking remote method ..." 접두어를 붙이므로 본문만 남긴다
async function invoke(channel, payload) {
  try {
    return await ipcRenderer.invoke(channel, payload);
  } catch (e) {
    throw new Error(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

contextBridge.exposeInMainWorld('api', {
  getConfig: () => invoke('config:get'),
  saveConfig: patch => invoke('config:save', patch),
  webviewPreloadUrl: () => invoke('paths:webviewPreload'),
  getKnowledge: refresh => invoke('site:knowledge', { refresh }),
  onSiteProgress: cb => ipcRenderer.on('site:progress', (_e, p) => cb(p)),
  getScript: () => invoke('script:get'),
  saveScript: segments => invoke('script:save', segments),
  testAi: () => invoke('ai:test'),
  generateIntro: pages => invoke('ai:intro', { pages }),
  answer: payload => invoke('ai:answer', payload),
  tts: text => invoke('ai:tts', { text }),
  getFaq: () => invoke('faq:get'),
  saveFaq: faq => invoke('faq:save', faq),
  elevenVoices: () => invoke('eleven:voices'),
  elevenSubscription: () => invoke('eleven:subscription'),
  ttsCached: text => invoke('ai:ttsCached', { text })
});

/* Ogechina — Quran PWA (script.js)
   - Uses Al-Quran Cloud API for text/translations/audio metadata
   - Multiple reciters (API reciter ids)
   - Caches surah JSON to localStorage for offline reading
   - Bookmarks stored in localStorage
   - Ready for wrapping with Capacitor to build APK/IPA
*/

const API_BASE = 'https://api.alquran.cloud/v1';
const reciters = [
  { id: 'ar.alafasy', name: 'Mishary Alafasy' },
  { id: 'ar.abdulbasitmurattal', name: 'Abdul Basit (Murattal)' },
  { id: 'ar.minshawi', name: 'Mohamed Minshawi' },
  { id: 'ar.husary', name: 'Mahmoud Al-Husary' },
  { id: 'ar.sudais', name: 'Abdurrahman As-Sudais' }
];

const dom = {
  surahList: document.getElementById('surahList'),
  surahTitle: document.getElementById('surahTitle'),
  verses: document.getElementById('verses'),
  reciterSelect: document.getElementById('reciterSelect'),
  search: document.getElementById('search'),
  bookmarks: document.getElementById('bookmarks'),
  clearBookmarks: document.getElementById('clearBookmarks'),
  exportBookmarks: document.getElementById('exportBookmarks'),
  clearCache: document.getElementById('clearCache'),
  installBtn: document.getElementById('installBtn'),
  playPause: document.getElementById('playPause'),
  prevAyah: document.getElementById('prevAyah'),
  nextAyah: document.getElementById('nextAyah'),
  seek: document.getElementById('seek')
};

let state = {
  surahs: [],
  currentSurah: null,
  currentAyahIndex: 0,
  audio: new Audio(),
  currentReciter: reciters[0].id,
  currentAudioList: [],
  playing: false,
  deferredPrompt: null
};

document.addEventListener('DOMContentLoaded', init);

async function init(){
  // setup reciters
  reciters.forEach(r => {
    const opt = document.createElement('option'); opt.value = r.id; opt.textContent = r.name;
    dom.reciterSelect.appendChild(opt);
  });
  dom.reciterSelect.value = state.currentReciter;
  dom.reciterSelect.addEventListener('change', (e)=> { state.currentReciter = e.target.value; stopAudio(); });

  dom.search.addEventListener('input', e => search(e.target.value.trim()));
  dom.clearBookmarks.addEventListener('click', ()=>{ localStorage.removeItem('og_bookmarks'); renderBookmarks(); });
  dom.exportBookmarks.addEventListener('click', exportBookmarks);
  dom.clearCache.addEventListener('click', clearAllCaches);

  dom.playPause.addEventListener('click', togglePlay);
  dom.prevAyah.addEventListener('click', playPrev);
  dom.nextAyah.addEventListener('click', playNext);
  dom.seek.addEventListener('input', onSeek);

  state.audio.addEventListener('timeupdate', ()=> { if(state.audio.duration) dom.seek.value = (state.audio.currentTime/state.audio.duration)*100; });
  state.audio.addEventListener('ended', ()=> playNext());

  // PWA install prompt
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.deferredPrompt = e; dom.installBtn.hidden=false; });
  dom.installBtn.addEventListener('click', async ()=> {
    if(state.deferredPrompt){ state.deferredPrompt.prompt(); const choice = await state.deferredPrompt.userChoice; state.deferredPrompt = null; dom.installBtn.hidden = true; }
  });

  renderBookmarks();
  await loadSurahList();
}

async function loadSurahList(){
  dom.surahList.innerHTML = 'Loading…';
  try {
    const r = await fetch(`${API_BASE}/surah`);
    const j = await r.json();
    state.surahs = j.data;
    renderSurahList();
  } catch (e){
    dom.surahList.innerHTML = 'Unable to load surah list. Check network.';
  }
}

function renderSurahList(){
  dom.surahList.innerHTML = '';
  state.surahs.forEach(s => {
    const item = document.createElement('div'); item.className = 'surah-item';
    item.innerHTML = `<div><strong>${s.number}.</strong> ${s.englishName}</div><div class="meta">${s.ayahs} ayahs</div>`;
    item.addEventListener('click', ()=> openSurah(s.number));
    dom.surahList.appendChild(item);
  });
}

async function openSurah(number){
  dom.verses.innerHTML = 'Loading…';
  dom.surahTitle.textContent = 'جارٍ التحميل — Loading…';
  const cacheKey = `og_surah_${number}_v1`;
  let surahObj = null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if(raw) surahObj = JSON.parse(raw);
  } catch(e){ surahObj = null; }

  if(!surahObj){
    try {
      const [arabicRes, transRes] = await Promise.all([
        fetch(`${API_BASE}/surah/${number}/quran-uthmani`),
        fetch(`${API_BASE}/surah/${number}/en.saheeh`)
      ]);
      const [arabicJson, transJson] = await Promise.all([arabicRes.json(), transRes.json()]);
      const surah = arabicJson.data;
      const translation = transJson.data;
      const ayahs = surah.ayahs.map((a, idx) => ({
        numberInSurah: a.numberInSurah,
        text: a.text,
        translation: (translation.ayahs[idx] && translation.ayahs[idx].text) || ''
      }));
      surahObj = { number: surah.number, name: surah.name, englishName: surah.englishName, ayahs };
      try { localStorage.setItem(cacheKey, JSON.stringify(surahObj)); } catch(e){}
    } catch(err){
      dom.verses.innerHTML = 'Failed to load surah. Possibly offline.';
      dom.surahTitle.textContent = 'خطأ — Error';
      return;
    }
  }

  state.currentSurah = surahObj;
  state.currentAyahIndex = 0;
  renderSurah(surahObj);
  warmRecitationAudio(number, state.currentReciter);
}

function renderSurah(s){
  dom.surahTitle.textContent = `${s.number}. ${s.name} — ${s.englishName}`;
  dom.verses.innerHTML = '';
  s.ayahs.forEach((a, idx) => {
    const v = document.createElement('div'); v.className = 'verse';
    v.innerHTML = `
      <div class="text">
        <div class="arabic">${a.text}</div>
        <div class="translation">${a.numberInSurah}. ${a.translation}</div>
      </div>
      <div class="ayah-actions">
        <button class="btn small play" data-idx="${idx}">▶</button>
        <button class="bookmark-btn" data-book="${s.number}:${a.numberInSurah}">🔖</button>
      </div>
    `;
    dom.verses.appendChild(v);
  });

  dom.verses.querySelectorAll('.play').forEach(btn => btn.addEventListener('click', e => playAyah(Number(e.target.dataset.idx))));
  dom.verses.querySelectorAll('.bookmark-btn').forEach(b => b.addEventListener('click', e => { addBookmark(e.target.dataset.book); }));
}

/* audio list via API */
async function warmRecitationAudio(surahNumber, reciterId){
  try {
    const res = await fetch(`${API_BASE}/surah/${surahNumber}/${reciterId}`);
    const j = await res.json();
    state.currentAudioList = j.data.ayahs.map(a => a.audio);
    state.currentAudioList.reciter = reciterId; state.currentAudioList.surah = surahNumber;
    // optional: pre-cache first ayah audio
    if('caches' in window && state.currentAudioList[0]) caches.open('og-audio-cache-v1').then(c=>c.add(state.currentAudioList[0]).catch(()=>{}));
  } catch(e){
    state.currentAudioList = [];
  }
}

async function playAyah(index){
  if(!state.currentSurah) return;
  const sn = state.currentSurah.number;
  if(!state.currentAudioList.length || state.currentAudioList.surah !== sn || state.currentAudioList.reciter !== state.currentReciter){
    await warmRecitationAudio(sn, state.currentReciter);
  }
  const url = state.currentAudioList[index];
  if(!url){
    alert('Audio not available for this reciter/surah via API.');
    return;
  }
  playUrl(url);
  state.currentAyahIndex = index;
  highlightAyah();
}

function playUrl(url){ state.audio.src = url; state.audio.play().catch(()=>alert('Audio playback blocked by browser policy.')); state.playing = true; dom.playPause.textContent = '⏸'; }
function togglePlay(){ if(state.playing){ state.audio.pause(); state.playing=false; dom.playPause.textContent='▶'; } else { if(state.audio.src) { state.audio.play(); state.playing=true; dom.playPause.textContent='⏸'; } else playAyah(state.currentAyahIndex || 0); } }
function playNext(){ if(state.currentAyahIndex < state.currentSurah.ayahs.length-1) playAyah(state.currentAyahIndex+1); else alert('End of surah'); }
function playPrev(){ if(state.currentAyahIndex > 0) playAyah(state.currentAyahIndex-1); }
function onSeek(e){ if(state.audio.duration) state.audio.currentTime = (e.target.value/100)*state.audio.duration; }
function highlightAyah(){ const nodes = dom.verses.querySelectorAll('.verse'); nodes.forEach((n,i)=> n.style.boxShadow = (i===state.currentAyahIndex) ? '0 10px 30px rgba(23,165,137,0.12)' : ''); }

/* Search */
function search(q){
  if(!q){ if(state.currentSurah) renderSurah(state.currentSurah); return; }
  q = q.toLowerCase();
  if(state.currentSurah){
    const matches = state.currentSurah.ayahs.filter(a => a.text.includes(q) || (a.translation && a.translation.toLowerCase().includes(q)));
    dom.verses.innerHTML = matches.map(a => `<div class="verse"><div class="text"><div class="arabic">${a.text}</div><div class="translation">${a.numberInSurah}. ${a.translation}</div></div></div>`).join('');
  } else {
    Array.from(dom.surahList.children).forEach((el, idx) => {
      const s = state.surahs[idx];
      if(!s) return;
      const ok = s.englishName.toLowerCase().includes(q) || (s.name && s.name.includes(q));
      el.style.display = ok ? '' : 'none';
    });
  }
}

/* Bookmarks */
const BK = 'og_bookmarks';
function renderBookmarks(){ const arr = JSON.parse(localStorage.getItem(BK) || '[]'); dom.bookmarks.innerHTML = arr.length ? arr.map(t=>`<li><button class="btn small" data-nav="${t}">${t}</button></li>`).join('') : '<li class="muted">No bookmarks</li>'; dom.bookmarks.querySelectorAll('button[data-nav]').forEach(b=> b.addEventListener('click', async e=>{ const [s,a] = e.target.dataset.nav.split(':').map(Number); await openSurah(s); const node = dom.verses.children[a-1]; if(node) node.scrollIntoView({behavior:'smooth', block:'center'}); })); }
function addBookmark(tag){ const arr = JSON.parse(localStorage.getItem(BK) || '[]'); if(!arr.includes(tag)) arr.push(tag); localStorage.setItem(BK, JSON.stringify(arr)); renderBookmarks(); }
function exportBookmarks(){ const arr = JSON.parse(localStorage.getItem(BK) || '[]'); const blob = new Blob([JSON.stringify(arr, null, 2)], {type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'bookmarks.json'; a.click(); URL.revokeObjectURL(url); }

/* Cache utilities */
async function clearAllCaches(){ if('caches' in window){ const keys = await caches.keys(); for(const k of keys) await caches.delete(k); localStorage.clear(); alert('Cache & localStorage cleared'); location.reload(); } else alert('Cache API not supported'); }
function stopAudio(){ state.audio.pause(); state.audio.src=''; state.playing=false; dom.playPause.textContent='▶'; }

window.addEventListener('beforeunload', e => { if(state.playing){ e.preventDefault(); e.returnValue = ''; } });

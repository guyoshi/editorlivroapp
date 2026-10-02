// ================= Leitor de Livros =================
// App leve, sem framework, pra todos os livros (um ou vários). Puxa texto
// (.md) e áudio (.mp3) dos capítulos de arquivos estáticos deste mesmo site.
// Guarda progresso de leitura e áudio no localStorage do aparelho.

const FONT_KEY = "jesed:readerFontScale";
const FONT_FAMILY_KEY = "jesed:readerFontFamily";
const HIDE_ART_KEY = "jesed:hideChapterArt";
const THEME_KEY = "jesed:theme";
const AUTO_AMBIENT_KEY = "jesed:autoAmbient";
const READER_ID_KEY = "jesed:readerId";

// Progresso precisa pertencer ao perfil, não ao aparelho. O readerId é
// único mesmo quando duas pessoas escolhem exatamente o mesmo nome.
// Admin sem perfil de leitor usa um namespace próprio.
function progressOwner(){
  const readerId = String(localStorage.getItem(READER_ID_KEY) || "").trim();
  if(readerId) return "reader:" + readerId;
  if(window.Comments?.isAdmin?.()) return "admin";
  return "guest";
}
const POS_KEY = (bookId, n) => `jesed:pos:${progressOwner()}:${bookId}:${n}`;
const LASTCH_KEY = (bookId) => `jesed:last:${progressOwner()}:${bookId}`;
const DONE_KEY = (bookId, n) => `jesed:done:${progressOwner()}:${bookId}:${n}`;

function resolve(path){
  return "./" + path;
}

// Aplica o tema salvo (ou o padrão, Âmbar Noturno) o quanto antes, pra
// evitar flash da cor errada.
const savedTheme = localStorage.getItem(THEME_KEY);
document.documentElement.dataset.theme = savedTheme || "ambar";
document.documentElement.dataset.readerFont = localStorage.getItem(FONT_FAMILY_KEY) || "lora";

// Imagens (capas e artes de capítulo) vêm referenciadas direto do site
// Dimensões Infinitas — se atualizar lá, atualiza aqui também, sem duplicar.
const ART_BASE = "https://guyoshi.github.io/dimensoesinfinitassite/assets/books/ciclo-de-jesed/";
function coverUrl(bookId){ return ART_BASE + bookId + "/cover.webp"; }
function chapterArtUrl(bookId, n){ return ART_BASE + bookId + "/chapters/chapter-" + String(n).padStart(2,"0") + ".webp"; }

const state = { books: [], currentBook: null, currentChapterIdx: -1, ambientSrc: null };

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const views = { library: $("#view-library"), book: $("#view-book"), reader: $("#view-reader") };
function showView(name){
  Object.entries(views).forEach(([k,el]) => el.hidden = k!==name);
  window.BetaAnalytics?.setView?.(name);
  window.scrollTo(0,0);
}

// ---------------- Biblioteca ----------------
let allBooksCache = null;
async function loadLibrary(){
  const listEl = $("#bookList");
  if(!allBooksCache){
    try{
      const res = await fetch(resolve("data/books.json"), {cache:"no-cache"});
      const data = await res.json();
      allBooksCache = data.books || [];
    }catch(e){
      listEl.innerHTML = `<p class="empty-hint">Não consegui carregar a biblioteca. Tente novamente em breve.</p>`;
      return;
    }
  }

  // Controle de acesso: o primeiro livro é escolhido no cadastro; os demais
  // são liberados individualmente pelo admin. Admin vê tudo.
  let allowed = null;
  try{ allowed = await window.Comments?.getAllowedBooks?.() ?? null; }catch(e){ allowed = []; }
  state.books = (allowed===null) ? allBooksCache.slice() : allBooksCache.filter(b=>allowed.includes(b.id));

  if(!state.books.length){
    const hasReaderProfile = !!window.Comments?.getUserName?.();
    listEl.innerHTML = allowed===null
      ? `<p class="empty-hint">Nenhum livro cadastrado ainda.</p>`
      : hasReaderProfile
        ? `<p class="empty-hint">Seu perfil ainda não tem livros disponíveis.</p>`
        : `<p class="empty-hint">Crie seu perfil abaixo e escolha qual livro quer começar lendo.</p>`;
    return;
  }
  listEl.innerHTML = state.books.map(b => `
    <button class="book-card" data-book="${b.id}">
      <div class="book-cover">
        <span class="book-cover-fallback">${(b.title||"?").slice(0,1)}</span>
        <img src="${coverUrl(b.id)}" alt="" loading="lazy" onerror="this.remove()">
      </div>
      <div class="book-info">
        <h3>${b.title}</h3>
        <p>${b.subtitle||""}</p>
      </div>
    </button>
  `).join("");
  $$(".book-card", listEl).forEach(card=>{
    card.addEventListener("click", ()=> openBook(card.dataset.book));
  });
}

// ---------------- Livro / capítulos ----------------
async function openBook(bookId){
  const meta = state.books.find(b=>b.id===bookId);
  if(!meta) return;
  const res = await fetch(resolve(meta.manifest), {cache:"no-cache"});
  const manifest = await res.json();
  state.currentBook = { ...meta, chapters: manifest.chapters || [] };
  const localCompleted = state.currentBook.chapters
    .filter(ch=>isChapterDone(state.currentBook.id,ch.n))
    .map(ch=>Number(ch.n));
  window.BetaAnalytics?.syncBook?.(state.currentBook,localCompleted);

  renderBookView();
  showView("book");
  checkAudioAvailability(); // não bloqueia a tela — só liga os pontinhos que existirem
}

// Redesenha a tela do livro (título, % do livro, lista de capítulos com
// marcas de concluído). Reutilizável: chamada ao abrir o livro e de novo
// ao voltar da leitura, pra refletir capítulos recém-concluídos.
function renderBookView(){
  const book = state.currentBook;
  if(!book) return;
  const meta = state.books.find(b=>b.id===book.id) || book;

  $("#bookTitle").textContent = meta.title;
  $("#bookSubtitle").textContent = meta.subtitle || "";
  const coverImg = $("#bookCoverImg");
  if(coverImg){
    coverImg.hidden = true;
    coverImg.onload = () => { coverImg.hidden = false; };
    coverImg.onerror = () => { coverImg.hidden = true; };
    coverImg.src = coverUrl(book.id);
  }

  const lastCh = Number(localStorage.getItem(LASTCH_KEY(book.id)) || -1);
  const prog = bookProgress(book);
  const progLine = prog.total ? `${prog.done}/${prog.total} capítulos lidos · ${prog.pct}% do livro` : "";
  $("#bookProgress").textContent = progLine;

  const listEl = $("#chapterList");
  listEl.innerHTML = book.chapters.map((c, i) => {
    const pos = readPos(book.id, c.n);
    const isLast = i===lastCh;
    const done = isChapterDone(book.id, c.n);
    let statusTxt = "";
    if(done) statusTxt = "concluído";
    else if(pos) statusTxt = "continuar · "+fmtTime(pos.t||0);
    else if(isLast) statusTxt = "última lida";
    return `
      <div class="chapter-row${done ? " chapter-done" : ""}" data-idx="${i}">
        <div class="chapter-num">${done ? checkIconSvg() : c.n}</div>
        <div class="chapter-info">
          <h4>${c.title}</h4>
          <span>${statusTxt}</span>
        </div>
        <div class="chapter-audio-dot" data-idx="${i}" hidden title="Tem áudio"></div>
      </div>`;
  }).join("");
  $$(".chapter-row", listEl).forEach(row=>{
    row.addEventListener("click", ()=> openChapter(Number(row.dataset.idx)));
  });
}
function checkIconSvg(){
  return `<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M9 16.2l-3.5-3.5L4 14.2 9 19.2 20 8.2l-1.4-1.4z"/></svg>`;
}

// Verifica em segundo plano quais capítulos já têm áudio enviado (alguns
// livros vão ganhando narração aos poucos) e acende o indicador só neles.
async function checkAudioAvailability(){
  const book = state.currentBook;
  if(!book) return;
  book.chapters.forEach(async (c, i) => {
    if(!c.audio) return;
    try{
      const res = await fetch(resolve(c.audio), {method:"HEAD", cache:"no-cache"});
      if(res.ok){
        const dot = document.querySelector(`.chapter-audio-dot[data-idx="${i}"]`);
        if(dot) dot.hidden = false;
      }
    }catch(e){ /* ainda não subiu — tudo bem */ }
  });
}

// ---------------- Leitura ----------------
async function openChapter(idx){
  const book = state.currentBook;
  const ch = book.chapters[idx];
  if(!ch) return;
  audioEl().pause();
  window.BetaAnalytics?.closeChapter?.();
  state.currentChapterIdx = idx;
  localStorage.setItem(LASTCH_KEY(book.id), String(idx));
  window.BetaAnalytics?.openChapter?.(book,ch);
  if(isChapterDone(book.id,ch.n)) window.BetaAnalytics?.progress?.(100);

  $("#readerChapter").textContent = `Cap. ${ch.n} · ${ch.title}`;
  $("#chapterText").innerHTML = `<p class="empty-hint">Carregando…</p>`;
  const art = $("#chapterArt");
  art.hidden = true;
  if(localStorage.getItem(HIDE_ART_KEY) === "1"){
    art.removeAttribute("src");
  }else{
    art.onerror = () => { art.hidden = true; };
    art.onload = () => { art.hidden = false; };
    art.src = chapterArtUrl(book.id, ch.n);
  }
  showView("reader");
  exitFocus();
  updateNextChapterUI();
  updateCompleteUI();
  resetReaderProgress();
  updateAmbientForChapter(ch);

  // texto
  try{
    const res = await fetch(resolve(ch.text), {cache:"no-cache"});
    const raw = await res.text();
    renderChapterText(ch, raw);
    Comments.attachChapter(book.id, ch.n, $("#chapterText"), $("#chapterNotes"));
  }catch(e){
    $("#chapterText").innerHTML = `<p class="empty-hint">Não consegui carregar o texto deste capítulo.</p>`;
  }

  // áudio
  const player = $("#audioEl");
  const bar = $("#playerBar");
  bar.classList.remove("player-missing");
  if(ch.audio){
    bar.hidden = false;
    views.reader.classList.add("has-narration");
    player.src = resolve(ch.audio);
    const saved = readPos(book.id, ch.n);
    player.addEventListener("loadedmetadata", function once(){
      if(saved && saved.t && saved.t < player.duration - 5){
        player.currentTime = saved.t;
      }
      updateTimes();
      player.removeEventListener("loadedmetadata", once);
    });
    player.addEventListener("error", function onErr(){
      // áudio deste capítulo ainda não foi enviado — some com a barra em
      // vez de deixar um player quebrado na tela
      bar.hidden = true;
      views.reader.classList.remove("has-narration");
      player.removeEventListener("error", onErr);
    }, {once:true});
    setMediaSession(book, ch);
  }else{
    bar.hidden = true;
    views.reader.classList.remove("has-narration");
    player.removeAttribute("src");
  }
}

function renderChapterText(ch, raw){
  const paras = raw.replace(/\r\n/g,"\n").trim().split(/\n{2,}/).filter(Boolean);
  const html = [`<p class="cap-title">${ch.title}</p>`]
    .concat(paras.map((p, i) => `
      <div class="para-block" data-para-idx="${i}">
        <p>${escapeHtml(p).replace(/\n/g,"<br>")}</p>
      </div>`))
    .join("");
  $("#chapterText").innerHTML = html;
}

// ---------------- navegação entre capítulos ----------------
function updateNextChapterUI(){
  const book = state.currentBook;
  const hasNext = !!(book && book.chapters[state.currentChapterIdx + 1]);
  const topBtn = $("#btnNextChapterTop");
  const endBtn = $("#btnNextChapterEnd");
  if(topBtn) topBtn.hidden = !hasNext;
  endBtn.hidden = !hasNext;
  if(hasNext){
    const next = book.chapters[state.currentChapterIdx + 1];
    $("#nextChapterLabel").textContent = `Próximo: ${next.title}`;
  }
}
function escapeHtml(s){
  return s.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
}

// ---------------- % de leitura do capítulo ----------------
function resetReaderProgress(){
  $("#readerProgressFill").style.width = "0%";
  $("#readerProgressLabel").textContent = "0%";
}
function updateReaderProgressBar(){
  const scroller = $("#readerScroll");
  const max = scroller.scrollHeight - scroller.clientHeight;
  const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((scroller.scrollTop / max) * 100))) : 100;
  $("#readerProgressFill").style.width = pct + "%";
  $("#readerProgressLabel").textContent = pct + "%";
  window.BetaAnalytics?.progress?.(pct);
  if(pct >= 96) setChapterDone(true, {silent:true});
}

// ---------------- sons de interface ----------------
// Pequenos bips sintetizados (sem precisar de arquivo de áudio) pra dar
// feedback sonoro em ações de leitura.
let uiAudioCtx = null;
function getUiAudioCtx(){
  if(!uiAudioCtx){
    try{ uiAudioCtx = new (window.AudioContext||window.webkitAudioContext)(); }
    catch(e){ return null; }
  }
  if(uiAudioCtx.state==="suspended") uiAudioCtx.resume().catch(()=>{});
  return uiAudioCtx;
}
function playTone(freqs, opts={}){
  const ctx = getUiAudioCtx();
  if(!ctx) return;
  const dur = opts.dur || 0.1, gap = opts.gap || 0.08, vol = opts.vol ?? 0.12;
  freqs.forEach((f,i)=>{
    const t0 = ctx.currentTime + i*gap;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(f, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0+0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0); osc.stop(t0+dur+0.02);
  });
}
function playNextChapterSound(){ playTone([660,880],{dur:0.08,gap:0.06,vol:0.1}); }
function playChapterCompleteSound(){ playTone([523.25,659.25,783.99],{dur:0.14,gap:0.1,vol:0.13}); }

// ---------------- conclusão de capítulo ----------------
function isChapterDone(bookId, n){
  return localStorage.getItem(DONE_KEY(bookId, n)) === "1";
}
function setChapterDone(done, opts={}){
  const book = state.currentBook;
  const ch = book && book.chapters[state.currentChapterIdx];
  if(!book || !ch) return;
  const already = isChapterDone(book.id, ch.n);
  if(already === done) { if(!opts.silent) updateCompleteUI(); return; }
  if(done) localStorage.setItem(DONE_KEY(book.id, ch.n), "1");
  else localStorage.removeItem(DONE_KEY(book.id, ch.n));
  window.BetaAnalytics?.completed?.(done);
  if(done) playChapterCompleteSound();
  updateCompleteUI();
}
function updateCompleteUI(){
  const book = state.currentBook;
  const ch = book && book.chapters[state.currentChapterIdx];
  if(!book || !ch) return;
  const done = isChapterDone(book.id, ch.n);
  const btn = $("#btnCompleteChapter");
  btn.classList.toggle("done", done);
  $("#completeBtnLabel").textContent = done ? "Capítulo concluído" : "Concluir capítulo";
  const prog = bookProgress(book);
  $("#bookProgressEnd").textContent = prog.total ? `${prog.done}/${prog.total} capítulos lidos · ${prog.pct}% do livro` : "";
}
function bookProgress(book){
  const total = book.chapters.length;
  const done = book.chapters.filter(c => isChapterDone(book.id, c.n)).length;
  const pct = total ? Math.round((done/total)*100) : 0;
  return { total, done, pct };
}

// ---------------- posição salva ----------------
function readPos(bookId, n){
  try{ return JSON.parse(localStorage.getItem(POS_KEY(bookId,n)) || "null"); }
  catch(e){ return null; }
}
function savePos(t){
  const book = state.currentBook;
  const ch = book && book.chapters[state.currentChapterIdx];
  if(!book || !ch) return;
  localStorage.setItem(POS_KEY(book.id, ch.n), JSON.stringify({t, at: Date.now()}));
}

// ---------------- player de áudio ----------------
const audioEl = () => $("#audioEl");
function fmtTime(s){
  s = Math.max(0, Math.floor(s||0));
  const m = Math.floor(s/60), r = s%60;
  return `${m}:${String(r).padStart(2,"0")}`;
}
function updateTimes(){
  const a = audioEl();
  $("#timeCurrent").textContent = fmtTime(a.currentTime);
  $("#timeTotal").textContent = fmtTime(a.duration);
  const seek = $("#seek");
  if(a.duration) seek.value = String(Math.round((a.currentTime/a.duration)*1000));
}
function setMediaSession(book, ch){
  if(!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: `Cap. ${ch.n} — ${ch.title}`,
    artist: book.title,
    album: book.subtitle || book.title,
  });
  navigator.mediaSession.setActionHandler("play", ()=> audioEl().play());
  navigator.mediaSession.setActionHandler("pause", ()=> audioEl().pause());
  navigator.mediaSession.setActionHandler("seekbackward", ()=> skip(-15));
  navigator.mediaSession.setActionHandler("seekforward", ()=> skip(15));
  navigator.mediaSession.setActionHandler("previoustrack", ()=> changeChapter(-1));
  navigator.mediaSession.setActionHandler("nexttrack", ()=> changeChapter(1));
}
function skip(sec){
  const a = audioEl();
  a.currentTime = Math.max(0, Math.min((a.duration||0), a.currentTime + sec));
}
function changeChapter(dir){
  const next = state.currentChapterIdx + dir;
  const book = state.currentBook;
  if(book && book.chapters[next]) openChapter(next);
}

const AMBIENT_NORMAL_VOLUME = 0.22;
const AMBIENT_DUCKED_VOLUME = 0.075;
const AMBIENT_DUCK_FACTOR = AMBIENT_DUCKED_VOLUME / AMBIENT_NORMAL_VOLUME;
const AMBIENT_CROSSFADE_MS = 2200;

let ambientDuckFactor = 1;
let ambientDuckTimer = null;
let ambientCrossfadeToken = 0;
let ambientActiveEl = null;
let ambientTrackKey = null;
const ambientMix = new WeakMap();

function ambientPlayers(){
  return [$("#ambientEl"),$("#ambientElAlt")].filter(Boolean);
}

function ambientResolvedSrc(src){
  if(!src)return "";
  return /^https?:\/\//i.test(src) ? src : resolve(src);
}

function ambientMixOf(el){
  return Math.max(0,Math.min(1,ambientMix.get(el) ?? 0));
}

function applyAmbientVolumes(){
  ambientPlayers().forEach(el=>{
    el.volume=Math.max(0,Math.min(1,AMBIENT_NORMAL_VOLUME * ambientDuckFactor * ambientMixOf(el)));
  });
}

function setAmbientDuck(target,ms=280){
  target=Math.max(0,Math.min(1,target));
  if(ambientDuckTimer)clearInterval(ambientDuckTimer);
  const start=ambientDuckFactor;
  const steps=10;
  let i=0;
  ambientDuckTimer=setInterval(()=>{
    i++;
    const p=i/steps;
    ambientDuckFactor=start+(target-start)*p;
    applyAmbientVolumes();
    if(i>=steps){
      clearInterval(ambientDuckTimer);
      ambientDuckTimer=null;
      ambientDuckFactor=target;
      applyAmbientVolumes();
    }
  },Math.max(16,ms/steps));
}

function syncAmbientButton(){
  const btn=$("#btnAmbient");
  if(!btn)return;
  const playing=!!ambientActiveEl && !ambientActiveEl.paused;
  btn.classList.toggle("active",playing);
  const label=playing?"Pausar música do capítulo":"Tocar música do capítulo";
  btn.setAttribute("aria-label",label);
  btn.title=label;
  btn.setAttribute("aria-pressed",String(playing));
  window.BetaAnalytics?.music?.(playing);
}

function stopAmbientElement(el,{clear=false}={}){
  if(!el)return;
  try{el.pause();}catch(e){}
  ambientMix.set(el,0);
  if(clear){
    el.removeAttribute("src");
    try{el.load();}catch(e){}
  }
  applyAmbientVolumes();
}

function crossfadeAmbient(outEl,inEl,ms=AMBIENT_CROSSFADE_MS){
  const token=++ambientCrossfadeToken;
  const outStart=outEl ? ambientMixOf(outEl) : 0;
  const inStart=inEl ? ambientMixOf(inEl) : 0;
  const started=performance.now();

  function frame(now){
    if(token!==ambientCrossfadeToken)return;
    const p=Math.min(1,(now-started)/ms);
    const smooth=p*p*(3-2*p);
    if(outEl)ambientMix.set(outEl,outStart*(1-smooth));
    if(inEl)ambientMix.set(inEl,inStart+(1-inStart)*smooth);
    applyAmbientVolumes();

    if(p<1){
      requestAnimationFrame(frame);
      return;
    }

    if(outEl && outEl!==inEl)stopAmbientElement(outEl,{clear:true});
    if(inEl)ambientMix.set(inEl,1);
    applyAmbientVolumes();
    syncAmbientButton();
  }
  requestAnimationFrame(frame);
}

function fadeOutAmbient(el,ms=1100,{clear=false}={}){
  if(!el || el.paused){
    stopAmbientElement(el,{clear});
    syncAmbientButton();
    return;
  }
  const token=++ambientCrossfadeToken;
  const startMix=ambientMixOf(el) || 1;
  const started=performance.now();

  function frame(now){
    if(token!==ambientCrossfadeToken)return;
    const p=Math.min(1,(now-started)/ms);
    const smooth=p*p*(3-2*p);
    ambientMix.set(el,startMix*(1-smooth));
    applyAmbientVolumes();

    if(p<1){
      requestAnimationFrame(frame);
      return;
    }

    stopAmbientElement(el,{clear});
    if(el===ambientActiveEl)ambientMix.set(el,1);
    syncAmbientButton();
  }
  requestAnimationFrame(frame);
}

function showHintOnce(key, title, text){
  if(localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  let el = document.getElementById("hintSheet");
  if(!el){
    el = document.createElement("div");
    el.id = "hintSheet";
    el.className = "sheet";
    el.innerHTML = '<div class="sheet-card"><h2 id="hintTitle"></h2><p class="sheet-hint" id="hintText"></p>'
      + '<div class="sheet-actions"><button id="hintOk" class="btn-primary" type="button">Entendi</button></div></div>';
    document.body.appendChild(el);
    el.querySelector("#hintOk").addEventListener("click", ()=>{ el.hidden = true; });
  }
  el.querySelector("#hintTitle").textContent = title;
  el.querySelector("#hintText").textContent = text;
  el.hidden = false;
}

function initPlayerControls(){
  const a = audioEl();
  const btnPlay = $("#btnPlay");
  const narrationStatePath = $("#narrationStatePath");
  const PLAY_PATH = "M8 5v14l11-7z";
  const PAUSE_PATH = "M6 5h4v14H6zM14 5h4v14h-4z";

  function setNarrationButtonState(playing){
    if(narrationStatePath)narrationStatePath.setAttribute("d",playing?PAUSE_PATH:PLAY_PATH);
    const label=playing?"Pausar narração":"Tocar narração";
    btnPlay.setAttribute("aria-label",label);
    btnPlay.title=label;
    btnPlay.setAttribute("aria-pressed",String(!!playing));
  }

  setNarrationButtonState(false);
  btnPlay.addEventListener("click", ()=>{
    showHintOnce("jesed:hintPlay", "Narração do capítulo", "Toque aqui pra ouvir o capítulo narrado. Dá pra pausar e continuar de onde parou a qualquer momento, inclusive em outro aparelho.");
    a.paused ? a.play() : a.pause();
  });
  a.addEventListener("play", ()=>{
    setNarrationButtonState(true);
    window.BetaAnalytics?.narration?.(true);
    setAmbientDuck(AMBIENT_DUCK_FACTOR);
  });
  a.addEventListener("pause", ()=>{
    setNarrationButtonState(false);
    window.BetaAnalytics?.narration?.(false);
    setAmbientDuck(1);
    savePos(a.currentTime);
  });
  a.addEventListener("timeupdate", ()=>{
    updateTimes();
    if(a.duration) window.BetaAnalytics?.progress?.((a.currentTime/a.duration)*100);
    if(Math.floor(a.currentTime) % 5 === 0) savePos(a.currentTime);
  });
  a.addEventListener("ended", ()=>{
    setNarrationButtonState(false);
    window.BetaAnalytics?.narration?.(false);
    window.BetaAnalytics?.progress?.(100);
    setChapterDone(true,{silent:true});
    setAmbientDuck(1);
    savePos(0);
  });

  $("#seek").addEventListener("input", (e)=>{
    if(!a.duration) return;
    a.currentTime = (Number(e.target.value)/1000) * a.duration;
  });
  $("#btnBack15").addEventListener("click", ()=> skip(-15));

  const ambientBtn=$("#btnAmbient");
  const players=ambientPlayers();
  ambientActiveEl=players[0]||null;
  players.forEach((el,i)=>{
    el.loop=true;
    ambientMix.set(el,i===0?1:0);
    el.addEventListener("play",syncAmbientButton);
    el.addEventListener("pause",syncAmbientButton);
  });
  applyAmbientVolumes();

  ambientBtn.addEventListener("click",async()=>{
    if(!state.ambientSrc || !ambientActiveEl){
      syncAmbientButton();
      return;
    }
    showHintOnce("jesed:hintAmbient", "Música do capítulo", "Liga a trilha pensada para este trecho. Ela continua entre capítulos que usam a mesma música e troca suavemente quando a trilha muda.");

    if(ambientActiveEl.paused){
      ambientCrossfadeToken++;
      ambientMix.set(ambientActiveEl,1);
      ambientDuckFactor=a.paused?1:AMBIENT_DUCK_FACTOR;
      applyAmbientVolumes();
      try{await ambientActiveEl.play();}
      catch(e){syncAmbientButton();}
    }else{
      fadeOutAmbient(ambientActiveEl,700);
    }
  });
}

async function updateAmbientForChapter(ch){
  const btn=$("#btnAmbient");
  const nextKey=ch?.ambient ? String(ch.ambient) : null;
  const autoStart=localStorage.getItem(AUTO_AMBIENT_KEY)==="1";

  if(nextKey && ambientTrackKey===nextKey && ambientActiveEl){
    state.ambientSrc=nextKey;
    btn.hidden=false;
    syncAmbientButton();
    return;
  }

  const players=ambientPlayers();
  const oldEl=ambientActiveEl;
  const oldKey=ambientTrackKey;
  const oldWasPlaying=!!oldEl && !oldEl.paused;

  if(!nextKey){
    state.ambientSrc=null;
    ambientTrackKey=null;
    btn.hidden=true;
    if(oldEl && !oldEl.paused)fadeOutAmbient(oldEl,AMBIENT_CROSSFADE_MS,{clear:true});
    else stopAmbientElement(oldEl,{clear:true});
    return;
  }

  btn.hidden=false;
  state.ambientSrc=nextKey;

  let nextEl=players.find(el=>el!==oldEl) || players[0] || null;
  if(!nextEl)return;

  ambientCrossfadeToken++;
  stopAmbientElement(nextEl,{clear:true});
  nextEl.src=ambientResolvedSrc(nextKey);
  nextEl.loop=true;
  ambientMix.set(nextEl,0);
  applyAmbientVolumes();

  const shouldPlay=oldWasPlaying || autoStart;

  if(!shouldPlay){
    if(oldEl && oldEl!==nextEl)stopAmbientElement(oldEl,{clear:true});
    ambientActiveEl=nextEl;
    ambientTrackKey=nextKey;
    ambientMix.set(nextEl,1);
    applyAmbientVolumes();
    syncAmbientButton();
    return;
  }

  try{
    await nextEl.play();
    ambientActiveEl=nextEl;
    ambientTrackKey=nextKey;
    crossfadeAmbient(oldEl,nextEl,AMBIENT_CROSSFADE_MS);
  }catch(e){
    stopAmbientElement(nextEl,{clear:true});
    ambientActiveEl=oldEl;
    ambientTrackKey=oldKey;
    state.ambientSrc=oldKey;
    syncAmbientButton();
  }
}

// ---------------- modo foco ----------------
function enterFocus(){
  document.body.classList.add("focus-mode");
  $("#focusExit").hidden = false;
}
function exitFocus(){
  document.body.classList.remove("focus-mode");
  $("#focusExit").hidden = true;
}

// ---------------- ajustes ----------------

function initReaderDisplay(){
  const btn = $("#btnReaderDisplay");
  const pop = $("#readerDisplayPop");
  if(!btn || !pop) return;
  let scale = Number(localStorage.getItem(FONT_KEY) || "1");
  if(!Number.isFinite(scale)) scale = 1;
  const applyScale = (track=false)=>{
    scale = Math.max(.8, Math.min(1.6, Math.round(scale*10)/10));
    document.documentElement.style.setProperty("--reader-font-scale", String(scale));
    localStorage.setItem(FONT_KEY, String(scale));
    $("#readerSizeLabel").textContent = Math.round(scale*100) + "%";
    if(track) window.BetaAnalytics?.preferenceChanged?.("fontScale");
  };
  applyScale(false);
  btn.addEventListener("click",()=>{
    pop.hidden = !pop.hidden;
    btn.setAttribute("aria-expanded", String(!pop.hidden));
  });
  $("#readerDisplayClose").addEventListener("click",()=>{
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  });
  pop.querySelectorAll("[data-reader-size]").forEach(b=>b.addEventListener("click",()=>{
    scale += b.dataset.readerSize==="+" ? .1 : -.1;
    applyScale(true);
  }));
  document.addEventListener("click",e=>{
    if(!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)){
      pop.hidden=true;
      btn.setAttribute("aria-expanded", "false");
    }
  });
}

async function openLocation(bookId, chapterN, paraIdx, paragraphKey, commentId){
  if(!bookId) return;
  if(!state.currentBook || state.currentBook.id!==bookId) await openBook(bookId);
  const book = state.currentBook;
  if(!book) return;
  const idx = book.chapters.findIndex(c=>Number(c.n)===Number(chapterN));
  if(idx<0) return;
  await openChapter(idx);

  // Comentários gerais do capítulo (sem parágrafo, paraIdx -1) vivem em
  // #chapterNotes, preenchido de forma assíncrona pela assinatura do
  // Firestore (Comments.attachChapter) — pode não estar pronto ainda no
  // frame seguinte à troca de capítulo. Por isso tentamos por um tempo
  // curto em vez de desistir no primeiro requestAnimationFrame.
  const findTarget = () => {
    let target = null;
    let threadEl = commentId ? $("[data-thread-id='"+commentId+"']") : null;
    if(threadEl){
      const paraBlock = threadEl.closest(".para-block");
      if(paraBlock){
        const panel = paraBlock.querySelector(".comment-panel");
        if(panel) panel.hidden = false;
        target = paraBlock;
      }else{
        target = threadEl; // já visível em #chapterNotes
      }
    }
    if(!target && paragraphKey) target = $("#chapterText .para-block[data-paragraph-key='"+paragraphKey+"']");
    if(!target && Number(paraIdx) >= 0) target = $("#chapterText .para-block[data-para-idx='"+Number(paraIdx)+"']");
    return target;
  };

  const attempts = 15; // ~3s no total
  for(let i=0;i<attempts;i++){
    await new Promise(r=>setTimeout(r,i===0?30:180));
    let target = findTarget();
    if(!target && i===attempts-1) target = $("#chapterNotes"); // última tentativa: cai pras notas gerais
    if(target && !target.hidden){
      target.scrollIntoView({behavior:"smooth",block:"center"});
      target.classList.add("feedback-target");
      setTimeout(()=>target.classList.remove("feedback-target"),1800);
      if(target.classList.contains("para-block")){
        const panel=target.querySelector(".comment-panel");
        if(panel) panel.hidden=false;
      }
      return;
    }
  }
}
window.BookReader = { openLocation, getBooks:()=>state.books.slice() };

const THEMES = [
  {id:"papel",    name:"Papel",         swatch:"#faf6ef"},
  {id:"ambar",    name:"Âmbar Noturno", swatch:"#221d17"},
  {id:"grafite",  name:"Grafite",       swatch:"#242426"},
  {id:"azul",     name:"Noite Azul",    swatch:"#1c2433"},
  {id:"floresta", name:"Verde Floresta",swatch:"#1c2820"},
  {id:"vinho",    name:"Vinho",         swatch:"#28181b"},
];
const READER_FONTS = [
  {id:"lora", name:"Lora", note:"Equilibrada e familiar"},
  {id:"literata", name:"Literata", note:"Criada para leitura digital"},
  {id:"merriweather", name:"Merriweather", note:"Clara em telas pequenas"},
  {id:"garamond", name:"EB Garamond", note:"Clássica de livros impressos"},
  {id:"atkinson", name:"Atkinson", note:"Alta distinção entre letras"},
];
function applyTheme(id,{track=true}={}){
  document.documentElement.dataset.theme = id;
  localStorage.setItem(THEME_KEY, id);
  updateThemePicker();
  if(track) window.BetaAnalytics?.preferenceChanged?.("theme");
}
function updateThemePicker(){
  const current = localStorage.getItem(THEME_KEY) || "ambar";
  $$(".theme-swatch").forEach(b=> b.classList.toggle("active", b.dataset.themeId===current));
}
function initThemePicker(picker){
  if(!picker) return;
  picker.innerHTML = THEMES.map(t=>
    `<button type="button" class="theme-swatch" data-theme-id="${t.id}" style="background:${t.swatch}">
       <span class="theme-swatch-name">${t.name}</span>
     </button>`
  ).join("");
  $$(".theme-swatch", picker).forEach(b=>{
    b.addEventListener("click", ()=> applyTheme(b.dataset.themeId));
  });
  updateThemePicker();
}

function applyReaderFont(id,{track=true}={}){
  if(!READER_FONTS.some(f=>f.id===id)) id = "lora";
  document.documentElement.dataset.readerFont = id;
  localStorage.setItem(FONT_FAMILY_KEY, id);
  if(track) window.BetaAnalytics?.preferenceChanged?.("font");
  $$("[data-reader-font]").forEach(b=>{
    const active = b.dataset.readerFont===id;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
}
function initFontPicker(picker, compact=false){
  if(!picker) return;
  picker.innerHTML = READER_FONTS.map(f=>
    `<button type="button" data-reader-font="${f.id}" aria-pressed="false">
       <span>${f.name}</span>${compact ? "" : `<small>${f.note}</small>`}
     </button>`
  ).join("");
  $$('[data-reader-font]', picker).forEach(b=>b.addEventListener("click",()=>applyReaderFont(b.dataset.readerFont,{track:true})));
  applyReaderFont(localStorage.getItem(FONT_FAMILY_KEY) || "lora",{track:false});
}

function initSettings(){
  const sheet = $("#settingsSheet");
  const hideArt = $("#cfgHideArt");
  const autoAmbient = $("#cfgAutoAmbient");
  $("#btnSettings").addEventListener("click", ()=>{
    if(hideArt) hideArt.checked = localStorage.getItem(HIDE_ART_KEY)==="1";
    if(autoAmbient) autoAmbient.checked = localStorage.getItem(AUTO_AMBIENT_KEY)==="1";
    sheet.hidden = false;
  });
  $("#cfgClose").addEventListener("click", ()=> sheet.hidden = true);
  sheet.addEventListener("click", e=>{
    if(e.target===sheet) sheet.hidden = true;
  });
  $("#cfgSave").addEventListener("click", ()=>{
    if(hideArt) localStorage.setItem(HIDE_ART_KEY, hideArt.checked ? "1" : "0");
    if(autoAmbient) localStorage.setItem(AUTO_AMBIENT_KEY, autoAmbient.checked ? "1" : "0");
    window.BetaAnalytics?.syncPreferences?.();
    sheet.hidden = true;
  });
  initThemePicker($("#themePicker"));
  initThemePicker($("#readerThemePicker"));
  initFontPicker($("#readerFontPicker"), true);
  initFontPicker($("#settingsFontPicker"));
}

// ---------------- navegação ----------------
function initNav(){
  $$("[data-back]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const to = btn.dataset.back;
      if(to==="library") showView("library");
      if(to==="book"){
        audioEl().pause();
        exitFocus();
        renderBookView();
        showView("book");
      }
    });
  });
  $("#btnFocus")?.addEventListener("click", enterFocus);
  $("#focusExit").addEventListener("click", exitFocus);
  $("#btnNextChapterTop")?.addEventListener("click", ()=>{ playNextChapterSound(); changeChapter(1); });
  $("#btnNextChapterEnd").addEventListener("click", ()=>{ playNextChapterSound(); changeChapter(1); });
  $("#readerScroll").addEventListener("scroll", ()=>{
    window.BetaAnalytics?.noteInteraction?.();
    updateReaderProgressBar();
  }, {passive:true});
  $("#btnCompleteChapter").addEventListener("click", ()=>{
    const book = state.currentBook;
    const ch = book && book.chapters[state.currentChapterIdx];
    if(!book || !ch) return;
    setChapterDone(!isChapterDone(book.id, ch.n));
  });
}

// ---------------- service worker ----------------
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("assets/service-worker.js").catch(()=>{});
  });
}

// ---------------- boot ----------------
initNav();
initPlayerControls();
initSettings();
initReaderDisplay();
window.BetaAnalytics?.setView?.("library");
setTimeout(()=>window.BetaAnalytics?.syncPreferences?.(),1200);
loadLibrary();
// Re-filtra a biblioteca quando o status de admin ou o perfil do leitor
// mudar (ex.: autenticação admin resolve async, login por código, etc.)
document.addEventListener("beta:admin", loadLibrary);
document.addEventListener("beta:profile-login", ()=>{
  loadLibrary();
  setTimeout(()=>window.BetaAnalytics?.syncPreferences?.(),250);
});
document.addEventListener("beta:profile-ready", ()=>{
  loadLibrary();
  setTimeout(()=>window.BetaAnalytics?.syncPreferences?.(),250);
});

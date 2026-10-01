// ================= Leitor de Livros =================
// App leve, sem framework, pra todos os livros (um ou vários). Puxa texto
// (.md) e áudio (.mp3) dos capítulos de arquivos estáticos (por padrão,
// deste mesmo site — dá pra apontar pra outro endereço nos Ajustes).
// Guarda progresso de leitura e áudio no localStorage do aparelho.

const CFG_KEY = "jesed:cfgBase";
const POS_KEY = (bookId, n) => `jesed:pos:${bookId}:${n}`;
const LASTCH_KEY = (bookId) => `jesed:last:${bookId}`;

function baseUrl(){
  const v = localStorage.getItem(CFG_KEY);
  return v && v.trim() ? v.trim().replace(/\/?$/, "/") : "./";
}
function resolve(path){
  return baseUrl() + path;
}

const state = { books: [], currentBook: null, currentChapterIdx: -1 };

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const views = { library: $("#view-library"), book: $("#view-book"), reader: $("#view-reader") };
function showView(name){
  Object.entries(views).forEach(([k,el]) => el.hidden = k!==name);
  window.scrollTo(0,0);
}

// ---------------- Biblioteca ----------------
async function loadLibrary(){
  const listEl = $("#bookList");
  try{
    const res = await fetch(resolve("data/books.json"), {cache:"no-cache"});
    const data = await res.json();
    state.books = data.books || [];
  }catch(e){
    listEl.innerHTML = `<p class="empty-hint">Não consegui carregar a biblioteca. Confira o endereço em Ajustes (⚙).</p>`;
    return;
  }
  if(!state.books.length){
    listEl.innerHTML = `<p class="empty-hint">Nenhum livro cadastrado ainda.</p>`;
    return;
  }
  listEl.innerHTML = state.books.map(b => `
    <button class="book-card" data-book="${b.id}">
      <div class="book-cover">${(b.title||"?").slice(0,1)}</div>
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

  $("#bookTitle").textContent = meta.title;
  $("#bookSubtitle").textContent = meta.subtitle || "";

  const lastCh = Number(localStorage.getItem(LASTCH_KEY(bookId)) || -1);

  const listEl = $("#chapterList");
  listEl.innerHTML = state.currentBook.chapters.map((c, i) => {
    const pos = readPos(bookId, c.n);
    const isLast = i===lastCh;
    return `
      <div class="chapter-row" data-idx="${i}">
        <div class="chapter-num">${c.n}</div>
        <div class="chapter-info">
          <h4>${c.title}</h4>
          <span>${pos ? "continuar · "+fmtTime(pos.t||0) : (isLast ? "última lida" : "")}</span>
        </div>
        <div class="chapter-audio-dot" data-idx="${i}" hidden title="Tem áudio"></div>
      </div>`;
  }).join("");
  $$(".chapter-row", listEl).forEach(row=>{
    row.addEventListener("click", ()=> openChapter(Number(row.dataset.idx)));
  });

  showView("book");
  checkAudioAvailability(); // não bloqueia a tela — só liga os pontinhos que existirem
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
  state.currentChapterIdx = idx;
  localStorage.setItem(LASTCH_KEY(book.id), String(idx));

  $("#readerBook").textContent = book.title;
  $("#readerChapter").textContent = `Cap. ${ch.n} — ${ch.title}`;
  $("#chapterText").innerHTML = `<p class="empty-hint">Carregando…</p>`;
  showView("reader");
  exitFocus();
  updateNextChapterUI();

  // texto
  try{
    const res = await fetch(resolve(ch.text), {cache:"no-cache"});
    const raw = await res.text();
    renderChapterText(ch, raw);
  }catch(e){
    $("#chapterText").innerHTML = `<p class="empty-hint">Não consegui carregar o texto deste capítulo.</p>`;
  }

  // áudio
  const player = $("#audioEl");
  const bar = $("#playerBar");
  player.pause();
  bar.classList.remove("player-missing");
  if(ch.audio){
    bar.hidden = false;
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
      player.removeEventListener("error", onErr);
    }, {once:true});
    setMediaSession(book, ch);
  }else{
    bar.hidden = true;
  }
}

function renderChapterText(ch, raw){
  const paras = raw.replace(/\r\n/g,"\n").trim().split(/\n{2,}/).filter(Boolean);
  const html = [`<p class="cap-title">${ch.title}</p>`]
    .concat(paras.map(p => `<p>${escapeHtml(p).replace(/\n/g,"<br>")}</p>`))
    .join("");
  $("#chapterText").innerHTML = html;
}

// ---------------- navegação entre capítulos ----------------
function updateNextChapterUI(){
  const book = state.currentBook;
  const hasNext = !!(book && book.chapters[state.currentChapterIdx + 1]);
  const topBtn = $("#btnNextChapterTop");
  const endBtn = $("#btnNextChapterEnd");
  topBtn.hidden = !hasNext;
  endBtn.hidden = !hasNext;
  if(hasNext){
    const next = book.chapters[state.currentChapterIdx + 1];
    $("#nextChapterLabel").textContent = `Próximo: ${next.title}`;
  }
}
function escapeHtml(s){
  return s.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
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

function initPlayerControls(){
  const a = audioEl();
  const btnPlay = $("#btnPlay"), iconPlay = $("#iconPlay"), iconPause = $("#iconPause");

  btnPlay.addEventListener("click", ()=> a.paused ? a.play() : a.pause());
  a.addEventListener("play", ()=>{ iconPlay.hidden = true; iconPause.hidden = false; });
  a.addEventListener("pause", ()=>{ iconPlay.hidden = false; iconPause.hidden = true; savePos(a.currentTime); });
  a.addEventListener("timeupdate", ()=>{
    updateTimes();
    if(Math.floor(a.currentTime) % 5 === 0) savePos(a.currentTime);
  });
  a.addEventListener("ended", ()=>{ savePos(0); });

  $("#seek").addEventListener("input", (e)=>{
    if(!a.duration) return;
    a.currentTime = (Number(e.target.value)/1000) * a.duration;
  });
  $("#btnBack15").addEventListener("click", ()=> skip(-15));

  // música de fundo (opcional — só ativa se o arquivo existir)
  const ambientBtn = $("#btnAmbient");
  const ambientEl = $("#ambientEl");
  ambientEl.volume = 0.22;
  let ambientTried = false;
  ambientBtn.addEventListener("click", async ()=>{
    if(ambientEl.paused){
      if(!ambientTried){
        ambientTried = true;
        ambientEl.src = resolve("content/_shared/ambient.mp3");
      }
      try{ await ambientEl.play(); ambientBtn.classList.add("active"); }
      catch(e){ ambientBtn.classList.remove("active"); }
    }else{
      ambientEl.pause();
      ambientBtn.classList.remove("active");
    }
  });
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
function initSettings(){
  const sheet = $("#settingsSheet");
  $("#btnSettings").addEventListener("click", ()=>{
    $("#cfgBase").value = localStorage.getItem(CFG_KEY) || "";
    sheet.hidden = false;
  });
  $("#cfgClose").addEventListener("click", ()=> sheet.hidden = true);
  $("#cfgSave").addEventListener("click", ()=>{
    const v = $("#cfgBase").value.trim();
    if(v) localStorage.setItem(CFG_KEY, v); else localStorage.removeItem(CFG_KEY);
    sheet.hidden = true;
    loadLibrary();
  });
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
        showView("book");
      }
    });
  });
  $("#btnFocus").addEventListener("click", enterFocus);
  $("#focusExit").addEventListener("click", exitFocus);
  $("#btnNextChapterTop").addEventListener("click", ()=> changeChapter(1));
  $("#btnNextChapterEnd").addEventListener("click", ()=> changeChapter(1));
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
loadLibrary();

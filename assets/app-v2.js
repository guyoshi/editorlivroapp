// ================= Leitor de Livros =================
// App leve, sem framework, pra todos os livros (um ou vários). Puxa texto
// (.md) e áudio (.mp3) dos capítulos de arquivos estáticos deste mesmo site.
// Guarda progresso de leitura e áudio no localStorage do aparelho.

const FONT_KEY = "jesed:readerFontScale";
const FONT_FAMILY_KEY = "jesed:readerFontFamily";
const HIDE_ART_KEY = "jesed:hideChapterArt";
const THEME_KEY = "jesed:theme";
const AUTO_AMBIENT_KEY = "jesed:autoAmbient";
const POS_KEY = (bookId, n) => `jesed:pos:${bookId}:${n}`;
const LASTCH_KEY = (bookId) => `jesed:last:${bookId}`;
const DONE_KEY = (bookId, n) => `jesed:done:${bookId}:${n}`;

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
  state.currentChapterIdx = idx;
  localStorage.setItem(LASTCH_KEY(book.id), String(idx));

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
  player.pause();
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
let ambientVolumeTimer = null;

function fadeAmbientVolume(target, ms=260){
  const el = $("#ambientEl");
  if(!el)return;
  if(ambientVolumeTimer)clearInterval(ambientVolumeTimer);
  const start = Number.isFinite(el.volume) ? el.volume : AMBIENT_NORMAL_VOLUME;
  const steps = 10;
  let i = 0;
  ambientVolumeTimer=setInterval(()=>{
    i++;
    const p=i/steps;
    el.volume=Math.max(0,Math.min(1,start+(target-start)*p));
    if(i>=steps){
      clearInterval(ambientVolumeTimer);
      ambientVolumeTimer=null;
      el.volume=target;
    }
  },Math.max(16,ms/steps));
}

// Diminui o volume aos poucos até parar, em vez de cortar seco.
function fadeOutAndPause(el, ms=500){
  if(el.paused)return;
  if(ambientVolumeTimer){clearInterval(ambientVolumeTimer);ambientVolumeTimer=null;}
  const startVol=el.volume;
  const steps=10, stepMs=ms/steps;
  let i=0;
  const t=setInterval(()=>{
    i++;
    el.volume=Math.max(0,startVol*(1-i/steps));
    if(i>=steps){
      clearInterval(t);
      el.pause();
      // O próximo play recalcula o volume conforme a narração esteja tocando.
      el.volume=AMBIENT_NORMAL_VOLUME;
    }
  },stepMs);
}

// Popup explicativo, mostrado só na primeira vez que a pessoa usa cada
// controle (guardado por aparelho).
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
    const music=$("#ambientEl");
    if(music && !music.paused)fadeAmbientVolume(AMBIENT_DUCKED_VOLUME);
  });
  a.addEventListener("pause", ()=>{
    setNarrationButtonState(false);
    const music=$("#ambientEl");
    if(music && !music.paused)fadeAmbientVolume(AMBIENT_NORMAL_VOLUME);
    savePos(a.currentTime);
  });
  a.addEventListener("timeupdate", ()=>{
    updateTimes();
    if(Math.floor(a.currentTime) % 5 === 0) savePos(a.currentTime);
  });
  a.addEventListener("ended", ()=>{
    setNarrationButtonState(false);
    const music=$("#ambientEl");
    if(music && !music.paused)fadeAmbientVolume(AMBIENT_NORMAL_VOLUME);
    savePos(0);
  });

  $("#seek").addEventListener("input", (e)=>{
    if(!a.duration) return;
    a.currentTime = (Number(e.target.value)/1000) * a.duration;
  });
  $("#btnBack15").addEventListener("click", ()=> skip(-15));

  // música de fundo do capítulo. O botão fica como último controle,
  // à direita da barra de narração.
  const ambientBtn = $("#btnAmbient");
  const ambientEl = $("#ambientEl");

  function setAmbientButtonState(playing){
    ambientBtn.classList.toggle("active",!!playing);
    const label=playing?"Pausar música do capítulo":"Tocar música do capítulo";
    ambientBtn.setAttribute("aria-label",label);
    ambientBtn.title=label;
    ambientBtn.setAttribute("aria-pressed",String(!!playing));
  }

  ambientEl.volume = AMBIENT_NORMAL_VOLUME;
  ambientEl.loop = true;
  ambientEl.addEventListener("play",()=>setAmbientButtonState(true));
  ambientEl.addEventListener("pause",()=>setAmbientButtonState(false));

  ambientBtn.addEventListener("click", async ()=>{
    if(!state.ambientSrc){ setAmbientButtonState(false); return; }
    showHintOnce("jesed:hintAmbient", "Música do capítulo", "Liga a trilha pensada para este trecho. Ela toca baixinho por baixo da narração e pode ser pausada separadamente.");
    if(ambientEl.paused){
      ambientEl.volume=a.paused ? AMBIENT_NORMAL_VOLUME : AMBIENT_DUCKED_VOLUME;
      try{ await ambientEl.play(); }
      catch(e){ setAmbientButtonState(false); }
    }else{
      fadeOutAndPause(ambientEl);
      setAmbientButtonState(false);
    }
  });
}

// Chama-se ao abrir/trocar de capítulo: troca (ou para) a música ambiente
// conforme o capítulo tenha ou não o campo "ambient" no manifesto.
function updateAmbientForChapter(ch){
  const ambientBtn = $("#btnAmbient");
  const ambientEl = $("#ambientEl");
  const wasPlaying = !ambientEl.paused;
  ambientEl.pause();

  const setStopped=()=>{
    ambientBtn.classList.remove("active");
    ambientBtn.setAttribute("aria-label","Tocar música do capítulo");
    ambientBtn.title="Tocar música do capítulo";
    ambientBtn.setAttribute("aria-pressed","false");
  };

  if(ch && ch.ambient){
    state.ambientSrc = ch.ambient;
    ambientBtn.hidden = false;
    ambientEl.src = /^https?:\/\//i.test(ch.ambient) ? ch.ambient : resolve(ch.ambient);
    const autoStart = localStorage.getItem(AUTO_AMBIENT_KEY) === "1";
    if(wasPlaying || autoStart){
      ambientEl.volume=audioEl().paused ? AMBIENT_NORMAL_VOLUME : AMBIENT_DUCKED_VOLUME;
      ambientEl.play().catch(()=>setStopped());
    }else{
      setStopped();
    }
  }else{
    state.ambientSrc = null;
    ambientBtn.hidden = true;
    setStopped();
    ambientEl.removeAttribute("src");
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
  const applyScale = ()=>{
    scale = Math.max(.8, Math.min(1.6, Math.round(scale*10)/10));
    document.documentElement.style.setProperty("--reader-font-scale", String(scale));
    localStorage.setItem(FONT_KEY, String(scale));
    $("#readerSizeLabel").textContent = Math.round(scale*100) + "%";
  };
  applyScale();
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
    applyScale();
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
function applyTheme(id){
  document.documentElement.dataset.theme = id;
  localStorage.setItem(THEME_KEY, id);
  updateThemePicker();
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

function applyReaderFont(id){
  if(!READER_FONTS.some(f=>f.id===id)) id = "lora";
  document.documentElement.dataset.readerFont = id;
  localStorage.setItem(FONT_FAMILY_KEY, id);
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
  $$('[data-reader-font]', picker).forEach(b=>b.addEventListener("click",()=>applyReaderFont(b.dataset.readerFont)));
  applyReaderFont(localStorage.getItem(FONT_FAMILY_KEY) || "lora");
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
  $("#cfgSave").addEventListener("click", ()=>{
    if(hideArt) localStorage.setItem(HIDE_ART_KEY, hideArt.checked ? "1" : "0");
    if(autoAmbient) localStorage.setItem(AUTO_AMBIENT_KEY, autoAmbient.checked ? "1" : "0");
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
  $("#readerScroll").addEventListener("scroll", updateReaderProgressBar, {passive:true});
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
loadLibrary();
// Re-filtra a biblioteca quando o status de admin ou o perfil do leitor
// mudar (ex.: autenticação admin resolve async, login por código, etc.)
document.addEventListener("beta:admin", loadLibrary);
document.addEventListener("beta:profile-login", loadLibrary);
document.addEventListener("beta:profile-ready", loadLibrary);

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
const READPCT_KEY = (bookId, n) => `jesed:readpct:${progressOwner()}:${bookId}:${n}`;
const SCROLLPCT_KEY = (bookId, n) => `jesed:scrollpct:${progressOwner()}:${bookId}:${n}`;
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
  window.BetaPresence?.setView?.(name);
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
  // Progresso parcial já guardado neste aparelho (capítulos começados e não
  // concluídos) também é importado — assim a leitura feita antes de o leitor
  // atualizar o app aparece no relatório sem ele precisar reler.
  const localPartial = state.currentBook.chapters
    .filter(ch=>!isChapterDone(state.currentBook.id,ch.n))
    .map(ch=>({n:Number(ch.n),pct:readChapterPct(state.currentBook.id,ch.n)}))
    .filter(x=>x.pct>0);
  const lastRaw = localStorage.getItem(LASTCH_KEY(state.currentBook.id));
  const lastIdx = lastRaw===null ? NaN : Number(lastRaw);
  const lastCh = Number.isInteger(lastIdx) ? state.currentBook.chapters[lastIdx] : null;
  window.BetaAnalytics?.syncBook?.(state.currentBook,localCompleted,localPartial,lastCh?Number(lastCh.n):0);

  renderBookView();
  showView("book");
  document.dispatchEvent(new CustomEvent("beta:book-open",{detail:{book:state.currentBook}}));
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
    const readPct = readChapterPct(book.id, c.n);
    const isLast = i===lastCh;
    const done = isChapterDone(book.id, c.n);
    const hasPartial = !done && readPct > 0 && readPct < 100;
    let statusTxt = "";
    if(done) statusTxt = "concluído";
    else if(hasPartial) statusTxt = "continuar";
    else if(pos) statusTxt = "continuar · "+fmtTime(pos.t||0);
    else if(isLast) statusTxt = "última lida";
    return `
      <div class="chapter-row${done ? " chapter-done" : ""}" data-idx="${i}">
        <div class="chapter-num">${done ? checkIconSvg() : c.n}</div>
        <div class="chapter-info">
          <h4>${c.title}</h4>
          <div class="chapter-status-row">
            <span>${statusTxt}</span>
            ${hasPartial ? `<strong class="chapter-progress-pct">${readPct}%</strong>` : ""}
          </div>
          ${hasPartial ? `<div class="chapter-progress-mini" aria-label="Progresso do capítulo: ${readPct}%"><i style="width:${readPct}%"></i></div>` : ""}
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
  window.BetaPresence?.closeChapter?.();
  state.currentChapterIdx = idx;
  localStorage.setItem(LASTCH_KEY(book.id), String(idx));
  window.BetaAnalytics?.openChapter?.(book,ch,readChapterPct(book.id,ch.n));
  window.BetaPresence?.openChapter?.(book,ch,readScrollPct(book.id,ch.n));
  if(isChapterDone(book.id,ch.n)){
    window.BetaAnalytics?.progress?.(100);
    window.BetaPresence?.progress?.(100);
  }

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
  const readerScroll=$("#readerScroll");
  if(readerScroll) readerScroll.scrollTop=0;
  window.scrollTo(0,0);
  exitFocus();
  updateNextChapterUI();
  updateCompleteUI();
  resetReaderProgress();
  updateAmbientForChapter(ch);
  document.dispatchEvent(new CustomEvent("beta:chapter-open",{detail:{book,chapter:ch,index:idx,isLast:idx===book.chapters.length-1}}));

  // texto
  try{
    const res = await fetch(resolve(ch.text), {cache:"no-cache"});
    const raw = await res.text();
    renderChapterText(ch, raw);
    // Capítulo incompleto retoma o ponto salvo da leitura textual.
    // A narração mantém seu próprio marcador em segundos e é restaurada abaixo.
    if(state.currentChapterIdx===idx){
      const done=isChapterDone(book.id,ch.n);
      const savedScroll=done?0:readScrollPct(book.id,ch.n);
      requestAnimationFrame(()=>{
        if(state.currentChapterIdx!==idx)return;
        const scroller=$("#readerScroll");
        if(scroller){
          const max=Math.max(0,scroller.scrollHeight-scroller.clientHeight);
          scroller.scrollTop=max*(savedScroll/100);
        }
        updateReaderProgressBar();
      });
    }
    Comments.attachChapter(book.id, ch.n, $("#chapterText"), $("#chapterNotes"));
  }catch(e){
    $("#chapterText").innerHTML = `<p class="empty-hint">Não consegui carregar o texto deste capítulo.</p>`;
  }

  // player inferior: permanece visível em todo capítulo.
  // Recursos ausentes ficam cinzentos e não reproduzíveis, em vez de sumirem.
  const player = $("#audioEl");
  const bar = $("#playerBar");
  bar.hidden = false;
  bar.classList.remove("player-missing");
  if(ch.audio){
    setNarrationAvailability(true);
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
      // O manifesto pode apontar para uma narração que ainda não foi publicada.
      // Nesse caso o controle continua no lugar, mas passa ao estado indisponível.
      try{ player.pause(); }catch(e){}
      setNarrationAvailability(false);
      views.reader.classList.remove("has-narration");
      player.removeEventListener("error", onErr);
    }, {once:true});
    setMediaSession(book, ch);
  }else{
    try{ player.pause(); }catch(e){}
    player.removeAttribute("src");
    try{ player.load(); }catch(e){}
    setNarrationAvailability(false);
    views.reader.classList.remove("has-narration");
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
// O % exibido nunca deve cair: se a pessoa desce até o fim e volta pra
// conferir algo, continua mostrando o quanto ela já alcançou no capítulo.
let readerProgressFloor = 0;
function resetReaderProgress(){
  const book = state.currentBook;
  const ch = book && book.chapters[state.currentChapterIdx];
  readerProgressFloor = (book && ch) ? readChapterPct(book.id, ch.n) : 0;
  $("#readerProgressFill").style.width = readerProgressFloor + "%";
  $("#readerProgressLabel").textContent = readerProgressFloor + "%";
}
function updateReaderProgressBar(){
  const scroller = $("#readerScroll");
  const max = scroller.scrollHeight - scroller.clientHeight;
  const rawPct = max > 0 ? Math.min(100, Math.max(0, Math.round((scroller.scrollTop / max) * 100))) : 100;
  readerProgressFloor = Math.max(readerProgressFloor, rawPct);
  const pct = readerProgressFloor;
  $("#readerProgressFill").style.width = pct + "%";
  $("#readerProgressLabel").textContent = pct + "%";
  saveScrollPct(rawPct);
  saveChapterPct(pct);
  window.BetaAnalytics?.progress?.(pct);
  window.BetaPresence?.progress?.(pct);
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
  if(done){
    localStorage.setItem(DONE_KEY(book.id, ch.n), "1");
    saveChapterPct(100);
  }else{
    localStorage.removeItem(DONE_KEY(book.id, ch.n));
    if(readChapterPct(book.id,ch.n)>=96) saveChapterPct(95,{force:true});
  }
  window.BetaAnalytics?.completed?.(done);
  document.dispatchEvent(new CustomEvent("beta:chapter-complete",{detail:{book,chapter:ch,done,index:state.currentChapterIdx,isLast:state.currentChapterIdx===book.chapters.length-1}}));
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
function readChapterPct(bookId,n){
  const raw=Number(localStorage.getItem(READPCT_KEY(bookId,n))||0);
  return Number.isFinite(raw)?Math.max(0,Math.min(100,Math.round(raw))):0;
}
function readScrollPct(bookId,n){
  const raw=Number(localStorage.getItem(SCROLLPCT_KEY(bookId,n))||0);
  return Number.isFinite(raw)?Math.max(0,Math.min(100,raw)):0;
}
function saveScrollPct(value){
  const book=state.currentBook;
  const ch=book&&book.chapters[state.currentChapterIdx];
  if(!book||!ch)return;
  const pct=Math.max(0,Math.min(100,Number(value)||0));
  localStorage.setItem(SCROLLPCT_KEY(book.id,ch.n),String(pct));
}
function saveChapterPct(value,{force=false}={}){
  const book=state.currentBook;
  const ch=book&&book.chapters[state.currentChapterIdx];
  if(!book||!ch)return;
  const pct=Math.max(0,Math.min(100,Math.round(Number(value)||0)));
  const current=readChapterPct(book.id,ch.n);
  const next=force?pct:Math.max(current,pct);
  if(next>0)localStorage.setItem(READPCT_KEY(book.id,ch.n),String(next));
}
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
let narrationAvailable = false;

function setNarrationAvailability(available){
  narrationAvailable = !!available;
  const bar=$("#playerBar"),btn=$("#btnPlay"),seek=$("#seek"),back=$("#btnBack15");
  if(bar)bar.classList.toggle("narration-unavailable",!narrationAvailable);
  if(btn){
    btn.disabled=!narrationAvailable;
    btn.setAttribute("aria-disabled",String(!narrationAvailable));
    btn.setAttribute("aria-pressed","false");
    const label=narrationAvailable?"Tocar narração":"Narração indisponível neste capítulo";
    btn.title=label;
    btn.setAttribute("aria-label",label);
    const path=$("#narrationStatePath");
    if(path)path.setAttribute("d","M8 5v14l11-7z");
  }
  if(seek){seek.disabled=!narrationAvailable;if(!narrationAvailable)seek.value="0";}
  if(back){back.disabled=!narrationAvailable;back.setAttribute("aria-disabled",String(!narrationAvailable));}
  if(!narrationAvailable){
    const cur=$("#timeCurrent"),total=$("#timeTotal");
    if(cur)cur.textContent="0:00";
    if(total)total.textContent="0:00";
  }
}
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
let ambientAvailable = false;
const ambientMix = new WeakMap();

function setAmbientAvailability(available){
  ambientAvailable=!!available;
  const btn=$("#btnAmbient");
  if(!btn)return;
  btn.hidden=false;
  btn.disabled=!ambientAvailable;
  btn.classList.toggle("unavailable",!ambientAvailable);
  btn.setAttribute("aria-disabled",String(!ambientAvailable));
  if(!ambientAvailable){
    btn.classList.remove("active");
    btn.setAttribute("aria-pressed","false");
    btn.setAttribute("aria-label","Música indisponível neste capítulo");
    btn.title="Música indisponível neste capítulo";
  }
}

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
  btn.hidden=false;
  const playing=ambientAvailable && !!ambientActiveEl && !ambientActiveEl.paused;
  btn.classList.toggle("active",playing);
  const label=!ambientAvailable?"Música indisponível neste capítulo":(playing?"Pausar música do capítulo":"Tocar música do capítulo");
  btn.setAttribute("aria-label",label);
  btn.title=label;
  btn.setAttribute("aria-pressed",String(playing));
  btn.disabled=!ambientAvailable;
  btn.setAttribute("aria-disabled",String(!ambientAvailable));
  window.BetaAnalytics?.music?.(playing);
  window.BetaPresence?.music?.(playing);
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
    const canPlay=!!narrationAvailable;
    const effectivePlaying=canPlay&&!!playing;
    if(narrationStatePath)narrationStatePath.setAttribute("d",effectivePlaying?PAUSE_PATH:PLAY_PATH);
    const label=!canPlay?"Narração indisponível neste capítulo":(effectivePlaying?"Pausar narração":"Tocar narração");
    btnPlay.setAttribute("aria-label",label);
    btnPlay.title=label;
    btnPlay.setAttribute("aria-pressed",String(effectivePlaying));
  }

  setNarrationButtonState(false);
  btnPlay.addEventListener("click", ()=>{
    if(!narrationAvailable)return;
    showHintOnce("jesed:hintPlay", "Narração do capítulo", "Toque aqui pra ouvir o capítulo narrado. Dá pra pausar e continuar de onde parou a qualquer momento, inclusive em outro aparelho.");
    a.paused ? a.play() : a.pause();
  });
  a.addEventListener("play", ()=>{
    setNarrationButtonState(true);
    window.BetaAnalytics?.narration?.(true);
    window.BetaPresence?.narration?.(true);
    setAmbientDuck(AMBIENT_DUCK_FACTOR);
  });
  a.addEventListener("pause", ()=>{
    setNarrationButtonState(false);
    window.BetaAnalytics?.narration?.(false);
    window.BetaPresence?.narration?.(false);
    setAmbientDuck(1);
    savePos(a.currentTime);
  });
  a.addEventListener("timeupdate", ()=>{
    updateTimes();
    if(a.duration){
      const audioPct=(a.currentTime/a.duration)*100;
      saveChapterPct(audioPct);
      window.BetaAnalytics?.progress?.(audioPct);
      window.BetaPresence?.progress?.(audioPct);
    }
    if(Math.floor(a.currentTime) % 5 === 0) savePos(a.currentTime);
  });
  a.addEventListener("ended", ()=>{
    setNarrationButtonState(false);
    window.BetaAnalytics?.narration?.(false);
    window.BetaPresence?.narration?.(false);
    saveChapterPct(100);
    window.BetaAnalytics?.progress?.(100);
    window.BetaPresence?.progress?.(100);
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
    if(!ambientAvailable || !state.ambientSrc || !ambientActiveEl){
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

  // O botão de música existe em todos os livros/capítulos. Só muda de estado.
  setAmbientAvailability(!!nextKey);

  if(nextKey && ambientTrackKey===nextKey && ambientActiveEl){
    state.ambientSrc=nextKey;
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
    if(oldEl && !oldEl.paused)fadeOutAmbient(oldEl,AMBIENT_CROSSFADE_MS,{clear:true});
    else stopAmbientElement(oldEl,{clear:true});
    syncAmbientButton();
    return;
  }

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
    const previous=Number(localStorage.getItem(FONT_KEY)||"1");
    scale = Math.max(.8, Math.min(1.6, Math.round(scale*10)/10));
    document.documentElement.style.setProperty("--reader-font-scale", String(scale));
    localStorage.setItem(FONT_KEY, String(scale));
    $("#readerSizeLabel").textContent = Math.round(scale*100) + "%";
    if(track&&Math.abs(previous-scale)>.001) window.BetaAnalytics?.preferenceChanged?.("fontScale");
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
  const previous=localStorage.getItem(THEME_KEY)||"ambar";
  document.documentElement.dataset.theme = id;
  localStorage.setItem(THEME_KEY, id);
  updateThemePicker();
  if(track&&previous!==id) window.BetaAnalytics?.preferenceChanged?.("theme");
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
  const previous=localStorage.getItem(FONT_FAMILY_KEY)||"lora";
  document.documentElement.dataset.readerFont = id;
  localStorage.setItem(FONT_FAMILY_KEY, id);
  if(track&&previous!==id) window.BetaAnalytics?.preferenceChanged?.("font");
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
  $("#btnNextChapterTop")?.addEventListener("click", ()=>{ playNextChapterSound(); window.Comments?.forceResync?.(); changeChapter(1); });
  $("#btnNextChapterEnd").addEventListener("click", ()=>{ playNextChapterSound(); window.Comments?.forceResync?.(); changeChapter(1); });
  $("#readerScroll").addEventListener("scroll", ()=>{
    window.BetaAnalytics?.noteInteraction?.();
    window.BetaPresence?.noteInteraction?.();
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
    navigator.serviceWorker.register("assets/service-worker.js").then(reg=>{
      reg.update().catch(()=>{});
      setInterval(()=>reg.update().catch(()=>{}),300000);
    }).catch(()=>{});
  });
}

// ---------------- boot ----------------
initNav();
initPlayerControls();
initSettings();
initReaderDisplay();
window.BetaAnalytics?.setView?.("library");
window.BetaPresence?.setView?.("library");
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

// ---------------- capa em tela cheia com zoom ----------------
(function initCoverViewer(){
  const img = document.getElementById("bookCoverImg");
  if(!img) return;
  img.classList.add("is-zoomable");
  img.setAttribute("role","button");
  img.setAttribute("aria-label","Ver capa em tela cheia");

  let box=null, pic=null;
  let scale=1, tx=0, ty=0;
  const MAX=6;
  const pts=new Map();
  let tapTimer=0, startDist=0, startScale=1, startMid=null, startTx=0, startTy=0, panStart=null, lastTap=0, moved=false;

  function apply(){
    pic.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;
  }
  function clamp(){
    if(scale<=1){ tx=0; ty=0; return; }
    const w=pic.clientWidth*scale, h=pic.clientHeight*scale;
    const mx=Math.max(0,(w-box.clientWidth)/2), my=Math.max(0,(h-box.clientHeight)/2);
    tx=Math.min(mx,Math.max(-mx,tx));
    ty=Math.min(my,Math.max(-my,ty));
  }
  function zoomAt(next,cx,cy){
    next=Math.min(MAX,Math.max(1,next));
    const r=box.getBoundingClientRect();
    const ox=cx-(r.left+r.width/2), oy=cy-(r.top+r.height/2);
    const k=next/scale;
    tx=ox-(ox-tx)*k; ty=oy-(oy-ty)*k;
    scale=next; clamp(); apply();
  }
  function reset(){ scale=1; tx=0; ty=0; apply(); }

  function build(){
    box=document.createElement("div");
    box.className="cover-viewer";
    box.hidden=true;
    box.innerHTML='<button class="cover-viewer-close" type="button" aria-label="Fechar">✕</button><img alt="Capa do livro" draggable="false">';
    document.body.appendChild(box);
    pic=box.querySelector("img");
    box.querySelector(".cover-viewer-close").addEventListener("click",close);

    box.addEventListener("pointerdown",e=>{
      if(e.target.closest(".cover-viewer-close")) return;
      box.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
      moved=false;
      if(pts.size===2){
        const [a,b]=[...pts.values()];
        startDist=Math.hypot(a.x-b.x,a.y-b.y)||1;
        startScale=scale; startTx=tx; startTy=ty;
        startMid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
        panStart=null;
      }else if(pts.size===1){
        panStart={x:e.clientX,y:e.clientY,tx,ty};
      }
    });
    box.addEventListener("pointermove",e=>{
      if(!pts.has(e.pointerId)) return;
      pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pts.size===2){
        const [a,b]=[...pts.values()];
        const d=Math.hypot(a.x-b.x,a.y-b.y);
        const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
        const next=Math.min(MAX,Math.max(1,startScale*d/startDist));
        const r=box.getBoundingClientRect();
        const k=next/startScale;
        scale=next;
        tx=(mid.x-r.left-r.width/2)-((startMid.x-r.left-r.width/2)-startTx)*k;
        ty=(mid.y-r.top-r.height/2)-((startMid.y-r.top-r.height/2)-startTy)*k;
        moved=true; clamp(); apply();
      }else if(pts.size===1&&panStart&&scale>1){
        const dx=e.clientX-panStart.x, dy=e.clientY-panStart.y;
        if(Math.abs(dx)+Math.abs(dy)>4) moved=true;
        tx=panStart.tx+dx; ty=panStart.ty+dy; clamp(); apply();
      }else if(panStart){
        if(Math.abs(e.clientX-panStart.x)+Math.abs(e.clientY-panStart.y)>6) moved=true;
      }
    });
    const up=e=>{
      if(!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if(pts.size===1){
        const p=[...pts.values()][0];
        panStart={x:p.x,y:p.y,tx,ty};
      }else if(pts.size===0){
        panStart=null;
        if(!moved&&e.type==="pointerup"){
          const now=Date.now();
          if(now-lastTap<300){
            lastTap=0; clearTimeout(tapTimer);
            scale>1?(reset()):zoomAt(2.5,e.clientX,e.clientY);
          }else{
            lastTap=now;
            // toque simples (sem zoom) fecha, após esperar um possível 2º toque
            clearTimeout(tapTimer);
            tapTimer=setTimeout(()=>{ if(scale===1) close(); },300);
          }
        }
        if(scale<1.02) reset();
      }
    };
    box.addEventListener("pointerup",up);
    box.addEventListener("pointercancel",up);
    box.addEventListener("wheel",e=>{
      e.preventDefault();
      zoomAt(scale*(e.deltaY<0?1.2:1/1.2),e.clientX,e.clientY);
    },{passive:false});
    document.addEventListener("keydown",e=>{
      if(box.hidden) return;
      if(e.key==="Escape") close();
      if(e.key==="+"||e.key==="=") zoomAt(scale*1.4,innerWidth/2,innerHeight/2);
      if(e.key==="-") zoomAt(scale/1.4,innerWidth/2,innerHeight/2);
    });
  }

  function open(){
    if(!img.src||img.hidden) return;
    if(!box) build();
    pic.src=img.currentSrc||img.src;
    reset();
    box.hidden=false;
    document.body.classList.add("cover-viewer-open");
    history.pushState({coverViewer:true},"");
  }
  function close(fromPop){
    if(!box||box.hidden) return;
    box.hidden=true;
    document.body.classList.remove("cover-viewer-open");
    if(fromPop!==true&&history.state?.coverViewer) history.back();
  }
  window.addEventListener("popstate",()=>close(true));
  img.addEventListener("click",open);
})();

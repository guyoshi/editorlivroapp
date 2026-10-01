// ================= Comentários (beta readers) =================
// Usa Firestore (config em assets/firebase-config.js). Se FIREBASE_CONFIG
// estiver nulo, os comentários ficam desativados e o resto do app segue
// funcionando normalmente.

const Comments = (() => {
  const NAME_KEY = "jesed:username";
  const ADMIN_KEY = "jesed:isAdmin";
  // Senha só pra não deixar o modo admin aparecer pra qualquer beta reader
  // por acidente — não é segurança de verdade (o app não tem login).
  const ADMIN_PASSWORD = "jesed-admin-2026";

  let db = null;
  let enabled = false;
  const cache = {}; // bookId -> array de comentários
  let globalShowAll = false;
  let globalConfigLoaded = false;

  function init(){
    if(window.FIREBASE_CONFIG && window.firebase){
      try{
        firebase.initializeApp(window.FIREBASE_CONFIG);
        db = firebase.firestore();
        enabled = true;
      }catch(e){ enabled = false; }
    }
    wireNameSheet();
    wireSettingsExtras();
  }

  function isEnabled(){ return enabled; }

  // ---------------- nome do usuário ----------------
  function getUserName(){ return (localStorage.getItem(NAME_KEY) || "").trim(); }
  function setUserName(v){
    v = (v || "").trim();
    if(v) localStorage.setItem(NAME_KEY, v);
  }

  function wireNameSheet(){
    const sheet = document.getElementById("nameSheet");
    const input = document.getElementById("nameInput");
    const saveBtn = document.getElementById("nameSave");
    if(!sheet || !input || !saveBtn) return;

    if(!getUserName()){
      sheet.hidden = false;
    }
    const doSave = ()=>{
      const v = input.value.trim();
      if(!v){ input.focus(); return; }
      setUserName(v);
      sheet.hidden = true;
    };
    saveBtn.addEventListener("click", doSave);
    input.addEventListener("keydown", (e)=>{ if(e.key==="Enter") doSave(); });
  }

  // ---------------- modo admin ----------------
  function isAdmin(){ return localStorage.getItem(ADMIN_KEY) === "1"; }

  function wireSettingsExtras(){
    const cfgName = document.getElementById("cfgName");
    const adminBox = document.getElementById("adminBox");
    const cfgShowAll = document.getElementById("cfgShowAll");
    const btnAdminToggle = document.getElementById("btnAdminToggle");
    const btnSettings = document.getElementById("btnSettings");
    const cfgSave = document.getElementById("cfgSave");
    if(!cfgName) return;

    const refreshAdminUI = async ()=>{
      if(isAdmin()){
        adminBox.hidden = false;
        btnAdminToggle.textContent = "Sair do modo admin";
        if(enabled){
          await loadGlobalConfig(true);
          cfgShowAll.checked = globalShowAll;
        }
      }else{
        adminBox.hidden = true;
        btnAdminToggle.textContent = "Modo admin";
      }
    };

    if(btnSettings){
      btnSettings.addEventListener("click", ()=>{
        cfgName.value = getUserName();
        refreshAdminUI();
      });
    }

    if(btnAdminToggle){
      btnAdminToggle.addEventListener("click", ()=>{
        if(isAdmin()){
          localStorage.removeItem(ADMIN_KEY);
          refreshAdminUI();
          return;
        }
        const pass = prompt("Senha de admin:");
        if(pass === ADMIN_PASSWORD){
          localStorage.setItem(ADMIN_KEY, "1");
          refreshAdminUI();
        }else if(pass !== null){
          alert("Senha incorreta.");
        }
      });
    }

    if(cfgSave){
      cfgSave.addEventListener("click", async ()=>{
        setUserName(cfgName.value);
        if(isAdmin() && enabled){
          const val = !!cfgShowAll.checked;
          try{
            await db.collection("config").doc("settings").set({ showAllComments: val });
            globalShowAll = val;
            globalConfigLoaded = true;
          }catch(e){ /* silencioso — rede/offline */ }
        }
      });
    }
  }

  async function loadGlobalConfig(force){
    if(!enabled) return false;
    if(globalConfigLoaded && !force) return globalShowAll;
    try{
      const doc = await db.collection("config").doc("settings").get();
      globalShowAll = doc.exists ? !!doc.data().showAllComments : false;
    }catch(e){
      globalShowAll = false;
    }
    globalConfigLoaded = true;
    return globalShowAll;
  }

  // ---------------- dados de comentários ----------------
  async function loadBookComments(bookId, force){
    if(!enabled) return [];
    if(cache[bookId] && !force) return cache[bookId];
    try{
      const snap = await db.collection("comments").where("bookId", "==", bookId).get();
      const list = [];
      snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      cache[bookId] = list;
      return list;
    }catch(e){
      return cache[bookId] || [];
    }
  }

  function visibleFor(list){
    const me = getUserName().trim().toLowerCase();
    if(isAdmin() || globalShowAll) return list;
    return list.filter(c => (c.author || "").trim().toLowerCase() === me);
  }

  async function addComment(bookId, chapter, paraIdx, text){
    if(!enabled) return null;
    const author = getUserName() || "Anônimo";
    const entry = { bookId, chapter, paraIdx, author, text, at: Date.now() };
    await db.collection("comments").add(entry);
    if(!cache[bookId]) cache[bookId] = [];
    cache[bookId].push(entry);
    return entry;
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
  }

  function renderCommentList(list){
    if(!list.length) return `<p class="comment-empty">Nenhum comentário ainda.</p>`;
    return list
      .slice()
      .sort((a,b)=> (a.at||0) - (b.at||0))
      .map(c => `
        <div class="comment-item">
          <span class="comment-author">${escapeHtml(c.author || "Anônimo")}</span>
          <span class="comment-text">${escapeHtml(c.text)}</span>
        </div>`).join("");
  }

  // ---------------- integração com o leitor ----------------
  // Chamado pelo app.js depois de montar o HTML do capítulo (com os
  // .para-block já no DOM). Busca os comentários do livro inteiro (cache
  // por livro) e injeta o toggle + painel em cada parágrafo, além da área
  // de notas gerais do capítulo (paraIdx -1).
  async function attachChapter(bookId, chapterN, containerEl, notesEl){
    if(!enabled) return;
    await loadGlobalConfig();
    const all = await loadBookComments(bookId);
    const chapterComments = visibleFor(all.filter(c => c.chapter === chapterN));

    // notas gerais do capítulo (paraIdx -1)
    const general = chapterComments.filter(c => c.paraIdx === -1);
    if(notesEl){
      if(general.length){
        notesEl.hidden = false;
        notesEl.innerHTML = `<div class="chapter-note-label">Notas do capítulo</div>` + renderCommentList(general);
      }else{
        notesEl.hidden = true;
        notesEl.innerHTML = "";
      }
    }

    const blocks = containerEl.querySelectorAll(".para-block");
    blocks.forEach(block => {
      const paraIdx = Number(block.dataset.paraIdx);
      const paraComments = chapterComments.filter(c => c.paraIdx === paraIdx);

      let actions = block.querySelector(".para-actions");
      let panel;
      if(!actions){
        actions = document.createElement("div");
        actions.className = "para-actions";
        actions.innerHTML = `
          <button class="comment-toggle" type="button">
            <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M4 4h16v12H7l-3 3V4z"/></svg>
            <span class="comment-count" hidden></span>
          </button>`;
        block.appendChild(actions);

        panel = document.createElement("div");
        panel.className = "comment-panel";
        panel.hidden = true;
        panel.innerHTML = `
          <div class="comment-list"></div>
          <form class="comment-form">
            <input type="text" maxlength="500" placeholder="Escreva um comentário…" required>
            <button type="submit">Enviar</button>
          </form>`;
        block.appendChild(panel);

        actions.querySelector(".comment-toggle").addEventListener("click", ()=>{
          panel.hidden = !panel.hidden;
        });
        panel.querySelector(".comment-form").addEventListener("submit", async (e)=>{
          e.preventDefault();
          const input = panel.querySelector("input");
          const text = input.value.trim();
          if(!text) return;
          await addComment(bookId, chapterN, paraIdx, text);
          input.value = "";
          const refreshed = visibleFor((await loadBookComments(bookId, true)).filter(
            c => c.chapter === chapterN && c.paraIdx === paraIdx
          ));
          panel.querySelector(".comment-list").innerHTML = renderCommentList(refreshed);
          updateCount(actions, refreshed.length);
        });
      }

      panel = block.querySelector(".comment-panel");
      panel.querySelector(".comment-list").innerHTML = renderCommentList(paraComments);
      updateCount(actions, paraComments.length);
    });
  }

  function updateCount(actionsEl, n){
    const el = actionsEl.querySelector(".comment-count");
    if(n > 0){ el.hidden = false; el.textContent = n; }
    else{ el.hidden = true; }
  }

  return { init, isEnabled, getUserName, setUserName, isAdmin, attachChapter };
})();

document.addEventListener("DOMContentLoaded", ()=> Comments.init());

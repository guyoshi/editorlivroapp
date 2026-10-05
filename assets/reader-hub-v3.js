// ================= Central do Leitor =================
// Reúne comentários, respostas do autor e reações do beta reader sem
// misturar estes dados com o manuscrito.

(() => {
  const SHEET_ID = "readerHubSheet";
  const SEEN_PREFIX = "jesed:readerReplySeen:";
  let data = { all:[], roots:[], reactions:[], repliesByRoot:new Map(), books:[] };
  let isOpen = false;
  let loading = false;
  let activeView = "unread";
  let liveUnsubs = [];
  const liveRows = new Map();

  const norm = s => String(s||"").replace(/\s+/g," ").trim().toLowerCase();
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const when = t => t ? new Date(t).toLocaleString("pt-BR", {
    day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit"
  }) : "";
  const shortId = id => {
    const clean = String(id||"").replace(/[^a-z0-9]/gi,"").toUpperCase();
    return clean ? clean.slice(-6) : "LEGADO";
  };
  const seenKey = id => SEEN_PREFIX + id;
  const isSeen = id => localStorage.getItem(seenKey(id)) === "1";
  const markSeen = id => localStorage.setItem(seenKey(id), "1");

  function mine(item){
    if(item?.role==="admin") return false;
    const uid = window.Comments?.getUserId?.();
    if(item.authorId) return item.authorId === uid;
    return norm(item.author) === norm(window.Comments?.getUserName?.());
  }

  function bookTitle(bookId){
    return data.books.find(b=>b.id===bookId)?.title || bookId || "Livro";
  }

  function ensureUI(){
    if(!document.getElementById(SHEET_ID)){
      const sheet = document.createElement("div");
      sheet.id = SHEET_ID;
      sheet.className = "reader-hub-sheet";
      sheet.hidden = true;
      sheet.innerHTML = `
        <section class="reader-hub">
          <header class="reader-hub-head">
            <div>
              <h2>Minha central</h2>
              <p id="readerHubIdentity"></p>
            </div>
            <button id="readerHubClose" type="button" class="icon-btn" aria-label="Fechar">✕</button>
          </header>

          <details class="reader-profile-card" open>
            <summary>Meu perfil</summary>
            <div class="reader-profile-content">
              <label class="field reader-profile-name-field">
                <span>Seu nome</span>
                <div class="reader-profile-name-row">
                  <input id="readerProfileName" type="text" maxlength="40" autocomplete="name">
                  <button id="readerProfileNameSave" type="button">Salvar nome</button>
                </div>
                <small id="readerProfileNameStatus" class="reader-profile-name-status" aria-live="polite"></small>
              </label>
              <div class="reader-access-card">
                <div class="reader-access-copy">
                  <span>Código de acesso</span>
                  <strong id="readerAccessCode">Gerando…</strong>
                  <small>Use este código para entrar no seu perfil em outro aparelho. Não compartilhe publicamente.</small>
                </div>
                <div class="reader-access-actions">
                  <button id="readerAccessCopy" type="button">Copiar código</button>
                </div>
              </div>
            </div>
          </details>

          <nav class="reader-hub-primary" aria-label="Conteúdo da central">
            <button type="button" data-hub-view="unread" class="active">
              Novas respostas <span id="readerHubNewCount" hidden></span>
            </button>
            <button type="button" data-hub-view="annotations">Minhas anotações</button>
          </nav>

          <div class="reader-hub-filters">
            <select id="readerHubBook">
              <option value="">Todos os livros</option>
            </select>
            <input id="readerHubSearch" type="search" placeholder="Buscar nas minhas anotações…">
          </div>

          <div id="readerHubList" class="reader-hub-list"></div>
        </section>`;
      document.body.appendChild(sheet);

      sheet.querySelector("#readerHubClose").addEventListener("click", close);
      sheet.addEventListener("click", e => { if(e.target===sheet) close(); });
      ["readerHubBook","readerHubSearch"].forEach(id=>{
        const el = sheet.querySelector("#"+id);
        el.addEventListener(el.tagName==="INPUT" ? "input" : "change", render);
      });
      sheet.querySelectorAll("[data-hub-view]").forEach(btn=>{
        btn.addEventListener("click",()=>{
          activeView = btn.dataset.hubView;
          render();
        });
      });
    }

    const btn = document.getElementById("btnReaderHub");
    if(btn && !btn.dataset.readerHubWired){
      btn.dataset.readerHubWired = "1";
      btn.addEventListener("click", open);
    }

    const copyBtn=document.getElementById("readerAccessCopy");
    if(copyBtn && !copyBtn.dataset.wired){
      copyBtn.dataset.wired="1";
      copyBtn.addEventListener("click",async()=>{
        const code=window.Comments?.getAccessCode?.()||"";
        if(!code)return;
        try{
          await navigator.clipboard.writeText(code);
          copyBtn.textContent="Copiado!";
          setTimeout(()=>copyBtn.textContent="Copiar código",1400);
        }catch(e){
          prompt("Copie seu código de acesso:",code);
        }
      });
    }

    const nameInput=document.getElementById("readerProfileName");
    const nameSave=document.getElementById("readerProfileNameSave");
    const nameStatus=document.getElementById("readerProfileNameStatus");
    if(nameSave && !nameSave.dataset.wired){
      nameSave.dataset.wired="1";
      nameSave.addEventListener("click",async()=>{
        const next=nameInput?.value.trim()||"";
        if(!next){nameInput?.focus();return;}
        nameSave.disabled=true;
        if(nameStatus){nameStatus.textContent="Salvando…";nameStatus.classList.remove("error");}
        try{
          await window.Comments?.updateReaderName?.(next);
          if(nameStatus)nameStatus.textContent="Nome atualizado.";
          const identity=document.getElementById("readerHubIdentity");
          if(identity)identity.textContent=next+" · perfil #"+shortId(window.Comments?.getUserId?.());
          setTimeout(()=>{if(nameStatus)nameStatus.textContent="";},1500);
        }catch(e){
          if(nameStatus){nameStatus.textContent=e?.message||"Não foi possível salvar o nome.";nameStatus.classList.add("error");}
        }finally{
          nameSave.disabled=false;
        }
      });
      nameInput?.addEventListener("keydown",e=>{if(e.key==="Enter")nameSave.click();});
    }

  }

  function applyRows(all,books){
    const roots = all.filter(x =>
      !x.parentId && x.kind!=="reply" && x.kind!=="reaction" && mine(x)
    );
    const reactions = all.filter(x => x.kind==="reaction" && mine(x));
    const rootIds = new Set(roots.map(x=>x.id));
    const repliesByRoot = new Map();
    roots.forEach(r=>repliesByRoot.set(r.id,[]));
    all.filter(x=>x.parentId && rootIds.has(x.parentId))
      .sort((a,b)=>(a.at||0)-(b.at||0))
      .forEach(x=>repliesByRoot.get(x.parentId).push(x));
    data = {all, roots, reactions, repliesByRoot, books};
  }

  function stopLiveNotifications(){
    liveUnsubs.forEach(fn=>{try{fn?.();}catch(e){}});
    liveUnsubs=[];
    liveRows.clear();
  }

  function syncLiveNotifications(){
    stopLiveNotifications();
    const db=window.Comments?.getDb?.();
    const books=window.BookReader?.getBooks?.()||[];
    if(!db||!books.length||window.Comments?.isAdmin?.()){
      const badge=document.getElementById("readerHubBadge");
      if(badge)badge.hidden=true;
      return;
    }

    books.forEach(book=>{
      const unsub=db.collection("comments").where("bookId","==",book.id).onSnapshot(snap=>{
        const rows=[];
        snap.forEach(doc=>rows.push({id:doc.id,...doc.data()}));
        liveRows.set(book.id,rows);
        const all=books.flatMap(b=>liveRows.get(b.id)||[]);
        applyRows(all,books);
        updateBadge();
        if(isOpen)render();
      },e=>console.warn("Central do leitor: atualização ao vivo indisponível em "+book.id,e));
      liveUnsubs.push(unsub);
    });
  }

  async function loadData(){
    if(loading) return;
    loading = true;
    try{
      const db = window.Comments?.getDb?.();
      data.books = window.BookReader?.getBooks?.() || [];
      if(!db || !data.books.length){
        data = {...data, all:[], roots:[], reactions:[], repliesByRoot:new Map()};
        return;
      }

      const snaps = await Promise.all(data.books.map(async book=>{
        try{
          const snap = await db.collection("comments").where("bookId","==",book.id).get();
          const rows = [];
          snap.forEach(doc=>rows.push({id:doc.id,...doc.data()}));
          return rows;
        }catch(e){
          console.warn("Central do leitor: não foi possível ler "+book.id, e);
          return [];
        }
      }));

      const all = snaps.flat();
      applyRows(all,data.books);
    }finally{
      loading = false;
    }
  }

  function unreadReplies(){
    const out = [];
    data.roots.forEach(root=>{
      (data.repliesByRoot.get(root.id)||[]).forEach(reply=>{
        if(reply.role==="admin" && !isSeen(reply.id)) out.push(reply);
      });
    });
    return out;
  }

  function updateBadge(){
    const badge = document.getElementById("readerHubBadge");
    const btn = document.getElementById("btnReaderHub");
    if(!badge) return;
    if(window.Comments?.isAdmin?.()){
      badge.hidden=true;
      if(btn){
        btn.title="Minha central";
        btn.setAttribute("aria-label","Minha central");
      }
      return;
    }
    const n = unreadReplies().length;
    badge.hidden = n===0;
    badge.textContent = n>99 ? "99+" : String(n);
    if(btn){
      const label=n?("Minha central · "+n+" nova"+(n===1?" resposta":"s respostas")):"Minha central";
      btn.title=label;
      btn.setAttribute("aria-label",label);
    }
  }

  function fillBookFilter(){
    const el = document.getElementById("readerHubBook");
    if(!el) return;
    const current = el.value;
    const used = new Set([
      ...data.roots.map(x=>x.bookId),
      ...data.reactions.map(x=>x.bookId)
    ]);
    const books = data.books.filter(b=>used.has(b.id));
    el.innerHTML = '<option value="">Todos os livros</option>' +
      books.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.title)+'</option>').join("");
    el.value = books.some(b=>b.id===current) ? current : "";
  }

  function replyFlags(root){
    const replies = data.repliesByRoot.get(root.id) || [];
    const authorReplies = replies.filter(r=>r.role==="admin");
    const unread = authorReplies.filter(r=>!isSeen(r.id));
    return {replies, authorReplies, unread};
  }

  function renderComment(root){
    const flags = replyFlags(root);
    const unread = flags.unread.length;
    const repliesHtml = flags.replies.map(r=>{
      const ownReply = mine(r);
      return '<div class="reader-hub-reply '+(r.role==="admin"?"by-author":"")+'">'+
        '<div class="reader-hub-meta"><strong>'+esc(r.role==="admin"?"Autor":(r.author||"Você"))+'</strong>'+
        '<span>'+when(r.at)+'</span>'+
        (ownReply ? '<span class="reader-hub-inline-actions"><button data-reply-action="edit" data-id="'+r.id+'">Editar</button><button data-reply-action="delete" data-id="'+r.id+'">Apagar</button></span>' : '')+
        '</div><div>'+esc(r.text||"")+'</div></div>';
    }).join("");

    return '<article class="reader-hub-card '+(unread?"has-new":"")+'" data-root-card="'+root.id+'">'+
      '<div class="reader-hub-card-top"><div><strong>'+esc(bookTitle(root.bookId))+'</strong>'+
      '<span>Cap. '+esc(root.chapter)+' · §'+(Number(root.paraIdx)+1)+' · '+when(root.at)+'</span></div>'+
      '<div class="reader-hub-pills">'+
      (unread?'<span class="reader-hub-pill new">Nova resposta</span>':'')+
      (root.status==="resolved"?'<span class="reader-hub-pill resolved">Resolvido</span>':'')+
      (!flags.authorReplies.length&&root.status!=="resolved"?'<span class="reader-hub-pill waiting">Aguardando</span>':'')+
      '</div></div>'+
      (root.quote?'<blockquote>'+esc(root.quote)+'</blockquote>':'')+
      '<div class="reader-hub-comment">'+esc(root.text||"")+'</div>'+
      (repliesHtml?'<div class="reader-hub-replies">'+repliesHtml+'</div>':'')+
      '<div class="reader-hub-actions">'+
      '<button data-root-action="goto" data-id="'+root.id+'">Ver trecho</button>'+
      '<button data-root-action="reply" data-id="'+root.id+'">Responder</button>'+
      '<button data-root-action="edit" data-id="'+root.id+'">Editar</button>'+
      '<button data-root-action="delete" data-id="'+root.id+'">Apagar</button>'+
      '</div></article>';
  }

  function renderReaction(item){
    return '<article class="reader-hub-card reaction-card">'+
      '<div class="reader-hub-card-top"><div><strong>'+esc(bookTitle(item.bookId))+'</strong>'+
      '<span>Cap. '+esc(item.chapter)+' · §'+(Number(item.paraIdx)+1)+' · '+when(item.at)+'</span></div>'+
      '<div class="reader-hub-big-emoji">'+esc(item.emoji||"☺")+'</div></div>'+
      (item.quote?'<blockquote>'+esc(item.quote)+'</blockquote>':'')+
      '<div class="reader-hub-actions">'+
      '<button data-reaction-action="goto" data-id="'+item.id+'">Ver trecho</button>'+
      '<button data-reaction-action="delete" data-id="'+item.id+'">Remover reação</button>'+
      '</div></article>';
  }

  function filteredItems(){
    const book = document.getElementById("readerHubBook")?.value || "";
    const q = norm(document.getElementById("readerHubSearch")?.value || "");

    const comments = data.roots.filter(root=>{
      if(book && root.bookId!==book) return false;
      const flags = replyFlags(root);
      if(activeView==="unread" && !flags.unread.length) return false;
      if(q && !norm((root.text||"")+" "+(root.quote||"")+" "+bookTitle(root.bookId)).includes(q)) return false;
      return true;
    }).map(item=>({kind:"comment",item,sortAt:item.updatedAt||item.at||0}));

    return comments.sort((a,b)=>{
      if(a.kind==="comment" && b.kind==="comment"){
        const au = replyFlags(a.item).unread.length ? 1 : 0;
        const bu = replyFlags(b.item).unread.length ? 1 : 0;
        if(au!==bu) return bu-au;
      }
      return b.sortAt-a.sortAt;
    });
  }

  function wireActions(){
    const list = document.getElementById("readerHubList");
    if(!list) return;

    list.querySelectorAll("[data-root-action]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const root = data.roots.find(x=>x.id===btn.dataset.id);
        if(!root) return;
        const action = btn.dataset.rootAction;

        if(action==="goto"){
          (data.repliesByRoot.get(root.id)||[]).filter(r=>r.role==="admin").forEach(r=>markSeen(r.id));
          updateBadge();
          close();
          await window.BookReader?.openLocation?.(root.bookId,root.chapter,root.paraIdx,root.paragraphKey,root.id);
          return;
        }
        if(action==="reply"){
          const text = prompt("Responder:", "");
          if(text?.trim()) await window.Comments?.reply?.(root,text.trim());
        }
        if(action==="edit") await window.Comments?.edit?.(root);
        if(action==="delete") await window.Comments?.del?.(root);
        await refresh();
      });
    });

    list.querySelectorAll("[data-reply-action]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const reply = data.all.find(x=>x.id===btn.dataset.id);
        if(!reply) return;
        if(btn.dataset.replyAction==="edit") await window.Comments?.edit?.(reply);
        if(btn.dataset.replyAction==="delete") await window.Comments?.del?.(reply);
        await refresh();
      });
    });

    list.querySelectorAll("[data-reaction-action]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const reaction = data.reactions.find(x=>x.id===btn.dataset.id);
        if(!reaction) return;
        if(btn.dataset.reactionAction==="goto"){
          close();
          await window.BookReader?.openLocation?.(reaction.bookId,reaction.chapter,reaction.paraIdx,reaction.paragraphKey);
          return;
        }
        if(btn.dataset.reactionAction==="delete"){
          if(confirm("Remover esta reação?")){
            await window.Comments?.getDb?.().collection("comments").doc(reaction.id).delete();
            await refresh();
          }
        }
      });
    });
  }

  function render(){
    ensureUI();
    const identity = document.getElementById("readerHubIdentity");
    if(identity){
      identity.textContent = (window.Comments?.getUserName?.() || "Leitor") +
        " · perfil #" + shortId(window.Comments?.getUserId?.());
    }
    const nameInput=document.getElementById("readerProfileName");
    if(nameInput && document.activeElement!==nameInput)nameInput.value=window.Comments?.getUserName?.()||"";
    const codeEl=document.getElementById("readerAccessCode");
    if(codeEl) codeEl.textContent=window.Comments?.getAccessCode?.()||"Indisponível";

    fillBookFilter();
    const unread = unreadReplies().length;
    const newCount = document.getElementById("readerHubNewCount");
    if(newCount){
      newCount.hidden = unread===0;
      newCount.textContent = unread>99 ? "99+" : String(unread);
    }
    document.querySelectorAll("[data-hub-view]").forEach(btn=>{
      const selected = btn.dataset.hubView===activeView;
      btn.classList.toggle("active", selected);
      btn.setAttribute("aria-current", selected ? "page" : "false");
    });
    const filters = document.querySelector(".reader-hub-filters");
    if(filters) filters.hidden = activeView==="unread";

    const list = document.getElementById("readerHubList");
    const items = filteredItems();

    if(!items.length){
      list.innerHTML = activeView==="unread"
        ? '<div class="reader-hub-empty"><strong>Você está em dia.</strong><span>Quando o autor responder uma anotação, ela aparece aqui.</span></div>'
        : '<div class="reader-hub-empty"><strong>Nenhuma anotação ainda.</strong><span>Seus comentários nos capítulos vão aparecer aqui.</span></div>';
    }else{
      list.innerHTML = items.map(x=>x.kind==="comment" ? renderComment(x.item) : renderReaction(x.item)).join("");
      wireActions();
    }

    updateBadge();
  }

  async function refresh(){
    await loadData();
    render();
  }

  async function open(){
    ensureUI();
    const sheet = document.getElementById(SHEET_ID);
    sheet.hidden = false;
    isOpen = true;
    document.body.classList.add("reader-hub-open");
    const list = document.getElementById("readerHubList");
    list.innerHTML = '<div class="reader-hub-empty"><span>Carregando suas anotações…</span></div>';
    try{await window.Comments?.ensureAccessProfile?.();}catch(e){console.warn("Código de acesso indisponível:",e);}
    await loadData();
    activeView = unreadReplies().length ? "unread" : "annotations";
    render();

    // Abrir a central significa que o leitor teve acesso às respostas.
    // Marcamos as respostas do autor exibidas agora como vistas localmente.
    data.roots.forEach(root=>{
      (data.repliesByRoot.get(root.id)||[]).filter(r=>r.role==="admin").forEach(r=>markSeen(r.id));
    });
    updateBadge();
  }

  function close(){
    const sheet = document.getElementById(SHEET_ID);
    if(sheet) sheet.hidden = true;
    isOpen = false;
    document.body.classList.remove("reader-hub-open");
  }

  async function initialBadge(){
    try{
      await loadData();
      updateBadge();
    }catch(e){
      console.warn("Central do leitor:", e);
    }
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    ensureUI();
    setTimeout(async()=>{
      await initialBadge();
      syncLiveNotifications();
    },400);
  });
  document.addEventListener("beta:profile-login",()=>setTimeout(syncLiveNotifications,80));
  document.addEventListener("beta:profile-ready",()=>setTimeout(syncLiveNotifications,80));
  document.addEventListener("beta:admin",()=>setTimeout(syncLiveNotifications,80));
  document.addEventListener("beta:library-loaded",()=>setTimeout(syncLiveNotifications,80));

  window.ReaderHub = {open,close,refresh,syncLiveNotifications};
})();

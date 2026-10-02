// Admin dashboard for beta-reader feedback
(() => {
  let all=[], unsub=null, open=false, lastItems=[];
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm=s=>String(s||"").replace(/\s+/g," ").trim().toLowerCase();
  const when=t=>t?new Date(t).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
  const shortId=id=>{const v=String(id||"").replace(/[^a-z0-9]/gi,"").toUpperCase();return v?v.slice(-6):"LEGADO";};
  const readerKey=x=>x.authorId||("legacy:"+norm(x.author));
  const readerLabel=x=>(x.author||"Anônimo")+" · #"+shortId(x.authorId);

  function roots(){return all.filter(x=>!x.parentId&&x.kind!=="reply"&&x.kind!=="reaction");}
  function replies(id){return all.filter(x=>x.parentId===id||x.rootId===id).sort((a,b)=>(a.at||0)-(b.at||0));}
  function find(id){return all.find(x=>x.id===id);}
  function db(){return window.Comments?.getDb?.();}

  function ensureButton(){
    const box=document.getElementById("adminBox");
    if(!box||document.getElementById("btnAuthorDashboard"))return;
    const b=document.createElement("button");
    b.id="btnAuthorDashboard";b.type="button";b.className="admin-comments-btn";
    b.innerHTML='<span>Painel do autor</span><span id="adminNewCount" class="admin-new-count" hidden></span>';
    b.onclick=showAdminHome;box.appendChild(b);
  }

  function ensureAdminHome(){
    if(document.getElementById("authorAdminSheet"))return;
    const el=document.createElement("div");el.id="authorAdminSheet";el.className="admin-dashboard-sheet";el.hidden=true;
    el.innerHTML='<section class="admin-dashboard admin-home"><header class="admin-dashboard-head"><div><h2>Painel do autor</h2><p>Gerencie leitores, mensagens e comentários em áreas separadas.</p></div><button id="authorAdminClose" class="icon-btn" type="button">✕</button></header><div class="admin-home-grid"><button id="openReaderAccess" class="admin-home-card" type="button"><strong>Leitores e acessos</strong><span>Libere livros, envie popup ou remova leitores.</span></button><button id="openPopupDashboard" class="admin-home-card" type="button"><strong>Mensagens popup</strong><span>Veja pendentes, disparadas, lidas e seus modelos.</span></button><button id="openCommentDashboard" class="admin-home-card" type="button"><strong>Comentários</strong><span>Leia e responda ao feedback dos capítulos.</span><span id="adminHomeNewCount" class="admin-new-count" hidden></span></button></div></section>';
    document.body.appendChild(el);
    el.querySelector("#authorAdminClose").onclick=hideAdminHome;
    el.querySelector("#openReaderAccess").onclick=()=>{hideAdminHome();showAccess();};
    el.querySelector("#openPopupDashboard").onclick=()=>{hideAdminHome();window.PopupMessages?.openAdmin?.();};
    el.querySelector("#openCommentDashboard").onclick=()=>{hideAdminHome();show();};
    el.onclick=e=>{if(e.target===el)hideAdminHome();};
  }

  function ensureSheet(){
    if(document.getElementById("commentAdminSheet"))return;
    const el=document.createElement("div");el.id="commentAdminSheet";el.className="admin-dashboard-sheet";el.hidden=true;
    el.innerHTML='<section class="admin-dashboard"><header class="admin-dashboard-head"><div><h2>Central de comentários</h2><p>Novos primeiro. Responda, resolva ou vá direto ao trecho.</p></div><button id="adminDashClose" class="icon-btn" type="button">✕</button></header><div class="admin-dashboard-filters"><select id="afStatus"><option value="all">Todos</option><option value="new">Novos</option><option value="open">Em aberto</option><option value="resolved">Resolvidos</option></select><select id="afBook"><option value="">Todos os livros</option></select><select id="afChapter"><option value="">Todos os capítulos</option></select><select id="afAuthor"><option value="">Todos os leitores</option></select><input id="afSearch" type="search" placeholder="Buscar comentário…"></div><div class="admin-dashboard-bulk"><button id="afMarkReadAll" type="button" class="link-btn">Marcar exibidos como lidos</button><button id="afMarkUnreadAll" type="button" class="link-btn">Marcar exibidos como não lidos</button></div><div id="adminDashboardList" class="admin-dashboard-list"></div></section>';
    document.body.appendChild(el);
    el.querySelector("#adminDashClose").onclick=hide;
    el.onclick=e=>{if(e.target===el)hide();};
    ["afStatus","afBook","afChapter","afAuthor","afSearch"].forEach(id=>{
      const x=el.querySelector("#"+id);x.addEventListener(x.tagName==="INPUT"?"input":"change",render);
    });
    el.querySelector("#afMarkReadAll").onclick=()=>bulkMark(true);
    el.querySelector("#afMarkUnreadAll").onclick=()=>bulkMark(false);
  }

  function subscribe(){
    if(unsub||!Comments?.isAdmin?.()||!db())return;
    unsub=db().collection("comments").onSnapshot(s=>{
      all=[];s.forEach(d=>all.push({id:d.id,...d.data()}));badge();if(open)render();
    });
  }
  function stop(){unsub?.();unsub=null;all=[];badge();}
  function badge(){
    const n=roots().filter(r=>!r.adminSeen).length;
    [document.getElementById("adminNewCount"),document.getElementById("adminHomeNewCount")].forEach(x=>{
      if(!x)return;x.hidden=!n;x.textContent=n>99?"99+":String(n);
    });
  }

  function fill(sel,vals,current,label){
    const first=sel.options[0]?.outerHTML||'<option value="">Todos</option>';
    sel.innerHTML=first+vals.map(v=>'<option value="'+esc(v)+'">'+esc(label?label(v):v)+'</option>').join("");
    sel.value=current;
  }

  function render(){
    if(!open)return;const sheet=document.getElementById("commentAdminSheet"),list=sheet.querySelector("#adminDashboardList");
    const st=sheet.querySelector("#afStatus"),bk=sheet.querySelector("#afBook"),ch=sheet.querySelector("#afChapter"),au=sheet.querySelector("#afAuthor"),se=sheet.querySelector("#afSearch");
    const bv=bk.value,cv=ch.value,av=au.value;
    const rr=roots(),books=[...new Set(rr.map(x=>x.bookId).filter(Boolean))].sort();
    const authorMap=new Map();
    rr.forEach(x=>authorMap.set(readerKey(x),{key:readerKey(x),label:readerLabel(x)}));
    const authors=[...authorMap.values()].sort((a,b)=>a.label.localeCompare(b.label,"pt-BR"));
    const chapters=[...new Set(rr.filter(x=>!bv||x.bookId===bv).map(x=>String(x.chapter)))].sort((a,b)=>Number(a)-Number(b));
    fill(bk,books,bv);
    au.innerHTML='<option value="">Todos os leitores</option>'+authors.map(x=>'<option value="'+esc(x.key)+'">'+esc(x.label)+'</option>').join("");
    au.value=authors.some(x=>x.key===av)?av:"";
    fill(ch,chapters,cv,v=>"Capítulo "+v);
    const q=norm(se.value);
    const items=rr.filter(r=>{
      if(st.value==="new"&&r.adminSeen)return false;if(st.value==="open"&&r.status==="resolved")return false;if(st.value==="resolved"&&r.status!=="resolved")return false;
      if(bk.value&&r.bookId!==bk.value)return false;if(ch.value&&String(r.chapter)!==ch.value)return false;if(au.value&&readerKey(r)!==au.value)return false;
      if(q&&!norm((r.text||"")+" "+(r.quote||"")+" "+(r.author||"")).includes(q))return false;return true;
    }).sort((a,b)=>{const an=a.adminSeen?0:1,bn=b.adminSeen?0:1;return an!==bn?bn-an:(b.updatedAt||b.at||0)-(a.updatedAt||a.at||0);});
    lastItems=items;
    if(!items.length){list.innerHTML='<p class="admin-empty">Nenhum comentário neste filtro.</p>';return;}
    list.innerHTML=items.map(r=>{
      const rp=replies(r.id).map(x=>'<div class="feedback-reply '+(x.role==="admin"?"by-admin":"")+'"><div class="feedback-meta"><strong>'+esc(x.role==="admin"?"Autor":readerLabel(x))+'</strong><span>'+when(x.at)+'</span></div><div class="feedback-text">'+esc(x.text)+'</div></div>').join("");
      return '<article class="admin-comment-card '+(!r.adminSeen?"is-new":"")+'"><div class="admin-card-top"><div><strong>'+esc(readerLabel(r))+'</strong><span>'+esc(r.bookId||"")+' · Cap. '+esc(r.chapter)+' · §'+(Number(r.paraIdx)+1)+'</span></div><div>'+(!r.adminSeen?'<span class="feedback-status new">Novo</span>':"")+(r.status==="resolved"?'<span class="feedback-status resolved">Resolvido</span>':"")+'</div></div>'+(r.quote?'<blockquote>'+esc(r.quote)+'</blockquote>':"")+'<div class="admin-root-text">'+esc(r.text||"")+'</div>'+(rp?'<div class="feedback-replies">'+rp+'</div>':"")+'<div class="admin-card-actions"><button data-a="goto" data-id="'+r.id+'">Ver trecho</button><button data-a="reply" data-id="'+r.id+'">Responder</button><button data-a="resolve" data-id="'+r.id+'">'+(r.status==="resolved"?"Reabrir":"Resolver")+'</button><button data-a="edit" data-id="'+r.id+'">Editar</button><button data-a="del" data-id="'+r.id+'">Apagar</button>'+(!r.adminSeen?'<button data-a="seen" data-id="'+r.id+'">Marcar lido</button>':'<button data-a="unseen" data-id="'+r.id+'">Marcar não lido</button>')+'</div></article>';
    }).join("");
    list.querySelectorAll("[data-a]").forEach(b=>b.onclick=async()=>{
      const r=find(b.dataset.id);if(!r)return;
      if(b.dataset.a==="reply"){const v=prompt("Responder a "+(r.author||"leitor")+":");if(v?.trim())await Comments.reply(r,v.trim());}
      if(b.dataset.a==="resolve")await Comments.resolve(r,r.status!=="resolved");
      if(b.dataset.a==="edit")await Comments.edit(r);
      if(b.dataset.a==="del")await Comments.del(r);
      if(b.dataset.a==="seen")await Comments.seen(r);
      if(b.dataset.a==="unseen")await Comments.unseen(r);
      if(b.dataset.a==="goto"){await Comments.seen(r);hide();window.BookReader?.openLocation?.(r.bookId,r.chapter,r.paraIdx,r.paragraphKey,r.id);}
    });
  }

  async function bulkMark(seenValue){
    if(!lastItems.length)return;
    const label=seenValue?"lidos":"não lidos";
    if(!confirm("Marcar "+lastItems.length+" comentário(s) exibido(s) como "+label+"?"))return;
    await Comments.markAllSeen(lastItems,seenValue);
  }

  function show(){if(!Comments?.isAdmin?.())return;ensureSheet();subscribe();document.getElementById("commentAdminSheet").hidden=false;open=true;render();}
  function hide(){const x=document.getElementById("commentAdminSheet");if(x)x.hidden=true;open=false;}
  function showAdminHome(){if(!Comments?.isAdmin?.())return;ensureAdminHome();subscribe();document.getElementById("authorAdminSheet").hidden=false;badge();}
  function hideAdminHome(){const x=document.getElementById("authorAdminSheet");if(x)x.hidden=true;}

  // ---------------- Acesso aos livros ----------------
  // Cada leitor escolhe o primeiro livro ao criar o perfil. O admin usa
  // esta área separada para liberar (ou remover) os próximos.
  let booksCache=null;
  async function getBooksList(){
    if(booksCache)return booksCache;
    try{
      const res=await fetch("data/books.json",{cache:"no-cache"});
      const data=await res.json();
      booksCache=data.books||[];
    }catch(e){booksCache=[];}
    return booksCache;
  }

  function ensureAccessSheet(){
    if(document.getElementById("bookAccessSheet"))return;
    const el=document.createElement("div");el.id="bookAccessSheet";el.className="admin-dashboard-sheet";el.hidden=true;
    el.innerHTML='<section class="admin-dashboard"><header class="admin-dashboard-head"><div><h2>Leitores e acessos</h2><p>Cada leitor escolhe o primeiro livro. Marque outros para ampliar a biblioteca dele.</p></div><button id="accessDashClose" class="icon-btn" type="button">✕</button></header><div id="bookAccessList" class="admin-dashboard-list"></div></section>';
    document.body.appendChild(el);
    el.querySelector("#accessDashClose").onclick=hideAccess;
    el.onclick=e=>{if(e.target===el)hideAccess();};
  }

  async function renderAccess(){
    const sheet=document.getElementById("bookAccessSheet");if(!sheet||sheet.hidden)return;
    const list=sheet.querySelector("#bookAccessList");
    list.innerHTML='<p class="admin-empty">Carregando…</p>';
    const [profiles,books]=await Promise.all([Comments.listReaderProfiles(),getBooksList()]);
    if(!books.length){list.innerHTML='<p class="admin-empty">Nenhum livro cadastrado ainda.</p>';return;}
    if(!profiles.length){list.innerHTML='<p class="admin-empty">Nenhum leitor com perfil ainda. Quando alguém criar o perfil e escolher o primeiro livro, aparecerá aqui.</p>';return;}
    list.innerHTML=profiles.map(p=>{
      const label=esc(p.name||"Anônimo")+" · #"+shortId(p.readerId);
      const allowed=Array.isArray(p.allowedBooks)?p.allowedBooks:[];
      const checks=books.map(b=>{
        const checked=allowed.includes(b.id)?"checked":"";
        return '<label class="field-check"><input type="checkbox" data-profile="'+esc(p.id)+'" data-book="'+esc(b.id)+'" '+checked+'><span>'+esc(b.title)+'</span></label>';
      }).join("");
      return '<article class="admin-comment-card"><div class="admin-card-top"><div><strong>'+label+'</strong></div></div>'+checks+'<div class="admin-card-actions"><button type="button" data-popup-profile="'+esc(p.id)+'">Enviar popup</button><button type="button" data-delete-profile="'+esc(p.id)+'">Apagar leitor</button></div></article>';
    }).join("");
    list.querySelectorAll("input[type=checkbox]").forEach(cb=>{
      cb.addEventListener("change",async()=>{
        const profileId=cb.dataset.profile;
        const row=cb.closest(".admin-comment-card");
        const current=[...row.querySelectorAll("input[type=checkbox]")].filter(x=>x.checked).map(x=>x.dataset.book);
        cb.disabled=true;
        try{await Comments.setAllowedBooks(profileId,current);}
        catch(e){alert("Não foi possível salvar: "+(e.message||"tente de novo."));cb.checked=!cb.checked;}
        finally{cb.disabled=false;}
      });
    });
    list.querySelectorAll("[data-popup-profile]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const profile=profiles.find(p=>p.id===btn.dataset.popupProfile);
        if(profile)window.PopupMessages?.openCompose?.(profile);
      });
    });
    list.querySelectorAll("[data-delete-profile]").forEach(btn=>{
      btn.addEventListener("click",async()=>{
        const profile=profiles.find(p=>p.id===btn.dataset.deleteProfile);
        if(!profile)return;
        const who=profile.name||"este leitor";
        if(!confirm('Apagar "'+who+'"?\n\nO código de acesso será revogado e os comentários, respostas e reações desse leitor serão apagados. Esta ação não pode ser desfeita.'))return;
        btn.disabled=true;
        btn.textContent="Apagando…";
        try{
          const result=await Comments.deleteReaderProfile(profile.id,profile.readerId);
          if(result?.cleanupFailed)alert("O leitor foi removido e o código foi revogado, mas alguns feedbacks podem ter ficado no banco.");
          await renderAccess();
        }catch(e){
          alert("Não foi possível apagar o leitor: "+(e.message||"tente de novo."));
          btn.disabled=false;
          btn.textContent="Apagar leitor";
        }
      });
    });
  }

  function showAccess(){if(!Comments?.isAdmin?.())return;ensureAccessSheet();document.getElementById("bookAccessSheet").hidden=false;renderAccess();}
  function hideAccess(){const x=document.getElementById("bookAccessSheet");if(x)x.hidden=true;}

  document.addEventListener("beta:admin",e=>{ensureButton();ensureAdminHome();if(e.detail?.on)subscribe();else{stop();hide();hideAccess();hideAdminHome();}});
  document.addEventListener("DOMContentLoaded",()=>{ensureButton();ensureAdminHome();ensureSheet();ensureAccessSheet();if(Comments?.isAdmin?.())subscribe();});
})();

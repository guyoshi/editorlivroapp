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
    if(!box||document.getElementById("btnCommentDashboard"))return;
    const b=document.createElement("button");
    b.id="btnCommentDashboard";b.type="button";b.className="admin-comments-btn";
    b.innerHTML='<span>Central de comentários</span><span id="adminNewCount" class="admin-new-count" hidden></span>';
    b.onclick=show;box.appendChild(b);
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
    const x=document.getElementById("adminNewCount");if(!x)return;
    const n=roots().filter(r=>!r.adminSeen).length;x.hidden=!n;x.textContent=n>99?"99+":String(n);
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

  document.addEventListener("beta:admin",e=>{ensureButton();if(e.detail?.on)subscribe();else{stop();hide();}});
  document.addEventListener("DOMContentLoaded",()=>{ensureButton();ensureSheet();if(Comments?.isAdmin?.())subscribe();});
})();

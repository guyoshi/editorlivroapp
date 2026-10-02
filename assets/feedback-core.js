// Beta feedback v2: threaded comments + paragraph reactions
const Comments = (() => {
  const NAME_KEY="jesed:username", USER_KEY="jesed:readerId", ADMIN_KEY="jesed:isAdmin";
  const ADMIN_HASH="117ccff39696ab27035b58ff732b2c5e61b399e7a366b38c3276eb04302521f7";
  const EMOJIS=["😍","😂","😱","😢","🤔"];
  let db=null, enabled=false, showAll=false, active=null, subBook=null, unsubC=null, unsubR=null;
  const cCache={}, rCache={};

  const norm=s=>String(s||"").replace(/\s+/g," ").trim().toLowerCase();
  function hashText(s){let h=2166136261;for(const ch of norm(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
  function uid(){let id=localStorage.getItem(USER_KEY);if(!id){id=(crypto.randomUUID?crypto.randomUUID():"r_"+Date.now().toString(36)+Math.random().toString(36).slice(2));localStorage.setItem(USER_KEY,id);}return id;}
  const name=()=>String(localStorage.getItem(NAME_KEY)||"").trim();
  const admin=()=>localStorage.getItem(ADMIN_KEY)==="1";
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const when=t=>t?new Date(t).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
  function pInfo(block){const p=block.querySelector("p");const raw=p?p.textContent:block.textContent;const q=norm(raw);return {key:"p_"+hashText(q),quote:q.slice(0,220)};}
  function loc(x,ch,i,key){if(x.chapter!==ch)return false;if(key&&x.paragraphKey)return x.paragraphKey===key;return Number(x.paraIdx)===Number(i);}
  function own(x){return admin()||(x.authorId?x.authorId===uid():norm(x.author)===norm(name()));}
  function rootVisible(x){return admin()||showAll||(x.authorId?x.authorId===uid():norm(x.author)===norm(name()));}

  async function sha256(s){
    const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
  }

  function init(){
    if(window.FIREBASE_CONFIG&&window.firebase){
      try{if(!firebase.apps.length)firebase.initializeApp(window.FIREBASE_CONFIG);db=firebase.firestore();enabled=true;}catch(e){console.warn(e);}
    }
    uid(); wireName(); wireSettings();
  }

  function wireName(){
    const sheet=document.getElementById("nameSheet"),input=document.getElementById("nameInput"),save=document.getElementById("nameSave");
    if(!sheet||!input||!save)return;
    if(!name())sheet.hidden=false;
    const go=()=>{const v=input.value.trim();if(!v)return input.focus();localStorage.setItem(NAME_KEY,v);sheet.hidden=true;};
    save.addEventListener("click",go);input.addEventListener("keydown",e=>{if(e.key==="Enter")go();});
  }

  function wireSettings(){
    const n=document.getElementById("cfgName"),box=document.getElementById("adminBox"),all=document.getElementById("cfgShowAll");
    const toggle=document.getElementById("btnAdminToggle"),settings=document.getElementById("btnSettings"),save=document.getElementById("cfgSave");
    if(!n)return;
    async function refresh(){
      if(admin()){
        box.hidden=false;toggle.textContent="Sair do modo admin";
        if(enabled){try{const d=await db.collection("config").doc("settings").get();showAll=d.exists&&!!d.data().showAllComments;}catch(e){}all.checked=showAll;}
        document.dispatchEvent(new CustomEvent("beta:admin",{detail:{on:true}}));
      }else{
        box.hidden=true;toggle.textContent="Modo admin";document.dispatchEvent(new CustomEvent("beta:admin",{detail:{on:false}}));
      }
    }
    settings?.addEventListener("click",()=>{n.value=name();refresh();});
    toggle?.addEventListener("click",async()=>{
      if(admin()){localStorage.removeItem(ADMIN_KEY);await refresh();render();return;}
      const pass=prompt("Senha de admin:"); if(pass===null)return;
      if(await sha256(pass)===ADMIN_HASH){localStorage.setItem(ADMIN_KEY,"1");await refresh();render();}else alert("Senha incorreta.");
    });
    save?.addEventListener("click",async()=>{
      if(n.value.trim())localStorage.setItem(NAME_KEY,n.value.trim());
      if(admin()&&enabled){showAll=!!all.checked;await db.collection("config").doc("settings").set({showAllComments:showAll},{merge:true});render();}
    });
    refresh();
  }

  async function load(book){
    if(!enabled)return;
    const [cs,rs]=await Promise.all([
      db.collection("comments").where("bookId","==",book).get(),
      db.collection("reactions").where("bookId","==",book).get()
    ]);
    cCache[book]=[];cs.forEach(d=>cCache[book].push({id:d.id,...d.data()}));
    rCache[book]=[];rs.forEach(d=>rCache[book].push({id:d.id,...d.data()}));
  }

  function subscribe(book){
    if(!enabled||subBook===book)return;
    unsubC?.();unsubR?.();subBook=book;
    unsubC=db.collection("comments").where("bookId","==",book).onSnapshot(s=>{cCache[book]=[];s.forEach(d=>cCache[book].push({id:d.id,...d.data()}));render();});
    unsubR=db.collection("reactions").where("bookId","==",book).onSnapshot(s=>{rCache[book]=[];s.forEach(d=>rCache[book].push({id:d.id,...d.data()}));render();});
  }

  const roots=book=>(cCache[book]||[]).filter(x=>!x.parentId&&x.kind!=="reply");
  const replies=(book,id)=>(cCache[book]||[]).filter(x=>x.parentId===id||x.rootId===id).sort((a,b)=>(a.at||0)-(b.at||0));
  function findItem(book,id){return (cCache[book]||[]).find(x=>x.id===id);}

  async function addRoot(book,ch,i,key,quote,text){
    const now=Date.now(),entry={kind:"comment",bookId:book,chapter:ch,paraIdx:i,paragraphKey:key,quote,author:name()||"Anônimo",authorId:uid(),role:admin()?"admin":"reader",text,status:"open",adminSeen:admin(),at:now,updatedAt:now};
    await db.collection("comments").add(entry);
  }
  async function reply(root,text){
    const now=Date.now();
    await db.collection("comments").add({kind:"reply",parentId:root.id,rootId:root.id,bookId:root.bookId,chapter:root.chapter,paraIdx:root.paraIdx,paragraphKey:root.paragraphKey||null,quote:root.quote||"",author:name()||"Anônimo",authorId:uid(),role:admin()?"admin":"reader",text,at:now,updatedAt:now});
    await db.collection("comments").doc(root.id).set({updatedAt:now,status:"open",adminSeen:admin()},{merge:true});
  }
  async function edit(x){
    if(!own(x))return;const v=prompt("Editar:",x.text||"");if(v===null||!v.trim())return;
    await db.collection("comments").doc(x.id).set({text:v.trim(),editedAt:Date.now(),updatedAt:Date.now(),...(admin()?{}:{adminSeen:false})},{merge:true});
    if(x.parentId&&!admin())await db.collection("comments").doc(x.parentId).set({adminSeen:false,updatedAt:Date.now()},{merge:true});
  }
  async function del(x){
    if(!own(x)||!confirm(x.parentId?"Apagar esta resposta?":"Apagar este comentário e as respostas?"))return;
    if(x.parentId)return db.collection("comments").doc(x.id).delete();
    const s=await db.collection("comments").where("parentId","==",x.id).get(),b=db.batch();s.forEach(d=>b.delete(d.ref));b.delete(db.collection("comments").doc(x.id));await b.commit();
  }
  async function resolve(x,on){if(admin())await db.collection("comments").doc(x.id).set({status:on?"resolved":"open",adminSeen:true,updatedAt:Date.now()},{merge:true});}
  async function seen(x){if(admin()&&!x.adminSeen)await db.collection("comments").doc(x.id).set({adminSeen:true},{merge:true});}

  async function react(book,ch,i,key,quote,emoji){
    const mine=(rCache[book]||[]).find(x=>x.authorId===uid()&&loc(x,ch,i,key));
    if(mine&&mine.emoji===emoji)return db.collection("reactions").doc(mine.id).delete();
    const p={bookId:book,chapter:ch,paraIdx:i,paragraphKey:key,quote,author:name()||"Anônimo",authorId:uid(),emoji,updatedAt:Date.now(),at:mine?.at||Date.now()};
    if(mine)await db.collection("reactions").doc(mine.id).set(p,{merge:true});else await db.collection("reactions").add(p);
  }

  function thread(root,book){
    const reps=replies(book,root.id);
    const acts=[];
    if(own(root)){acts.push('<button data-act="edit" data-id="'+root.id+'">Editar</button>','<button data-act="del" data-id="'+root.id+'">Apagar</button>');}
    if(admin()){acts.push('<button data-act="resolve" data-id="'+root.id+'">'+(root.status==="resolved"?"Reabrir":"Resolver")+'</button>');if(!root.adminSeen)acts.push('<button data-act="seen" data-id="'+root.id+'">Marcar lido</button>');}
    const rh=reps.map(r=>'<div class="feedback-reply '+(r.role==="admin"?"by-admin":"")+'"><div class="feedback-meta"><strong>'+esc(r.role==="admin"?"Autor":r.author)+'</strong><span>'+when(r.at)+'</span>'+(own(r)?'<span class="feedback-mini-actions"><button data-act="edit" data-id="'+r.id+'">Editar</button><button data-act="del" data-id="'+r.id+'">Apagar</button></span>':"")+'</div><div class="feedback-text">'+esc(r.text)+'</div></div>').join("");
    return '<div class="feedback-thread"><div class="feedback-meta"><strong>'+esc(root.author)+'</strong><span>'+when(root.at)+'</span>'+(!root.adminSeen&&admin()?'<span class="feedback-status new">Novo</span>':"")+(root.status==="resolved"?'<span class="feedback-status resolved">Resolvido</span>':"")+'</div><div class="feedback-text">'+esc(root.text)+'</div>'+(acts.length?'<div class="feedback-actions">'+acts.join("")+'</div>':"")+(rh?'<div class="feedback-replies">'+rh+'</div>':"")+'<form class="feedback-reply-form" data-root="'+root.id+'"><input maxlength="500" placeholder="Responder…" required><button>Responder</button></form></div>';
  }

  function wireThreads(el,book){
    el.querySelectorAll("[data-act]").forEach(b=>b.onclick=async()=>{
      const x=findItem(book,b.dataset.id);if(!x)return;
      if(b.dataset.act==="edit")await edit(x); if(b.dataset.act==="del")await del(x); if(b.dataset.act==="resolve")await resolve(x,x.status!=="resolved"); if(b.dataset.act==="seen")await seen(x);
    });
    el.querySelectorAll(".feedback-reply-form").forEach(f=>f.onsubmit=async e=>{e.preventDefault();const x=findItem(book,f.dataset.root),inp=f.querySelector("input");if(x&&inp.value.trim()){await reply(x,inp.value.trim());inp.value="";}});
  }

  function render(){
    if(!active)return;
    const {bookId:book,chapterN:ch,containerEl,notesEl}=active, rr=roots(book), reactions=rCache[book]||[];
    const general=rr.filter(x=>x.chapter===ch&&Number(x.paraIdx)===-1&&rootVisible(x));
    if(notesEl){notesEl.hidden=!general.length;notesEl.innerHTML=general.length?'<div class="chapter-note-label">Notas do capítulo</div>'+general.map(x=>thread(x,book)).join(""):"";if(general.length)wireThreads(notesEl,book);}
    containerEl.querySelectorAll(".para-block").forEach(block=>{
      const i=Number(block.dataset.paraIdx),info=pInfo(block);block.dataset.paragraphKey=info.key;
      const vr=rr.filter(x=>loc(x,ch,i,info.key)&&rootVisible(x)), rx=reactions.filter(x=>loc(x,ch,i,info.key)), mine=rx.find(x=>x.authorId===uid());
      let a=block.querySelector(".para-actions"),panel=block.querySelector(".comment-panel");
      if(!a){
        a=document.createElement("div");a.className="para-actions";a.innerHTML='<button class="comment-toggle" title="Comentários"><svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M4 4h16v12H7l-3 3V4z"/></svg><span class="comment-count" hidden></span></button><button class="reaction-toggle" title="Reagir"><span class="reaction-face">☺</span></button><div class="reaction-summary"></div><div class="reaction-picker" hidden></div>';block.appendChild(a);
        panel=document.createElement("div");panel.className="comment-panel";panel.hidden=true;panel.innerHTML='<div class="comment-list"></div><form class="comment-form"><input maxlength="500" placeholder="Escreva um comentário…" required><button>Enviar</button></form>';block.appendChild(panel);
        a.querySelector(".comment-toggle").onclick=()=>{panel.hidden=!panel.hidden;if(!panel.hidden&&admin())vr.forEach(seen);};
        a.querySelector(".reaction-toggle").onclick=()=>{const p=a.querySelector(".reaction-picker");p.hidden=!p.hidden;};
        panel.querySelector(".comment-form").onsubmit=async e=>{e.preventDefault();const inp=e.currentTarget.querySelector("input");if(inp.value.trim()){await addRoot(book,ch,i,info.key,info.quote,inp.value.trim());inp.value="";}};
      }
      a=block.querySelector(".para-actions");panel=block.querySelector(".comment-panel");
      const cnt=a.querySelector(".comment-count");cnt.hidden=!vr.length;if(vr.length)cnt.textContent=vr.length;
      a.querySelector(".reaction-face").textContent=mine?.emoji||"☺";
      const counts={};rx.forEach(x=>counts[x.emoji]=(counts[x.emoji]||0)+1);
      a.querySelector(".reaction-summary").innerHTML=EMOJIS.filter(e=>counts[e]).map(e=>'<span class="reaction-count '+(mine?.emoji===e?"mine":"")+'">'+e+' '+counts[e]+'</span>').join("");
      const pick=a.querySelector(".reaction-picker");pick.innerHTML=EMOJIS.map(e=>'<button type="button" data-e="'+e+'" class="'+(mine?.emoji===e?"selected":"")+'">'+e+'</button>').join("");pick.querySelectorAll("button").forEach(b=>b.onclick=async()=>{pick.hidden=true;await react(book,ch,i,info.key,info.quote,b.dataset.e);});
      const list=panel.querySelector(".comment-list");list.innerHTML=vr.length?vr.sort((a,b)=>(a.at||0)-(b.at||0)).map(x=>thread(x,book)).join(""):'<p class="comment-empty">Nenhum comentário ainda.</p>';wireThreads(panel,book);
    });
  }

  async function attachChapter(bookId,chapterN,containerEl,notesEl){
    if(!enabled)return;active={bookId,chapterN,containerEl,notesEl};
    try{const d=await db.collection("config").doc("settings").get();showAll=d.exists&&!!d.data().showAllComments;}catch(e){}
    await load(bookId);subscribe(bookId);render();
  }

  return {
    init,attachChapter,isEnabled:()=>enabled,isAdmin:admin,getUserName:name,getUserId:uid,hashText,
    getDb:()=>db,getCachedComments:book=>(cCache[book]||[]),reply,edit,del,resolve,seen
  };
})();
window.Comments=Comments;\ndocument.addEventListener("DOMContentLoaded",()=>Comments.init());

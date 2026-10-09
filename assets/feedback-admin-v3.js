// Admin dashboard for beta-reader feedback
(() => {
  let all=[], unsub=null, open=false, lastItems=[];
  let knownNewIds=null;
  let betaFeedbackLiveRows=[],betaFeedbackUnsub=null,knownBetaVersions=null;
  let pendingBetaChapterFocus=null;
  const BETA_SEEN_KEY="lityra:admin:betaFeedbackSeen:v1";
  let exiladoReactionCleanupRunning=false,exiladoReactionCleanupDone=false;
  const RUINAS_REORDER_MIGRATION="ruinas-20-22-20261008-v1";
  const RUINAS_REORDER_CUTOFF=1791470872310;
  const APPROVAL_REQUIRED_AFTER=1791550800000;
  let ruinasReorderMigrationRunning=false,ruinasReorderMigrationDone=false;
  let notifyAudioCtx=null;

  function playNewCommentSound(){
    try{
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(!Ctx)return;
      if(!notifyAudioCtx)notifyAudioCtx=new Ctx();
      const ctx=notifyAudioCtx;
      if(ctx.state==="suspended")ctx.resume().catch(()=>{});
      const now=ctx.currentTime;
      [880,1320].forEach((freq,i)=>{
        const osc=ctx.createOscillator(),gain=ctx.createGain();
        osc.type="sine";osc.frequency.value=freq;
        const start=now+i*0.12;
        gain.gain.setValueAtTime(0,start);
        gain.gain.linearRampToValueAtTime(0.18,start+0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001,start+0.22);
        osc.connect(gain);gain.connect(ctx.destination);
        osc.start(start);osc.stop(start+0.24);
      });
    }catch(e){ /* som é só um extra, nunca deve travar o painel */ }
  }
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm=s=>String(s||"").replace(/\s+/g," ").trim().toLowerCase();
  const when=t=>t?new Date(t).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
  const whenFull=t=>t?new Date(t).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).replace(","," ·"):"";
  const commentWhen=x=>{
    const created=whenFull(x?.at),edited=whenFull(x?.editedAt);
    if(created&&edited)return created+" · editado "+edited;
    if(edited)return "editado "+edited;
    return created;
  };
  const shortId=id=>{const v=String(id||"").replace(/[^a-z0-9]/gi,"").toUpperCase();return v?v.slice(-6):"LEGADO";};
  const readerKey=x=>x.authorId||("legacy:"+norm(x.author));
  const readerLabel=x=>(x?.role==="admin"?"Autor":(x.author||"Anônimo"));
  const fmtDuration=value=>{
    const s=Math.max(0,Math.round(Number(value)||0));
    if(s<60)return s+"s";
    const m=Math.floor(s/60);
    if(m<60)return m+"min";
    const h=Math.floor(m/60),rest=m%60;
    return h+"h"+(rest?" "+rest+"min":"");
  };
  const pct=value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)));
  const THEME_LABELS={papel:"Papel",ambar:"Âmbar Noturno",grafite:"Grafite",azul:"Noite Azul",floresta:"Verde Floresta",vinho:"Vinho"};
  const FONT_LABELS={lora:"Lora",literata:"Literata",merriweather:"Merriweather",garamond:"EB Garamond",atkinson:"Atkinson"};
  const settingLabel=(map,value)=>map[value]||value||"—";

  function roots(){return all.filter(x=>!x.parentId&&x.kind!=="reply"&&x.kind!=="reaction");}
  function reactionsAll(){return all.filter(x=>x.kind==="reaction");}
  function replies(id){return all.filter(x=>x.parentId===id||x.rootId===id).sort((a,b)=>(a.at||0)-(b.at||0));}
  function authorReplies(id){return replies(id).filter(x=>x.role==="admin");}
  function activityStamp(root){
    const readerReplies=replies(root.id).filter(x=>x.role!=="admin");
    return Math.max(Number(root.updatedAt)||0,Number(root.editedAt)||0,Number(root.at)||0,...readerReplies.map(x=>Number(x.editedAt||x.at)||0));
  }
  function activityLabel(root){
    if(root.adminSeen)return "";
    const readerReplies=replies(root.id).filter(x=>x.role!=="admin");
    const latestReply=readerReplies.slice().sort((a,b)=>(Number(b.editedAt||b.at)||0)-(Number(a.editedAt||a.at)||0))[0];
    const replyAt=Number(latestReply?.editedAt||latestReply?.at)||0;
    const editAt=Number(root.editedAt)||0;
    if(editAt&&editAt>=replyAt)return "Comentário editado";
    if(latestReply)return latestReply.editedAt?"Resposta editada":"Nova resposta";
    if((Number(root.updatedAt)||0)>(Number(root.at)||0))return "Nova atividade";
    return "Novo comentário";
  }
  function find(id){return all.find(x=>x.id===id);}
  function db(){return window.Comments?.getDb?.();}

  function readBetaSeen(){
    try{return JSON.parse(localStorage.getItem(BETA_SEEN_KEY)||"{}")||{};}
    catch(e){return {};}
  }
  function betaVersion(row){return Number(row?.updatedAt||row?.createdAt)||0;}
  function betaFeedbackIsUnseen(row){
    if(!row||row.type!=="chapter")return false;
    const seen=readBetaSeen();
    return betaVersion(row)>Number(seen[row.id]||0);
  }
  function betaUnreadRows(){
    return betaFeedbackLiveRows.filter(betaFeedbackIsUnseen);
  }
  function markBetaRowsSeen(rows){
    if(!rows?.length)return;
    const seen=readBetaSeen();
    rows.forEach(row=>{seen[row.id]=Math.max(Number(seen[row.id]||0),betaVersion(row));});
    try{localStorage.setItem(BETA_SEEN_KEY,JSON.stringify(seen));}catch(e){}
    badge();
    updateFeedbackHub();
    const betaSheet=document.getElementById("betaFeedbackAdminSheet");
    if(betaSheet)renderBetaFeedbackAdmin();
  }
  function betaNotificationLabel(row){
    const who=row?.name||"Leitor";
    const where=row?.chapter?("Cap. "+row.chapter+(row.chapterTitle?" · "+row.chapterTitle:"")):"Avaliação beta";
    return {title:"Novo feedback beta",body:who+" · "+where};
  }
  function showBetaFeedbackToast(row){
    const info=betaNotificationLabel(row);
    let el=document.getElementById("adminBetaFeedbackToast");
    if(!el){
      el=document.createElement("button");
      el.id="adminBetaFeedbackToast";
      el.className="admin-beta-toast";
      el.type="button";
      document.body.appendChild(el);
    }
    el.innerHTML='<strong>💬 '+esc(info.title)+'</strong><span>'+esc(info.body)+'</span>';
    el.hidden=false;
    clearTimeout(showBetaFeedbackToast.timer);
    showBetaFeedbackToast.timer=setTimeout(()=>{el.hidden=true;},7000);
    el.onclick=()=>{
      el.hidden=true;
      pendingBetaChapterFocus={bookId:row.bookId,chapter:Number(row.chapter)||0};
      hideAdminHome();hideFeedbackHub();
      showBetaFeedbackAdmin();
    };
    try{
      if(document.visibilityState!=="visible"&&window.Notification?.permission==="granted"){
        new Notification(info.title,{body:info.body});
      }
    }catch(e){}
  }
  function subscribeBetaFeedback(){
    if(betaFeedbackUnsub||!Comments?.isAdmin?.()||!db())return;
    betaFeedbackUnsub=db().collection("betaFeedback").onSnapshot(s=>{
      const next=[];s.forEach(d=>next.push({id:d.id,...d.data()}));
      betaFeedbackLiveRows=next;
      const current=new Map(next.filter(x=>x.type==="chapter").map(x=>[x.id,betaVersion(x)]));
      if(knownBetaVersions){
        const fresh=next.filter(row=>{
          if(row.type!=="chapter"||!betaFeedbackIsUnseen(row))return false;
          const before=Number(knownBetaVersions.get(row.id)||0);
          return betaVersion(row)>before;
        }).sort((a,b)=>betaVersion(b)-betaVersion(a));
        if(fresh.length){
          playNewCommentSound();
          showBetaFeedbackToast(fresh[0]);
        }
      }
      knownBetaVersions=current;
      badge();updateFeedbackHub();
      const betaSheet=document.getElementById("betaFeedbackAdminSheet");
      if(betaSheet&&!betaSheet.hidden){
        betaFeedbackRows=next.slice();
        renderBetaFeedbackAdmin();
      }
    },e=>console.warn("Não foi possível acompanhar avaliações beta:",e));
  }

  function ensureButton(){
    const btn=document.getElementById("btnReaderHub");
    if(!btn)return null;
    const on=!!window.Comments?.isAdmin?.();
    btn.classList.toggle("admin-mode",on);
    if(on){
      btn.hidden=false;
      btn.title="Painel do autor";
      btn.setAttribute("aria-label","Painel do autor");
      const path=btn.querySelector("#topProfileIconPath");
      if(path)path.setAttribute("d","M12 2 4 5v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-3zm-1 14-4-4 1.4-1.4 2.6 2.57 4.6-4.6L17 10l-6 6z");
    }
    if(!btn.dataset.adminHomeWired){
      btn.dataset.adminHomeWired="1";
      btn.addEventListener("click",()=>{
        if(window.Comments?.isAdmin?.())showAdminHome();
      });
    }
    return btn;
  }

  function ensureAdminHome(){
    if(document.getElementById("authorAdminSheet"))return;
    const el=document.createElement("div");el.id="authorAdminSheet";el.className="admin-dashboard-sheet";el.hidden=true;
    el.innerHTML='<section class="admin-dashboard admin-home"><header class="admin-dashboard-head"><div><h2>Painel do autor</h2><p>Leitores, feedback, análises e comunicação em um só lugar.</p></div><div class="admin-head-actions"><button id="authorAdminClose" class="icon-btn" type="button">✕</button></div></header>'
      +'<div class="admin-home-summary"><span><b id="adminHomeReaderStat">—</b> leitores</span><span><b id="adminHomeLiveStat">—</b> ativos agora</span><span><b id="adminHomeFeedbackStat">—</b> novidades</span><span><b id="adminHomeMessageStat">—</b> mensagens pendentes</span></div>'
      +'<div class="admin-home-grid">'
        +'<button id="openReaderAccess" class="admin-home-card" type="button"><strong>👥 Leitores</strong><span>Progresso, atividade, livros liberados, códigos e gestão individual.</span></button>'
        +'<button id="openFeedbackHub" class="admin-home-card" type="button"><strong>💬 Feedback</strong><span>Comentários, respostas, reações e avaliações beta.</span><span id="adminHomeNewCount" class="admin-new-count" hidden></span></button>'
        +'<button id="openAnalyticsDashboard" class="admin-home-card" type="button"><strong>📊 Análises</strong><span>Comportamento geral de leitura, tempo, áudio e preferências.</span></button>'
        +'<button id="openPopupDashboard" class="admin-home-card" type="button"><strong>📣 Mensagens</strong><span>Envie recados, acompanhe leitura e reutilize modelos.</span></button>'
      +'</div>'
      +'<footer class="admin-home-footer"><button id="authorAdminLogout" class="link-btn admin-home-logout" type="button">Sair do admin</button></footer>'
      +'</section>';
    document.body.appendChild(el);
    el.querySelector("#authorAdminClose").onclick=hideAdminHome;
    el.querySelector("#authorAdminLogout").onclick=()=>{hideAdminHome();document.dispatchEvent(new CustomEvent("beta:admin-logout"));};
    el.querySelector("#openReaderAccess").onclick=()=>{hideAdminHome();showAccess();};
    el.querySelector("#openFeedbackHub").onclick=()=>{hideAdminHome();showFeedbackHub();};
    el.querySelector("#openAnalyticsDashboard").onclick=()=>{hideAdminHome();showAnalytics();};
    el.querySelector("#openPopupDashboard").onclick=()=>{hideAdminHome();window.PopupMessages?.openAdmin?.();};
    el.onclick=e=>{if(e.target===el)hideAdminHome();};
  }

  async function refreshAdminHomeStats(){
    const home=document.getElementById("authorAdminSheet");
    if(!home||home.hidden||!db())return;
    const set=(id,value)=>{const x=document.getElementById(id);if(x)x.textContent=String(value);};
    set("adminHomeFeedbackStat",roots().filter(r=>!r.adminSeen).length+betaUnreadRows().length);
    try{
      const [profiles,presenceSnap,messageSnap]=await Promise.all([
        Comments.listReaderProfiles(),
        db().collection("readerPresence").get().catch(()=>null),
        db().collection("popupMessages").get().catch(()=>null)
      ]);
      set("adminHomeReaderStat",profiles.length);
      let live=0;
      presenceSnap?.forEach(d=>{
        const p=d.data()||{},age=Date.now()-(Number(p.heartbeatAt)||0);
        if(age<=45000&&p.active)live++;
      });
      set("adminHomeLiveStat",live);
      let pending=0;
      messageSnap?.forEach(d=>{const m=d.data()||{};if(!m.shownAt&&!m.readAt)pending++;});
      set("adminHomeMessageStat",pending);
    }catch(e){/* resumo é informativo; o painel continua funcional sem ele */}
  }

  function ensureFeedbackHub(){
    if(document.getElementById("feedbackHubSheet"))return;
    const el=document.createElement("div");el.id="feedbackHubSheet";el.className="admin-dashboard-sheet";el.hidden=true;
    el.innerHTML='<section class="admin-dashboard feedback-hub"><header class="admin-dashboard-head"><div><h2>Feedback</h2><p>Tudo o que os leitores disseram ou sinalizaram sobre a obra.</p></div><div class="admin-head-actions"><button id="feedbackHubBack" class="link-btn admin-back-btn" type="button">← Painel</button><button id="feedbackHubClose" class="icon-btn" type="button">✕</button></div></header>'
      +'<div class="feedback-hub-summary"><span><b id="feedbackHubCommentCount">0</b> comentários</span><span><b id="feedbackHubReactionCount">0</b> reações</span><span><b id="feedbackHubBetaCount">—</b> avaliações</span></div>'
      +'<div class="admin-home-grid">'
        +'<button id="feedbackHubComments" class="admin-home-card" type="button"><strong>Comentários e respostas</strong><span>Leia, responda, resolva e acompanhe edições dos leitores.</span><span id="feedbackHubNewCount" class="admin-new-count" hidden></span></button>'
        +'<button id="feedbackHubReactions" class="admin-home-card" type="button"><strong>Reações</strong><span>Veja o mapa emocional dos trechos e quem reagiu a cada passagem.</span></button>'
        +'<button id="feedbackHubBeta" class="admin-home-card" type="button"><strong>Avaliações beta</strong><span>Capa, capítulos, opinião final e exportação estruturada para IA.</span><span id="feedbackHubBetaNewCount" class="admin-new-count" hidden></span></button>'
      +'</div></section>';
    document.body.appendChild(el);
    el.querySelector("#feedbackHubBack").onclick=()=>{hideFeedbackHub();showAdminHome();};
    el.querySelector("#feedbackHubClose").onclick=hideFeedbackHub;
    el.querySelector("#feedbackHubComments").onclick=()=>{hideFeedbackHub();show();};
    el.querySelector("#feedbackHubReactions").onclick=()=>{hideFeedbackHub();showReactions();};
    el.querySelector("#feedbackHubBeta").onclick=()=>{hideFeedbackHub();showBetaFeedbackAdmin();};
    el.onclick=e=>{if(e.target===el)hideFeedbackHub();};
  }

  function updateFeedbackHub(){
    const sheet=document.getElementById("feedbackHubSheet");
    if(!sheet)return;
    const comments=roots().length,reactions=reactionsAll().length,unseen=roots().filter(r=>!r.adminSeen).length;
    const betaUnseen=betaUnreadRows().length;
    const c=sheet.querySelector("#feedbackHubCommentCount"),r=sheet.querySelector("#feedbackHubReactionCount"),b=sheet.querySelector("#feedbackHubNewCount");
    const betaCount=sheet.querySelector("#feedbackHubBetaCount"),betaBadge=sheet.querySelector("#feedbackHubBetaNewCount");
    if(c)c.textContent=String(comments);
    if(r)r.textContent=String(reactions);
    if(betaCount)betaCount.textContent=String(betaFeedbackLiveRows.length);
    if(b){b.hidden=!unseen;b.textContent=unseen>99?"99+":String(unseen);}
    if(betaBadge){betaBadge.hidden=!betaUnseen;betaBadge.textContent=betaUnseen>99?"99+":String(betaUnseen);}
  }
  function showFeedbackHub(){
    if(!Comments?.isAdmin?.())return;
    ensureFeedbackHub();subscribe();
    const sheet=document.getElementById("feedbackHubSheet");sheet.hidden=false;updateFeedbackHub();
  }
  function hideFeedbackHub(){const x=document.getElementById("feedbackHubSheet");if(x)x.hidden=true;}

  function ensureReactionSheet(){
    if(document.getElementById("reactionAdminSheet"))return;
    const el=document.createElement("div");el.id="reactionAdminSheet";el.className="admin-dashboard-sheet";el.hidden=true;
    el.innerHTML='<section class="admin-dashboard"><header class="admin-dashboard-head"><div><h2>Reações</h2><p>Mapa emocional dos trechos reagidos pelos leitores.</p></div><div class="admin-head-actions"><button id="reactionBack" class="link-btn admin-back-btn" type="button">← Feedback</button><button id="reactionClose" class="icon-btn" type="button">✕</button></div></header>'
      +'<div class="admin-dashboard-filters"><select id="reactionBook"><option value="">Todos os livros</option></select><select id="reactionChapter"><option value="">Todos os capítulos</option></select><select id="reactionAuthor"><option value="">Todos os leitores</option></select><select id="reactionEmoji"><option value="">Todos os emojis</option><option>😍</option><option>😂</option><option>😱</option><option>😢</option><option>🤔</option><option>😡</option></select></div>'
      +'<div id="reactionAdminList" class="admin-dashboard-list"></div></section>';
    document.body.appendChild(el);
    el.querySelector("#reactionBack").onclick=()=>{hideReactions();showFeedbackHub();};
    el.querySelector("#reactionClose").onclick=hideReactions;
    ["reactionBook","reactionChapter","reactionAuthor","reactionEmoji"].forEach(id=>el.querySelector("#"+id).addEventListener("change",renderReactions));
    el.onclick=e=>{if(e.target===el)hideReactions();};
  }

  function renderReactions(){
    const sheet=document.getElementById("reactionAdminSheet");if(!sheet||sheet.hidden)return;
    const bk=sheet.querySelector("#reactionBook"),ch=sheet.querySelector("#reactionChapter"),au=sheet.querySelector("#reactionAuthor"),em=sheet.querySelector("#reactionEmoji"),list=sheet.querySelector("#reactionAdminList");
    const bv=bk.value,cv=ch.value,av=au.value,ev=em.value;
    const rr=reactionsAll();
    const books=[...new Set(rr.map(x=>x.bookId).filter(Boolean))].sort();
    const authors=[...new Set(rr.map(x=>x.author).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
    const chapters=[...new Set(rr.filter(x=>!bv||x.bookId===bv).map(x=>String(x.chapter)))].sort((a,b)=>Number(a)-Number(b));
    fill(bk,books,bv);fill(ch,chapters,cv,v=>"Capítulo "+v);fill(au,authors,av);
    const items=rr.filter(x=>(!bk.value||x.bookId===bk.value)&&(!ch.value||String(x.chapter)===ch.value)&&(!au.value||x.author===au.value)&&(!ev||x.emoji===ev))
      .sort((a,b)=>(Number(b.updatedAt||b.at)||0)-(Number(a.updatedAt||a.at)||0));
    if(!items.length){list.innerHTML='<p class="admin-empty">Nenhuma reação neste filtro.</p>';return;}
    const counts={};items.forEach(x=>counts[x.emoji]=(counts[x.emoji]||0)+1);
    list.innerHTML='<div class="reaction-overview">'+Object.entries(counts).map(([emoji,count])=>'<span>'+emoji+' <b>'+count+'</b></span>').join("")+'</div>'
      +items.map(x=>'<article class="admin-comment-card reaction-admin-card"><div class="reaction-admin-emoji">'+esc(x.emoji||"")+'</div><div class="reaction-admin-body"><div class="admin-card-top"><div><strong>'+esc(x.author||"Anônimo")+'</strong><span>'+esc(x.bookId||"")+' · Cap. '+esc(x.chapter)+' · §'+(Number(x.paraIdx)+1)+'</span><span>'+esc(whenFull(x.at))+'</span></div></div>'+(x.quote?'<blockquote>'+esc(x.quote)+'</blockquote>':"")+'<div class="admin-card-actions"><button data-reaction-goto="'+esc(x.id)+'">Ver trecho</button></div></div></article>').join("");
    list.querySelectorAll("[data-reaction-goto]").forEach(btn=>btn.onclick=()=>{
      const x=all.find(item=>item.id===btn.dataset.reactionGoto);if(!x)return;
      hideReactions();window.BookReader?.openLocation?.(x.bookId,x.chapter,x.paraIdx,x.paragraphKey);
    });
  }
  function showReactions(){if(!Comments?.isAdmin?.())return;ensureReactionSheet();subscribe();document.getElementById("reactionAdminSheet").hidden=false;renderReactions();}
  function hideReactions(){const x=document.getElementById("reactionAdminSheet");if(x)x.hidden=true;}


  function ensureSheet(){
    if(document.getElementById("commentAdminSheet"))return;
    const el=document.createElement("div");el.id="commentAdminSheet";el.className="admin-dashboard-sheet";el.hidden=true;
    el.innerHTML='<section class="admin-dashboard"><header class="admin-dashboard-head"><div><h2>Comentários e respostas</h2><p>Leia, responda e acompanhe comentários novos ou editados.</p></div><div class="admin-head-actions"><button id="adminDashBack" class="link-btn admin-back-btn" type="button">← Feedback</button><button id="adminDashClose" class="icon-btn" type="button">✕</button></div></header><div class="admin-dashboard-filters"><select id="afStatus" title="Filtrar por situação"><option value="all">Situação: todas</option><option value="open">Abertos</option><option value="resolved">Resolvidos</option></select><select id="afReply" title="Filtrar por resposta"><option value="all">Resposta: todas</option><option value="unanswered">Sem minha resposta</option><option value="answered">Respondidos por mim</option></select><label class="admin-filter-toggle" title="Mostrar apenas comentários ainda não lidos"><input id="afUnread" type="checkbox"><span>Só não lidos</span></label><select id="afBook"><option value="">Todos os livros</option></select><select id="afChapter"><option value="">Todos os capítulos</option></select><select id="afAuthor"><option value="">Todos os leitores</option></select><select id="afSort" title="Classificar comentários"><option value="unread">Não lidos primeiro</option><option value="newest">Mais novos primeiro</option><option value="oldest">Mais antigos primeiro</option><option value="book">Ordem do livro</option></select><input id="afSearch" type="search" placeholder="Buscar comentário ou resposta…"></div><div class="admin-dashboard-bulk"><button id="afMarkReadAll" type="button" class="link-btn">Marcar exibidos como lidos</button><button id="afMarkUnreadAll" type="button" class="link-btn">Marcar exibidos como não lidos</button></div><div id="adminDashboardList" class="admin-dashboard-list"></div></section>';
    document.body.appendChild(el);
    el.querySelector("#adminDashBack").onclick=()=>{hide();showFeedbackHub();};
    el.querySelector("#adminDashClose").onclick=hide;
    el.onclick=e=>{if(e.target===el)hide();};
    ["afStatus","afReply","afUnread","afBook","afChapter","afAuthor","afSort","afSearch"].forEach(id=>{
      const x=el.querySelector("#"+id);x.addEventListener(x.tagName==="INPUT"?"input":"change",render);
    });
    el.querySelector("#afMarkReadAll").onclick=()=>bulkMark(true);
    el.querySelector("#afMarkUnreadAll").onclick=()=>bulkMark(false);
    ensureReplyComposer();
  }

  let composerRoot=null,composerReply=null;
  function ensureReplyComposer(){
    if(document.getElementById("adminReplyComposer"))return;
    const el=document.createElement("div");
    el.id="adminReplyComposer";
    el.className="reply-composer-sheet";
    el.hidden=true;
    el.innerHTML='<section class="reply-composer-card" role="dialog" aria-modal="true" aria-labelledby="replyComposerTitle">'
      +'<div class="reply-composer-head"><div><span class="reply-composer-kicker">Resposta do autor</span><h2 id="replyComposerTitle">Responder comentário</h2></div><button id="replyComposerClose" class="icon-btn" type="button">✕</button></div>'
      +'<div id="replyComposerContext" class="reply-composer-context"></div>'
      +'<label class="reply-composer-field"><span>Sua resposta</span><textarea id="replyComposerText" maxlength="500" rows="5" placeholder="Escreva uma resposta clara e gentil…"></textarea><small><span id="replyComposerCount">0</span>/500</small></label>'
      +'<p id="replyComposerStatus" class="reply-composer-status" aria-live="polite"></p>'
      +'<div class="reply-composer-actions"><button id="replyComposerCancel" class="btn-ghost" type="button">Cancelar</button><button id="replyComposerSave" class="btn-primary" type="button">Enviar resposta</button></div>'
      +'</section>';
    document.body.appendChild(el);
    const ta=el.querySelector("#replyComposerText");
    const close=()=>{composerRoot=null;composerReply=null;el.hidden=true;el.querySelector("#replyComposerStatus").textContent="";};
    el.querySelector("#replyComposerClose").onclick=close;
    el.querySelector("#replyComposerCancel").onclick=close;
    el.onclick=e=>{if(e.target===el)close();};
    ta.addEventListener("input",()=>{el.querySelector("#replyComposerCount").textContent=String(ta.value.length);});
    el.querySelector("#replyComposerSave").onclick=async()=>{
      const value=ta.value.trim();
      if(!value||!composerRoot)return;
      const btn=el.querySelector("#replyComposerSave"),status=el.querySelector("#replyComposerStatus");
      btn.disabled=true;
      status.textContent=composerReply?"Salvando edição…":"Enviando resposta…";
      try{
        if(composerReply)await Comments.saveText(composerReply,value);
        else await Comments.reply(composerRoot,value);
        close();
        render();
      }catch(e){
        status.textContent=e?.message||"Não foi possível salvar a resposta.";
      }finally{btn.disabled=false;}
    };
  }

  function openReplyComposer(root,reply=null){
    if(!root)return;
    ensureReplyComposer();
    composerRoot=root;composerReply=reply;
    const el=document.getElementById("adminReplyComposer");
    const ta=el.querySelector("#replyComposerText");
    el.querySelector("#replyComposerTitle").textContent=reply?"Editar minha resposta":"Responder a "+(root.author||"leitor");
    el.querySelector("#replyComposerSave").textContent=reply?"Salvar alteração":"Enviar resposta";
    el.querySelector("#replyComposerContext").innerHTML=(root.quote?'<blockquote>'+esc(root.quote)+'</blockquote>':"")+'<div class="reply-composer-original"><strong>'+esc(root.author||"Leitor")+'</strong><p>'+esc(root.text||"")+'</p></div>';
    ta.value=reply?.text||"";
    el.querySelector("#replyComposerCount").textContent=String(ta.value.length);
    el.querySelector("#replyComposerStatus").textContent="";
    el.hidden=false;
    setTimeout(()=>{ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);},0);
  }


  function ruinasReorderTarget(ch,idx){
    const c=Number(ch),i=Number(idx);
    if(!Number.isFinite(i))return null;
    if(c===20){
      if(i>=0&&i<=52)return [20,i];
      if(i===53)return [21,0];
      if(i>=54&&i<=155)return [21,i-54];
    }
    if(c===21){
      if(i>=0&&i<=128)return [22,i];
      if(i>=129&&i<=141)return [20,53+(i-129)];
      if(i>=142&&i<=163)return [22,127];
      if(i>=164&&i<=177)return [20,66+(i-164)];
      if(i>=178&&i<=180)return [22,130+(i-178)];
      if(i===181)return [20,79];
      if(i>=182&&i<=198)return [22,141];
      if(i>=199&&i<=205)return [22,136+(i-199)];
      if(i>=206&&i<=216)return [22,179];
      if(i>=217&&i<=224)return [22,152];
      if(i>=225&&i<=226)return [22,143+(i-225)];
      if(i>=227&&i<=268)return [20,80+(i-227)];
    }
    if(c===22){
      if(i>=0&&i<=207)return [20,122+i];
      if(i>=208&&i<=239)return [20,331+(i-208)];
      if(i===240)return [22,153];
      if(i>=241&&i<=265)return [22,154+(i-241)];
      if(i>=266&&i<=269)return [22,180+(i-266)];
      if(i===270)return [23,1];
    }
    return null;
  }

  async function ruinasMigrationParagraphs(){
    const files={
      20:"content/ruinas-dos-ceus/capitulos/20 - Capítulo 20 - O Exilado.md",
      21:"content/ruinas-dos-ceus/capitulos/21 - Capítulo 21 - Ruínas dos Céus.md",
      22:"content/ruinas-dos-ceus/capitulos/22 - Capítulo 22 - A Âncora e o Sopro.md",
      23:"content/ruinas-dos-ceus/capitulos/23 - Capítulo 23 - O Peso da Verdade.md"
    };
    const out={};
    for(const [ch,path] of Object.entries(files)){
      const res=await fetch(new URL(path,document.baseURI).href,{cache:"no-store"});
      if(!res.ok)throw new Error("Não consegui carregar o capítulo "+ch+" para migrar o feedback.");
      out[ch]=(await res.text()).replace(/\r\n/g,"\n").trim().split(/\n\s*\n+/).filter(Boolean);
    }
    return out;
  }

  async function migrateRuinasReorderFeedback(){
    if(ruinasReorderMigrationDone||ruinasReorderMigrationRunning||!Comments?.isAdmin?.()||!db())return;
    const localKey="lityra:migration:"+RUINAS_REORDER_MIGRATION;
    if(localStorage.getItem(localKey)==="done"){ruinasReorderMigrationDone=true;return;}
    ruinasReorderMigrationRunning=true;
    try{
      const [snap,targetParas]=await Promise.all([
        db().collection("comments").where("bookId","==","ruinas-dos-ceus").get(),
        ruinasMigrationParagraphs()
      ]);
      const changes=[],unmapped=[];
      snap.forEach(doc=>{
        const x={id:doc.id,...doc.data()};
        if(x.layoutMigration===RUINAS_REORDER_MIGRATION)return;
        const at=Number(x.at)||0;
        if(at&&at>RUINAS_REORDER_CUTOFF)return;
        const ch=Number(x.chapter);
        if(ch<20||ch>22)return;
        const target=ruinasReorderTarget(ch,x.paraIdx);
        if(!target){unmapped.push({id:x.id,chapter:ch,paraIdx:x.paraIdx,kind:x.kind||"comment"});return;}
        const [newCh,newIdx]=target;
        const para=targetParas[String(newCh)]?.[newIdx];
        if(typeof para!=="string"){unmapped.push({id:x.id,chapter:ch,paraIdx:x.paraIdx,target,kind:x.kind||"comment"});return;}
        changes.push({
          ref:doc.ref,
          data:{
            chapter:newCh,
            paraIdx:newIdx,
            paragraphKey:"p_"+Comments.hashText(para),
            quote:norm(para).slice(0,220),
            layoutMigration:RUINAS_REORDER_MIGRATION
          }
        });
      });

      for(let i=0;i<changes.length;i+=350){
        const batch=db().batch();
        changes.slice(i,i+350).forEach(x=>batch.set(x.ref,x.data,{merge:true}));
        await batch.commit();
      }

      const verify=await db().collection("comments").where("bookId","==","ruinas-dos-ceus").get();
      const remaining=[];
      verify.forEach(doc=>{
        const x=doc.data()||{},at=Number(x.at)||0,ch=Number(x.chapter);
        if(ch>=20&&ch<=22&&(!at||at<=RUINAS_REORDER_CUTOFF)&&x.layoutMigration!==RUINAS_REORDER_MIGRATION){
          remaining.push({id:doc.id,chapter:ch,paraIdx:x.paraIdx,kind:x.kind||"comment"});
        }
      });

      const report={
        id:RUINAS_REORDER_MIGRATION,
        moved:changes.length,
        unmapped,
        remaining,
        verifiedAt:Date.now()
      };
      window.__ruinasFeedbackMigrationReport=report;
      localStorage.setItem("lityra:migration:report:"+RUINAS_REORDER_MIGRATION,JSON.stringify(report));
      if(!unmapped.length&&!remaining.length){
        localStorage.setItem(localKey,"done");
        ruinasReorderMigrationDone=true;
        console.info("Migração dos capítulos 20–22 concluída:",changes.length,"itens de feedback.");
      }else{
        console.warn("Migração dos capítulos 20–22 precisa de revisão:",report);
      }
    }catch(e){
      console.warn("Não foi possível migrar automaticamente o feedback dos capítulos 20–22:",e);
    }finally{
      ruinasReorderMigrationRunning=false;
    }
  }

  async function cleanupExiladoOldReactions(){
    if(exiladoReactionCleanupDone||exiladoReactionCleanupRunning||!Comments?.isAdmin?.()||!db())return;
    const targets=all.filter(x=>{
      const at=Number(x.at)||0;
      const oldEnough=!at||at<=RUINAS_REORDER_CUTOFF;
      const oldLocation=Number(x.chapter)===22&&x.layoutMigration!==RUINAS_REORDER_MIGRATION;
      const migratedLocation=Number(x.chapter)===20&&x.layoutMigration===RUINAS_REORDER_MIGRATION;
      return x.kind==="reaction"
        && x.bookId==="ruinas-dos-ceus"
        && oldEnough
        && (oldLocation||migratedLocation)
        && (x.emoji==="😂"||x.emoji==="😍");
    });
    if(!targets.length){exiladoReactionCleanupDone=true;return;}
    exiladoReactionCleanupRunning=true;
    try{
      for(let i=0;i<targets.length;i+=400){
        const batch=db().batch();
        targets.slice(i,i+400).forEach(x=>batch.delete(db().collection("comments").doc(x.id)));
        await batch.commit();
      }
      exiladoReactionCleanupDone=true;
      console.info("Reações 😂/😍 antigas removidas de O Exilado:",targets.length);
    }catch(e){
      console.warn("Não foi possível limpar as reações antigas de O Exilado:",e);
    }finally{
      exiladoReactionCleanupRunning=false;
    }
  }

  function subscribe(){
    subscribeBetaFeedback();
    if(unsub||!Comments?.isAdmin?.()||!db())return;
    unsub=db().collection("comments").onSnapshot(s=>{
      all=[];s.forEach(d=>all.push({id:d.id,...d.data()}));
      const currentNew=new Map(roots().filter(r=>!r.adminSeen).map(r=>[r.id,activityStamp(r)]));
      if(knownNewIds){
        let hasFresh=false;
        currentNew.forEach((stamp,id)=>{
          if(!knownNewIds.has(id)||stamp>(knownNewIds.get(id)||0))hasFresh=true;
        });
        if(hasFresh)playNewCommentSound();
      }
      knownNewIds=currentNew;
      migrateRuinasReorderFeedback();
      cleanupExiladoOldReactions();
      badge();updateFeedbackHub();if(open)render();
      const reactionSheet=document.getElementById("reactionAdminSheet");if(reactionSheet&&!reactionSheet.hidden)renderReactions();
    });
  }
  function stop(){
    unsub?.();unsub=null;all=[];knownNewIds=null;
    betaFeedbackUnsub?.();betaFeedbackUnsub=null;betaFeedbackLiveRows=[];knownBetaVersions=null;
    badge();
  }
  function badge(){
    const commentN=roots().filter(r=>!r.adminSeen).length;
    const betaN=betaUnreadRows().length;
    const n=commentN+betaN;
    const targets=[
      document.getElementById("adminHomeNewCount"),
      document.getElementById("feedbackHubNewCount"),
      ...(window.Comments?.isAdmin?.()?[document.getElementById("readerHubBadge")]:[])
    ];
    targets.forEach(x=>{
      if(!x)return;
      x.hidden=!n;
      x.textContent=n>99?"99+":String(n);
    });
    const homeStat=document.getElementById("adminHomeFeedbackStat");if(homeStat)homeStat.textContent=String(n);
    const top=document.getElementById("btnReaderHub");
    if(top&&window.Comments?.isAdmin?.()){
      const label=n
        ? "Painel do autor · "+n+" "+(n===1?"novidade":"novidades")
        : "Painel do autor";
      top.title=label;
      top.setAttribute("aria-label",label);
    }
  }

  function fill(sel,vals,current,label){
    const first=sel.options[0]?.outerHTML||'<option value="">Todos</option>';
    sel.innerHTML=first+vals.map(v=>'<option value="'+esc(v)+'">'+esc(label?label(v):v)+'</option>').join("");
    sel.value=current;
  }

  function render(){
    if(!open)return;
    const sheet=document.getElementById("commentAdminSheet"),list=sheet.querySelector("#adminDashboardList");
    const st=sheet.querySelector("#afStatus"),rf=sheet.querySelector("#afReply"),ur=sheet.querySelector("#afUnread"),bk=sheet.querySelector("#afBook"),ch=sheet.querySelector("#afChapter"),au=sheet.querySelector("#afAuthor"),so=sheet.querySelector("#afSort"),se=sheet.querySelector("#afSearch");
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
      const reps=replies(r.id),answered=reps.some(x=>x.role==="admin");
      if(st.value==="open"&&r.status==="resolved")return false;
      if(st.value==="resolved"&&r.status!=="resolved")return false;
      if(rf.value==="answered"&&!answered)return false;
      if(rf.value==="unanswered"&&answered)return false;
      if(ur?.checked&&r.adminSeen)return false;
      if(bk.value&&r.bookId!==bk.value)return false;
      if(ch.value&&String(r.chapter)!==ch.value)return false;
      if(au.value&&readerKey(r)!==au.value)return false;
      const haystack=(r.text||"")+" "+(r.quote||"")+" "+(r.author||"")+" "+reps.map(x=>x.text||"").join(" ");
      if(q&&!norm(haystack).includes(q))return false;
      return true;
    });
    items.sort((a,b)=>{
      const atA=a.updatedAt||a.at||0,atB=b.updatedAt||b.at||0;
      if(so.value==="newest")return atB-atA;
      if(so.value==="oldest")return atA-atB;
      if(so.value==="book"){
        const byBook=String(a.bookId||"").localeCompare(String(b.bookId||""),"pt-BR");
        if(byBook)return byBook;
        const byChapter=Number(a.chapter||0)-Number(b.chapter||0);
        if(byChapter)return byChapter;
        const byParagraph=Number(a.paraIdx||0)-Number(b.paraIdx||0);
        if(byParagraph)return byParagraph;
        return atA-atB;
      }
      const an=a.adminSeen?0:1,bn=b.adminSeen?0:1;
      return an!==bn?bn-an:atB-atA;
    });
    lastItems=items;
    if(!items.length){list.innerHTML='<p class="admin-empty">Nenhum comentário neste filtro.</p>';return;}

    list.innerHTML=items.map(r=>{
      const reps=replies(r.id),myReplies=reps.filter(x=>x.role==="admin");
      const rp=reps.map(x=>{
        const isMine=x.role==="admin";
        const actions='<span class="feedback-mini-actions">'+(isMine?'<button data-a="edit-reply" data-id="'+x.id+'" data-root="'+r.id+'">Editar</button>':"")+'<button data-a="del-reply" data-id="'+x.id+'" data-root="'+r.id+'">Apagar</button></span>';
        return '<div class="feedback-reply '+(isMine?"by-admin":"")+'"><div class="feedback-meta"><strong>'+esc(isMine?"Sua resposta":readerLabel(x))+'</strong><span>'+esc(commentWhen(x))+'</span>'+actions+'</div><div class="feedback-text">'+esc(x.text)+'</div></div>';
      }).join("");
      const activity=activityLabel(r),activityClass=/editad/i.test(activity)?"edited":"new";
      const badges=(!r.adminSeen?'<span class="feedback-status '+activityClass+'">'+esc(activity||"Novo")+'</span>':"")
        +(myReplies.length?'<span class="feedback-status answered">Respondido</span>':"")
        +(r.status==="resolved"?'<span class="feedback-status resolved">Resolvido</span>':"");
      const editRoot=r.role==="admin"?'<button data-a="edit-root" data-id="'+r.id+'">Editar</button>':"";
      const replyLabel=myReplies.length?"Responder novamente":"Responder";
      return '<article class="admin-comment-card '+(!r.adminSeen?"is-new":"")+'">'
        +'<div class="admin-card-top"><div><strong>'+esc(readerLabel(r))+'</strong>'+(commentWhen(r)?'<span class="feedback-comment-time">'+esc(commentWhen(r))+'</span>':"")+'<span>'+esc(r.bookId||"")+' · Cap. '+esc(r.chapter)+' · §'+(Number(r.paraIdx)+1)+'</span></div><div>'+badges+'</div></div>'
        +(r.quote?'<blockquote>'+esc(r.quote)+'</blockquote>':"")
        +'<div class="admin-root-text">'+esc(r.text||"")+'</div>'
        +(rp?'<div class="feedback-replies">'+rp+'</div>':"")
        +'<div class="admin-card-actions"><button data-a="goto" data-id="'+r.id+'">Ver trecho</button><button data-a="reply" data-id="'+r.id+'">'+replyLabel+'</button><button data-a="resolve" data-id="'+r.id+'">'+(r.status==="resolved"?"Reabrir":"Resolver")+'</button>'+editRoot+'<button data-a="del" data-id="'+r.id+'">Apagar</button>'+(!r.adminSeen?'<button data-a="seen" data-id="'+r.id+'">Marcar lido</button>':'<button data-a="unseen" data-id="'+r.id+'">Marcar não lido</button>')+'</div>'
        +'</article>';
    }).join("");

    list.querySelectorAll("[data-a]").forEach(b=>b.onclick=async()=>{
      const action=b.dataset.a;
      if(action==="edit-reply"){
        const reply=find(b.dataset.id),root=find(b.dataset.root);
        if(reply&&root)openReplyComposer(root,reply);
        return;
      }
      if(action==="del-reply"){
        const x=find(b.dataset.id);if(x)await Comments.del(x);
        return;
      }
      const r=find(b.dataset.id);if(!r)return;
      if(action==="reply")openReplyComposer(r);
      if(action==="resolve")await Comments.resolve(r,r.status!=="resolved");
      if(action==="edit-root")await Comments.edit(r);
      if(action==="del")await Comments.del(r);
      if(action==="seen")await Comments.seen(r);
      if(action==="unseen")await Comments.unseen(r);
      if(action==="goto"){await Comments.seen(r);hide();window.BookReader?.openLocation?.(r.bookId,r.chapter,r.paraIdx,r.paragraphKey,r.id);}
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
  let adminHomeRefreshTimer=null;
  function showAdminHome(){
    if(!Comments?.isAdmin?.())return;ensureAdminHome();subscribe();document.getElementById("authorAdminSheet").hidden=false;badge();refreshAdminHomeStats();
    if(adminHomeRefreshTimer)clearInterval(adminHomeRefreshTimer);
    adminHomeRefreshTimer=setInterval(()=>{if(document.visibilityState==="visible")refreshAdminHomeStats();},30000);
  }
  function hideAdminHome(){const x=document.getElementById("authorAdminSheet");if(x)x.hidden=true;if(adminHomeRefreshTimer){clearInterval(adminHomeRefreshTimer);adminHomeRefreshTimer=null;}}

  // ---------------- Análises de leitura ----------------
  let analyticsRows=[];
  let analyticsReturnTo="home";
  let diagMap=new Map(),diagAvailable=false;
  let commentMap=new Map(),bookTitles=new Map();
  function lastContact(readerId,a){
    const d=diagMap.get(String(readerId||""))||null;
    const p=presenceFor(readerId);
    return Math.max(Number(d?.seenAt)||0,Number(p?.heartbeatAt)||0,Number(a?.updatedAt)||0);
  }
  async function loadBookTitles(){
    if(bookTitles.size)return;
    try{
      const res=await fetch("data/books.json",{cache:"no-cache"});
      const json=await res.json();
      (json.books||[]).forEach(b=>bookTitles.set(String(b.id),String(b.title||b.id)));
    }catch(e){/* sem títulos: usa o id */}
  }
  // Comentários e reações funcionam em QUALQUER versão do app. Servem de
  // sinal de atividade quando o aparelho do leitor ainda roda uma versão
  // antiga que não envia métricas nem presença.
  async function loadCommentActivity(){
    commentMap=new Map();
    try{
      const snap=await db().collection("comments").orderBy("updatedAt","desc").limit(600).get();
      snap.forEach(d=>{
        const c=d.data()||{};
        const id=String(c.authorId||"");
        if(!id||c.role==="admin")return;
        const at=Number(c.updatedAt||c.at)||0;
        const cur=commentMap.get(id)||{count:0,lastAt:0};
        cur.count++;
        if(at>cur.lastAt){cur.lastAt=at;cur.bookId=c.bookId;cur.chapter=c.chapter;cur.kind=c.kind;}
        commentMap.set(id,cur);
      });
    }catch(e){console.warn("Atividade de comentários indisponível:",e);}
  }
  // Linha de diagnóstico: último contato do app + erro de sincronização, se houver.
  // Versões a partir desta data sempre gravam readerDiagnostics. Se um aparelho
  // falou com o servidor depois disso e não há diagnóstico, ele roda app antigo.
  const DIAG_RELEASED_AT=Date.parse("2026-10-02T21:00:00Z");
  function versionParts(v){return String(v||"").split(/[^0-9]+/).filter(Boolean).map(Number);}
  function versionOlder(a,b){
    const x=versionParts(a),y=versionParts(b);
    for(let i=0;i<Math.max(x.length,y.length);i++){
      const p=x[i]||0,q=y[i]||0;
      if(p!==q)return p<q;
    }
    return false;
  }
  function outdatedReason(d,seen){
    if(!diagAvailable||!seen||d)return "";
    return seen>DIAG_RELEASED_AT?"Este aparelho está rodando uma versão antiga do app (sem número de versão).":"";
  }
  function versionNote(d){
    const current=window.BetaDiag?.appVersion||"";
    if(!d?.appVersion||!current||!versionOlder(d.appVersion,current))return "";
    return '<small class="analytics-diag">Versão anterior à atual ('+esc(current)+'). Atualiza sozinho quando o leitor voltar ao app.</small>';
  }
  function diagHtml(readerId,a){
    const d=diagMap.get(String(readerId||""))||null;
    const seen=lastContact(readerId,a);
    let out='<small class="analytics-diag">Último contato do app: '+esc(when(seen)||"—")+(d?.appVersion?' · versão '+esc(d.appVersion):'')+'</small>';
    const outdated=outdatedReason(d,seen);
    if(outdated)out+='<small class="analytics-diag is-error">⚠ '+esc(outdated)+' Por isso posição, código e presença não atualizam. Peça para fechar o app por completo (tirar dos recentes) e abrir de novo.</small>';
    else out+=versionNote(d);
    const cm=commentMap.get(String(readerId||""))||null;
    if(cm&&cm.lastAt){
      const kind=cm.kind==="reaction"?"reação":cm.kind==="reply"?"resposta":"comentário";
      const where=cm.bookId?(' · '+esc(bookTitles.get(String(cm.bookId))||cm.bookId)+(cm.chapter?' cap. '+esc(cm.chapter):'')):'';
      out+='<small class="analytics-diag">Última atividade (comentários): '+esc(kind)+' em '+esc(when(cm.lastAt))+where+'</small>';
      const gap=cm.lastAt-(Number(d?.seenAt)||0);
      if(!outdated&&diagAvailable&&gap>10*60*1000&&Date.now()-cm.lastAt<6*3600*1000){
        out+='<small class="analytics-diag is-error">⚠ Está usando o app mas este aparelho não envia dados (versão antiga em cache). Peça para fechar o app por completo e abrir de novo.</small>';
      }
    }
    const errAt=Number(d?.lastErrorAt)||0,okAt=Number(d?.lastOkAt)||0;
    if(errAt&&errAt>=okAt){
      out+='<small class="analytics-diag is-error">⚠ Falha de sincronização ('+esc(d.lastErrorWhere||"?")+') em '+esc(when(errAt))+': '+esc(d.lastError||"")+'</small>';
    }
    return out;
  }
  let presenceMap=new Map(),presenceUnsub=null,presenceTicker=null;
  const FEATURE_MIN_SEC=15;
  const PRESENCE_FRESH_MS=45000;
  const PRESENCE_RECENT_MS=5*60*1000;
  const share=(n,total)=>total?Math.round((n/total)*100):0;
  const avg=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
  const median=values=>{
    if(!values.length)return 0;
    const v=values.slice().sort((a,b)=>a-b),mid=Math.floor(v.length/2);
    return v.length%2?v[mid]:(v[mid-1]+v[mid])/2;
  };
  const uses=(row,key)=>(Number(row.analytics?.[key])||0)>=FEATURE_MIN_SEC;

  function ensureAnalyticsSheet(){
    if(document.getElementById("betaAnalyticsSheet"))return;
    const el=document.createElement("div");
    el.id="betaAnalyticsSheet";
    el.className="admin-dashboard-sheet";
    el.hidden=true;
    el.innerHTML='<section class="admin-dashboard analytics-dashboard">'
      +'<header class="admin-dashboard-head"><div><h2>Análises de leitura</h2><p>Visão geral de comportamento, tempo, áudio e preferências.</p></div><div class="admin-head-actions"><button id="analyticsBackHome" class="link-btn admin-back-btn" type="button">← Painel</button><button id="analyticsRefresh" class="link-btn" type="button">Atualizar</button><button id="analyticsClose" class="icon-btn" type="button">✕</button></div></header>'
      +'<div id="analyticsMain" class="analytics-scroll">'
      +'<p class="analytics-note">As médias ignoram os usuários marcados como teste. Uso de narração/música conta após 15 segundos. Capítulos antigos concluídos são importados quando o leitor abre o livro, mas tempos históricos não podem ser reconstruídos.</p>'
      +'<section id="analyticsLiveSection" class="analytics-section analytics-live-section"><div class="analytics-section-head"><h3>Agora</h3><span>Quem está com o app aberto agora ou saiu há menos de 5 minutos. Atualiza sozinho.</span></div><div id="analyticsLiveList" class="analytics-live-list"></div></section>'
      +'<div id="analyticsOverview" class="analytics-overview"></div>'
      +'<section class="analytics-section"><div class="analytics-section-head"><h3>Uso de recursos</h3><span>Percentual dos leitores medidos que realmente usaram narração, música, ambos ou nenhum.</span></div><div id="analyticsAdoption" class="analytics-adoption"></div></section>'
      +'<section class="analytics-section"><div class="analytics-section-head"><h3>Preferências mais usadas</h3><span>Top escolhas dos leitores válidos, em porcentagem.</span></div><div id="analyticsPreferences" class="analytics-preferences"></div></section>'
      +'<section class="analytics-section"><div class="analytics-section-head"><h3>Comparação entre leitores</h3><span>Resumo comparativo. A gestão individual fica em Leitores.</span></div><div id="analyticsReaderList"></div></section>'
      +'</div>'
      +'<div id="analyticsDetail" class="analytics-scroll" hidden></div>'
      +'</section>';
    document.body.appendChild(el);
    el.querySelector("#analyticsBackHome").onclick=()=>{const back=analyticsReturnTo;hideAnalytics();if(back==="readers")showAccess();else showAdminHome();};
    el.querySelector("#analyticsClose").onclick=hideAnalytics;
    el.querySelector("#analyticsRefresh").onclick=()=>loadAnalytics();
    el.onclick=e=>{if(e.target===el)hideAnalytics();};
  }

  function presenceFor(readerId){
    return presenceMap.get(String(readerId||""))||null;
  }
  function presenceAge(p){
    return p?Math.max(0,Date.now()-(Number(p.heartbeatAt)||0)):Infinity;
  }
  function presenceFresh(p){
    return !!p&&presenceAge(p)<=PRESENCE_FRESH_MS;
  }
  function presenceStatus(p){
    if(!p)return {label:"Offline",kind:"offline"};
    const age=presenceAge(p);
    if(age<=PRESENCE_FRESH_MS){
      if(p.active){
        const media=(p.narrationOn?" 🎧":"")+(p.musicOn?" ♪":"");
        return {label:(p.narrationOn?"Ouvindo agora":"Lendo agora")+media,kind:"live"};
      }
      if(p.view==="reader"&&p.visible)return {label:"Capítulo aberto · sem atividade recente",kind:"idle"};
      return {label:"Online no app",kind:"online"};
    }
    if(age<=PRESENCE_RECENT_MS){
      const sec=Math.max(1,Math.round(age/1000));
      return {label:sec<60?"Inativo há "+sec+"s":"Inativo há "+Math.floor(sec/60)+"min",kind:"recent"};
    }
    return {label:p.heartbeatAt?"Offline · visto "+when(p.heartbeatAt):"Offline",kind:"offline"};
  }
  function liveLocation(p){
    if(!p||!p.chapter)return "";
    return esc(p.bookTitle||p.bookId||"Livro")+" · Cap. "+esc(p.chapter)+" · "+pct(p.currentPct)+"%";
  }
  function renderLivePresence(){
    const list=document.getElementById("analyticsLiveList");
    const section=document.getElementById("analyticsLiveSection");
    if(!list||!section)return;
    const profileByReader=new Map(analyticsRows.map(row=>[row.profile?.readerId,row.profile]));
    const live=[...presenceMap.values()]
      .filter(p=>presenceAge(p)<=PRESENCE_RECENT_MS&&!profileByReader.get(p.readerId)?.analyticsIgnored)
      .sort((a,b)=>{
        const rank=p=>{const k=presenceStatus(p).kind;return k==="live"?0:k==="idle"?1:k==="online"?2:3;};
        return rank(a)-rank(b)||(Number(b.heartbeatAt)||0)-(Number(a.heartbeatAt)||0);
      });
    section.hidden=false;
    if(!live.length){
      list.innerHTML='<p class="admin-empty">Nenhum leitor com o app aberto agora.</p>';
      return;
    }
    list.innerHTML=live.map(p=>{
      const profile=profileByReader.get(p.readerId)||{};
      const label=esc(profile.name||p.name||"Leitor");
      const status=presenceStatus(p);
      return '<article class="analytics-live-card">'
        +'<div><span class="presence-dot presence-'+esc(status.kind)+'"></span><strong>'+label+'</strong><small>'+esc(status.label)+'</small></div>'
        +'<div class="analytics-live-location"><b>'+pct(p.currentPct)+'%</b><span>'+liveLocation(p)+'</span></div>'
      +'</article>';
    }).join("");
  }
  function stopPresenceSubscription(){
    presenceUnsub?.();presenceUnsub=null;
    if(presenceTicker){clearInterval(presenceTicker);presenceTicker=null;}
  }
  function startPresenceSubscription(){
    if(presenceUnsub||!db())return;
    presenceUnsub=db().collection("readerPresence").onSnapshot(snap=>{
      presenceMap=new Map();
      snap.forEach(d=>presenceMap.set(d.id,{id:d.id,...d.data()}));
      renderAnalytics();
      const detail=document.getElementById("analyticsDetail");
      if(detail&&!detail.hidden&&detail.dataset.readerId)showAnalyticsReader(detail.dataset.readerId);
    },e=>console.warn("Presença ao vivo indisponível:",e));
    presenceTicker=setInterval(()=>{
      renderAnalytics();
      const detail=document.getElementById("analyticsDetail");
      if(detail&&!detail.hidden&&detail.dataset.readerId)showAnalyticsReader(detail.dataset.readerId);
    },10000);
  }

  function distribution(rows,key,labelMap){
    const counts=new Map();
    rows.forEach(row=>{
      const value=row.analytics?.[key];
      if(value===undefined||value===null||value==="")return;
      const label=labelMap?settingLabel(labelMap,value):String(value);
      counts.set(label,(counts.get(label)||0)+1);
    });
    return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"pt-BR"));
  }

  function renderTopDistribution(title,items,limit=2){
    const total=items.reduce((sum,item)=>sum+item[1],0);
    const top=items.slice(0,limit);
    return '<div class="analytics-pref-card"><strong>'+esc(title)+'</strong>'
      +(top.length
        ?'<div class="analytics-pref-values">'+top.map(([label,count],i)=>'<span><b>'+(i+1)+'º '+esc(label)+'</b> '+share(count,total)+'% <small>('+count+')</small></span>').join("")+'</div>'
        :'<small>Sem dados ainda</small>')
      +'</div>';
  }

  function renderAdoption(label,count,total,note){
    const value=share(count,total);
    return '<div class="analytics-adoption-card"><div><strong>'+esc(label)+'</strong><b>'+value+'%</b></div><div class="analytics-progress"><i style="width:'+value+'%"></i></div><small>'+count+' de '+total+(note?' · '+esc(note):'')+'</small></div>';
  }

  async function setAnalyticsIgnored(profileId,readerId,ignored){
    if(!db()||!profileId)return;
    await db().collection("readerProfiles").doc(profileId).set({
      analyticsIgnored:!!ignored,
      updatedAt:Date.now()
    },{merge:true});
    const row=analyticsRows.find(item=>item.profile?.id===profileId||item.profile?.readerId===readerId);
    if(row?.profile)row.profile.analyticsIgnored=!!ignored;
    renderAnalytics();
  }

  function wireIgnoreButtons(root=document){
    root.querySelectorAll("[data-analytics-ignore]").forEach(btn=>{
      btn.onclick=async e=>{
        e.stopPropagation();
        const profileId=btn.dataset.profileId;
        const readerId=btn.dataset.readerId;
        const next=btn.dataset.analyticsIgnore==="1";
        btn.disabled=true;
        try{
          await setAnalyticsIgnored(profileId,readerId,next);
          const detail=btn.closest("#analyticsDetail");
          if(detail&&!detail.hidden)showAnalyticsReader(readerId);
        }catch(e){
          console.warn("Não foi possível alterar a amostra dos relatórios:",e);
          alert("Não foi possível alterar este leitor nas estatísticas.");
          btn.disabled=false;
        }
      };
    });
  }

  // ---- Aviso "feche e abra o app" para aparelhos desatualizados ----
  const UPDATE_ALERT_TITLE="Atualize o app";
  const UPDATE_ALERT_TEXT="Há uma versão nova do app. Feche o app por completo (tire dos aplicativos recentes) e abra de novo para atualizar. Sem isso, seu progresso e seu código de acesso não aparecem para o autor.";
  function outdatedRows(){
    return analyticsRows.filter(row=>{
      const p=row.profile||{};
      if(p.analyticsIgnored||!p.id||!p.readerId)return false;
      const id=p.readerId;
      return !!outdatedReason(diagMap.get(String(id))||null,lastContact(id,row.analytics));
    });
  }
  async function sendUpdateAlerts(){
    const PM=window.PopupMessages;
    const rows=outdatedRows();
    if(!PM?.sendToProfile||!rows.length)return;
    // não repete para quem já tem esse aviso pendente
    let pending=new Set();
    try{
      const snap=await db().collection("popupMessages").where("source","==","update-alert").get();
      snap.forEach(d=>{const m=d.data()||{};if(!m.shownAt&&!m.readAt)pending.add(String(m.recipientProfileId));});
    }catch(e){console.warn("Não foi possível checar avisos pendentes:",e);}
    const targets=rows.filter(r=>!pending.has(String(r.profile.id)));
    if(!targets.length){alert("Todos os aparelhos desatualizados já têm o aviso pendente.");return;}
    const names=targets.map(r=>r.profile.name||"Leitor").join(", ");
    if(!confirm("Enviar o popup \""+UPDATE_ALERT_TITLE+"\" para "+targets.length+" leitor(es)?\n\n"+names))return;
    let ok=0;
    for(const r of targets){
      try{
        await PM.sendToProfile(r.profile,{title:UPDATE_ALERT_TITLE,text:UPDATE_ALERT_TEXT,source:"update-alert"});
        ok++;
      }catch(e){console.warn("Falha ao avisar "+r.profile.name,e);}
    }
    alert(ok+" de "+targets.length+" aviso(s) enviado(s). Aparece quando o leitor abrir o app.");
    renderAnalytics();
  }

  function renderAnalytics(){
    const overview=document.getElementById("analyticsOverview");
    const adoption=document.getElementById("analyticsAdoption");
    const pref=document.getElementById("analyticsPreferences");
    const list=document.getElementById("analyticsReaderList");
    if(!overview||!adoption||!pref||!list)return;
    renderLivePresence();

    const validRows=analyticsRows.filter(row=>!row.profile?.analyticsIgnored);
    const ignoredCount=analyticsRows.length-validRows.length;
    const measured=validRows.filter(row=>row.analytics);
    const sum=key=>measured.reduce((acc,row)=>acc+(Number(row.analytics?.[key])||0),0);
    const chapterRows=measured.flatMap(row=>Array.isArray(row.chapters)?row.chapters:[]);
    const timedCompleted=chapterRows.filter(ch=>ch.completed&&(Number(ch.activeSec)||0)>=FEATURE_MIN_SEC);
    const completedTimes=timedCompleted.map(ch=>Number(ch.activeSec)||0);
    const completedTotal=chapterRows.filter(ch=>ch.completed).length;
    const avgChapter=avg(completedTimes);
    const medianChapter=median(completedTimes);
    const avgCompleted=measured.length?completedTotal/measured.length:0;
    const weekAgo=Date.now()-7*24*60*60*1000;
    const active7=measured.filter(row=>(Number(row.analytics?.lastActiveAt)||0)>=weekAgo).length;

    const narrationUsers=measured.filter(row=>uses(row,"totalNarrationSec"));
    const musicUsers=measured.filter(row=>uses(row,"totalMusicSec"));
    const both=measured.filter(row=>uses(row,"totalNarrationSec")&&uses(row,"totalMusicSec"));
    const narrationOnly=measured.filter(row=>uses(row,"totalNarrationSec")&&!uses(row,"totalMusicSec"));
    const musicOnly=measured.filter(row=>!uses(row,"totalNarrationSec")&&uses(row,"totalMusicSec"));
    const neither=measured.filter(row=>!uses(row,"totalNarrationSec")&&!uses(row,"totalMusicSec"));

    overview.innerHTML=[
      ["Leitores válidos",validRows.length,ignoredCount?ignoredCount+" ignorado(s)":"nenhum ignorado"],
      ["Com dados",measured.length,validRows.length?share(measured.length,validRows.length)+"% da amostra":"sem amostra"],
      ["Tempo ativo",fmtDuration(sum("totalActiveSec")),"total medido nos capítulos"],
      ["Média / capítulo",completedTimes.length?fmtDuration(avgChapter):"—",completedTimes.length+" capítulos concluídos com tempo"],
      ["Mediana / capítulo",completedTimes.length?fmtDuration(medianChapter):"—","menos sensível a leituras muito longas"],
      ["Caps / leitor",measured.length?avgCompleted.toFixed(1):"—","média de capítulos concluídos"],
      ["Usam narração",share(narrationUsers.length,measured.length)+"%",fmtDuration(sum("totalNarrationSec"))+" reproduzidos"],
      ["Usam música",share(musicUsers.length,measured.length)+"%",fmtDuration(sum("totalMusicSec"))+" reproduzidos"],
      ["Ativos 7 dias",active7,measured.length?share(active7,measured.length)+"% dos medidos":"sem dados"]
    ].map(([title,value,note])=>'<div class="analytics-kpi"><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>').join("");

    adoption.innerHTML=
      renderAdoption("Narração + música",both.length,measured.length,"usaram os dois")
      +renderAdoption("Só narração",narrationOnly.length,measured.length,"sem música")
      +renderAdoption("Só música",musicOnly.length,measured.length,"sem narração")
      +renderAdoption("Nenhum dos dois",neither.length,measured.length,"leitura sem áudio");

    const themeDist=distribution(measured,"theme",THEME_LABELS);
    const fontDist=distribution(measured,"font",FONT_LABELS);
    const scaleDist=distribution(measured,"fontScale").map(([value,count])=>[Math.round(Number(value)*100)+"%",count]);
    const autoMusicOn=measured.filter(row=>row.analytics?.autoAmbient===true).length;
    const hideArtOn=measured.filter(row=>row.analytics?.hideArt===true).length;
    const changedFont=measured.filter(row=>(Number(row.analytics?.fontChanges)||0)>0).length;
    const changedTheme=measured.filter(row=>(Number(row.analytics?.themeChanges)||0)>0).length;

    pref.innerHTML=
      renderTopDistribution("Top temas",themeDist,2)
      +renderTopDistribution("Top fontes",fontDist,2)
      +renderTopDistribution("Top tamanhos",scaleDist,2)
      +'<div class="analytics-pref-card"><strong>Outras escolhas</strong><div class="analytics-pref-values">'
        +'<span><b>Música automática</b> '+share(autoMusicOn,measured.length)+'% <small>('+autoMusicOn+')</small></span>'
        +'<span><b>Oculta imagens</b> '+share(hideArtOn,measured.length)+'% <small>('+hideArtOn+')</small></span>'
        +'<span><b>Já trocou de fonte</b> '+share(changedFont,measured.length)+'%</span>'
        +'<span><b>Já trocou de tema</b> '+share(changedTheme,measured.length)+'%</span>'
      +'</div></div>';

    if(!analyticsRows.length){
      list.innerHTML='<p class="admin-empty">Nenhum leitor cadastrado ainda.</p>';
      return;
    }

    const displayRows=analyticsRows.slice().sort((a,b)=>{
      const ignored=Number(!!a.profile?.analyticsIgnored)-Number(!!b.profile?.analyticsIgnored);
      if(ignored)return ignored;
      const ap=presenceFor(a.profile?.readerId||a.analytics?.readerId),bp=presenceFor(b.profile?.readerId||b.analytics?.readerId);
      const alive=Number(!!(ap&&presenceFresh(ap)&&ap.active)),blive=Number(!!(bp&&presenceFresh(bp)&&bp.active));
      if(alive!==blive)return blive-alive;
      return (b.analytics?.lastActiveAt||b.analytics?.updatedAt||0)-(a.analytics?.lastActiveAt||a.analytics?.updatedAt||0);
    });

    const nOutdated=outdatedRows().length;
    const alertBar=nOutdated
      ?'<div class="analytics-update-alert"><span>⚠ '+nOutdated+' aparelho(s) com app desatualizado.</span><button id="analyticsSendUpdateAlert" class="link-btn" type="button">Avisar para fechar e abrir o app</button></div>'
      :"";
    list.innerHTML=alertBar+displayRows.map(row=>{
      const p=row.profile||{},a=row.analytics,ignored=!!p.analyticsIgnored;
      const label=esc(p.name||a?.name||"Anônimo")+(p.accessCode?" · Código "+esc(p.accessCode):" · Código não sincronizado");
      const ignoreBtn='<button class="link-btn analytics-ignore-btn" type="button" data-analytics-ignore="'+(ignored?"0":"1")+'" data-profile-id="'+esc(p.id||"")+'" data-reader-id="'+esc(p.readerId||a?.readerId||"")+'">'+(ignored?"Incluir nas estatísticas":"Ignorar nas estatísticas")+'</button>';
      if(!a){
        return '<article class="analytics-reader-card is-empty '+(ignored?"is-ignored":"")+'">'
          +'<div class="analytics-reader-open-static"><strong>'+label+'</strong><span>Sem atividade medida ainda.</span>'+diagHtml(p.readerId,null)+'</div>'
          +'<div class="analytics-reader-actions">'+(ignored?'<span class="analytics-ignored-badge">Ignorado</span>':'')+ignoreBtn+'</div>'
          +'</article>';
      }
      const live=presenceFor(a.readerId);
      const fresh=presenceFresh(live);
      const liveReader=fresh&&live?.view==="reader"&&live?.chapter;
      const shownPct=liveReader?pct(live.currentPct):pct(a.currentChapterPct);
      const location=liveReader
        ?liveLocation(live)
        :a.currentChapter
          ?esc(a.currentBookTitle||a.currentBookId||"Livro")+' · Cap. '+esc(a.currentChapter)+' · '+pct(a.currentChapterPct)+'%'
          :'Nenhum capítulo aberto ainda';
      const status=presenceStatus(live);
      const completed=(row.chapters||[]).filter(ch=>ch.completed).length;
      return '<article class="analytics-reader-card '+(ignored?"is-ignored":"")+' '+(fresh&&live?.active?"is-live":"")+'">'
        +'<button class="analytics-reader-open" type="button" data-analytics-reader="'+esc(a.readerId)+'">'
          +'<div class="analytics-reader-top"><div><strong>'+label+'</strong><span>'+location+'</span><em class="presence-status '+esc(status.kind)+'">'+(status.kind==="live"?'<i></i>':"")+esc(status.label)+'</em></div><b>'+shownPct+'%</b></div>'
          +'<div class="analytics-progress"><i style="width:'+shownPct+'%"></i></div>'
          +'<div class="analytics-reader-metrics"><span>'+completed+' caps concluídos</span><span>'+fmtDuration(a.totalActiveSec)+' ativo</span><span>'+fmtDuration(a.totalNarrationSec)+' narração</span><span>'+fmtDuration(a.totalMusicSec)+' música</span></div>'
          +'<small>Última leitura medida: '+esc(when(a.lastActiveAt)||"nenhuma ainda")+'</small>'
          +diagHtml(a.readerId,a)
        +'</button>'
        +'<div class="analytics-reader-actions">'+(ignored?'<span class="analytics-ignored-badge">Ignorado das médias</span>':'')+ignoreBtn+'</div>'
        +'</article>';
    }).join("");

    const sendBtn=list.querySelector("#analyticsSendUpdateAlert");
    if(sendBtn)sendBtn.onclick=async()=>{sendBtn.disabled=true;try{await sendUpdateAlerts();}finally{sendBtn.disabled=false;}};
    list.querySelectorAll("[data-analytics-reader]").forEach(btn=>{
      btn.onclick=()=>showAnalyticsReader(btn.dataset.analyticsReader);
    });
    wireIgnoreButtons(list);
  }

  let analyticsRefreshTimer=null,analyticsLoading=false;
  async function loadAnalytics(opts){
    const silent=!!(opts&&opts.silent===true);
    const main=document.getElementById("analyticsMain");
    const detail=document.getElementById("analyticsDetail");
    const list=document.getElementById("analyticsReaderList");
    if(!main||!detail||!list||!db())return;
    if(analyticsLoading)return;
    analyticsLoading=true;
    if(!silent){
      detail.hidden=true;
      main.hidden=false;
      list.innerHTML='<p class="admin-empty">Carregando relatórios…</p>';
    }
    try{
      const [profiles,snap,diagSnap]=await Promise.all([
        Comments.listReaderProfiles(),
        db().collection("readerAnalytics").get(),
        db().collection("readerDiagnostics").get().catch(e=>{
          console.warn("Diagnóstico dos leitores indisponível (publique as Rules novas):",e);
          return null;
        })
      ]);
      diagMap=new Map();
      diagAvailable=!!diagSnap;
      diagSnap?.forEach(d=>diagMap.set(d.id,{id:d.id,...d.data()}));
      await Promise.all([loadCommentActivity(),loadBookTitles()]);
      const byReader=new Map();
      snap.forEach(d=>byReader.set(d.id,{id:d.id,...d.data()}));
      analyticsRows=profiles.map(profile=>({profile,analytics:byReader.get(profile.readerId)||null,chapters:[]}));

      await Promise.all(analyticsRows.filter(row=>row.analytics?.readerId).map(async row=>{
        try{
          const chapterSnap=await db().collection("readerAnalytics").doc(row.analytics.readerId).collection("chapters").get();
          chapterSnap.forEach(d=>{
            if(String(d.id||"").startsWith("access__"))return;
            row.chapters.push({id:d.id,...d.data()});
          });
        }catch(e){
          console.warn("Não foi possível carregar capítulos de "+row.analytics.readerId,e);
        }
      }));

      analyticsRows.forEach(row=>row.chapters.sort((a,b)=>{
        const book=String(a.bookTitle||a.bookId||"").localeCompare(String(b.bookTitle||b.bookId||""),"pt-BR");
        return book||((Number(a.chapter)||0)-(Number(b.chapter)||0));
      }));
      analyticsRows.sort((a,b)=>{
        const ignored=(Number(!!a.profile?.analyticsIgnored)-Number(!!b.profile?.analyticsIgnored));
        if(ignored)return ignored;
        return (b.analytics?.lastActiveAt||b.analytics?.updatedAt||0)-(a.analytics?.lastActiveAt||a.analytics?.updatedAt||0);
      });
      renderAnalytics();
      if(silent&&!detail.hidden&&detail.dataset.readerId)showAnalyticsReader(detail.dataset.readerId);
    }catch(e){
      console.warn("Não foi possível carregar os relatórios beta:",e);
      if(!silent)list.innerHTML='<p class="admin-empty">Não foi possível carregar os relatórios. Confira se as regras do Firestore desta versão já foram publicadas.</p>';
    }finally{
      analyticsLoading=false;
    }
  }

  function showAnalyticsReader(readerId){
    const row=analyticsRows.find(item=>item.analytics?.readerId===readerId);
    if(!row)return;
    const main=document.getElementById("analyticsMain");
    const detail=document.getElementById("analyticsDetail");
    main.hidden=true;
    detail.hidden=false;
    detail.dataset.readerId=readerId;

    const chapters=row.chapters||[];
    const a=row.analytics,p=row.profile||{};
    const ignored=!!p.analyticsIgnored;
    const label=esc(p.name||a.name||"Anônimo")+(p.accessCode?" · Código "+esc(p.accessCode):" · Código não sincronizado");
    const narrationCaps=chapters.filter(ch=>(Number(ch.narrationSec)||0)>=FEATURE_MIN_SEC).length;
    const musicCaps=chapters.filter(ch=>(Number(ch.musicSec)||0)>=FEATURE_MIN_SEC).length;
    const completed=chapters.filter(ch=>ch.completed).length;
    const timedCompleted=chapters.filter(ch=>ch.completed&&(Number(ch.activeSec)||0)>=FEATURE_MIN_SEC);
    const readerAvg=avg(timedCompleted.map(ch=>Number(ch.activeSec)||0));
    const live=presenceFor(readerId);
    const fresh=presenceFresh(live);
    const status=presenceStatus(live);
    const current=(fresh&&live?.view==="reader"&&live?.chapter)
      ?liveLocation(live)
      :a.currentChapter
        ?esc(a.currentBookTitle||a.currentBookId||"Livro")+' · Cap. '+esc(a.currentChapter)+' · '+pct(a.currentChapterPct)+'%'
        :'Nenhum capítulo aberto';

    const chapterHtml=chapters.length?chapters.map(ch=>{
      const cp=ch.completed?100:pct(ch.currentPct);
      return '<article class="analytics-chapter-card">'
        +'<div class="analytics-reader-top"><div><strong>'+esc(ch.bookTitle||ch.bookId||"Livro")+' · Cap. '+esc(ch.chapter)+'</strong><span>'+esc(ch.chapterTitle||"")+'</span></div><b>'+(ch.completed?"Concluído":cp+"%")+'</b></div>'
        +'<div class="analytics-progress"><i style="width:'+cp+'%"></i></div>'
        +'<div class="analytics-reader-metrics"><span>'+fmtDuration(ch.activeSec)+' ativo</span><span>'+fmtDuration(ch.narrationSec)+' narração</span><span>'+fmtDuration(ch.musicSec)+' música</span></div>'
        +'</article>';
    }).join(""):'<p class="admin-empty">Ainda não há capítulos medidos para este leitor.</p>';

    detail.innerHTML=
      '<button id="analyticsBack" class="back-link analytics-back" type="button">'+(analyticsReturnTo==="readers"?"← Leitores":"← Análises")+'</button>'
      +'<section class="analytics-reader-detail-head"><div class="analytics-reader-detail-title"><div><h3>'+label+'</h3><p>'+current+'</p><em class="presence-status '+esc(status.kind)+'">'+(status.kind==="live"?'<i></i>':"")+esc(status.label)+'</em><small>Última leitura medida: '+esc(when(a.lastActiveAt)||"nenhuma ainda")+'</small>'+diagHtml(readerId,a)+'</div>'
        +'<button class="link-btn analytics-ignore-btn" type="button" data-analytics-ignore="'+(ignored?"0":"1")+'" data-profile-id="'+esc(p.id||"")+'" data-reader-id="'+esc(readerId)+'">'+(ignored?"Incluir nas estatísticas":"Ignorar nas estatísticas")+'</button>'
      +'</div></section>'
      +'<div class="analytics-overview compact">'
        +'<div class="analytics-kpi"><span>Concluídos</span><strong>'+completed+'</strong><small>capítulos</small></div>'
        +'<div class="analytics-kpi"><span>Tempo ativo</span><strong>'+fmtDuration(a.totalActiveSec)+'</strong><small>no capítulo</small></div>'
        +'<div class="analytics-kpi"><span>Média / cap.</span><strong>'+(timedCompleted.length?fmtDuration(readerAvg):"—")+'</strong><small>'+timedCompleted.length+' capítulos com tempo</small></div>'
        +'<div class="analytics-kpi"><span>Narração</span><strong>'+fmtDuration(a.totalNarrationSec)+'</strong><small>'+narrationCaps+' capítulos</small></div>'
        +'<div class="analytics-kpi"><span>Música</span><strong>'+fmtDuration(a.totalMusicSec)+'</strong><small>'+musicCaps+' capítulos</small></div>'
      +'</div>'
      +'<section class="analytics-section"><div class="analytics-section-head"><h3>Personalização</h3><span>Estado atual e quantas vezes ele mudou as principais escolhas.</span></div>'
        +'<div class="analytics-personalization">'
          +'<span><b>Tema</b>'+esc(settingLabel(THEME_LABELS,a.theme))+' <small>'+Number(a.themeChanges||0)+' trocas</small></span>'
          +'<span><b>Fonte</b>'+esc(settingLabel(FONT_LABELS,a.font))+' <small>'+Number(a.fontChanges||0)+' trocas</small></span>'
          +'<span><b>Tamanho</b>'+Math.round(Number(a.fontScale||1)*100)+'% <small>'+Number(a.fontScaleChanges||0)+' trocas</small></span>'
          +'<span><b>Música automática</b>'+(a.autoAmbient?"Sim":"Não")+'</span>'
          +'<span><b>Oculta imagens</b>'+(a.hideArt?"Sim":"Não")+'</span>'
        +'</div>'
      +'</section>'
      +'<section class="analytics-section"><div class="analytics-section-head"><h3>Capítulo a capítulo</h3><span>Tempo ativo, narração e música podem acontecer ao mesmo tempo.</span></div>'+chapterHtml+'</section>';

    detail.querySelector("#analyticsBack").onclick=()=>{detail.dataset.readerId="";if(analyticsReturnTo==="readers"){hideAnalytics();showAccess();}else{detail.hidden=true;main.hidden=false;}};
    wireIgnoreButtons(detail);
  }

  function showAnalytics(){
    if(!Comments?.isAdmin?.())return;
    analyticsReturnTo="home";
    ensureAnalyticsSheet();
    const sheet=document.getElementById("betaAnalyticsSheet");sheet.hidden=false;
    const back=sheet.querySelector("#analyticsBackHome");if(back)back.textContent="← Painel";
    startPresenceSubscription();
    loadAnalytics();
    // Progresso, códigos e capítulos são recarregados sozinhos enquanto o
    // relatório estiver aberto — não é preciso tocar em "Atualizar".
    if(analyticsRefreshTimer)clearInterval(analyticsRefreshTimer);
    analyticsRefreshTimer=setInterval(()=>{
      if(document.visibilityState==="visible")loadAnalytics({silent:true});
    },30000);
  }
  function hideAnalytics(){
    const x=document.getElementById("betaAnalyticsSheet");
    if(x)x.hidden=true;
    stopPresenceSubscription();
    if(analyticsRefreshTimer){clearInterval(analyticsRefreshTimer);analyticsRefreshTimer=null;}
  }


  // ---------------- Avaliações beta estruturadas ----------------
  let betaFeedbackRows=[],betaFeedbackProfiles=[],betaFeedbackAnalytics=[],betaFeedbackExportPayload=null;
  let betaChapterDetailContext=null;

  function meanFeedback(values){
    const nums=values.map(Number).filter(Number.isFinite);
    return nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:0;
  }
  function starsText(value){
    const n=Math.max(0,Math.min(5,Number(value)||0));
    return n?n.toFixed(1)+"/5":"—";
  }
  function countBy(rows,key){
    const map=new Map();
    rows.forEach(row=>{
      const value=typeof key==="function"?key(row):row?.[key];
      if(value)map.set(String(value),(map.get(String(value))||0)+1);
    });
    return [...map.entries()].sort((a,b)=>b[1]-a[1]);
  }
  function paceLabel(v){return v==="slow"?"Lento":v==="balanced"?"Equilibrado":v==="fast"?"Rápido":"Sem resposta";}
  function tagLabel(v){return v==="loved"?"Gostei muito":v==="confused"?"Fiquei confuso":v==="slow"?"Ritmo lento":v;}

  function ensureBetaFeedbackAdminSheet(){
    if(document.getElementById("betaFeedbackAdminSheet"))return;
    const el=document.createElement("div");
    el.id="betaFeedbackAdminSheet";
    el.className="admin-dashboard-sheet";
    el.hidden=true;
    el.innerHTML='<section class="admin-dashboard beta-feedback-admin">'
      +'<header class="admin-dashboard-head"><div><h2>Avaliações beta</h2><p>Capa, capítulos, opinião final e cruzamento com comportamento de leitura.</p></div>'
      +'<div class="admin-head-actions"><button id="betaFeedbackBack" class="link-btn admin-back-btn" type="button">← Feedback</button><button id="betaFeedbackRefresh" class="link-btn" type="button">Atualizar</button><button id="betaFeedbackClose" class="icon-btn" type="button">✕</button></div></header>'
      +'<div class="beta-feedback-admin-tools"><button id="betaFeedbackCopyJson" class="btn-ghost" type="button">Copiar JSON para IA</button><button id="betaFeedbackDownloadJson" class="btn-ghost" type="button">Baixar JSON</button><span>Exporta apenas dados de leitura e feedback. Códigos de acesso ficam de fora.</span></div>'
      +'<div id="betaFeedbackAdminBody" class="admin-dashboard-list"><p class="admin-empty">Carregando…</p></div>'
      +'</section>';
    document.body.appendChild(el);
    el.querySelector("#betaFeedbackBack").onclick=()=>{hideBetaFeedbackAdmin();showFeedbackHub();};
    el.querySelector("#betaFeedbackClose").onclick=hideBetaFeedbackAdmin;
    el.querySelector("#betaFeedbackRefresh").onclick=loadBetaFeedbackAdmin;
    el.onclick=e=>{if(e.target===el)hideBetaFeedbackAdmin();};
    el.querySelector("#betaFeedbackCopyJson").onclick=async()=>{
      if(!betaFeedbackExportPayload)return;
      const raw=JSON.stringify(betaFeedbackExportPayload,null,2);
      try{
        await navigator.clipboard.writeText(raw);
        const btn=el.querySelector("#betaFeedbackCopyJson"),old=btn.textContent;
        btn.textContent="JSON copiado!";
        setTimeout(()=>btn.textContent=old,1500);
      }catch(e){alert("Não foi possível copiar automaticamente. Use Baixar JSON.");}
    };
    el.querySelector("#betaFeedbackDownloadJson").onclick=()=>{
      if(!betaFeedbackExportPayload)return;
      const blob=new Blob([JSON.stringify(betaFeedbackExportPayload,null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download="beta-reading-dados-"+new Date().toISOString().slice(0,10)+".json";
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
  }

  function ensureBetaChapterDetailSheet(){
    if(document.getElementById("betaChapterDetailSheet"))return;
    const el=document.createElement("div");
    el.id="betaChapterDetailSheet";
    el.className="admin-dashboard-sheet";
    el.hidden=true;
    el.innerHTML='<section class="admin-dashboard beta-chapter-detail">'
      +'<header class="admin-dashboard-head"><div><h2 id="betaChapterDetailTitle">Feedback do capítulo</h2><p id="betaChapterDetailSub"></p></div>'
      +'<div class="admin-head-actions beta-chapter-nav"><button id="betaChapterPrev" class="icon-btn beta-nav-arrow" type="button" title="Capítulo anterior" aria-label="Capítulo anterior">‹</button><button id="betaChapterNext" class="icon-btn beta-nav-arrow" type="button" title="Próximo capítulo" aria-label="Próximo capítulo">›</button><button id="betaChapterDetailBack" class="link-btn admin-back-btn" type="button">← Avaliações beta</button><button id="betaChapterDetailClose" class="icon-btn" type="button">✕</button></div></header>'
      +'<div id="betaChapterDetailBody" class="admin-dashboard-list"></div>'
      +'</section>';
    document.body.appendChild(el);
    el.querySelector("#betaChapterDetailBack").onclick=()=>{el.hidden=true;document.getElementById("betaFeedbackAdminSheet").hidden=false;renderBetaFeedbackAdmin();};
    el.querySelector("#betaChapterDetailClose").onclick=()=>{el.hidden=true;};
    el.querySelector("#betaChapterPrev").onclick=()=>moveBetaChapterDetail(-1);
    el.querySelector("#betaChapterNext").onclick=()=>moveBetaChapterDetail(1);
    el.onclick=e=>{if(e.target===el)el.hidden=true;};
    document.addEventListener("keydown",e=>{
      if(el.hidden||!betaChapterDetailContext)return;
      if(e.key==="ArrowLeft"){e.preventDefault();moveBetaChapterDetail(-1);}
      if(e.key==="ArrowRight"){e.preventDefault();moveBetaChapterDetail(1);}
    });
  }

  function betaDetailChapters(bookId){
    return [...new Set(
      betaFeedbackRows
        .filter(x=>x.type==="chapter"&&x.bookId===bookId)
        .map(x=>Number(x.chapter))
        .filter(Boolean)
    )].sort((a,b)=>a-b);
  }

  function moveBetaChapterDetail(delta){
    const ctx=betaChapterDetailContext;
    if(!ctx)return;
    const chapters=betaDetailChapters(ctx.bookId);
    const idx=chapters.indexOf(Number(ctx.chapter));
    const next=chapters[idx+Number(delta||0)];
    if(!next)return;
    showBetaChapterDetail(ctx.bookId,next);
  }

  function updateBetaChapterNav(){
    const el=document.getElementById("betaChapterDetailSheet");
    if(!el||!betaChapterDetailContext)return;
    const chapters=betaDetailChapters(betaChapterDetailContext.bookId);
    const idx=chapters.indexOf(Number(betaChapterDetailContext.chapter));
    const prev=el.querySelector("#betaChapterPrev"),next=el.querySelector("#betaChapterNext");
    if(prev){prev.disabled=idx<=0;prev.title=idx>0?"Capítulo "+chapters[idx-1]:"Sem capítulo anterior com feedback";}
    if(next){next.disabled=idx<0||idx>=chapters.length-1;next.title=idx>=0&&idx<chapters.length-1?"Capítulo "+chapters[idx+1]:"Sem próximo capítulo com feedback";}
  }

  function showBetaChapterDetail(bookId,chapter){
    ensureBetaChapterDetailSheet();
    betaChapterDetailContext={bookId:String(bookId||""),chapter:Number(chapter)||0};
    const el=document.getElementById("betaChapterDetailSheet");
    const rows=betaFeedbackRows
      .filter(x=>x.type==="chapter"&&x.bookId===bookId&&Number(x.chapter)===Number(chapter))
      .sort((a,b)=>betaVersion(b)-betaVersion(a));
    const analyticsByReader=new Map(
      betaFeedbackAnalytics
        .filter(x=>x.bookId===bookId&&Number(x.chapter)===Number(chapter))
        .map(x=>[String(x.readerId||""),x])
    );
    const title=rows[0]?.chapterTitle||betaFeedbackAnalytics.find(x=>x.bookId===bookId&&Number(x.chapter)===Number(chapter))?.chapterTitle||"";
    const bookTitle=rows[0]?.bookTitle||bookId;
    el.querySelector("#betaChapterDetailTitle").textContent="Cap. "+chapter+(title?" · "+title:"");
    el.querySelector("#betaChapterDetailSub").textContent=bookTitle+" · "+rows.length+" feedback"+(rows.length===1?"":"s");
    const body=el.querySelector("#betaChapterDetailBody");

    if(!rows.length){
      body.innerHTML='<p class="admin-empty">Ainda não há feedback escrito neste capítulo.</p>';
    }else{
      body.innerHTML=rows.map(row=>{
        const a=analyticsByReader.get(String(row.readerId||""))||null;
        const tags=(row.tags||[]).map(tag=>'<span>'+esc(tagLabel(tag))+'</span>').join("");
        const text=String(row.text||"").trim();
        const edited=Number(row.updatedAt||0)>Number(row.createdAt||0)+1000;
        const timing=a?'<div class="beta-detail-metrics">'
          +'<span>'+(a.completed?"Concluído":"Em leitura")+'</span>'
          +'<span>'+pct(a.currentPct)+'%</span>'
          +'<span>'+fmtDuration(a.activeSec)+' ativo</span>'
          +(Number(a.narrationSec)?'<span>'+fmtDuration(a.narrationSec)+' narração</span>':"")
          +(Number(a.musicSec)?'<span>'+fmtDuration(a.musicSec)+' música</span>':"")
          +'</div>':"";
        return '<article class="beta-detail-response '+(betaFeedbackIsUnseen(row)?"is-new":"")+'">'
          +'<div class="beta-detail-response-head"><div><strong>'+esc(row.name||"Leitor")+'</strong><span>'+esc(whenFull(row.updatedAt||row.createdAt))+(edited?' · editado':'')+'</span></div>'
          +(betaFeedbackIsUnseen(row)?'<b>Novo</b>':"")+'</div>'
          +(tags?'<div class="beta-detail-tags">'+tags+'</div>':"")
          +(text?'<blockquote>'+esc(text)+'</blockquote>':'<p class="beta-detail-empty">Sem comentário escrito. O leitor marcou apenas as opções acima.</p>')
          +timing
          +'</article>';
      }).join("");
    }

    updateBetaChapterNav();
    markBetaRowsSeen(rows);
    const main=document.getElementById("betaFeedbackAdminSheet");
    if(main)main.hidden=true;
    el.hidden=false;
  }

  function renderBetaFeedbackAdmin(){
    const body=document.getElementById("betaFeedbackAdminBody");
    if(!body)return;
    const profileByReader=new Map(betaFeedbackProfiles.map(p=>[p.readerId,p]));
    const validReaderIds=new Set(betaFeedbackProfiles.filter(p=>!p.analyticsIgnored).map(p=>p.readerId));
    // "Ignorar nas estatísticas" nunca deve esconder a avaliação escrita.
    // Todas as respostas aparecem; apenas médias/cruzamentos quantitativos
    // excluem os leitores marcados como ignorados.
    const validFeedback=betaFeedbackRows.slice();
    const statsFeedback=betaFeedbackRows.filter(x=>validReaderIds.has(x.readerId));
    const ignoredCount=betaFeedbackProfiles.filter(p=>p.analyticsIgnored).length;
    const books=[...new Set(validFeedback.map(x=>x.bookId).concat(betaFeedbackAnalytics.map(x=>x.bookId)).filter(Boolean))];

    const coverRows=validFeedback.filter(x=>x.type==="cover");
    const chapterRows=validFeedback.filter(x=>x.type==="chapter");
    const bookRows=validFeedback.filter(x=>x.type==="book");
    const statBookRows=statsFeedback.filter(x=>x.type==="book");
    const overallAvg=meanFeedback(statBookRows.map(x=>x.overallRating));
    const continueAvg=meanFeedback(statBookRows.map(x=>x.continueRating));

    const unreadChapterRows=chapterRows.filter(betaFeedbackIsUnseen);
    let html=(unreadChapterRows.length
      ?'<div class="beta-unread-banner"><div><strong>'+unreadChapterRows.length+' avaliação'+(unreadChapterRows.length===1?' não lida':'ões não lidas')+'</strong><span>Os capítulos com novidade ficam destacados até você abrir a avaliação.</span></div><button id="betaOpenNextUnread" class="btn-primary" type="button">Abrir próxima não lida</button></div>'
      :'')
      +'<div class="analytics-overview">'
      +'<div class="analytics-kpi"><span>Avaliações de capa</span><strong>'+coverRows.length+'</strong><small>respostas</small></div>'
      +'<div class="analytics-kpi"><span>Feedbacks de capítulo</span><strong>'+chapterRows.length+'</strong><small>respostas</small></div>'
      +'<div class="analytics-kpi"><span>Opiniões finais</span><strong>'+bookRows.length+'</strong><small>livros concluídos</small></div>'
      +'<div class="analytics-kpi"><span>Nota geral</span><strong>'+starsText(overallAvg)+'</strong><small>média da amostra</small></div>'
      +'<div class="analytics-kpi"><span>Vontade de continuar</span><strong>'+starsText(continueAvg)+'</strong><small>métrica de série</small></div>'
      +'</div>'
      +'<p class="analytics-note">As médias excluem '+ignoredCount+' leitor(es) marcado(s) como ignorados nas estatísticas. As respostas continuam preservadas no banco.</p>';

    if(!books.length){
      body.innerHTML=html+'<p class="admin-empty">Ainda não há avaliações beta. Elas aparecerão aqui conforme os leitores responderem.</p>';
      betaFeedbackExportPayload=makeBetaFeedbackExport(validFeedback,validReaderIds);
      return;
    }

    books.forEach(bookId=>{
      const allForBook=validFeedback.filter(x=>x.bookId===bookId);
      const statsForBook=statsFeedback.filter(x=>x.bookId===bookId);
      const cover=allForBook.filter(x=>x.type==="cover");
      const chapters=allForBook.filter(x=>x.type==="chapter");
      const finals=allForBook.filter(x=>x.type==="book");
      const statCover=statsForBook.filter(x=>x.type==="cover");
      const statFinals=statsForBook.filter(x=>x.type==="book");
      const bookTitle=(allForBook[0]?.bookTitle)||betaFeedbackAnalytics.find(x=>x.bookId===bookId)?.bookTitle||bookId;
      const visualAvg=meanFeedback(statCover.map(x=>x.visualRating));
      const openAvg=meanFeedback(statCover.map(x=>x.openInterestRating));
      const coverFitAvg=meanFeedback(statFinals.map(x=>x.coverRepresentationRating).filter(Boolean));
      const generalAvg=meanFeedback(statFinals.map(x=>x.overallRating));
      const nextAvg=meanFeedback(statFinals.map(x=>x.continueRating));
      const pace=countBy(finals,x=>paceLabel(x.pace));
      const chars=countBy(finals,"favoriteCharacter").slice(0,5);

      const analyticsForBook=betaFeedbackAnalytics.filter(x=>x.bookId===bookId&&validReaderIds.has(x.readerId));
      const chapterNums=[...new Set(analyticsForBook.map(x=>Number(x.chapter)).concat(chapters.map(x=>Number(x.chapter))).filter(Boolean))].sort((a,b)=>a-b);
      const chapterCross=chapterNums.map(n=>{
        const ar=analyticsForBook.filter(x=>Number(x.chapter)===n);
        const fr=chapters.filter(x=>Number(x.chapter)===n);
        const timed=ar.filter(x=>x.completed&&(Number(x.activeSec)||0)>=FEATURE_MIN_SEC);
        const tagCounts=new Map();
        fr.forEach(row=>(row.tags||[]).forEach(tag=>tagCounts.set(tag,(tagCounts.get(tag)||0)+1)));
        const title=fr[0]?.chapterTitle||ar[0]?.chapterTitle||"";
        const unread=fr.filter(betaFeedbackIsUnseen).length;
        return '<button class="beta-cross-card beta-cross-open'+(unread?' is-unread':'')+'" type="button" data-beta-book="'+esc(bookId)+'" data-beta-chapter="'+n+'">'
          +'<div class="beta-cross-title"><div><strong>Cap. '+n+(title?" · "+esc(title):"")+'</strong><span>'+ar.filter(x=>x.completed).length+' concluíram · '+fr.length+' feedback(s)</span></div><div class="beta-cross-side">'+(unread?'<em class="beta-unread-pill">NÃO LIDO'+(unread>1?' · '+unread:'')+'</em>':'')+'<b>'+(timed.length?fmtDuration(meanFeedback(timed.map(x=>x.activeSec))):"—")+' <small>média</small></b></div></div>'
          +'<div class="beta-cross-tags">'
            +([...tagCounts.entries()].length?[...tagCounts.entries()].sort((a,b)=>b[1]-a[1]).map(([tag,count])=>'<span>'+esc(tagLabel(tag))+' <b>'+count+'</b></span>').join(""):'<span>Sem marcações</span>')
            +(fr.filter(x=>String(x.text||"").trim()).length?'<span>Comentários <b>'+fr.filter(x=>String(x.text||"").trim()).length+'</b></span>':"")
          +'</div>'
        +'</button>';
      }).join("");

      const finalCards=finals.length?finals.map(row=>{
        const ignored=!!profileByReader.get(row.readerId)?.analyticsIgnored;
        return '<article class="beta-response-card'+(ignored?" is-ignored":"")+'">'
          +'<div class="beta-response-head"><strong>'+esc(row.name||"Leitor")+'</strong><span>★ '+esc(row.overallRating)+'/5 · Próximo '+esc(row.continueRating)+'/5</span></div>'
          +(row.favoriteCharacter?'<p><b>Personagem favorito:</b> '+esc(row.favoriteCharacter)+'</p>':"")
          +(row.memorableMoment?'<p><b>Momento mais memorável:</b> '+esc(row.memorableMoment)+'</p>':"")
          +(row.hookMoment?'<p><b>Quando precisou continuar:</b> '+esc(row.hookMoment)+'</p>':"")
          +(row.difficultPart?'<p><b>Parte confusa/cansativa:</b> '+esc(row.difficultPart)+'</p>':"")
          +(row.finalComment?'<p><b>Opinião final:</b> '+esc(row.finalComment)+'</p>':"")
        +'</article>';
      }).join(""):'<p class="admin-empty">Ainda não há opiniões finais deste livro.</p>';

      const coverNotes=cover.filter(x=>String(x.note||"").trim()).map(row=>'<div class="beta-mini-quote"><strong>'+esc(row.name||"Leitor")+'</strong><span>'+esc(row.note)+'</span></div>').join("");

      html+='<section class="analytics-section beta-book-report">'
        +'<div class="analytics-section-head"><h3>'+esc(bookTitle)+'</h3><span>'+allForBook.length+' resposta(s) estruturada(s)</span></div>'
        +'<div class="beta-book-score-grid">'
          +'<div><span>Visual da capa</span><strong>'+starsText(visualAvg)+'</strong><small>'+cover.length+' respostas</small></div>'
          +'<div><span>Faria abrir</span><strong>'+starsText(openAvg)+'</strong><small>força de clique</small></div>'
          +'<div><span>Capa representa</span><strong>'+starsText(coverFitAvg)+'</strong><small>após a leitura</small></div>'
          +'<div><span>Nota do livro</span><strong>'+starsText(generalAvg)+'</strong><small>'+finals.length+' respostas</small></div>'
          +'<div><span>Quer continuar</span><strong>'+starsText(nextAvg)+'</strong><small>próximo livro</small></div>'
        +'</div>'
        +'<div class="beta-feedback-distributions">'
          +'<div><h4>Ritmo</h4>'+(pace.length?pace.map(([label,count])=>'<span>'+esc(label)+' <b>'+count+'</b></span>').join(""):'<span>Sem respostas</span>')+'</div>'
          +'<div><h4>Personagens favoritos</h4>'+(chars.length?chars.map(([label,count])=>'<span>'+esc(label)+' <b>'+count+'</b></span>').join(""):'<span>Sem respostas</span>')+'</div>'
        +'</div>'
        +(coverNotes?'<details class="beta-report-details"><summary>Comentários sobre a capa ('+cover.filter(x=>String(x.note||"").trim()).length+')</summary>'+coverNotes+'</details>':"")
        +'<details class="beta-report-details" open><summary>Capítulos: comportamento + feedback</summary><div class="beta-cross-list">'+(chapterCross||'<p class="admin-empty">Ainda não há dados de capítulo.</p>')+'</div></details>'
        +'<details class="beta-report-details"><summary>Opiniões finais ('+finals.length+')</summary>'+finalCards+'</details>'
      +'</section>';
    });

    body.innerHTML=html;
    body.querySelectorAll("[data-beta-book][data-beta-chapter]").forEach(btn=>{
      btn.onclick=()=>showBetaChapterDetail(btn.dataset.betaBook,Number(btn.dataset.betaChapter));
    });
    const nextUnread=body.querySelector("#betaOpenNextUnread");
    if(nextUnread)nextUnread.onclick=()=>{
      const row=chapterRows.filter(betaFeedbackIsUnseen).sort((a,b)=>betaVersion(a)-betaVersion(b))[0];
      if(row)showBetaChapterDetail(row.bookId,Number(row.chapter));
    };
    betaFeedbackExportPayload=makeBetaFeedbackExport(validFeedback,validReaderIds);
  }

  function makeBetaFeedbackExport(validFeedback,validReaderIds){
    const analytics=betaFeedbackAnalytics.filter(x=>validReaderIds.has(x.readerId)).map(x=>({
      readerId:x.readerId,
      name:x.name||"",
      bookId:x.bookId,
      bookTitle:x.bookTitle||"",
      chapter:Number(x.chapter)||0,
      chapterTitle:x.chapterTitle||"",
      currentPct:Number(x.currentPct)||0,
      activeSec:Number(x.activeSec)||0,
      narrationSec:Number(x.narrationSec)||0,
      musicSec:Number(x.musicSec)||0,
      completed:!!x.completed
    }));
    const feedback=validFeedback.map(x=>{
      const copy={...x};
      delete copy.id;
      delete copy.profileHash;
      return copy;
    });
    return {
      schemaVersion:1,
      generatedAt:new Date().toISOString(),
      purpose:"Dados estruturados de beta reading para análise narrativa e de experiência.",
      definitions:{
        activeSec:"Tempo ativo medido no capítulo; não equivale necessariamente a leitura ocular.",
        cover_visualRating:"Avaliação visual da capa, 1 a 5.",
        cover_openInterestRating:"Quanto a capa faria o leitor abrir o livro sem conhecer a história, 1 a 5.",
        book_overallRating:"Nota geral do livro, 1 a 5.",
        book_continueRating:"Vontade de continuar para o próximo livro, 1 a 5.",
        book_coverRepresentationRating:"Quanto a capa representa a história após a leitura, 0 a 5.",
        chapter_tags:["loved=Gostei muito","confused=Fiquei confuso","slow=Ritmo lento"]
      },
      feedback,
      chapterAnalytics:analytics
    };
  }

  async function loadBetaFeedbackAdmin(){
    const body=document.getElementById("betaFeedbackAdminBody");
    if(!body||!db())return;
    body.innerHTML='<p class="admin-empty">Cruzando respostas com os dados de leitura…</p>';
    try{
      const [profiles,feedbackSnap,analyticsSnap]=await Promise.all([
        Comments.listReaderProfiles(),
        db().collection("betaFeedback").get(),
        db().collection("readerAnalytics").get()
      ]);
      betaFeedbackProfiles=profiles;
      betaFeedbackRows=[];
      feedbackSnap.forEach(d=>betaFeedbackRows.push({id:d.id,...d.data()}));
      const analyticsSummaries=[];
      analyticsSnap.forEach(d=>analyticsSummaries.push({id:d.id,...d.data()}));
      betaFeedbackAnalytics=[];
      await Promise.all(analyticsSummaries.map(async summary=>{
        try{
          const snap=await db().collection("readerAnalytics").doc(summary.readerId||summary.id).collection("chapters").get();
          snap.forEach(d=>{
            if(String(d.id||"").startsWith("access__"))return;
            betaFeedbackAnalytics.push({readerId:summary.readerId||summary.id,name:summary.name||"",...d.data()});
          });
        }catch(e){console.warn("Falha ao cruzar capítulos do leitor:",e);}
      }));
      renderBetaFeedbackAdmin();
      if(pendingBetaChapterFocus){
        const target=pendingBetaChapterFocus;
        pendingBetaChapterFocus=null;
        showBetaChapterDetail(target.bookId,target.chapter);
      }
    }catch(e){
      console.warn("Não foi possível carregar avaliações beta:",e);
      body.innerHTML='<p class="admin-empty">Não foi possível carregar as avaliações. Confira se as Rules mais recentes do Firestore foram publicadas.</p>';
    }
  }

  function showBetaFeedbackAdmin(){
    if(!Comments?.isAdmin?.())return;
    ensureBetaFeedbackAdminSheet();
    document.getElementById("betaFeedbackAdminSheet").hidden=false;
    loadBetaFeedbackAdmin();
  }
  function hideBetaFeedbackAdmin(){
    const x=document.getElementById("betaFeedbackAdminSheet");
    if(x)x.hidden=true;
  }

  // ---------------- Exclusão segura de leitor ----------------
  let pendingDeleteProfile=null;
  let deletingReader=false;

  function ensureDeleteReaderConfirm(){
    if(document.getElementById("readerDeleteConfirm"))return;
    const el=document.createElement("div");
    el.id="readerDeleteConfirm";
    el.className="danger-confirm-sheet";
    el.hidden=true;
    el.innerHTML='<section class="danger-confirm-card" role="dialog" aria-modal="true" aria-labelledby="readerDeleteTitle">'
      +'<div class="danger-confirm-icon" aria-hidden="true">!</div>'
      +'<div><h2 id="readerDeleteTitle">Apagar leitor definitivamente?</h2><p>Você está prestes a apagar <strong id="readerDeleteName">este leitor</strong>.</p></div>'
      +'<div class="danger-confirm-warning"><strong>Esta ação não pode ser desfeita.</strong><ul>'
        +'<li>O código de acesso deste leitor será revogado.</li>'
        +'<li>Comentários, respostas, reações e avaliações beta ficam preservados no histórico.</li>'
        +'<li>Relatórios de atividade e presença ao vivo vinculados a ele serão removidos.</li>'
        +'<li>Ele perderá o acesso aos livros liberados para este perfil.</li>'
      +'</ul><p>Dados de progresso que existam apenas no aparelho do leitor podem continuar fisicamente naquele navegador, mas o perfil revogado não poderá ser recuperado pelo código antigo.</p></div>'
      +'<label class="danger-confirm-check"><input id="readerDeleteAcknowledge" type="checkbox"><span>Entendo que o acesso será revogado, mas o histórico editorial será preservado.</span></label>'
      +'<p id="readerDeleteStatus" class="danger-confirm-status" aria-live="polite"></p>'
      +'<div class="danger-confirm-actions"><button id="readerDeleteCancel" class="btn-ghost" type="button">Cancelar</button><button id="readerDeleteConfirmBtn" class="btn-danger" type="button" disabled>Apagar definitivamente</button></div>'
      +'</section>';
    document.body.appendChild(el);

    const ack=el.querySelector("#readerDeleteAcknowledge");
    const confirmBtn=el.querySelector("#readerDeleteConfirmBtn");
    const cancelBtn=el.querySelector("#readerDeleteCancel");

    const close=()=>{
      if(deletingReader)return;
      pendingDeleteProfile=null;
      ack.checked=false;
      confirmBtn.disabled=true;
      el.querySelector("#readerDeleteStatus").textContent="";
      el.hidden=true;
    };

    ack.addEventListener("change",()=>{confirmBtn.disabled=!ack.checked||deletingReader;});
    cancelBtn.onclick=close;
    el.onclick=e=>{if(e.target===el)close();};

    confirmBtn.onclick=async()=>{
      const profile=pendingDeleteProfile;
      if(!profile||!ack.checked||deletingReader)return;
      deletingReader=true;
      confirmBtn.disabled=true;
      cancelBtn.disabled=true;
      confirmBtn.textContent="Apagando…";
      const status=el.querySelector("#readerDeleteStatus");
      status.textContent="Revogando o acesso e preservando o histórico editorial…";
      try{
        const result=await Comments.deleteReaderProfile(profile.id,profile.readerId);
        if(result?.cleanupFailed){
          status.textContent="O perfil foi revogado, mas parte da limpeza pode não ter sido concluída.";
          alert("O acesso foi revogado e o histórico editorial foi preservado, mas parte da limpeza de atividade pode não ter sido concluída.");
        }else{
          status.textContent="Acesso revogado. Comentários e respostas preservados.";
        }
        pendingDeleteProfile=null;
        el.hidden=true;
        await renderAccess();
      }catch(e){
        status.textContent="Não foi possível apagar o leitor. Nenhuma nova tentativa será feita automaticamente.";
        alert("Não foi possível apagar o leitor: "+(e.message||"tente de novo."));
      }finally{
        deletingReader=false;
        ack.checked=false;
        cancelBtn.disabled=false;
        confirmBtn.disabled=true;
        confirmBtn.textContent="Apagar definitivamente";
      }
    };
  }

  function openDeleteReaderConfirm(profile){
    if(!profile)return;
    ensureDeleteReaderConfirm();
    pendingDeleteProfile=profile;
    const el=document.getElementById("readerDeleteConfirm");
    el.querySelector("#readerDeleteName").textContent=(profile.name||"Anônimo")+(profile.accessCode?" · Código "+profile.accessCode:"");
    el.querySelector("#readerDeleteAcknowledge").checked=false;
    el.querySelector("#readerDeleteConfirmBtn").disabled=true;
    el.querySelector("#readerDeleteStatus").textContent="";
    el.hidden=false;
  }

  // ---------------- Gerar novo código (com cuidado, igual exclusão) ----------------
  let pendingRotateProfile=null;
  let rotatingCode=false;

  function ensureRotateCodeConfirm(){
    if(document.getElementById("readerRotateConfirm"))return;
    const el=document.createElement("div");
    el.id="readerRotateConfirm";
    el.className="danger-confirm-sheet";
    el.hidden=true;
    el.innerHTML='<section class="danger-confirm-card" role="dialog" aria-modal="true" aria-labelledby="readerRotateTitle">'
      +'<div class="danger-confirm-icon" aria-hidden="true">!</div>'
      +'<div><h2 id="readerRotateTitle">Gerar novo código de acesso?</h2><p>Você está prestes a trocar o código de <strong id="readerRotateName">este leitor</strong>.</p></div>'
      +'<div class="danger-confirm-warning"><strong>O código atual deixará de funcionar imediatamente.</strong><ul>'
        +'<li>Se o leitor estiver com o código antigo salvo em outro aparelho, ele perderá o acesso até você passar o novo código.</li>'
        +'<li>O leitor, comentários, relatórios e livros liberados são preservados.</li>'
      +'</ul></div>'
      +'<label class="danger-confirm-check"><input id="readerRotateAcknowledge" type="checkbox"><span>Entendo que preciso avisar o leitor do novo código.</span></label>'
      +'<p id="readerRotateStatus" class="danger-confirm-status" aria-live="polite"></p>'
      +'<div id="readerRotateResult" class="reader-admin-code" hidden><span>Novo código de acesso</span><strong id="readerRotateResultCode"></strong></div>'
      +'<div class="danger-confirm-actions"><button id="readerRotateCancel" class="btn-ghost" type="button">Cancelar</button><button id="readerRotateConfirmBtn" class="btn-danger" type="button" disabled>Gerar novo código</button></div>'
      +'</section>';
    document.body.appendChild(el);

    const ack=el.querySelector("#readerRotateAcknowledge");
    const confirmBtn=el.querySelector("#readerRotateConfirmBtn");
    const cancelBtn=el.querySelector("#readerRotateCancel");
    const result=el.querySelector("#readerRotateResult");

    const close=()=>{
      if(rotatingCode)return;
      pendingRotateProfile=null;
      ack.checked=false;
      confirmBtn.disabled=true;
      el.querySelector("#readerRotateStatus").textContent="";
      result.hidden=true;
      cancelBtn.textContent="Cancelar";
      el.hidden=true;
    };

    ack.addEventListener("change",()=>{confirmBtn.disabled=!ack.checked||rotatingCode;});
    cancelBtn.onclick=close;
    el.onclick=e=>{if(e.target===el)close();};

    confirmBtn.onclick=async()=>{
      const profile=pendingRotateProfile;
      if(!profile||!ack.checked||rotatingCode)return;
      rotatingCode=true;
      confirmBtn.disabled=true;
      ack.disabled=true;
      confirmBtn.textContent="Gerando…";
      const status=el.querySelector("#readerRotateStatus");
      status.textContent="Revogando o código antigo e gerando um novo…";
      try{
        const r=await Comments.rotateReaderAccessCode(profile.id);
        if(r?.cleanupFailed){
          status.textContent="Código gerado, mas parte das mensagens/relatórios pode precisar de sincronização quando o leitor abrir o app.";
        }else{
          status.textContent="Pronto. Avise o leitor do novo código abaixo:";
        }
        el.querySelector("#readerRotateResultCode").textContent=r.accessCode;
        result.hidden=false;
        confirmBtn.hidden=true;
        ack.closest("label").hidden=true;
        cancelBtn.textContent="Fechar";
        await renderAccess();
      }catch(e){
        status.textContent="Não foi possível gerar o código: "+(e.message||"tente de novo.");
      }finally{
        rotatingCode=false;
        ack.disabled=false;
        cancelBtn.disabled=false;
      }
    };
  }

  function openRotateCodeConfirm(profile){
    if(!profile)return;
    ensureRotateCodeConfirm();
    pendingRotateProfile=profile;
    const el=document.getElementById("readerRotateConfirm");
    el.querySelector("#readerRotateName").textContent=(profile.name||"Anônimo")+(profile.accessCode?" · Código atual "+profile.accessCode:" · ainda sem código sincronizado");
    el.querySelector("#readerRotateAcknowledge").checked=false;
    el.querySelector("#readerRotateAcknowledge").closest("label").hidden=false;
    el.querySelector("#readerRotateConfirmBtn").disabled=true;
    el.querySelector("#readerRotateConfirmBtn").hidden=false;
    el.querySelector("#readerRotateConfirmBtn").textContent="Gerar novo código";
    el.querySelector("#readerRotateCancel").textContent="Cancelar";
    el.querySelector("#readerRotateStatus").textContent="";
    el.querySelector("#readerRotateResult").hidden=true;
    el.hidden=false;
  }

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

  function ensureAccessLogSheet(){
    if(document.getElementById("readerAccessLogSheet"))return;
    const el=document.createElement("div");
    el.id="readerAccessLogSheet";
    el.className="admin-dashboard-sheet";
    el.hidden=true;
    el.innerHTML='<section class="admin-dashboard reader-access-log-dashboard">'
      +'<header class="admin-dashboard-head"><div><h2 id="readerAccessLogTitle">Registro de acesso</h2><p id="readerAccessLogSub">Aberturas de capítulos registradas pelo Lityra.</p></div>'
      +'<div class="admin-head-actions"><button id="readerAccessLogBack" class="link-btn admin-back-btn" type="button">← Leitores</button><button id="readerAccessLogClose" class="icon-btn" type="button">✕</button></div></header>'
      +'<div id="readerAccessLogBody" class="admin-dashboard-list"><p class="admin-empty">Carregando…</p></div>'
      +'</section>';
    document.body.appendChild(el);
    const close=()=>{el.hidden=true;showAccess();};
    el.querySelector("#readerAccessLogBack").onclick=close;
    el.querySelector("#readerAccessLogClose").onclick=()=>{el.hidden=true;};
    el.onclick=e=>{if(e.target===el)el.hidden=true;};
  }

  async function showReaderAccessLog(profile){
    if(!profile?.readerId||!db())return;
    ensureAccessLogSheet();
    hideAccess();
    const el=document.getElementById("readerAccessLogSheet");
    const body=el.querySelector("#readerAccessLogBody");
    el.querySelector("#readerAccessLogTitle").textContent="Registro de acesso · "+(profile.name||"Leitor");
    el.querySelector("#readerAccessLogSub").textContent="Cada linha é uma abertura real de capítulo registrada a partir desta versão do Lityra.";
    body.innerHTML='<p class="admin-empty">Carregando acessos…</p>';
    el.hidden=false;
    try{
      const snap=await db().collection("readerAnalytics").doc(profile.readerId).collection("chapters").get();
      const rows=[];
      snap.forEach(d=>{
        if(!String(d.id||"").startsWith("access__"))return;
        const data=d.data()||{};
        rows.push({id:d.id,...data});
      });
      rows.sort((a,b)=>(Number(b.lastOpenedAt||b.updatedAt)||0)-(Number(a.lastOpenedAt||a.updatedAt)||0));
      if(!rows.length){
        body.innerHTML='<p class="admin-empty">Ainda não há acessos históricos registrados. O histórico começa a ser gravado quando o leitor abrir capítulos nesta versão.</p>';
        return;
      }
      const byDay=new Map();
      rows.forEach(row=>{
        const stamp=Number(row.lastOpenedAt||row.updatedAt)||0;
        const day=stamp?new Date(stamp).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"}):"Sem data";
        if(!byDay.has(day))byDay.set(day,[]);
        byDay.get(day).push(row);
      });
      body.innerHTML=[...byDay.entries()].map(([day,items])=>
        '<section class="reader-access-log-day"><h3>'+esc(day)+'</h3>'
        +items.map(row=>{
          const stamp=Number(row.lastOpenedAt||row.updatedAt)||0;
          const time=stamp?new Date(stamp).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}):"";
          return '<div class="reader-access-log-row"><time>'+esc(time)+'</time><div><strong>'+esc(row.bookTitle||row.bookId||"Livro")+'</strong><span>Cap. '+esc(row.chapter)+(row.chapterTitle?' · '+esc(row.chapterTitle):'')+'</span></div></div>';
        }).join("")
        +'</section>'
      ).join("");
    }catch(e){
      console.warn("Não foi possível carregar o registro de acessos:",e);
      body.innerHTML='<p class="admin-empty">Não foi possível carregar o registro de acessos agora.</p>';
    }
  }

  function ensureAccessSheet(){
    if(document.getElementById("bookAccessSheet"))return;
    const el=document.createElement("div");el.id="bookAccessSheet";el.className="admin-dashboard-sheet";el.hidden=true;
    el.innerHTML='<section class="admin-dashboard"><header class="admin-dashboard-head"><div><h2>Leitores</h2><p>Acompanhe cada leitor e gerencie acesso sem separar progresso de cadastro.</p></div><div class="admin-head-actions"><button id="accessDashBack" class="link-btn admin-back-btn" type="button">← Painel</button><button id="accessDashClose" class="icon-btn" type="button">✕</button></div></header><div id="bookAccessList" class="admin-dashboard-list"></div></section>';
    document.body.appendChild(el);
    el.querySelector("#accessDashBack").onclick=()=>{hideAccess();showAdminHome();};
    el.querySelector("#accessDashClose").onclick=hideAccess;
    el.onclick=e=>{if(e.target===el)hideAccess();};
  }

  async function renderAccess(){
    const sheet=document.getElementById("bookAccessSheet");if(!sheet||sheet.hidden)return;
    const list=sheet.querySelector("#bookAccessList");
    list.innerHTML='<p class="admin-empty">Carregando leitores…</p>';
    const [profiles,books,analyticsSnap,presenceSnap]=await Promise.all([
      Comments.listReaderProfiles(),
      getBooksList(),
      db().collection("readerAnalytics").get().catch(()=>null),
      db().collection("readerPresence").get().catch(()=>null)
    ]);
    if(!profiles.length){list.innerHTML='<p class="admin-empty">Nenhum leitor com perfil ainda. Quando alguém criar o perfil, aparecerá aqui.</p>';return;}
    const analyticsByReader=new Map();analyticsSnap?.forEach(d=>analyticsByReader.set(d.id,{id:d.id,...d.data()}));
    const presenceByReader=new Map();presenceSnap?.forEach(d=>presenceByReader.set(d.id,{id:d.id,...d.data()}));
    const ordered=profiles.slice().sort((a,b)=>{
      const isPending=p=>p.approvalStatus==="pending"||(!p.approvalStatus&&Number(p.createdAt||0)>=APPROVAL_REQUIRED_AFTER);
      const pendingA=isPending(a)?1:0,pendingB=isPending(b)?1:0;
      if(pendingA!==pendingB)return pendingB-pendingA;
      const ap=presenceByReader.get(a.readerId),bp=presenceByReader.get(b.readerId);
      const alive=p=>p&&Date.now()-(Number(p.heartbeatAt)||0)<=45000&&p.active?1:0;
      if(alive(ap)!==alive(bp))return alive(bp)-alive(ap);
      const aa=analyticsByReader.get(a.readerId),ba=analyticsByReader.get(b.readerId);
      return (Number(ba?.lastActiveAt||ba?.updatedAt)||0)-(Number(aa?.lastActiveAt||aa?.updatedAt)||0);
    });
    list.innerHTML=ordered.map(p=>{
      const code=String(p.accessCode||"").trim();
      const label=esc(p.name||"Anônimo");
      const pending=p.approvalStatus==="pending"||(!p.approvalStatus&&Number(p.createdAt||0)>=APPROVAL_REQUIRED_AFTER);
      const blocked=!pending&&p.accessEnabled===false;
      const accessKind=pending?"pending":(blocked?"blocked":"active");
      const accessLabel=pending?"Pendente de aprovação":(blocked?"Acesso bloqueado":"Acesso ativo");
      const a=analyticsByReader.get(p.readerId)||null;
      const live=presenceByReader.get(p.readerId)||null;
      const fresh=!!live&&Date.now()-(Number(live.heartbeatAt)||0)<=45000;
      const liveReader=fresh&&live?.view==="reader"&&live?.chapter;
      const shownPct=liveReader?pct(live.currentPct):pct(a?.currentChapterPct);
      const location=liveReader
        ?esc(live.bookTitle||live.bookId||"Livro")+" · Cap. "+esc(live.chapter)+" · "+pct(live.currentPct)+"%"
        :a?.currentChapter
          ?esc(a.currentBookTitle||a.currentBookId||"Livro")+" · Cap. "+esc(a.currentChapter)+" · "+pct(a.currentChapterPct)+"%"
          :"Nenhum capítulo aberto ainda";
      const status=presenceStatus(live);
      const completed=Array.isArray(a?.completedChapters)?a.completedChapters.length:0;
      const codeHtml=code
        ? '<div class="reader-admin-code"><span>Código de acesso</span><strong>'+esc(code)+'</strong></div>'
        : '<div class="reader-admin-code is-missing"><span>Código de acesso</span><strong>Ainda não sincronizado</strong><small>Perfil antigo: o código aparece quando o leitor sincronizar ou quando você gerar um novo.</small></div>';
      const allowed=Array.isArray(p.allowedBooks)?p.allowedBooks:[];
      const checks=books.length?books.map(b=>{
        const checked=allowed.includes(b.id)?"checked":"";
        return '<label class="field-check"><input type="checkbox" data-profile="'+esc(p.id)+'" data-book="'+esc(b.id)+'" '+checked+'><span>'+esc(b.title)+'</span></label>';
      }).join(""):'<p class="admin-empty compact">Nenhum livro cadastrado.</p>';
      return '<article class="admin-comment-card reader-admin-card is-'+accessKind+'">'
        +'<div class="reader-admin-overview">'
          +'<div class="reader-access-state '+accessKind+'">'+esc(accessLabel)+'</div>'
          +'<div class="analytics-reader-top"><div><strong>'+label+'</strong><span>'+location+'</span><em class="presence-status '+esc(status.kind)+'">'+(status.kind==="live"?'<i></i>':"")+esc(status.label)+'</em></div><b>'+(a?shownPct+"%":"—")+'</b></div>'
          +(a?'<div class="analytics-progress"><i style="width:'+shownPct+'%"></i></div>':'')
          +'<div class="analytics-reader-metrics"><span>'+completed+' caps concluídos</span><span>'+fmtDuration(a?.totalActiveSec)+' ativo</span><span>'+fmtDuration(a?.totalNarrationSec)+' narração</span><span>'+fmtDuration(a?.totalMusicSec)+' música</span></div>'
          +'<small>Última leitura: '+esc(when(a?.lastActiveAt)||"nenhuma medida ainda")+'</small>'
        +'</div>'
        +'<div class="admin-card-actions reader-primary-actions">'
          +(pending?'<button class="reader-approve-btn" type="button" data-approve-reader="'+esc(p.id)+'">Aprovar leitor</button>':'<button class="reader-access-toggle" type="button" data-reader-access="'+esc(p.id)+'" data-enable="'+(blocked?'1':'0')+'">'+(blocked?'Liberar leitor':'Bloquear leitor')+'</button>')
          +(a?'<button type="button" data-reader-reading="'+esc(p.readerId)+'">Ver leitura detalhada</button>':'')
          +'<button type="button" data-access-log="'+esc(p.id)+'">Registro de acesso</button>'
          +'<button type="button" data-popup-profile="'+esc(p.id)+'">Enviar mensagem</button>'
          +(code?'<button type="button" data-copy-code="'+esc(p.id)+'">Copiar código</button>':'')
        +'</div>'
        +'<details class="reader-access-details"><summary>Acessos e livros <span>'+allowed.length+' liberado(s)</span></summary><div class="reader-access-details-body">'+codeHtml+'<p class="reader-access-note">'+(pending?'O livro escolhido fica preparado, mas só será visível depois da aprovação.':'Desmarcar um livro fecha a leitura desse livro no aparelho do leitor em tempo real.')+'</p><div class="reader-book-access-list">'+checks+'</div><div class="admin-card-actions reader-access-card-actions"><span class="reader-access-card-actions-caution"><button class="btn-caution" type="button" data-rotate-code="'+esc(p.id)+'">'+(code?'Gerar novo código':'Gerar código')+'</button><button class="reader-delete-btn" type="button" data-delete-profile="'+esc(p.id)+'">Apagar leitor</button></span></div></div></details>'
      +'</article>';
    }).join("");
    list.querySelectorAll("input[data-book]").forEach(cb=>{
      cb.addEventListener("change",async()=>{
        const profileId=cb.dataset.profile;
        const row=cb.closest(".reader-admin-card");
        const current=[...row.querySelectorAll("input[data-book]")].filter(x=>x.checked).map(x=>x.dataset.book);
        cb.disabled=true;
        try{await Comments.setAllowedBooks(profileId,current);}
        catch(e){alert("Não foi possível salvar: "+(e.message||"tente de novo."));cb.checked=!cb.checked;}
        finally{cb.disabled=false;}
      });
    });
    list.querySelectorAll("[data-approve-reader]").forEach(btn=>btn.addEventListener("click",async()=>{
      btn.disabled=true;
      try{await Comments.approveReaderProfile(btn.dataset.approveReader);await renderAccess();}
      catch(e){alert("Não foi possível aprovar: "+(e.message||"tente de novo."));btn.disabled=false;}
    }));
    list.querySelectorAll("[data-reader-access]").forEach(btn=>btn.addEventListener("click",async()=>{
      const enable=btn.dataset.enable==="1";
      const action=enable?"liberar":"bloquear";
      if(!confirm((enable?"Liberar":"Bloquear")+" o acesso deste leitor agora?"))return;
      btn.disabled=true;
      try{await Comments.setReaderAccess(btn.dataset.readerAccess,enable);await renderAccess();}
      catch(e){alert("Não foi possível "+action+" o leitor: "+(e.message||"tente de novo."));btn.disabled=false;}
    }));
    list.querySelectorAll("[data-reader-reading]").forEach(btn=>btn.addEventListener("click",()=>openReaderAnalytics(btn.dataset.readerReading)));
    list.querySelectorAll("[data-access-log]").forEach(btn=>btn.addEventListener("click",()=>{
      const profile=profiles.find(p=>p.id===btn.dataset.accessLog);
      if(profile)showReaderAccessLog(profile);
    }));
    list.querySelectorAll("[data-copy-code]").forEach(btn=>{
      btn.addEventListener("click",async()=>{
        const profile=profiles.find(p=>p.id===btn.dataset.copyCode);
        if(!profile?.accessCode)return;
        try{
          await navigator.clipboard.writeText(profile.accessCode);
          const old=btn.textContent;btn.textContent="Copiado!";setTimeout(()=>btn.textContent=old,1300);
        }catch(e){alert("Código: "+profile.accessCode);}
      });
    });
    list.querySelectorAll("[data-rotate-code]").forEach(btn=>btn.addEventListener("click",()=>{
      const profile=profiles.find(p=>p.id===btn.dataset.rotateCode);if(profile)openRotateCodeConfirm(profile);
    }));
    list.querySelectorAll("[data-popup-profile]").forEach(btn=>btn.addEventListener("click",()=>{
      const profile=profiles.find(p=>p.id===btn.dataset.popupProfile);if(profile)window.PopupMessages?.openCompose?.(profile);
    }));
    list.querySelectorAll("[data-delete-profile]").forEach(btn=>btn.addEventListener("click",()=>{
      const profile=profiles.find(p=>p.id===btn.dataset.deleteProfile);if(profile)openDeleteReaderConfirm(profile);
    }));
  }

  async function openReaderAnalytics(readerId){
    if(!readerId)return;
    hideAccess();
    analyticsReturnTo="readers";
    ensureAnalyticsSheet();
    const sheet=document.getElementById("betaAnalyticsSheet");sheet.hidden=false;
    const back=sheet.querySelector("#analyticsBackHome");if(back)back.textContent="← Leitores";
    startPresenceSubscription();
    await loadAnalytics();
    showAnalyticsReader(readerId);
  }

  function showAccess(){if(!Comments?.isAdmin?.())return;ensureAccessSheet();document.getElementById("bookAccessSheet").hidden=false;renderAccess();}
  function hideAccess(){const x=document.getElementById("bookAccessSheet");if(x)x.hidden=true;}

  const FELIPE_CH22_REACTION_MIGRATION="lityra:migration:felipe-ch22-exilado-v1";

  async function migrateFelipeCh22Reactions(){
    if(!Comments?.isAdmin?.()||!db()||localStorage.getItem(FELIPE_CH22_REACTION_MIGRATION)==="1")return;
    try{
      const manifestRes=await fetch("data/ruinas-dos-ceus.json",{cache:"no-cache"});
      if(!manifestRes.ok)return;
      const manifest=await manifestRes.json();
      const ch=(manifest.chapters||[]).find(x=>Number(x.n)===22);
      if(!ch?.text)return;

      const textRes=await fetch(ch.text,{cache:"no-cache"});
      if(!textRes.ok)return;
      const raw=await textRes.text();
      const paras=String(raw||"").replace(/\r\n/g,"\n").trim().split(/\n{2,}/).filter(Boolean);

      const defs=[
        {snippet:"Cobrir o rosto dele foi a parte mais difícil.",emoji:"😢"},
        {snippet:"— Hoje você não come.",emoji:"😱"},
        {snippet:"Gabasteri fechou a mão no pescoço dele.",emoji:"😱"},
        {snippet:"— Vocês não vão a lugar algum.",emoji:"😱"},
        {snippet:"Mas um Gabasteri foi enviado para as Ilhas Baixas muitos ciclos antes da queda.",emoji:"🤔"}
      ];
      const targets=defs.map(def=>{
        const idx=paras.findIndex(p=>p.includes(def.snippet));
        if(idx<0)return null;
        const text=paras[idx];
        return {
          idx,text,emoji:def.emoji,
          key:"p_"+Comments.hashText(text),
          quote:norm(text).slice(0,220)
        };
      });
      if(targets.some(x=>!x))return;

      const snap=await db().collection("comments").where("bookId","==","ruinas-dos-ceus").get();
      const reactions=[];
      snap.forEach(doc=>{
        const x=doc.data()||{},name=norm(x.author);
        if(x.kind==="reaction"&&Number(x.chapter)===22&&(name==="felipe"||name==="filipe")){
          reactions.push({ref:doc.ref,id:doc.id,...x});
        }
      });
      if(!reactions.length)return;

      reactions.sort((a,b)=>(Number(a.paraIdx)||0)-(Number(b.paraIdx)||0)||(Number(a.at)||0)-(Number(b.at)||0));
      const n=reactions.length;
      const pick=n<=1?[2]:n===2?[2,4]:n===3?[0,2,4]:n===4?[0,1,2,4]:[0,1,2,3,4];
      const selected=pick.map(i=>targets[i]);
      const batch=db().batch();

      reactions.forEach((r,i)=>{
        if(i<selected.length){
          const t=selected[i];
          batch.set(r.ref,{
            paraIdx:t.idx,
            paragraphKey:t.key,
            quote:t.quote,
            emoji:t.emoji,
            updatedAt:Date.now()
          },{merge:true});
        }else{
          batch.delete(r.ref);
        }
      });

      await batch.commit();
      localStorage.setItem(FELIPE_CH22_REACTION_MIGRATION,"1");
      await Comments.forceResync?.();
    }catch(e){
      console.warn("Não foi possível reposicionar as reações do Filipe no capítulo 22:",e);
    }
  }

  document.addEventListener("beta:admin",e=>{ensureButton();ensureAdminHome();if(e.detail?.on){subscribe();setTimeout(migrateFelipeCh22Reactions,500);}else{stop();hide();hideReactions();hideFeedbackHub();hideAccess();hideAnalytics();hideBetaFeedbackAdmin();const d=document.getElementById("betaChapterDetailSheet");if(d)d.hidden=true;hideAdminHome();}});
  document.addEventListener("beta:admin-home",()=>{if(Comments?.isAdmin?.())showAdminHome();});
  document.addEventListener("DOMContentLoaded",()=>{ensureButton();ensureAdminHome();ensureFeedbackHub();ensureReactionSheet();ensureSheet();ensureAccessSheet();ensureAnalyticsSheet();ensureBetaFeedbackAdminSheet();ensureBetaChapterDetailSheet();ensureDeleteReaderConfirm();ensureRotateCodeConfirm();if(Comments?.isAdmin?.()){subscribe();setTimeout(migrateFelipeCh22Reactions,500);}});
})();

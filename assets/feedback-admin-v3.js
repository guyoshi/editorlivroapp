// Admin dashboard for beta-reader feedback
(() => {
  let all=[], unsub=null, open=false, lastItems=[];
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm=s=>String(s||"").replace(/\s+/g," ").trim().toLowerCase();
  const when=t=>t?new Date(t).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
  const shortId=id=>{const v=String(id||"").replace(/[^a-z0-9]/gi,"").toUpperCase();return v?v.slice(-6):"LEGADO";};
  const readerKey=x=>x.authorId||("legacy:"+norm(x.author));
  const readerLabel=x=>(x.author||"Anônimo")+" · #"+shortId(x.authorId);
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
  function replies(id){return all.filter(x=>x.parentId===id||x.rootId===id).sort((a,b)=>(a.at||0)-(b.at||0));}
  function find(id){return all.find(x=>x.id===id);}
  function db(){return window.Comments?.getDb?.();}

  function ensureButton(){
    const btn=document.getElementById("btnAuthorAdmin");
    const bar=document.getElementById("authorAdminHomeBar");
    if(!btn)return null;
    const on=!!window.Comments?.isAdmin?.();
    btn.hidden=!on;
    if(bar)bar.hidden=!on;
    if(!btn.dataset.adminHomeWired){
      btn.dataset.adminHomeWired="1";
      btn.addEventListener("click",()=>showAdminHome());
    }
    return btn;
  }

  function ensureAdminHome(){
    if(document.getElementById("authorAdminSheet"))return;
    const el=document.createElement("div");el.id="authorAdminSheet";el.className="admin-dashboard-sheet";el.hidden=true;
    el.innerHTML='<section class="admin-dashboard admin-home"><header class="admin-dashboard-head"><div><h2>Painel do autor</h2><p>Gerencie leitores, acompanhe a leitura e centralize o feedback.</p></div><div class="admin-head-actions"><button id="authorAdminLogout" class="link-btn" type="button">Sair do admin</button><button id="authorAdminClose" class="icon-btn" type="button">✕</button></div></header><div class="admin-home-grid"><button id="openReaderAccess" class="admin-home-card" type="button"><strong>Leitores e acessos</strong><span>Libere livros, envie popup ou remova leitores.</span></button><button id="openAnalyticsDashboard" class="admin-home-card" type="button"><strong>Relatórios beta</strong><span>Veja avanço, tempo de leitura, narração, música e preferências.</span></button><button id="openPopupDashboard" class="admin-home-card" type="button"><strong>Mensagens popup</strong><span>Veja pendentes, disparadas, lidas e seus modelos.</span></button><button id="openCommentDashboard" class="admin-home-card" type="button"><strong>Comentários</strong><span>Leia e responda ao feedback dos capítulos.</span><span id="adminHomeNewCount" class="admin-new-count" hidden></span></button></div></section>';
    document.body.appendChild(el);
    el.querySelector("#authorAdminClose").onclick=hideAdminHome;
    el.querySelector("#authorAdminLogout").onclick=()=>{hideAdminHome();document.dispatchEvent(new CustomEvent("beta:admin-logout"));};
    el.querySelector("#openReaderAccess").onclick=()=>{hideAdminHome();showAccess();};
    el.querySelector("#openAnalyticsDashboard").onclick=()=>{hideAdminHome();showAnalytics();};
    el.querySelector("#openPopupDashboard").onclick=()=>{hideAdminHome();window.PopupMessages?.openAdmin?.();};
    el.querySelector("#openCommentDashboard").onclick=()=>{hideAdminHome();show();};
    el.onclick=e=>{if(e.target===el)hideAdminHome();};
  }

  function ensureSheet(){
    if(document.getElementById("commentAdminSheet"))return;
    const el=document.createElement("div");el.id="commentAdminSheet";el.className="admin-dashboard-sheet";el.hidden=true;
    el.innerHTML='<section class="admin-dashboard"><header class="admin-dashboard-head"><div><h2>Central de comentários</h2><p>Novos primeiro. Responda, resolva ou vá direto ao trecho.</p></div><div class="admin-head-actions"><button id="adminDashBack" class="link-btn admin-back-btn" type="button">← Painel</button><button id="adminDashClose" class="icon-btn" type="button">✕</button></div></header><div class="admin-dashboard-filters"><select id="afStatus"><option value="all">Todos</option><option value="new">Novos</option><option value="open">Em aberto</option><option value="resolved">Resolvidos</option></select><select id="afBook"><option value="">Todos os livros</option></select><select id="afChapter"><option value="">Todos os capítulos</option></select><select id="afAuthor"><option value="">Todos os leitores</option></select><input id="afSearch" type="search" placeholder="Buscar comentário…"></div><div class="admin-dashboard-bulk"><button id="afMarkReadAll" type="button" class="link-btn">Marcar exibidos como lidos</button><button id="afMarkUnreadAll" type="button" class="link-btn">Marcar exibidos como não lidos</button></div><div id="adminDashboardList" class="admin-dashboard-list"></div></section>';
    document.body.appendChild(el);
    el.querySelector("#adminDashBack").onclick=()=>{hide();showAdminHome();};
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

  // ---------------- Relatórios beta ----------------
  let analyticsRows=[];
  const FEATURE_MIN_SEC=15;
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
      +'<header class="admin-dashboard-head"><div><h2>Relatórios beta</h2><p>Avanço dos leitores e uso real das ferramentas do app.</p></div><div class="admin-head-actions"><button id="analyticsBackHome" class="link-btn admin-back-btn" type="button">← Painel</button><button id="analyticsRefresh" class="link-btn" type="button">Atualizar</button><button id="analyticsClose" class="icon-btn" type="button">✕</button></div></header>'
      +'<div id="analyticsMain" class="analytics-scroll">'
      +'<p class="analytics-note">As médias ignoram os usuários marcados como teste. Uso de narração/música conta após 15 segundos. Capítulos antigos concluídos são importados quando o leitor abre o livro, mas tempos históricos não podem ser reconstruídos.</p>'
      +'<div id="analyticsOverview" class="analytics-overview"></div>'
      +'<section class="analytics-section"><div class="analytics-section-head"><h3>Uso de recursos</h3><span>Percentual dos leitores medidos que realmente usaram narração, música, ambos ou nenhum.</span></div><div id="analyticsAdoption" class="analytics-adoption"></div></section>'
      +'<section class="analytics-section"><div class="analytics-section-head"><h3>Preferências mais usadas</h3><span>Top escolhas dos leitores válidos, em porcentagem.</span></div><div id="analyticsPreferences" class="analytics-preferences"></div></section>'
      +'<section class="analytics-section"><div class="analytics-section-head"><h3>Avanço dos leitores</h3><span>Toque em um leitor para abrir o detalhe. Contas de teste podem ser ignoradas sem serem apagadas.</span></div><div id="analyticsReaderList"></div></section>'
      +'</div>'
      +'<div id="analyticsDetail" class="analytics-scroll" hidden></div>'
      +'</section>';
    document.body.appendChild(el);
    el.querySelector("#analyticsBackHome").onclick=()=>{hideAnalytics();showAdminHome();};
    el.querySelector("#analyticsClose").onclick=hideAnalytics;
    el.querySelector("#analyticsRefresh").onclick=loadAnalytics;
    el.onclick=e=>{if(e.target===el)hideAnalytics();};
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

  function renderAnalytics(){
    const overview=document.getElementById("analyticsOverview");
    const adoption=document.getElementById("analyticsAdoption");
    const pref=document.getElementById("analyticsPreferences");
    const list=document.getElementById("analyticsReaderList");
    if(!overview||!adoption||!pref||!list)return;

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
      return (b.analytics?.lastActiveAt||b.analytics?.updatedAt||0)-(a.analytics?.lastActiveAt||a.analytics?.updatedAt||0);
    });

    list.innerHTML=displayRows.map(row=>{
      const p=row.profile||{},a=row.analytics,ignored=!!p.analyticsIgnored;
      const label=esc(p.name||a?.name||"Anônimo")+" · #"+shortId(p.readerId||a?.readerId);
      const ignoreBtn='<button class="link-btn analytics-ignore-btn" type="button" data-analytics-ignore="'+(ignored?"0":"1")+'" data-profile-id="'+esc(p.id||"")+'" data-reader-id="'+esc(p.readerId||a?.readerId||"")+'">'+(ignored?"Incluir nas estatísticas":"Ignorar nas estatísticas")+'</button>';
      if(!a){
        return '<article class="analytics-reader-card is-empty '+(ignored?"is-ignored":"")+'">'
          +'<div class="analytics-reader-open-static"><strong>'+label+'</strong><span>Sem atividade medida ainda.</span></div>'
          +'<div class="analytics-reader-actions">'+(ignored?'<span class="analytics-ignored-badge">Ignorado</span>':'')+ignoreBtn+'</div>'
          +'</article>';
      }
      const location=a.currentChapter
        ?esc(a.currentBookTitle||a.currentBookId||"Livro")+' · Cap. '+esc(a.currentChapter)+' · '+pct(a.currentChapterPct)+'%'
        :'Nenhum capítulo aberto ainda';
      const completed=(row.chapters||[]).filter(ch=>ch.completed).length;
      return '<article class="analytics-reader-card '+(ignored?"is-ignored":"")+'">'
        +'<button class="analytics-reader-open" type="button" data-analytics-reader="'+esc(a.readerId)+'">'
          +'<div class="analytics-reader-top"><div><strong>'+label+'</strong><span>'+location+'</span></div><b>'+pct(a.currentChapterPct)+'%</b></div>'
          +'<div class="analytics-progress"><i style="width:'+pct(a.currentChapterPct)+'%"></i></div>'
          +'<div class="analytics-reader-metrics"><span>'+completed+' caps concluídos</span><span>'+fmtDuration(a.totalActiveSec)+' ativo</span><span>'+fmtDuration(a.totalNarrationSec)+' narração</span><span>'+fmtDuration(a.totalMusicSec)+' música</span></div>'
          +'<small>Última atividade: '+esc(when(a.lastActiveAt||a.updatedAt)||"—")+'</small>'
        +'</button>'
        +'<div class="analytics-reader-actions">'+(ignored?'<span class="analytics-ignored-badge">Ignorado das médias</span>':'')+ignoreBtn+'</div>'
        +'</article>';
    }).join("");

    list.querySelectorAll("[data-analytics-reader]").forEach(btn=>{
      btn.onclick=()=>showAnalyticsReader(btn.dataset.analyticsReader);
    });
    wireIgnoreButtons(list);
  }

  async function loadAnalytics(){
    const main=document.getElementById("analyticsMain");
    const detail=document.getElementById("analyticsDetail");
    const list=document.getElementById("analyticsReaderList");
    if(!main||!detail||!list||!db())return;
    detail.hidden=true;
    main.hidden=false;
    list.innerHTML='<p class="admin-empty">Carregando relatórios…</p>';
    try{
      const [profiles,snap]=await Promise.all([
        Comments.listReaderProfiles(),
        db().collection("readerAnalytics").get()
      ]);
      const byReader=new Map();
      snap.forEach(d=>byReader.set(d.id,{id:d.id,...d.data()}));
      analyticsRows=profiles.map(profile=>({profile,analytics:byReader.get(profile.readerId)||null,chapters:[]}));

      await Promise.all(analyticsRows.filter(row=>row.analytics?.readerId).map(async row=>{
        try{
          const chapterSnap=await db().collection("readerAnalytics").doc(row.analytics.readerId).collection("chapters").get();
          chapterSnap.forEach(d=>row.chapters.push({id:d.id,...d.data()}));
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
    }catch(e){
      console.warn("Não foi possível carregar os relatórios beta:",e);
      list.innerHTML='<p class="admin-empty">Não foi possível carregar os relatórios. Confira se as regras do Firestore desta versão já foram publicadas.</p>';
    }
  }

  function showAnalyticsReader(readerId){
    const row=analyticsRows.find(item=>item.analytics?.readerId===readerId);
    if(!row)return;
    const main=document.getElementById("analyticsMain");
    const detail=document.getElementById("analyticsDetail");
    main.hidden=true;
    detail.hidden=false;

    const chapters=row.chapters||[];
    const a=row.analytics,p=row.profile||{};
    const ignored=!!p.analyticsIgnored;
    const label=esc(p.name||a.name||"Anônimo")+" · #"+shortId(readerId);
    const narrationCaps=chapters.filter(ch=>(Number(ch.narrationSec)||0)>=FEATURE_MIN_SEC).length;
    const musicCaps=chapters.filter(ch=>(Number(ch.musicSec)||0)>=FEATURE_MIN_SEC).length;
    const completed=chapters.filter(ch=>ch.completed).length;
    const timedCompleted=chapters.filter(ch=>ch.completed&&(Number(ch.activeSec)||0)>=FEATURE_MIN_SEC);
    const readerAvg=avg(timedCompleted.map(ch=>Number(ch.activeSec)||0));
    const current=a.currentChapter
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
      '<button id="analyticsBack" class="back-link analytics-back" type="button">← Todos os leitores</button>'
      +'<section class="analytics-reader-detail-head"><div class="analytics-reader-detail-title"><div><h3>'+label+'</h3><p>'+current+'</p><small>Última atividade: '+esc(when(a.lastActiveAt||a.updatedAt)||"—")+'</small></div>'
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

    detail.querySelector("#analyticsBack").onclick=()=>{detail.hidden=true;main.hidden=false;};
    wireIgnoreButtons(detail);
  }

  function showAnalytics(){
    if(!Comments?.isAdmin?.())return;
    ensureAnalyticsSheet();
    document.getElementById("betaAnalyticsSheet").hidden=false;
    loadAnalytics();
  }
  function hideAnalytics(){
    const x=document.getElementById("betaAnalyticsSheet");
    if(x)x.hidden=true;
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

  function ensureAccessSheet(){
    if(document.getElementById("bookAccessSheet"))return;
    const el=document.createElement("div");el.id="bookAccessSheet";el.className="admin-dashboard-sheet";el.hidden=true;
    el.innerHTML='<section class="admin-dashboard"><header class="admin-dashboard-head"><div><h2>Leitores e acessos</h2><p>Cada leitor escolhe o primeiro livro. Marque outros para ampliar a biblioteca dele.</p></div><div class="admin-head-actions"><button id="accessDashBack" class="link-btn admin-back-btn" type="button">← Painel</button><button id="accessDashClose" class="icon-btn" type="button">✕</button></div></header><div id="bookAccessList" class="admin-dashboard-list"></div></section>';
    document.body.appendChild(el);
    el.querySelector("#accessDashBack").onclick=()=>{hideAccess();showAdminHome();};
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

  document.addEventListener("beta:admin",e=>{ensureButton();ensureAdminHome();if(e.detail?.on)subscribe();else{stop();hide();hideAccess();hideAnalytics();hideAdminHome();}});
  document.addEventListener("beta:admin-home",()=>{if(Comments?.isAdmin?.())showAdminHome();});
  document.addEventListener("DOMContentLoaded",()=>{ensureButton();ensureAdminHome();ensureSheet();ensureAccessSheet();ensureAnalyticsSheet();if(Comments?.isAdmin?.())subscribe();});
})();

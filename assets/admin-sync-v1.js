/* Sincronização manual do conteúdo publicado, exclusiva do painel do autor. */
(()=>{"use strict";
  const SHEET_ID="adminContentSyncSheet";
  const STATUS_ID="adminContentSyncStatus";
  const VERSION_KEY="lityra:asset-cache-version";
  const admin=()=>!!window.Comments?.isAdmin?.();
  const $=selector=>document.querySelector(selector);
  const safe=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const stampUrl=(raw,stamp)=>{
    const url=new URL(raw,document.baseURI);
    url.searchParams.set("lityra_sync",String(stamp));
    return url.href;
  };
  function ensureSheet(){
    if($("#"+SHEET_ID))return $("#"+SHEET_ID);
    const sheet=document.createElement("div");
    sheet.id=SHEET_ID;
    sheet.className="admin-dashboard-sheet";
    sheet.hidden=true;
    sheet.innerHTML='<section class="admin-dashboard sync-dashboard">'
      +'<header class="admin-dashboard-head"><div><h2>Sincronizar conteúdo</h2><p>Atualize livros e imagens que já estão publicados no Lityra.</p></div>'
      +'<div class="admin-head-actions"><button id="adminContentSyncBack" class="link-btn admin-back-btn" type="button">← Painel</button>'
      +'<button id="adminContentSyncClose" class="icon-btn" type="button" aria-label="Fechar">✕</button></div></header>'
      +'<div class="sync-content"><p class="sync-description">Busca a lista mais recente de livros e capítulos, renova as capas e artes disponíveis e limpa o cache de arquivos do app. O progresso de leitura, os comentários e as permissões permanecem intactos.</p>'
      +'<label class="sync-option"><input id="adminSyncAuditImages" type="checkbox"> Conferir se cada imagem publicada está acessível <small>(pode consumir dados móveis)</small></label>'
      +'<button id="adminContentSyncRun" class="btn-primary sync-run" type="button">↻ Sincronizar agora</button>'
      +'<p id="'+STATUS_ID+'" class="sync-status" role="status" aria-live="polite">Nenhuma sincronização executada nesta sessão.</p>'
      +'<div id="adminContentSyncResults" class="sync-results" hidden></div>'
      +'<p class="sync-disclaimer">Novos livros devem constar em <code>data/books.json</code> e ter um manifesto publicado. Imagens precisam existir no endereço configurado. Este botão não envia arquivos do telefone nem altera o GitHub.</p></div></section>';
    document.body.appendChild(sheet);
    sheet.querySelector("#adminContentSyncClose").onclick=()=>{sheet.hidden=true;};
    sheet.querySelector("#adminContentSyncBack").onclick=()=>{
      sheet.hidden=true;
      document.dispatchEvent(new Event("beta:admin-home"));
    };
    sheet.onclick=event=>{if(event.target===sheet)sheet.hidden=true;};
    sheet.querySelector("#adminContentSyncRun").onclick=runSync;
    return sheet;
  }
  function show(){
    if(!admin())return;
    ensureSheet().hidden=false;
  }
  function status(value){
    const el=$("#"+STATUS_ID);
    if(el)el.textContent=value;
  }
  async function fetchData(path,stamp){
    if(!/^data\/[a-z0-9_-]+\.json$/i.test(path))throw new Error("Manifesto inválido: "+path);
    const response=await fetch(stampUrl(path,stamp),{cache:"no-store",credentials:"same-origin"});
    if(!response.ok)throw new Error(path+" (HTTP "+response.status+")");
    const data=await response.json();
    if(!data||typeof data!=="object")throw new Error("JSON inválido: "+path);
    return data;
  }
  async function checkImage(url,stamp){
    return new Promise(resolve=>{
      const image=new Image();
      let ended=false;
      const timer=setTimeout(()=>done(false),12000);
      function done(ok){
        if(ended)return;
        ended=true;
        clearTimeout(timer);
        image.onload=null;image.onerror=null;
        resolve(ok);
      }
      image.onload=()=>done(true);
      image.onerror=()=>done(false);
      try{image.src=stampUrl(url,stamp);}catch(_){done(false);}
    });
  }
  function coverPath(book){
    return book.cover || (["ruinas-dos-ceus","guerras-de-sangue","dinastia-polar","herdeiros-das-cinzas"].includes(book.id)
      ? "https://guyoshi.github.io/dimensoesinfinitassite/assets/books/ciclo-de-jesed/"+book.id+"/cover.webp"
      : null);
  }
  function chapterArtPath(book,chapter){
    if(chapter.art)return chapter.art;
    if(!book.artBase)return null;
    return book.artBase+"chapters/chapter-"+String(chapter.n).padStart(2,"0")+".webp";
  }
  async function runSync(){
    if(!admin())return;
    const sheet=ensureSheet(),button=sheet.querySelector("#adminContentSyncRun");
    if(button.disabled)return;
    const result=sheet.querySelector("#adminContentSyncResults");
    const audit=sheet.querySelector("#adminSyncAuditImages").checked;
    button.disabled=true;
    result.hidden=true;
    const stamp=Date.now();
    try{
      status("Conferindo catálogo publicado…");
      const root=await fetchData("data/books.json",stamp);
      if(!Array.isArray(root.books))throw new Error("data/books.json não contém a lista de livros.");
      const books=root.books;
      const ids=new Set();
      for(const book of books){
        if(!book||typeof book.id!=="string"||!book.id||typeof book.title!=="string"||!/^data\/[a-z0-9_-]+\.json$/i.test(book.manifest||"")||ids.has(book.id))
          throw new Error("Há um livro repetido ou incompleto no catálogo.");
        ids.add(book.id);
      }
      const oldIds=new Set(window.LityraContentAPI?.getBooks?.().map(book=>book.id)||[]);
      const fresh=books.filter(book=>!oldIds.has(book.id));
      let chapterCount=0,artCount=0;
      const manifests=new Map();
      const errors=[];
      for(let i=0;i<books.length;i+=5){
        const batch=books.slice(i,i+5);
        status("Verificando manifestos de livros: "+Math.min(i+batch.length,books.length)+"/"+books.length+"…");
        const res=await Promise.all(batch.map(async book=>{
          try{
            const m=await fetchData(book.manifest,stamp);
            if(!Array.isArray(m.chapters))throw new Error("sem lista de capítulos");
            return {book,chapters:m.chapters};
          }catch(error){
            errors.push(book.title+": "+(error.message||error));
            return {book,chapters:[]};
          }
        }));
        res.forEach(item=>{
          manifests.set(item.book.id,item.chapters);
          chapterCount+=item.chapters.length;
          artCount+=item.chapters.filter(ch=>chapterArtPath(item.book,ch)).length;
        });
      }
      if(errors.length)throw new Error("Não foi possível validar tudo: "+errors.join("; "));
      const covers=books.map(coverPath).filter(Boolean);
      let verified=0,missing=[];
      if(audit){
        const targets=[
          ...books.map(book=>({url:coverPath(book),label:"Capa: "+book.title})).filter(x=>x.url),
          ...books.flatMap(book=>(manifests.get(book.id)||[]).map(ch=>({
            url:chapterArtPath(book,ch),label:book.title+" · Cap. "+ch.n
          }))).filter(x=>x.url)
        ];
        // A verificação é opt-in porque cada imagem precisa ser carregada.
        for(let i=0;i<targets.length;i+=5){
          if(!admin())throw new Error("Sessão de administrador encerrada.");
          status("Conferindo imagens: "+Math.min(i+5,targets.length)+"/"+targets.length+"…");
          const group=targets.slice(i,i+5);
          const ok=await Promise.all(group.map(x=>checkImage(x.url,stamp)));
          ok.forEach((value,j)=>value?verified++:missing.push(group[j].label));
        }
      }
      if(!admin())throw new Error("Sessão de administrador encerrada.");
      status("Atualizando cache e biblioteca…");
      if("caches" in window){
        const keys=await caches.keys();
        await Promise.all(keys.filter(key=>/^jesed-(?:shell|content)-/.test(key)).map(key=>caches.delete(key)));
      }
      try{sessionStorage.setItem(VERSION_KEY,String(stamp));}catch(_){}
      if(window.LityraContentAPI?.refresh)await window.LityraContentAPI.refresh(books);
      if("serviceWorker" in navigator){
        try{const reg=await navigator.serviceWorker.getRegistration();if(reg)await reg.update();}catch(_){}
      }
      const rows=[
        "<strong>"+books.length+"</strong> livros publicados",
        "<strong>"+chapterCount+"</strong> capítulos cadastrados",
        "<strong>"+covers.length+"</strong> capas configuradas",
        "<strong>"+artCount+"</strong> imagens de capítulos referenciadas",
        "<strong>"+fresh.length+"</strong> livro(s) novo(s) nesta sessão"
      ];
      result.innerHTML='<div class="sync-metrics">'+rows.map(row=>"<span>"+row+"</span>").join("")+"</div>"
        +(fresh.length?'<p><b>Novos livros:</b> '+fresh.map(book=>safe(book.title)).join(", ")+"</p>":"")
        +(audit?'<p><b>Imagens acessíveis:</b> '+verified+"/"+(verified+missing.length)+"</p>"
          +(missing.length?'<details><summary>'+missing.length+' imagem(ns) não encontrada(s)</summary><ul>'+missing.map(name=>"<li>"+safe(name)+"</li>").join("")+"</ul></details>":""):"<p>Imagens renovadas sob demanda. Ative a conferência para checar os arquivos individualmente.</p>");
      result.hidden=false;
      status("Sincronização concluída. Os arquivos publicados aparecerão ao abrir a biblioteca e os capítulos.");
    }catch(error){
      status("Não foi possível concluir: "+(error?.message||"falha de rede")+". Nada foi apagado do progresso.");
    }finally{
      button.disabled=false;
    }
  }
  document.addEventListener("lityra:admin-sync-open",show);
  document.addEventListener("beta:admin",event=>{if(!event.detail?.on){const sheet=$("#"+SHEET_ID);if(sheet)sheet.hidden=true;}});
})();
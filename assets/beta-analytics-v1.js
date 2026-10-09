// ================= Beta Reader Analytics =================
// Coleta progresso e uso do leitor beta de forma agregada por perfil.
// O nome é apenas rótulo: toda a identidade usa readerId + hash do código.

(() => {
  const USER_KEY="jesed:readerId";
  const NAME_KEY="jesed:username";
  const PROFILE_HASH_KEY="jesed:readerCodeHash";
  const THEME_KEY="jesed:theme";
  const FONT_KEY="jesed:readerFontScale";
  const FONT_FAMILY_KEY="jesed:readerFontFamily";
  const HIDE_ART_KEY="jesed:hideChapterArt";
  const AUTO_AMBIENT_KEY="jesed:autoAmbient";

  let context=null;
  let currentView="library";
  let lastInteractionAt=Date.now();
  let lastTickAt=Date.now();
  let lastFlushAt=Date.now();
  let activePendingSec=0;
  let narrationPendingSec=0;
  let musicPendingSec=0;
  let narrationPlaying=false;
  let musicPlaying=false;
  let narrationStartedAt=0;
  let musicStartedAt=0;
  let lastProgressSent=-1;
  let maxProgressSeen=0;
  let progressTimer=null;
  let sending=false;
  const usageQueue=[];

  const now=()=>Date.now();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  // Mesma janela curta de "cold start" do Firestore logo após abrir o app
  // (às vezes a primeira escrita cruzando coleções esbarra em permission-denied
  // mesmo com as Rules corretas). Tentamos de novo antes de desistir, em vez
  // de perder a métrica silenciosamente.
  async function commitWithRetry(batch){
    const attempts=[0,1500,4000];
    let lastErr=null;
    for(let i=0;i<attempts.length;i++){
      if(attempts[i])await sleep(attempts[i]);
      try{
        await batch.commit();
        return true;
      }catch(e){
        lastErr=e;
      }
    }
    throw lastErr;
  }
  const chapterKey=ctx=>ctx ? String(ctx.bookId)+":"+String(ctx.chapter) : "";
  const chapterDocId=ctx=>String(ctx.bookId).replace(/[^a-zA-Z0-9_-]/g,"_")+"__"+String(ctx.chapter);

  function identity(){
    if(window.Comments?.isAdmin?.())return null;
    const readerId=String(localStorage.getItem(USER_KEY)||"").trim();
    const profileHash=String(localStorage.getItem(PROFILE_HASH_KEY)||"").trim();
    const name=String(localStorage.getItem(NAME_KEY)||"").trim();
    if(!readerId||!profileHash||!name)return null;
    return {readerId,profileHash,name};
  }

  function db(){
    return window.Comments?.getDb?.() || null;
  }

  function fieldValue(){
    return window.firebase?.firestore?.FieldValue || null;
  }

  function prefs(){
    const rid=String(localStorage.getItem(USER_KEY)||"").trim();
    const scoped=base=>rid?base+":reader:"+rid:base+":guest";
    const read=(base,fallback)=>{
      const value=localStorage.getItem(scoped(base));
      return value===null?fallback:value;
    };
    const scaleRaw=Number(read(FONT_KEY,"1"));
    return {
      theme:String(read(THEME_KEY,document.documentElement.dataset.theme||"ambar")),
      font:String(read(FONT_FAMILY_KEY,document.documentElement.dataset.readerFont||"lora")),
      fontScale:Number.isFinite(scaleRaw)?Math.max(.8,Math.min(1.6,Math.round(scaleRaw*10)/10)):1,
      hideArt:read(HIDE_ART_KEY,"0")==="1",
      autoAmbient:read(AUTO_AMBIENT_KEY,"0")==="1"
    };
  }

  function summaryBase(id,stamp=now()){
    return {
      readerId:id.readerId,
      profileHash:id.profileHash,
      name:id.name,
      updatedAt:stamp
    };
  }

  function chapterBase(id,ctx,stamp=now()){
    return {
      readerId:id.readerId,
      profileHash:id.profileHash,
      bookId:ctx.bookId,
      bookTitle:ctx.bookTitle||ctx.bookId,
      chapter:Number(ctx.chapter)||0,
      chapterTitle:ctx.chapterTitle||"",
      updatedAt:stamp
    };
  }

  // Histórico de abertura dos capítulos. Cada abertura fica em um documento
  // separado dentro da subcoleção já autorizada de analytics. O prefixo
  // "access__" permite ao painel distinguir eventos do estado agregado.
  async function logChapterAccess(ctx,stamp=now()){
    const id=identity(),store=db();
    if(!id||!store||!ctx?.bookId||!ctx?.chapter)return false;
    const accessId="access__"+stamp+"__"+Math.random().toString(36).slice(2,8);
    const payload={
      ...chapterBase(id,ctx,stamp),
      lastOpenedAt:stamp
    };
    try{
      await store.collection("readerAnalytics").doc(id.readerId).collection("chapters").doc(accessId).set(payload);
      window.BetaDiag?.ok?.("access-log");
      return true;
    }catch(e){
      window.BetaDiag?.error?.("access-log",e);
      console.warn("Não foi possível registrar o acesso ao capítulo:",e);
      return false;
    }
  }

  // Escritas que falharam ficam guardadas (uma por capítulo, sempre com o
  // estado mais recente) e são reenviadas no próximo ciclo, em vez de se
  // perderem — antes, se a abertura do capítulo falhasse uma vez, o painel
  // nunca ficava sabendo que o leitor estava naquele capítulo.
  const failedStates=new Map();
  let retryingStates=false;
  function rememberFailed(summaryFields,chapterFields,ctx){
    const key=ctx&&chapterFields?chapterKey(ctx):"__summary";
    const prev=failedStates.get(key);
    failedStates.set(key,{
      summaryFields:{...(prev?.summaryFields||{}),...summaryFields},
      chapterFields:chapterFields?{...(prev?.chapterFields||{}),...chapterFields}:(prev?.chapterFields||null),
      ctx:ctx?{...ctx}:null
    });
  }
  async function retryFailedStates(){
    if(retryingStates||!failedStates.size)return;
    retryingStates=true;
    try{
      for(const [key,item] of [...failedStates.entries()]){
        failedStates.delete(key);
        try{await writeState(item.summaryFields,item.chapterFields,item.ctx);}
        catch(e){break;}
      }
    }finally{retryingStates=false;}
  }

  async function writeState(summaryFields={},chapterFields=null,ctx=context){
    const id=identity(),store=db();
    if(!id||!store){
      if(!id)window.BetaDiag?.error?.("analytics:identidade",new Error("perfil incompleto neste aparelho (readerId/hash/nome)"));
      rememberFailed(summaryFields,chapterFields,ctx);
      return false;
    }
    const stamp=now();
    const batch=store.batch();
    const summaryRef=store.collection("readerAnalytics").doc(id.readerId);
    batch.set(summaryRef,{...summaryBase(id,stamp),...summaryFields},{merge:true});
    if(ctx&&chapterFields){
      const chapterRef=summaryRef.collection("chapters").doc(chapterDocId(ctx));
      batch.set(chapterRef,{...chapterBase(id,ctx,stamp),...chapterFields},{merge:true});
    }
    try{
      await commitWithRetry(batch);
    }catch(e){
      window.BetaDiag?.error?.(ctx&&chapterFields?"analytics:capitulo":"analytics:resumo",e);
      rememberFailed(summaryFields,chapterFields,ctx);
      throw e;
    }
    window.BetaDiag?.ok?.("analytics");
    return true;
  }

  function collectMedia(stamp=now()){
    if(narrationPlaying&&narrationStartedAt){
      narrationPendingSec += Math.max(0,(stamp-narrationStartedAt)/1000);
      narrationStartedAt=stamp;
    }
    if(musicPlaying&&musicStartedAt){
      musicPendingSec += Math.max(0,(stamp-musicStartedAt)/1000);
      musicStartedAt=stamp;
    }
  }

  function enqueueCurrentUsage(){
    if(!context)return;
    collectMedia();
    const active=Math.max(0,Math.floor(activePendingSec));
    const narration=Math.max(0,Math.floor(narrationPendingSec));
    const music=Math.max(0,Math.floor(musicPendingSec));
    if(!active&&!narration&&!music)return;
    usageQueue.push({
      ctx:{...context},
      active,
      narration,
      music,
      at:now()
    });
    activePendingSec=Math.max(0,activePendingSec-active);
    narrationPendingSec=Math.max(0,narrationPendingSec-narration);
    musicPendingSec=Math.max(0,musicPendingSec-music);
  }

  async function drainUsage(){
    if(sending||!usageQueue.length)return;
    const id=identity(),store=db(),FV=fieldValue();
    if(!id||!store||!FV)return;
    sending=true;
    try{
      while(usageQueue.length){
        const item=usageQueue[0];
        const key=chapterKey(item.ctx);
        const summary={...summaryBase(id,item.at),lastActiveAt:item.at};
        const chapter={...chapterBase(id,item.ctx,item.at),lastActiveAt:item.at};

        if(item.active){
          summary.totalActiveSec=FV.increment(item.active);
          chapter.activeSec=FV.increment(item.active);
        }
        if(item.narration){
          summary.totalNarrationSec=FV.increment(item.narration);
          summary.narrationChapters=FV.arrayUnion(key);
          chapter.narrationSec=FV.increment(item.narration);
          chapter.narrationUsed=true;
        }
        if(item.music){
          summary.totalMusicSec=FV.increment(item.music);
          summary.musicChapters=FV.arrayUnion(key);
          chapter.musicSec=FV.increment(item.music);
          chapter.musicUsed=true;
        }

        const summaryRef=store.collection("readerAnalytics").doc(id.readerId);
        const chapterRef=summaryRef.collection("chapters").doc(chapterDocId(item.ctx));
        const batch=store.batch();
        batch.set(summaryRef,summary,{merge:true});
        batch.set(chapterRef,chapter,{merge:true});
        await commitWithRetry(batch);
        usageQueue.shift();
      }
    }catch(e){
      window.BetaDiag?.error?.("analytics:tempo",e);
      console.warn("Não foi possível sincronizar as métricas do leitor:",e);
    }finally{
      sending=false;
    }
  }

  function flushUsage(){
    enqueueCurrentUsage();
    drainUsage();
    lastFlushAt=now();
  }

  function noteInteraction(){
    lastInteractionAt=now();
  }

  function setView(name){
    currentView=name||"library";
    noteInteraction();
    if(currentView!=="reader")flushUsage();
  }

  function closeChapter(){
    flushUsage();
    context=null;
    lastProgressSent=-1;
    maxProgressSeen=0;
    if(progressTimer){clearTimeout(progressTimer);progressTimer=null;}
    if(narrationPlaying)narrationStartedAt=now();
    if(musicPlaying)musicStartedAt=now();
  }

  function openChapter(book,ch,initialPct=0){
    if(!book||!ch)return;
    context={
      bookId:String(book.id||""),
      bookTitle:String(book.title||book.id||""),
      chapter:Number(ch.n)||0,
      chapterTitle:String(ch.title||"")
    };
    const knownPct=Math.max(0,Math.min(100,Math.round(Number(initialPct)||0)));
    lastProgressSent=knownPct;
    maxProgressSeen=knownPct;
    noteInteraction();
    const stamp=now();
    const p=prefs();
    writeState({
      lastActiveAt:stamp,
      currentBookId:context.bookId,
      currentBookTitle:context.bookTitle,
      currentChapter:context.chapter,
      currentChapterTitle:context.chapterTitle,
      currentChapterPct:knownPct,
      ...p
    },{
      lastOpenedAt:stamp,
      currentPct:knownPct
    }).catch(e=>console.warn("Não foi possível registrar a abertura do capítulo:",e));
    logChapterAccess({...context},stamp);
    if(narrationPlaying)narrationStartedAt=stamp;
    if(musicPlaying)musicStartedAt=stamp;
  }

  function progress(value){
    if(!context)return;
    noteInteraction();
    const incoming=Math.max(0,Math.min(100,Math.round(Number(value)||0)));
    maxProgressSeen=Math.max(maxProgressSeen,incoming);
    const pct=maxProgressSeen;
    if(Math.abs(pct-lastProgressSent)<3 && pct<96)return;
    if(progressTimer)clearTimeout(progressTimer);
    progressTimer=setTimeout(()=>{
      progressTimer=null;
      if(!context)return;
      lastProgressSent=pct;
      const ctx={...context};
      writeState({
        lastActiveAt:now(),
        currentBookId:ctx.bookId,
        currentBookTitle:ctx.bookTitle,
        currentChapter:ctx.chapter,
        currentChapterTitle:ctx.chapterTitle,
        currentChapterPct:pct
      },{
        currentPct:pct
      },ctx).catch(e=>console.warn("Não foi possível sincronizar o progresso:",e));
    },1200);
  }

  function completed(done){
    if(!context)return;
    noteInteraction();
    const FV=fieldValue();
    if(!FV)return;
    const key=chapterKey(context);
    const stamp=now();
    const summary={
      lastActiveAt:stamp,
      completedChapters:done?FV.arrayUnion(key):FV.arrayRemove(key)
    };
    const chapter={
      completed:!!done,
      currentPct:done?100:Math.max(0,lastProgressSent),
      completedAt:done?stamp:0
    };
    if(done)summary.currentChapterPct=100;
    writeState(summary,chapter).catch(e=>console.warn("Não foi possível sincronizar a conclusão:",e));
  }

  function narration(playing){
    const next=!!playing;
    if(next===narrationPlaying)return;
    const stamp=now();
    if(narrationPlaying&&narrationStartedAt){
      narrationPendingSec+=Math.max(0,(stamp-narrationStartedAt)/1000);
    }
    narrationPlaying=next;
    narrationStartedAt=next?stamp:0;
    if(!next)flushUsage();
  }

  function music(playing){
    const next=!!playing;
    if(next===musicPlaying)return;
    const stamp=now();
    if(musicPlaying&&musicStartedAt){
      musicPendingSec+=Math.max(0,(stamp-musicStartedAt)/1000);
    }
    musicPlaying=next;
    musicStartedAt=next?stamp:0;
    if(!next)flushUsage();
  }

  function syncPreferences(){
    const id=identity(),store=db();
    if(!id||!store)return;
    // Preferências não contam como atividade de leitura. Isso mantém
    // "última atividade" confiável para capítulos, em vez de renovar só
    // porque uma aba antiga ficou aberta.
    writeState({...prefs()}).catch(e=>console.warn("Não foi possível sincronizar as preferências:",e));
  }

  function preferenceChanged(kind){
    const FV=fieldValue();
    if(!FV)return syncPreferences();
    const fields={...prefs()};
    if(kind==="theme")fields.themeChanges=FV.increment(1);
    if(kind==="font")fields.fontChanges=FV.increment(1);
    if(kind==="fontScale")fields.fontScaleChanges=FV.increment(1);
    writeState(fields).catch(e=>console.warn("Não foi possível registrar a personalização:",e));
  }

  async function syncBook(book,completedNumbers=[],partial=[],lastN=0){
    const id=identity(),store=db(),FV=fieldValue();
    if(!id||!store||!FV||!book||!Array.isArray(book.chapters))return;
    const completedSet=new Set(completedNumbers.map(Number));
    const partialMap=new Map((partial||[]).map(x=>[Number(x.n),Math.max(0,Math.min(99,Math.round(Number(x.pct)||0)))]));
    completedSet.forEach(n=>partialMap.delete(n));
    if(!completedSet.size&&!partialMap.size)return;

    // Só reenvia quando algo mudou desde a última importação neste aparelho.
    const signature=[...completedSet].sort((a,b)=>a-b).join(",")+"|"
      +[...partialMap.entries()].sort((a,b)=>a[0]-b[0]).map(e=>e[0]+":"+e[1]).join(",")+"|"+lastN;
    const flagKey="jesed:importV2:"+id.readerId+":"+String(book.id||"");
    try{if(localStorage.getItem(flagKey)===signature)return;}catch(_){}

    const summaryRef=store.collection("readerAnalytics").doc(id.readerId);
    const batch=store.batch();
    const stamp=now();
    const keys=[];
    book.chapters.forEach(ch=>{
      const n=Number(ch.n);
      const done=completedSet.has(n);
      if(!done&&!partialMap.has(n))return;
      const ctx={
        bookId:String(book.id||""),
        bookTitle:String(book.title||book.id||""),
        chapter:n||0,
        chapterTitle:String(ch.title||"")
      };
      if(done)keys.push(chapterKey(ctx));
      batch.set(
        summaryRef.collection("chapters").doc(chapterDocId(ctx)),
        {...chapterBase(id,ctx,stamp),...(done?{completed:true,currentPct:100}:{currentPct:partialMap.get(n)})},
        {merge:true}
      );
    });
    const summary={...summaryBase(id,stamp),...prefs()};
    if(keys.length)summary.completedChapters=FV.arrayUnion(...keys);
    const last=book.chapters.find(ch=>Number(ch.n)===Number(lastN));
    if(last){
      const lastPct=completedSet.has(Number(last.n))?100:(partialMap.get(Number(last.n))||0);
      summary.currentBookId=String(book.id||"");
      summary.currentBookTitle=String(book.title||book.id||"");
      summary.currentChapter=Number(last.n)||0;
      summary.currentChapterTitle=String(last.title||"");
      summary.currentChapterPct=lastPct;
    }
    batch.set(summaryRef,summary,{merge:true});
    try{
      await commitWithRetry(batch);
      try{localStorage.setItem(flagKey,signature);}catch(_){}
      window.BetaDiag?.ok?.("importar");
    }catch(e){window.BetaDiag?.error?.("analytics:importar",e);console.warn("Não foi possível importar o progresso local:",e);}
  }

  function tick(){
    const stamp=now();
    const elapsed=Math.max(0,Math.min(5,(stamp-lastTickAt)/1000));
    lastTickAt=stamp;
    if(
      context &&
      currentView==="reader" &&
      document.visibilityState==="visible" &&
      stamp-lastInteractionAt<180000
    ){
      activePendingSec+=elapsed;
    }
    if(stamp-lastFlushAt>=30000){flushUsage();retryFailedStates();}
  }

  setInterval(tick,5000);
  setInterval(()=>syncPreferences(),300000);
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="hidden")flushUsage();
    else{
      lastTickAt=now();
      noteInteraction();
      syncPreferences();
    }
  });
  window.addEventListener("focus",()=>syncPreferences());
  window.addEventListener("pagehide",flushUsage);
  // Reparo manual (disparado ao avançar de capítulo, por exemplo): força uma
  // escrita agora, em vez de esperar o próximo ciclo normal.
  document.addEventListener("beta:force-resync",()=>{syncPreferences();flushUsage();retryFailedStates();});
  document.addEventListener("pointerdown",noteInteraction,{passive:true});
  document.addEventListener("keydown",noteInteraction);

  window.BetaAnalytics={
    noteInteraction,
    setView,
    openChapter,
    closeChapter,
    progress,
    completed,
    narration,
    music,
    syncPreferences,
    preferenceChanged,
    syncBook,
    flush:flushUsage
  };
})();

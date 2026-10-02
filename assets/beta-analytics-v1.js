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
  let progressTimer=null;
  let sending=false;
  const usageQueue=[];

  const now=()=>Date.now();
  const chapterKey=ctx=>ctx ? String(ctx.bookId)+":"+String(ctx.chapter) : "";
  const chapterDocId=ctx=>String(ctx.bookId).replace(/[^a-zA-Z0-9_-]/g,"_")+"__"+String(ctx.chapter);

  function identity(){
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
    const scaleRaw=Number(localStorage.getItem(FONT_KEY)||"1");
    return {
      theme:String(localStorage.getItem(THEME_KEY)||document.documentElement.dataset.theme||"ambar"),
      font:String(localStorage.getItem(FONT_FAMILY_KEY)||document.documentElement.dataset.readerFont||"lora"),
      fontScale:Number.isFinite(scaleRaw)?Math.max(.8,Math.min(1.6,Math.round(scaleRaw*10)/10)):1,
      hideArt:localStorage.getItem(HIDE_ART_KEY)==="1",
      autoAmbient:localStorage.getItem(AUTO_AMBIENT_KEY)==="1"
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

  async function writeState(summaryFields={},chapterFields=null,ctx=context){
    const id=identity(),store=db();
    if(!id||!store)return false;
    const stamp=now();
    const batch=store.batch();
    const summaryRef=store.collection("readerAnalytics").doc(id.readerId);
    batch.set(summaryRef,{...summaryBase(id,stamp),...summaryFields},{merge:true});
    if(ctx&&chapterFields){
      const chapterRef=summaryRef.collection("chapters").doc(chapterDocId(ctx));
      batch.set(chapterRef,{...chapterBase(id,ctx,stamp),...chapterFields},{merge:true});
    }
    await batch.commit();
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
        await batch.commit();
        usageQueue.shift();
      }
    }catch(e){
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
    if(progressTimer){clearTimeout(progressTimer);progressTimer=null;}
    if(narrationPlaying)narrationStartedAt=now();
    if(musicPlaying)musicStartedAt=now();
  }

  function openChapter(book,ch){
    if(!book||!ch)return;
    context={
      bookId:String(book.id||""),
      bookTitle:String(book.title||book.id||""),
      chapter:Number(ch.n)||0,
      chapterTitle:String(ch.title||"")
    };
    lastProgressSent=-1;
    noteInteraction();
    const stamp=now();
    const p=prefs();
    writeState({
      lastActiveAt:stamp,
      currentBookId:context.bookId,
      currentBookTitle:context.bookTitle,
      currentChapter:context.chapter,
      currentChapterTitle:context.chapterTitle,
      currentChapterPct:0,
      ...p
    },{
      lastOpenedAt:stamp,
      currentPct:0
    }).catch(e=>console.warn("Não foi possível registrar a abertura do capítulo:",e));
    if(narrationPlaying)narrationStartedAt=stamp;
    if(musicPlaying)musicStartedAt=stamp;
  }

  function progress(value){
    if(!context)return;
    noteInteraction();
    const pct=Math.max(0,Math.min(100,Math.round(Number(value)||0)));
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
    writeState({...prefs(),lastActiveAt:now()}).catch(e=>console.warn("Não foi possível sincronizar as preferências:",e));
  }

  function preferenceChanged(kind){
    const FV=fieldValue();
    if(!FV)return syncPreferences();
    const fields={...prefs(),lastActiveAt:now()};
    if(kind==="theme")fields.themeChanges=FV.increment(1);
    if(kind==="font")fields.fontChanges=FV.increment(1);
    if(kind==="fontScale")fields.fontScaleChanges=FV.increment(1);
    writeState(fields).catch(e=>console.warn("Não foi possível registrar a personalização:",e));
  }

  async function syncBook(book,completedNumbers=[]){
    const id=identity(),store=db(),FV=fieldValue();
    if(!id||!store||!FV||!book||!Array.isArray(book.chapters))return;
    const completedSet=new Set(completedNumbers.map(Number));
    if(!completedSet.size)return;

    const summaryRef=store.collection("readerAnalytics").doc(id.readerId);
    const batch=store.batch();
    const stamp=now();
    const keys=[];
    book.chapters.forEach(ch=>{
      if(!completedSet.has(Number(ch.n)))return;
      const ctx={
        bookId:String(book.id||""),
        bookTitle:String(book.title||book.id||""),
        chapter:Number(ch.n)||0,
        chapterTitle:String(ch.title||"")
      };
      keys.push(chapterKey(ctx));
      batch.set(
        summaryRef.collection("chapters").doc(chapterDocId(ctx)),
        {...chapterBase(id,ctx,stamp),completed:true,currentPct:100},
        {merge:true}
      );
    });
    if(!keys.length)return;
    batch.set(summaryRef,{
      ...summaryBase(id,stamp),
      lastActiveAt:stamp,
      completedChapters:FV.arrayUnion(...keys),
      ...prefs()
    },{merge:true});
    try{await batch.commit();}
    catch(e){console.warn("Não foi possível importar o progresso local:",e);}
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
    if(stamp-lastFlushAt>=30000)flushUsage();
  }

  setInterval(tick,5000);
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="hidden")flushUsage();
    else{lastTickAt=now();noteInteraction();}
  });
  window.addEventListener("pagehide",flushUsage);
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

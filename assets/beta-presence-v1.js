// ================= Presença ao vivo do leitor beta =================
// Heartbeat leve para o painel do autor saber se o leitor está realmente
// ativo no capítulo, além do progresso histórico salvo em analytics.
(() => {
  "use strict";

  const USER_KEY="jesed:readerId";
  const NAME_KEY="jesed:username";
  const PROFILE_HASH_KEY="jesed:readerCodeHash";
  const HEARTBEAT_MS=15000;
  const ACTIVE_WINDOW_MS=180000;

  let currentView="library";
  let context=null;
  let currentPct=0;
  let narrationOn=false;
  let musicOn=false;
  let lastInteractionAt=Date.now();
  let writeTimer=null;
  let writing=false;
  let pending=false;

  const now=()=>Date.now();

  function identity(){
    const readerId=String(localStorage.getItem(USER_KEY)||"").trim();
    const profileHash=String(localStorage.getItem(PROFILE_HASH_KEY)||"").trim();
    const name=String(localStorage.getItem(NAME_KEY)||"").trim();
    if(!readerId||!profileHash||!name)return null;
    return {readerId,profileHash,name};
  }
  function db(){return window.Comments?.getDb?.()||null;}

  function visible(){return document.visibilityState==="visible";}

  function payload(){
    const id=identity();
    if(!id)return null;
    const stamp=now();
    const readerOpen=currentView==="reader"&&!!context;
    const recentlyActive=stamp-lastInteractionAt<=ACTIVE_WINDOW_MS;
    const active=readerOpen&&(narrationOn||(visible()&&recentlyActive));
    return {
      readerId:id.readerId,
      profileHash:id.profileHash,
      name:id.name,
      heartbeatAt:stamp,
      lastInteractionAt,
      view:currentView,
      visible:visible(),
      active,
      mode:narrationOn?"narration":active?"reading":readerOpen&&visible()?"idle":"app",
      bookId:context?.bookId||"",
      bookTitle:context?.bookTitle||"",
      chapter:Number(context?.chapter)||0,
      chapterTitle:context?.chapterTitle||"",
      currentPct:Math.max(0,Math.min(100,Math.round(Number(currentPct)||0))),
      narrationOn:!!narrationOn,
      musicOn:!!musicOn
    };
  }

  async function writePresence(){
    if(writing){pending=true;return;}
    const store=db(),data=payload();
    if(!store||!data)return;
    writing=true;
    try{
      await store.collection("readerPresence").doc(data.readerId).set(data,{merge:true});
    }catch(e){
      console.warn("Não foi possível sincronizar presença do leitor:",e);
    }finally{
      writing=false;
      if(pending){pending=false;writePresence();}
    }
  }

  function scheduleWrite(delay=350){
    if(writeTimer)clearTimeout(writeTimer);
    writeTimer=setTimeout(()=>{writeTimer=null;writePresence();},delay);
  }

  function noteInteraction(){
    lastInteractionAt=now();
    if(currentView==="reader")scheduleWrite(500);
  }

  function setView(view){
    currentView=String(view||"library");
    if(currentView!=="reader"){
      context=null;
      currentPct=0;
      narrationOn=false;
      musicOn=false;
    }
    noteInteraction();
    scheduleWrite(100);
  }

  function openChapter(book,ch,initialPct=0){
    if(!book||!ch)return;
    context={
      bookId:String(book.id||""),
      bookTitle:String(book.title||book.id||""),
      chapter:Number(ch.n)||0,
      chapterTitle:String(ch.title||"")
    };
    currentPct=Math.max(0,Math.min(100,Number(initialPct)||0));
    noteInteraction();
    scheduleWrite(100);
  }

  function closeChapter(){
    context=null;
    currentPct=0;
    narrationOn=false;
    musicOn=false;
    scheduleWrite(100);
  }

  function progress(value){
    if(!context)return;
    currentPct=Math.max(0,Math.min(100,Number(value)||0));
    noteInteraction();
    scheduleWrite(650);
  }

  function narration(playing){
    narrationOn=!!playing;
    if(narrationOn)noteInteraction();
    scheduleWrite(100);
  }

  function music(playing){
    musicOn=!!playing;
    if(musicOn)noteInteraction();
    scheduleWrite(100);
  }

  setInterval(()=>{
    if(visible()||narrationOn||musicOn)writePresence();
  },HEARTBEAT_MS);

  document.addEventListener("visibilitychange",()=>{
    if(visible())noteInteraction();
    scheduleWrite(50);
  });
  window.addEventListener("focus",()=>{noteInteraction();scheduleWrite(50);});
  window.addEventListener("pagehide",()=>{scheduleWrite(0);});
  document.addEventListener("pointerdown",noteInteraction,{passive:true});
  document.addEventListener("keydown",noteInteraction);

  window.BetaPresence={
    noteInteraction,
    setView,
    openChapter,
    closeChapter,
    progress,
    narration,
    music,
    ping:writePresence
  };
})();

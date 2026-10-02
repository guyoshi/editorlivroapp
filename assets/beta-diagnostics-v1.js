// ================= Diagnóstico de sincronização do leitor beta =================
// Grava um "sinal de vida" independente das métricas: versão do app, último
// contato e o último erro de sincronização. As Rules desta coleção NÃO
// dependem do perfil estar correto — assim, mesmo quando métricas/presença
// são recusadas, o painel do autor consegue ver o motivo.
(() => {
  "use strict";

  const USER_KEY="jesed:readerId";
  const NAME_KEY="jesed:username";
  const PROFILE_HASH_KEY="jesed:readerCodeHash";
  const SEEN_EVERY_MS=60000;

  const appVersion=(()=>{
    try{
      const s=document.querySelector('script[src*="beta-diagnostics"]');
      return (new URL(s.src,location.href).searchParams.get("v")||"").slice(0,40);
    }catch(e){return "";}
  })();

  const state={
    lastOkAt:0,lastOkWhere:"",
    lastErrorAt:0,lastError:"",lastErrorWhere:"",
    errorCount:0
  };
  let lastWriteAt=0,timer=null,writing=false,dirty=false;

  const now=()=>Date.now();
  const clip=(v,n)=>String(v||"").slice(0,n);
  function db(){return window.Comments?.getDb?.()||null;}
  function ident(){
    return {
      readerId:clip(localStorage.getItem(USER_KEY),80).trim(),
      profileHash:clip(localStorage.getItem(PROFILE_HASH_KEY),64).trim(),
      name:clip(localStorage.getItem(NAME_KEY),40).trim()
    };
  }
  function standalone(){
    try{return window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;}
    catch(e){return false;}
  }

  async function write(){
    const store=db(),id=ident();
    if(!store||id.readerId.length<16)return;
    if(writing){dirty=true;return;}
    writing=true;
    lastWriteAt=now();
    try{
      await store.collection("readerDiagnostics").doc(id.readerId).set({
        readerId:id.readerId,
        profileHash:id.profileHash,
        name:id.name,
        appVersion,
        seenAt:now(),
        visible:document.visibilityState==="visible",
        standalone:standalone(),
        online:navigator.onLine!==false,
        ua:clip(navigator.userAgent,200),
        lastOkAt:state.lastOkAt,
        lastOkWhere:clip(state.lastOkWhere,40),
        lastErrorAt:state.lastErrorAt,
        lastError:clip(state.lastError,300),
        lastErrorWhere:clip(state.lastErrorWhere,40),
        errorCount:state.errorCount
      },{merge:true});
    }catch(e){
      console.warn("Diagnóstico do leitor indisponível:",e);
    }finally{
      writing=false;
      if(dirty){dirty=false;schedule(3000);}
    }
  }
  function schedule(delay){
    if(timer)return;
    timer=setTimeout(()=>{timer=null;write();},delay);
  }

  function ok(where){
    state.lastOkAt=now();
    state.lastOkWhere=String(where||"");
    // Sucesso não precisa ir na hora; vai no próximo sinal de vida.
  }
  function error(where,err){
    state.lastErrorAt=now();
    state.lastErrorWhere=String(where||"");
    state.lastError=((err&&err.code)?err.code+": ":"")+((err&&err.message)||String(err||"erro"));
    state.errorCount++;
    schedule(1500);
  }

  setInterval(()=>{
    if(document.visibilityState==="visible"&&now()-lastWriteAt>=SEEN_EVERY_MS)write();
  },15000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")schedule(1500);});
  document.addEventListener("beta:profile-ready",()=>schedule(1500));
  document.addEventListener("beta:profile-login",()=>schedule(1500));
  window.addEventListener("load",()=>schedule(4000));

  window.BetaDiag={ok,error,ping:write,appVersion};
})();

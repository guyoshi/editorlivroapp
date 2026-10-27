/* Narração gratuita, priorizando vozes pt-BR presentes no aparelho. */
(()=>{"use strict";
const synth=window.speechSynthesis,supported=!!(synth&&window.SpeechSynthesisUtterance);
const VOICE_KEY="lityra:tts:voice",RATE_KEY="lityra:tts:rate";
let ch=null,playing=false,token=0,voices=[],voiceId="",rate=Math.max(.75,Math.min(1.5,Number(localStorage.getItem(RATE_KEY))||1));
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return String(h>>>0);}
function splitText(raw){
 const text=String(raw||"").replace(/^---\s*\n[\s\S]*?\n---\s*\n/,"")
 .replace(/\x60{3}[\s\S]*?\x60{3}/g,"").replace(/!\[([^\]]*)\]\([^)]+\)/g,"$1")
 .replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/^\s{0,3}#{1,6}\s+/gm,"")
 .replace(/^\s*>\s?/gm,"").replace(/^\s*[-*+]\s+/gm,"").replace(/[*_\x60]/g,"")
 .replace(/<[^>]*>/g,"").replace(/\r\n/g,"\n").trim();
 const out=[],paragraphStarts=[];
 for(const para of text.split(/\n\s*\n/)){
   if(para.trim())paragraphStarts.push(out.length);
   let rem=para.replace(/\s*\n\s*/g," ").replace(/\s+/g," ").trim();
   while(rem){
     if(rem.length<=240){out.push(rem);break;}
     const s=rem.slice(0,240),mark=Math.max(s.lastIndexOf(". "),s.lastIndexOf("! "),s.lastIndexOf("? "),s.lastIndexOf("; "));
     const cut=mark>=85?mark+1:Math.max(95,s.lastIndexOf(" "));
     out.push(rem.slice(0,cut).trim());rem=rem.slice(cut).trim();
   }
 }
 return {parts:out.filter(Boolean),paragraphStarts};
}
function keyFor(book,chapter){
 const owner=window.Comments?.isAdmin?.()?"admin":localStorage.getItem("jesed:readerId")||"guest";
 return "lityra:tts:position:"+owner+":"+book.id+":"+chapter.n;
}
function save(){if(ch)try{localStorage.setItem(ch.key,JSON.stringify({hash:ch.hash,index:ch.index,offset:ch.offset}));}catch(_){}}
function fraction(){if(!ch||!ch.parts.length)return 0;const part=ch.parts[ch.index];return Math.min(1,(ch.index+(part?ch.offset/part.length:0))/ch.parts.length);}
function status(type="progress",error=""){return {type,error,supported,ready:!!ch,playing,index:ch?.index||0,count:ch?.parts.length||0,fraction:fraction()};}
function emit(type,error){document.dispatchEvent(new CustomEvent("lityra:tts-state",{detail:status(type,error)}));}
function cancel(){token++;if(supported)try{synth.cancel();}catch(_){}}
function stop(){if(!ch)return;playing=false;cancel();save();ch=null;emit("stop");}
function prepare(book,chapter,raw){
 stop();if(!supported||!raw)return false;
 const split=splitText(raw),parts=split.parts;if(!parts.length)return false;
 const key=keyFor(book,chapter),h=hash(String(raw));let old=null;
 try{old=JSON.parse(localStorage.getItem(key)||"null");}catch(_){}
 const valid=old?.hash===h&&Number.isInteger(old.index)&&old.index>=0&&old.index<parts.length;
 const index=valid?old.index:0,offset=valid?Math.min(parts[index].length-1,Math.max(0,Number(old.offset)||0)):0;
 ch={key,hash:h,parts,paragraphStarts:split.paragraphStarts,index,offset};playing=false;emit("ready");return true;
}
function speakNext(){
 if(!ch||!playing)return;
 if(ch.index>=ch.parts.length){playing=false;ch.offset=0;save();emit("ended");return;}
 const part=ch.parts[ch.index],start=ch.offset,u=new SpeechSynthesisUtterance(part.slice(start));
 const voice=voices.find(v=>v.voiceURI===voiceId)||voices[0]||null;if(voice)u.voice=voice;
 u.lang=voice?.lang||"pt-BR";u.rate=rate;const id=token;
 u.onboundary=e=>{if(id!==token||!ch||!playing||!Number.isFinite(e.charIndex))return;
   ch.offset=Math.min(part.length-1,Math.max(start,start+e.charIndex));save();emit("progress");};
 u.onend=()=>{if(id!==token||!ch||!playing)return;ch.index++;ch.offset=0;save();emit("progress");speakNext();};
 u.onerror=()=>{if(id!==token||!ch||!playing)return;playing=false;save();emit("error","A voz foi interrompida. Toque novamente para continuar.");};
 try{if(synth.paused)synth.resume();synth.speak(u);}catch(_){playing=false;emit("error","Não foi possível iniciar a voz neste navegador.");}
}
function play(){if(!supported||!ch)return false;if(playing)return true;if(ch.index>=ch.parts.length){ch.index=0;ch.offset=0;}playing=true;cancel();emit("play");speakNext();return true;}
function pause(){if(!ch||!playing)return;playing=false;cancel();save();emit("pause");}
function seek(p){if(!ch)return;const restart=playing;playing=false;cancel();ch.index=Math.min(ch.parts.length-1,Math.floor(Math.max(0,Math.min(1,Number(p)||0))*ch.parts.length));ch.offset=0;save();emit("progress");if(restart)play();}
function jumpParagraph(direction){
 if(!ch)return;
 const starts=ch.paragraphStarts||[0];
 const current=starts.reduce((acc,v,i)=>v<=ch.index?i:acc,0);
 const target=direction<0?starts[Math.max(0,current-(ch.index>starts[current]?0:1))]:starts[Math.min(starts.length-1,current+1)];
 const restart=playing;playing=false;cancel();ch.index=target;ch.offset=0;save();emit("progress");if(restart)play();
}
function back(){jumpParagraph(-1);}
function next(){jumpParagraph(1);}
function reloadVoices(){
 if(!supported)return;voices=(synth.getVoices()||[]).filter(v=>/^pt(?:-|$)/i.test(v.lang)).sort((a,b)=>(a.lang.toLowerCase()==="pt-br"?0:1)-(b.lang.toLowerCase()==="pt-br"?0:1));
 const select=document.getElementById("ttsVoice");if(!select)return;select.replaceChildren();
 if(!voices.length){select.add(new Option("Voz do dispositivo (PT-BR)",""));select.disabled=true;voiceId="";return;}
 for(const v of voices)select.add(new Option(v.name+" ("+v.lang+")",v.voiceURI));
 select.disabled=false;const chosen=localStorage.getItem(VOICE_KEY)||"";voiceId=voices.some(v=>v.voiceURI===chosen)?chosen:voices[0].voiceURI;select.value=voiceId;
}
function setup(){
 const voice=document.getElementById("ttsVoice"),speed=document.getElementById("ttsRate"),label=document.getElementById("ttsRateValue");
 if(speed){speed.value=String(rate);if(label)label.textContent=rate+"×";
 speed.addEventListener("input",()=>{rate=Math.max(.75,Math.min(1.5,Number(speed.value)||1));localStorage.setItem(RATE_KEY,String(rate));if(label)label.textContent=rate.toFixed(2).replace(/0$/,"").replace(/\.$/,"")+"×";if(playing){pause();play();}});}
 if(voice)voice.addEventListener("change",()=>{voiceId=voice.value;localStorage.setItem(VOICE_KEY,voiceId);if(playing){pause();play();}});
 if(supported){reloadVoices();synth.addEventListener?.("voiceschanged",reloadVoices);}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup,{once:true});else setup();
window.LityraTTS={supported,prepare,play,pause,stop,seek,back,next,status:()=>status()};
})();

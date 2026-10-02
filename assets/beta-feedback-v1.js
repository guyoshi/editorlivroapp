// Structured beta-reader feedback: cover, chapter and end-of-book survey
(() => {
  "use strict";

  const COLLECTION="betaFeedback";
  const PROFILE_HASH_KEY="jesed:readerCodeHash";
  const READER_ID_KEY="jesed:readerId";
  const LOCAL_PREFIX="jesed:betaFeedback:";
  let config={schemaVersion:1,books:{},chapterTags:[]};
  let currentBook=null,currentChapter=null,currentIndex=-1,currentIsLast=false;

  const $=(s,r=document)=>r.querySelector(s);
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const db=()=>window.Comments?.getDb?.();
  const readerId=()=>String(localStorage.getItem(READER_ID_KEY)||"").trim();
  const profileHash=()=>String(localStorage.getItem(PROFILE_HASH_KEY)||"").trim();
  const readerName=()=>String(window.Comments?.getUserName?.()||"").trim();
  const canSubmit=()=>!!(db()&&readerId()&&profileHash()&&readerName()&&!window.Comments?.isAdmin?.());
  const docId=(kind,bookId,chapter)=>[kind,readerId(),bookId,chapter||""].filter(Boolean).join("__");
  const localKey=id=>LOCAL_PREFIX+id;
  const now=()=>Date.now();

  function readLocal(id){
    try{return JSON.parse(localStorage.getItem(localKey(id))||"null");}
    catch(e){return null;}
  }
  function writeLocal(id,data){
    try{localStorage.setItem(localKey(id),JSON.stringify(data));}catch(e){}
  }
  function base(kind,book){
    return {
      schemaVersion:1,
      type:kind,
      readerId:readerId(),
      profileHash:profileHash(),
      name:readerName(),
      bookId:String(book?.id||""),
      bookTitle:String(book?.title||""),
      updatedAt:now()
    };
  }
  async function saveFeedback(id,data){
    if(!canSubmit())throw new Error("Seu perfil ainda não está pronto para enviar feedback.");
    await db().collection(COLLECTION).doc(id).set(data,{merge:true});
    writeLocal(id,data);
    document.dispatchEvent(new CustomEvent("beta:feedback-saved",{detail:data}));
    return data;
  }

  function starsMarkup(id,label){
    return '<div class="beta-rating-field"><span>'+esc(label)+'</span><div class="beta-stars" id="'+id+'" role="radiogroup" aria-label="'+esc(label)+'">'
      +[1,2,3,4,5].map(n=>'<button type="button" data-star="'+n+'" aria-label="'+n+' de 5">☆</button>').join("")
      +'<strong class="beta-star-value">—</strong></div></div>';
  }
  function setStars(root,value){
    const v=Math.max(0,Math.min(5,Number(value)||0));
    root.dataset.value=String(v||"");
    root.querySelectorAll("[data-star]").forEach(btn=>{
      const active=Number(btn.dataset.star)<=v;
      btn.textContent=active?"★":"☆";
      btn.classList.toggle("active",active);
      btn.setAttribute("aria-checked",String(Number(btn.dataset.star)===v));
    });
    const out=root.querySelector(".beta-star-value");
    if(out)out.textContent=v?v+"/5":"—";
  }
  function wireStars(root){
    root.querySelectorAll("[data-star]").forEach(btn=>btn.addEventListener("click",()=>setStars(root,Number(btn.dataset.star))));
  }
  function starValue(id){return Number($("#"+id)?.dataset.value)||0;}

  function ensureInlineUi(){
    if(!$("#coverFeedbackCta")){
      const host=$(".book-cover-hero");
      if(host){
        const box=document.createElement("div");
        box.id="coverFeedbackCta";
        box.className="beta-inline-feedback";
        box.innerHTML='<div><strong>O que achou da capa?</strong><span id="coverFeedbackStatus">Uma impressão rápida ajuda muito.</span></div><button id="coverFeedbackOpen" type="button" class="btn-ghost">Avaliar capa</button>';
        host.insertAdjacentElement("afterend",box);
        $("#coverFeedbackOpen").addEventListener("click",openCoverSheet);
      }
    }
    if(!$("#chapterFeedbackOpen")){
      const area=$(".chapter-complete-area");
      if(area){
        const wrap=document.createElement("div");
        wrap.className="beta-reader-feedback-actions";
        wrap.innerHTML='<button id="chapterFeedbackOpen" type="button" class="beta-feedback-link">💬 Comentar este capítulo</button>'
          +'<button id="bookFeedbackOpen" type="button" class="beta-feedback-link beta-book-feedback-link" hidden>★ Dar opinião sobre o livro</button>';
        area.insertAdjacentElement("afterend",wrap);
        $("#chapterFeedbackOpen").addEventListener("click",openChapterSheet);
        $("#bookFeedbackOpen").addEventListener("click",openBookSheet);
      }
    }
  }

  function ensureCoverSheet(){
    if($("#betaCoverSheet"))return;
    const el=document.createElement("div");
    el.id="betaCoverSheet";el.className="sheet";el.hidden=true;
    el.innerHTML='<div class="sheet-card beta-feedback-sheet-card">'
      +'<div class="beta-feedback-kicker">Impressão inicial</div><h2>Avaliar capa</h2>'
      +'<p class="sheet-hint">Duas respostas rápidas. Não há resposta certa.</p>'
      +starsMarkup("coverVisualStars","O que você achou da capa?")
      +starsMarkup("coverOpenStars","Se não conhecesse a história, essa capa faria você abrir o livro?")
      +'<label class="field"><span>Algo que chamou sua atenção? <small>(opcional)</small></span><textarea id="coverFeedbackNote" rows="3" maxlength="500"></textarea></label>'
      +'<p id="coverFeedbackMsg" class="reader-code-status" aria-live="polite"></p>'
      +'<div class="sheet-actions"><button id="coverFeedbackSave" class="btn-primary" type="button">Salvar avaliação</button><button id="coverFeedbackCancel" class="btn-ghost" type="button">Agora não</button></div>'
      +'</div>';
    document.body.appendChild(el);
    wireStars($("#coverVisualStars",el));wireStars($("#coverOpenStars",el));
    const close=()=>{el.hidden=true;};
    $("#coverFeedbackCancel",el).onclick=close;
    el.onclick=e=>{if(e.target===el)close();};
    $("#coverFeedbackSave",el).onclick=async()=>{
      if(!currentBook)return;
      const visualRating=starValue("coverVisualStars"),openInterestRating=starValue("coverOpenStars");
      const msg=$("#coverFeedbackMsg",el);
      if(!visualRating||!openInterestRating){msg.textContent="Escolha uma nota nas duas perguntas.";msg.classList.add("error");return;}
      const btn=$("#coverFeedbackSave",el);btn.disabled=true;msg.textContent="Salvando…";msg.classList.remove("error");
      try{
        const id=docId("cover",currentBook.id);
        await saveFeedback(id,{
          ...base("cover",currentBook),
          visualRating,
          openInterestRating,
          note:$("#coverFeedbackNote",el).value.trim(),
          createdAt:readLocal(id)?.createdAt||now()
        });
        msg.textContent="Avaliação salva.";
        renderCoverCta();
        setTimeout(close,350);
      }catch(e){msg.textContent=e.message||"Não foi possível salvar.";msg.classList.add("error");}
      finally{btn.disabled=false;}
    };
  }

  function openCoverSheet(){
    if(!currentBook||!canSubmit())return;
    ensureCoverSheet();
    const el=$("#betaCoverSheet");
    const saved=readLocal(docId("cover",currentBook.id))||{};
    setStars($("#coverVisualStars",el),saved.visualRating||0);
    setStars($("#coverOpenStars",el),saved.openInterestRating||0);
    $("#coverFeedbackNote",el).value=saved.note||"";
    $("#coverFeedbackMsg",el).textContent="";
    el.hidden=false;
  }
  function renderCoverCta(){
    ensureInlineUi();
    const box=$("#coverFeedbackCta");
    if(!box)return;
    box.hidden=!currentBook||!canSubmit();
    if(box.hidden)return;
    const saved=readLocal(docId("cover",currentBook.id));
    $("#coverFeedbackStatus").textContent=saved?.visualRating
      ?"Sua avaliação: "+saved.visualRating+"/5 · Você pode editar quando quiser."
      :"Uma impressão rápida ajuda muito.";
    $("#coverFeedbackOpen").textContent=saved?"Editar avaliação":"Avaliar capa";
  }

  function ensureChapterSheet(){
    if($("#betaChapterSheet"))return;
    const el=document.createElement("div");el.id="betaChapterSheet";el.className="sheet";el.hidden=true;
    el.innerHTML='<div class="sheet-card beta-feedback-sheet-card">'
      +'<div class="beta-feedback-kicker">Feedback opcional</div><h2 id="chapterFeedbackTitle">Sobre este capítulo</h2>'
      +'<p class="sheet-hint">Marque o que fizer sentido. Você pode escolher mais de uma opção.</p>'
      +'<div id="chapterFeedbackTags" class="beta-feedback-chips"></div>'
      +'<label class="field"><span>Quer comentar algo?</span><textarea id="chapterFeedbackText" rows="5" maxlength="1500" placeholder="Algo funcionou muito bem? Ficou confuso? Teve uma reação específica?"></textarea></label>'
      +'<p id="chapterFeedbackMsg" class="reader-code-status" aria-live="polite"></p>'
      +'<div class="sheet-actions"><button id="chapterFeedbackSave" class="btn-primary" type="button">Enviar feedback</button><button id="chapterFeedbackCancel" class="btn-ghost" type="button">Cancelar</button></div>'
      +'</div>';
    document.body.appendChild(el);
    const close=()=>{el.hidden=true;};
    $("#chapterFeedbackCancel",el).onclick=close;
    el.onclick=e=>{if(e.target===el)close();};
    $("#chapterFeedbackSave",el).onclick=async()=>{
      if(!currentBook||!currentChapter)return;
      const tags=[...el.querySelectorAll("[data-feedback-tag].selected")].map(x=>x.dataset.feedbackTag);
      const text=$("#chapterFeedbackText",el).value.trim();
      const msg=$("#chapterFeedbackMsg",el);
      if(!tags.length&&!text){msg.textContent="Marque uma opção ou escreva um comentário.";msg.classList.add("error");return;}
      const btn=$("#chapterFeedbackSave",el);btn.disabled=true;msg.textContent="Enviando…";msg.classList.remove("error");
      try{
        const id=docId("chapter",currentBook.id,currentChapter.n);
        await saveFeedback(id,{
          ...base("chapter",currentBook),
          chapter:Number(currentChapter.n),
          chapterTitle:String(currentChapter.title||""),
          tags,
          text,
          createdAt:readLocal(id)?.createdAt||now()
        });
        msg.textContent="Obrigado. Feedback salvo.";
        renderChapterCtas();
        setTimeout(close,350);
      }catch(e){msg.textContent=e.message||"Não foi possível enviar.";msg.classList.add("error");}
      finally{btn.disabled=false;}
    };
  }

  function openChapterSheet(){
    if(!currentBook||!currentChapter||!canSubmit())return;
    ensureChapterSheet();
    const el=$("#betaChapterSheet");
    const saved=readLocal(docId("chapter",currentBook.id,currentChapter.n))||{};
    $("#chapterFeedbackTitle",el).textContent="Cap. "+currentChapter.n+" · "+currentChapter.title;
    const tags=config.chapterTags||[];
    $("#chapterFeedbackTags",el).innerHTML=tags.map(t=>'<button type="button" data-feedback-tag="'+esc(t.id)+'">'+esc(t.label)+'</button>').join("");
    el.querySelectorAll("[data-feedback-tag]").forEach(btn=>{
      btn.classList.toggle("selected",(saved.tags||[]).includes(btn.dataset.feedbackTag));
      btn.onclick=()=>btn.classList.toggle("selected");
    });
    $("#chapterFeedbackText",el).value=saved.text||"";
    $("#chapterFeedbackMsg",el).textContent="";
    el.hidden=false;
  }

  function ensureBookSheet(){
    if($("#betaBookSheet"))return;
    const el=document.createElement("div");el.id="betaBookSheet";el.className="sheet";el.hidden=true;
    el.innerHTML='<div class="sheet-card beta-feedback-sheet-card beta-book-survey-card">'
      +'<div class="beta-feedback-kicker">Você terminou</div><h2 id="bookFeedbackTitle">Sua opinião sobre o livro</h2>'
      +'<p class="sheet-hint">Responda só o que quiser. As duas primeiras perguntas já ajudam muito.</p>'
      +starsMarkup("bookOverallStars","Nota geral")
      +starsMarkup("bookContinueStars","Quanto você gostaria de continuar para o próximo livro?")
      +'<label class="field"><span>Como sentiu o ritmo geral?</span><select id="bookPace"><option value="">Prefiro não responder</option><option value="slow">Lento</option><option value="balanced">Equilibrado</option><option value="fast">Rápido</option></select></label>'
      +'<label class="field"><span>Personagem favorito</span><select id="bookFavoriteCharacter"></select></label>'
      +starsMarkup("bookCoverFitStars","Agora que terminou: a capa representa bem a história?")
      +'<label class="field"><span>Qual foi o momento mais memorável?</span><textarea id="bookMemorableMoment" rows="3" maxlength="1200"></textarea></label>'
      +'<label class="field"><span>Qual foi o momento em que você percebeu que precisava continuar lendo?</span><textarea id="bookHookMoment" rows="3" maxlength="1200"></textarea></label>'
      +'<label class="field"><span>Teve alguma parte confusa, cansativa ou que você mudaria?</span><textarea id="bookDifficultPart" rows="3" maxlength="1200"></textarea></label>'
      +'<label class="field"><span>Quer deixar mais alguma opinião?</span><textarea id="bookFinalComment" rows="4" maxlength="1800"></textarea></label>'
      +'<p id="bookFeedbackMsg" class="reader-code-status" aria-live="polite"></p>'
      +'<div class="sheet-actions"><button id="bookFeedbackSave" class="btn-primary" type="button">Enviar opinião</button><button id="bookFeedbackCancel" class="btn-ghost" type="button">Agora não</button></div>'
      +'</div>';
    document.body.appendChild(el);
    wireStars($("#bookOverallStars",el));wireStars($("#bookContinueStars",el));wireStars($("#bookCoverFitStars",el));
    const close=()=>{el.hidden=true;};
    $("#bookFeedbackCancel",el).onclick=close;
    el.onclick=e=>{if(e.target===el)close();};
    $("#bookFeedbackSave",el).onclick=async()=>{
      if(!currentBook)return;
      const overallRating=starValue("bookOverallStars"),continueRating=starValue("bookContinueStars");
      const msg=$("#bookFeedbackMsg",el);
      if(!overallRating||!continueRating){msg.textContent="Dê pelo menos a nota geral e a vontade de continuar.";msg.classList.add("error");return;}
      const btn=$("#bookFeedbackSave",el);btn.disabled=true;msg.textContent="Enviando…";msg.classList.remove("error");
      try{
        const id=docId("book",currentBook.id);
        await saveFeedback(id,{
          ...base("book",currentBook),
          overallRating,
          continueRating,
          pace:$("#bookPace",el).value,
          favoriteCharacter:$("#bookFavoriteCharacter",el).value,
          coverRepresentationRating:starValue("bookCoverFitStars"),
          memorableMoment:$("#bookMemorableMoment",el).value.trim(),
          hookMoment:$("#bookHookMoment",el).value.trim(),
          difficultPart:$("#bookDifficultPart",el).value.trim(),
          finalComment:$("#bookFinalComment",el).value.trim(),
          createdAt:readLocal(id)?.createdAt||now()
        });
        msg.textContent="Obrigado. Sua opinião foi salva.";
        renderChapterCtas();
        setTimeout(close,450);
      }catch(e){msg.textContent=e.message||"Não foi possível enviar.";msg.classList.add("error");}
      finally{btn.disabled=false;}
    };
  }

  function openBookSheet(){
    if(!currentBook||!currentIsLast||!canSubmit())return;
    ensureBookSheet();
    const el=$("#betaBookSheet");
    const saved=readLocal(docId("book",currentBook.id))||{};
    $("#bookFeedbackTitle",el).textContent="Sua opinião sobre "+currentBook.title;
    setStars($("#bookOverallStars",el),saved.overallRating||0);
    setStars($("#bookContinueStars",el),saved.continueRating||0);
    setStars($("#bookCoverFitStars",el),saved.coverRepresentationRating||0);
    $("#bookPace",el).value=saved.pace||"";
    const chars=config.books?.[currentBook.id]?.characters||[];
    $("#bookFavoriteCharacter",el).innerHTML='<option value="">Prefiro não responder</option>'
      +chars.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("")
      +'<option value="Outro / não sei">Outro / não sei</option>';
    $("#bookFavoriteCharacter",el).value=saved.favoriteCharacter||"";
    $("#bookMemorableMoment",el).value=saved.memorableMoment||"";
    $("#bookHookMoment",el).value=saved.hookMoment||"";
    $("#bookDifficultPart",el).value=saved.difficultPart||"";
    $("#bookFinalComment",el).value=saved.finalComment||"";
    $("#bookFeedbackMsg",el).textContent="";
    el.hidden=false;
  }

  function renderChapterCtas(){
    ensureInlineUi();
    const chapterBtn=$("#chapterFeedbackOpen"),bookBtn=$("#bookFeedbackOpen");
    if(chapterBtn){
      chapterBtn.hidden=!currentChapter||!canSubmit();
      if(!chapterBtn.hidden){
        const saved=readLocal(docId("chapter",currentBook.id,currentChapter.n));
        chapterBtn.textContent=saved?"✓ Feedback deste capítulo":"💬 Comentar este capítulo";
      }
    }
    if(bookBtn){
      bookBtn.hidden=!currentIsLast||!canSubmit();
      if(!bookBtn.hidden){
        const saved=readLocal(docId("book",currentBook.id));
        bookBtn.textContent=saved?"✓ Editar opinião sobre o livro":"★ Dar opinião sobre o livro";
      }
    }
  }

  async function init(){
    ensureInlineUi();
    try{
      const res=await fetch("data/beta-feedback.json",{cache:"no-cache"});
      if(res.ok)config=await res.json();
    }catch(e){console.warn("Configuração de feedback beta indisponível:",e);}
  }

  document.addEventListener("DOMContentLoaded",init);
  document.addEventListener("beta:book-open",e=>{
    currentBook=e.detail?.book||null;
    currentChapter=null;currentIndex=-1;currentIsLast=false;
    renderCoverCta();renderChapterCtas();
  });
  document.addEventListener("beta:chapter-open",e=>{
    currentBook=e.detail?.book||currentBook;
    currentChapter=e.detail?.chapter||null;
    currentIndex=Number(e.detail?.index??-1);
    currentIsLast=!!e.detail?.isLast;
    renderChapterCtas();
  });
  document.addEventListener("beta:profile-ready",()=>{renderCoverCta();renderChapterCtas();});
  document.addEventListener("beta:profile-login",()=>{renderCoverCta();renderChapterCtas();});
  document.addEventListener("beta:admin",()=>{renderCoverCta();renderChapterCtas();});

  window.BetaFeedback={
    collection:COLLECTION,
    getConfig:()=>config,
    current:()=>({book:currentBook,chapter:currentChapter,isLast:currentIsLast})
  };
})();

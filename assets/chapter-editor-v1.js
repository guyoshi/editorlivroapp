(() => {
  "use strict";

  const REPO = "guyoshi/dimensoesinfinitas";
  const BRANCH = "main";
  const TOKEN_SESSION = "jesed:githubEditToken";
  const TOKEN_LOCAL = "jesed:githubEditTokenRemembered";
  const BOOK_ROOTS = {
    "ruinas-dos-ceus": "Ciclo de Jesed/1 - Ruínas dos Céus/00 - Texto",
    "guerras-de-sangue": "Ciclo de Jesed/2 - Guerras de Sangue/00 - Texto",
    "dinastia-polar": "Ciclo de Jesed/3 - Dinastia Polar/00 - Texto"
  };

  let edit = null;
  let busy = false;
  let observer = null;

  const qs = (sel, root=document) => root.querySelector(sel);
  const qsa = (sel, root=document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const norm = (s) => String(s ?? "").replace(/\s+/g," ").trim().toLowerCase();

  function isAdmin(){
    return !!window.Comments?.isAdmin?.();
  }

  function current(){
    return window.BookReader?.getCurrent?.() || null;
  }

  function ensureUi(){
    if(!qs("#chapterEditorBar")){
      const bar=document.createElement("div");
      bar.id="chapterEditorBar";
      bar.className="chapter-editor-bar";
      bar.hidden=true;
      bar.innerHTML=
        '<div class="chapter-editor-bar-copy"><strong id="chapterEditorBarTitle">Editando parágrafo</strong><span id="chapterEditorBarMeta"></span></div>'+
        '<div class="chapter-editor-bar-actions">'+
          '<button id="chapterEditorCancel" class="chapter-editor-btn ghost" type="button">Cancelar</button>'+
          '<button id="chapterEditorPreview" class="chapter-editor-btn ghost" type="button">Ver alterações</button>'+
          '<button id="chapterEditorPublish" class="chapter-editor-btn primary" type="button">Salvar e publicar</button>'+
        '</div>';
      document.body.appendChild(bar);
      qs("#chapterEditorCancel").onclick=()=>cancelEdit();
      qs("#chapterEditorPreview").onclick=()=>showChanges();
      qs("#chapterEditorPublish").onclick=()=>saveAndPublish();
    }
    if(!qs("#chapterEditorToast")){
      const toast=document.createElement("div");
      toast.id="chapterEditorToast";
      toast.className="chapter-editor-toast";
      toast.hidden=true;
      document.body.appendChild(toast);
    }
  }

  let toastTimer=null;
  function toast(message, kind="ok"){
    ensureUi();
    const el=qs("#chapterEditorToast");
    el.className="chapter-editor-toast "+kind;
    el.textContent=message;
    el.hidden=false;
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{el.hidden=true;},3200);
  }

  function parseParagraphs(raw){
    return String(raw||"").replace(/\r\n/g,"\n").trim().split(/\n{2,}/).filter(Boolean);
  }

  function editedParagraphs(){
    if(!edit)return [];
    const raw=String(edit.textarea.value||"").replace(/\r\n/g,"\n").trim();
    if(!raw)return [];
    return raw.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
  }

  function buildRaw(parts){
    const body=parts.join("\n\n");
    return body+(edit?.rawEndsWithNewline?"\n":"");
  }

  function keyFor(text){
    return "p_"+(window.Comments?.hashText?.(text) || "");
  }

  function quoteFor(text){
    return norm(text).slice(0,220);
  }

  function resizeTextarea(){
    if(!edit?.textarea)return;
    const ta=edit.textarea;
    ta.style.height="auto";
    ta.style.height=Math.max(120,Math.min(520,ta.scrollHeight+6))+"px";
    const n=editedParagraphs().length;
    const meta=qs("#chapterEditorBarMeta");
    if(meta)meta.textContent=n===0?"Parágrafo será apagado":(n===1?"1 parágrafo":n+" novos parágrafos");
  }

  async function loadCurrentRaw(ctx){
    // Depois de uma publicação, o leitor já contém a versão nova em memória.
    // Reutilizá-la evita voltar ao arquivo estático antigo enquanto o deploy/sync
    // ainda não terminou e permite várias edições seguidas sem recarregar.
    const live=window.BookReader?.getCurrentContext?.();
    const sameChapter=live
      && String(live.bookId||"")===String(ctx.book.id||"")
      && Number(live.chapter?.n)===Number(ctx.chapter.n);
    if(sameChapter&&String(live.raw||"").trim())return String(live.raw);

    // Fallback para a primeira abertura ou caso o estado em memória não exista.
    const url=new URL(ctx.chapter.text, document.baseURI).href;
    const res=await fetch(url,{cache:"no-cache"});
    if(!res.ok)throw new Error("Não consegui carregar o texto atual do capítulo.");
    return res.text();
  }

  async function startEdit(block){
    if(busy||!isAdmin())return;
    if(edit){
      if(edit.block===block)return;
      toast("Salve ou cancele o parágrafo atual antes de editar outro.","warn");
      return;
    }
    const ctx=current();
    if(!ctx?.book?.id||!ctx?.chapter)return;
    const idx=Number(block.dataset.paraIdx);
    if(!Number.isFinite(idx))return;

    try{
      block.classList.add("chapter-edit-loading");
      const raw=await loadCurrentRaw(ctx);
      const paras=parseParagraphs(raw);
      if(idx<0||idx>=paras.length)throw new Error("O parágrafo mudou desde que o capítulo foi aberto. Reabra o capítulo.");
      const p=[...block.children].find(x=>x.tagName==="P");
      if(!p)throw new Error("Não encontrei o texto desse parágrafo.");

      const ta=document.createElement("textarea");
      ta.className="chapter-inline-editor";
      ta.value=paras[idx];
      ta.setAttribute("aria-label","Editar parágrafo");
      ta.spellcheck=true;
      ta.addEventListener("input",resizeTextarea);
      ta.addEventListener("keydown",e=>{
        if(e.key==="Escape"){e.preventDefault();cancelEdit();}
      });

      p.hidden=true;
      p.insertAdjacentElement("afterend",ta);
      block.classList.remove("chapter-edit-loading");
      block.classList.add("chapter-editing");

      edit={
        ctx,block,idx,p,textarea:ta,raw,
        rawEndsWithNewline:/\n$/.test(raw),
        paras,
        original:paras[idx],
        sourceKey:block.dataset.paragraphKey||keyFor(paras[idx])
      };

      ensureUi();
      qs("#chapterEditorBar").hidden=false;
      qs("#chapterEditorBarTitle").textContent="Editando §"+(idx+1)+" · Cap. "+ctx.chapter.n;
      resizeTextarea();
      requestAnimationFrame(()=>{resizeTextarea();ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);});
    }catch(err){
      block.classList.remove("chapter-edit-loading");
      toast(err.message||"Não foi possível iniciar a edição.","error");
    }
  }

  function cancelEdit(say=true){
    if(busy||!edit)return;
    edit.textarea?.remove();
    if(edit.p)edit.p.hidden=false;
    edit.block?.classList.remove("chapter-editing");
    edit=null;
    const bar=qs("#chapterEditorBar");
    if(bar)bar.hidden=true;
    if(say)toast("Alteração cancelada.","warn");
    setTimeout(refreshEditButtons,0);
  }

  function proposed(){
    if(!edit)return null;
    const next=editedParagraphs();
    const parts=edit.paras.slice();
    parts.splice(edit.idx,1,...next);
    return {newParas:next,allParas:parts,raw:buildRaw(parts)};
  }

  function sameText(a,b){
    return String(a||"").replace(/\r\n/g,"\n").trim()===String(b||"").replace(/\r\n/g,"\n").trim();
  }

  function modalShell(title,body,actions){
    return new Promise(resolve=>{
      const wrap=document.createElement("div");
      wrap.className="chapter-editor-modal";
      wrap.innerHTML=
        '<section class="chapter-editor-dialog" role="dialog" aria-modal="true">'+
          '<header><div><h2>'+esc(title)+'</h2></div><button class="chapter-editor-x" type="button" aria-label="Fechar">✕</button></header>'+
          '<div class="chapter-editor-dialog-body">'+body+'</div>'+
          '<footer></footer>'+
        '</section>';
      document.body.appendChild(wrap);
      const close=(value)=>{wrap.remove();resolve(value);};
      qs(".chapter-editor-x",wrap).onclick=()=>close(null);
      wrap.addEventListener("click",e=>{if(e.target===wrap)close(null);});
      const footer=qs("footer",wrap);
      actions.forEach(a=>{
        const b=document.createElement("button");
        b.type="button";
        b.className="chapter-editor-btn "+(a.primary?"primary":"ghost");
        b.textContent=a.label;
        b.onclick=async()=>{
          if(a.onClick){
            const value=await a.onClick(wrap,close);
            if(value!==undefined)close(value);
          }else close(a.value);
        };
        footer.appendChild(b);
      });
    });
  }

  async function showChanges(){
    if(!edit)return;
    const p=proposed();
    if(!p||sameText(p.raw,edit.raw)){
      toast("Nenhuma alteração neste parágrafo.","warn");
      return;
    }
    let after="";
    if(!p.newParas.length){
      after='<div class="chapter-diff-empty">Parágrafo removido</div>';
    }else{
      after=p.newParas.map((x,i)=>
        '<div class="chapter-diff-new"><span>Novo §'+(edit.idx+i+1)+'</span><p>'+esc(x).replace(/\n/g,"<br>")+'</p></div>'
      ).join("");
    }
    const structural=p.newParas.length===0?"Exclusão":(p.newParas.length>1?"Divisão em "+p.newParas.length+" parágrafos":"Edição do texto");
    const body=
      '<div class="chapter-diff-summary">'+esc(structural)+'</div>'+
      '<div class="chapter-diff-grid">'+
        '<div><h3>Antes</h3><div class="chapter-diff-old"><p>'+esc(edit.original).replace(/\n/g,"<br>")+'</p></div></div>'+
        '<div><h3>Depois</h3>'+after+'</div>'+
      '</div>';
    await modalShell("Ver alterações",body,[{label:"Fechar",value:true,primary:true}]);
  }

  function currentKeyIndexMap(){
    const map=new Map();
    qsa("#chapterText .para-block").forEach(block=>{
      const i=Number(block.dataset.paraIdx);
      const k=block.dataset.paragraphKey;
      if(k&&Number.isFinite(i))map.set(k,i);
    });
    return map;
  }

  function legacyEffectiveIndex(x,ch,keyIndex){
    const stored=Number(x?.paraIdx);
    if(!Number.isFinite(stored))return stored;
    if(x?.paragraphKey&&keyIndex.has(x.paragraphKey))return keyIndex.get(x.paragraphKey);
    if(!x?.paragraphKey){
      if(Number(ch)===6&&stored>31)return stored+3;
      if(Number(ch)===14&&stored>1)return stored+7;
    }
    return stored;
  }

  function sourceFeedback(){
    if(!edit)return {all:[],roots:[],keyIndex:new Map()};
    const book=edit.ctx.book.id,ch=edit.ctx.chapter.n,keyIndex=currentKeyIndexMap();
    const all=window.Comments?.getCachedComments?.(book)||[];
    const atSource=x=>Number(x.chapter)===Number(ch)&&legacyEffectiveIndex(x,ch,keyIndex)===edit.idx;
    const roots=all.filter(x=>atSource(x)&&!x.parentId&&x.kind!=="reply");
    return {all,roots,keyIndex,atSource};
  }

  function guessSplitTarget(item,newParas){
    const q=norm(item.quote||"");
    if(!q)return "";
    let best=-1,bestScore=0;
    const qWords=new Set(q.split(/\s+/).filter(w=>w.length>3));
    newParas.forEach((p,i)=>{
      const n=norm(p);
      let score=0;
      if(n.includes(q)||q.includes(n))score=1;
      else{
        const words=new Set(n.split(/\s+/).filter(w=>w.length>3));
        let common=0;qWords.forEach(w=>{if(words.has(w))common++;});
        score=qWords.size?common/qWords.size:0;
      }
      if(score>bestScore){bestScore=score;best=i;}
    });
    return best>=0&&bestScore>=0.45?String(best):"";
  }

  async function chooseRemap(newParas){
    const {roots}=sourceFeedback();
    if(!roots.length)return {};
    if(newParas.length===1)return Object.fromEntries(roots.map(x=>[x.id,"0"]));

    const previous=edit.idx>0;
    const next=edit.idx<edit.paras.length-1;

    let rows="";
    roots.forEach((x,row)=>{
      const isReaction=x.kind==="reaction";
      const label=isReaction
        ? '<strong class="chapter-remap-emoji">'+esc(x.emoji||"•")+'</strong> Reação de '+esc(x.author||"leitor")
        : '<strong>'+esc(x.author||"Leitor")+'</strong><span>'+esc(x.text||"Comentário")+'</span>';
      let options='<option value="">Escolha…</option>';
      if(newParas.length>1){
        const suggested=guessSplitTarget(x,newParas);
        newParas.forEach((p,i)=>{
          const snippet=norm(p).slice(0,72);
          options+='<option value="'+i+'"'+(suggested===String(i)?" selected":"")+'>§'+(edit.idx+i+1)+' · '+esc(snippet)+(snippet.length>=72?"…":"")+'</option>';
        });
      }else{
        if(previous)options+='<option value="prev">Parágrafo anterior (§'+edit.idx+')</option>';
        if(next)options+='<option value="next">Próximo parágrafo (§'+(edit.idx+1)+')</option>';
      }
      rows+=
        '<label class="chapter-remap-row" data-feedback-id="'+esc(x.id)+'">'+
          '<div class="chapter-remap-feedback">'+label+(x.quote?'<small>Trecho: '+esc(String(x.quote).slice(0,130))+'</small>':"")+'</div>'+
          '<select>'+options+'</select>'+
        '</label>';
    });

    const intro=newParas.length>1
      ? 'Este parágrafo virou '+newParas.length+'. Escolha onde cada comentário ou reação continuará ligado.'
      : 'Este parágrafo será apagado. Escolha se cada comentário ou reação vai para o anterior ou para o próximo.';

    const result=await modalShell(
      newParas.length>1?"Reposicionar feedback":"Parágrafo apagado",
      '<p class="chapter-remap-intro">'+esc(intro)+'</p><div class="chapter-remap-list">'+rows+'</div>',
      [
        {label:"Voltar",value:null},
        {label:"Continuar",primary:true,onClick:(wrap)=>{
          const out={};
          let missing=false;
          qsa(".chapter-remap-row",wrap).forEach(row=>{
            const value=qs("select",row).value;
            row.classList.toggle("needs-choice",!value);
            if(!value)missing=true;
            else out[row.dataset.feedbackId]=value;
          });
          if(missing)return undefined;
          return out;
        }}
      ]
    );
    return result;
  }

  function targetForRoot(root,newParas,assignments){
    if(newParas.length===1){
      return {idx:edit.idx,key:keyFor(newParas[0]),quote:quoteFor(newParas[0])};
    }
    if(newParas.length>1){
      const off=Number(assignments[root.id]);
      const text=newParas[off];
      return {idx:edit.idx+off,key:keyFor(text),quote:quoteFor(text)};
    }
    const choice=assignments[root.id];
    if(choice==="prev"){
      const block=qs('#chapterText .para-block[data-para-idx="'+(edit.idx-1)+'"]');
      const text=qs("p",block)?.textContent||"";
      return {idx:edit.idx-1,key:block?.dataset.paragraphKey||keyFor(text),quote:quoteFor(text)};
    }
    if(choice==="next"){
      const block=qs('#chapterText .para-block[data-para-idx="'+(edit.idx+1)+'"]');
      const text=qs("p",block)?.textContent||"";
      return {idx:edit.idx,key:block?.dataset.paragraphKey||keyFor(text),quote:quoteFor(text)};
    }
    return null;
  }
  async function applyFeedbackRemap(newParas,assignments){
    const info=sourceFeedback();
    const db=window.Comments?.getDb?.();
    if(!db||!isAdmin())throw new Error("O modo administrador perdeu a conexão com o Firestore.");

    const delta=newParas.length-1;
    const rootTargets=new Map();
    info.roots.forEach(root=>{
      const target=targetForRoot(root,newParas,assignments);
      if(target)rootTargets.set(root.id,target);
    });

    const patches=[];
    const ch=edit.ctx.chapter.n;

    info.all.forEach(x=>{
      if(Number(x.chapter)!==Number(ch))return;
      const stored=Number(x.paraIdx);
      if(!Number.isFinite(stored)||stored<0)return;

      const rootId=x.parentId||x.rootId||x.id;
      if(rootTargets.has(rootId)){
        const t=rootTargets.get(rootId);
        patches.push({id:x.id,data:{paraIdx:t.idx,paragraphKey:t.key,quote:t.quote}});
        return;
      }

      if(delta!==0){
        const effective=legacyEffectiveIndex(x,ch,info.keyIndex);
        if(effective>edit.idx){
          const newIdx=x.paragraphKey&&info.keyIndex.has(x.paragraphKey)
            ? effective+delta
            : stored+delta;
          patches.push({id:x.id,data:{paraIdx:newIdx}});
        }
      }
    });

    if(!patches.length)return 0;
    for(let start=0;start<patches.length;start+=400){
      const batch=db.batch();
      patches.slice(start,start+400).forEach(p=>{
        batch.set(db.collection("comments").doc(p.id),p.data,{merge:true});
      });
      await batch.commit();
    }
    return patches.length;
  }

  function canonicalPath(ctx){
    const root=BOOK_ROOTS[ctx.book.id];
    if(!root)throw new Error("Este livro ainda não está configurado para edição canônica.");
    const marker="/capitulos/";
    const text=String(ctx.chapter.text||"").replace(/\\/g,"/");
    const pos=text.indexOf(marker);
    const file=pos>=0?text.slice(pos+marker.length):text.split("/").pop();
    if(!file)throw new Error("Não consegui identificar o arquivo canônico deste capítulo.");
    return root+"/capitulos/"+file;
  }

  function utf8ToBase64(text){
    const bytes=new TextEncoder().encode(text);
    let binary="";
    const step=0x8000;
    for(let i=0;i<bytes.length;i+=step){
      binary+=String.fromCharCode(...bytes.subarray(i,i+step));
    }
    return btoa(binary);
  }

  function base64ToUtf8(value){
    const binary=atob(String(value||"").replace(/\s/g,""));
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function forgetToken(){
    sessionStorage.removeItem(TOKEN_SESSION);
    localStorage.removeItem(TOKEN_LOCAL);
  }

  function cleanToken(value){
    return String(value||"").replace(/[\s\u00A0\u200B-\u200D\u2060\uFEFF]+/g,"").trim();
  }

  function checkedToken(value){
    const t=cleanToken(value);
    if(!t)return "";
    if(/[^\x21-\x7E]/.test(t)){
      forgetToken();
      throw new Error("O token contém um caractere invisível ou inválido. Cole novamente o código completo do GitHub.");
    }
    return t;
  }

  async function askToken(){
    const body=
      '<p>Para publicar no livro oficial, o navegador precisa de um token GitHub com acesso somente ao repositório <code>'+esc(REPO)+'</code> e permissão <strong>Contents: Read and write</strong>.</p>'+
      '<p class="chapter-token-note">Por padrão ele fica apenas nesta sessão e é enviado somente para <code>api.github.com</code>.</p>'+
      '<label class="chapter-token-field"><span>Fine-grained personal access token</span><input id="chapterGithubToken" type="password" autocomplete="off" placeholder="github_pat_…"></label>'+
      '<label class="chapter-token-remember"><input id="chapterGithubRemember" type="checkbox" checked> Lembrar neste dispositivo</label>'+
      '<a class="chapter-token-link" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Criar token no GitHub</a>';
    const result=await modalShell("Conectar GitHub",body,[
      {label:"Cancelar",value:null},
      {label:"Conectar",primary:true,onClick:(wrap)=>{
        const token=cleanToken(qs("#chapterGithubToken",wrap).value);
        if(!token){qs("#chapterGithubToken",wrap).focus();return undefined;}
        if(/[^\x21-\x7E]/.test(token)){
          qs("#chapterGithubToken",wrap).value="";
          qs("#chapterGithubToken",wrap).placeholder="Cole novamente o token sem espaços";
          qs("#chapterGithubToken",wrap).focus();
          return undefined;
        }
        return {token,remember:qs("#chapterGithubRemember",wrap).checked};
      }}
    ]);
    if(!result)return null;
    sessionStorage.setItem(TOKEN_SESSION,result.token);
    if(result.remember)localStorage.setItem(TOKEN_LOCAL,result.token);
    return result.token;
  }

  async function token(){
    const stored=sessionStorage.getItem(TOKEN_SESSION)||localStorage.getItem(TOKEN_LOCAL);
    if(stored){
      const cleaned=checkedToken(stored);
      if(cleaned!==stored){
        sessionStorage.setItem(TOKEN_SESSION,cleaned);
        if(localStorage.getItem(TOKEN_LOCAL))localStorage.setItem(TOKEN_LOCAL,cleaned);
      }
      return cleaned;
    }
    return await askToken();
  }

  async function github(path,options={}){
    const t=await token();
    if(!t)throw new Error("Publicação cancelada.");
    const encoded=path.split("/").map(encodeURIComponent).join("/");
    const url="https://api.github.com/repos/"+REPO+"/contents/"+encoded+(options.method?"":"?ref="+encodeURIComponent(BRANCH));
    let res;
    try{
      res=await fetch(url,{
        method:options.method||"GET",
        headers:{
          "Accept":"application/vnd.github+json",
          "Authorization":"Bearer "+checkedToken(t),
          "X-GitHub-Api-Version":"2022-11-28",
          ...(options.headers||{})
        },
        body:options.body?JSON.stringify(options.body):undefined
      });
    }catch(err){
      if(/ISO-8859-1|headers|code point/i.test(String(err?.message||err))){
        forgetToken();
        throw new Error("O token salvo contém um caractere inválido. Cole novamente o código do GitHub; o Lityra vai limpar espaços e caracteres invisíveis automaticamente.");
      }
      throw err;
    }
    let data=null;
    try{data=await res.json();}catch(e){}
    if(res.status===401){
      forgetToken();
      throw new Error("O token do GitHub não é mais válido. Conecte novamente.");
    }
    if(res.status===403){
      throw new Error("O GitHub recusou esta ação. Confira se o token tem acesso ao repositório e Contents: Read and write.");
    }
    if(!res.ok){
      const msg=data?.message||("GitHub respondeu "+res.status+".");
      throw new Error(msg);
    }
    return data;
  }

  async function publishCanonical(nextRaw){
    const path=canonicalPath(edit.ctx);
    const remote=await github(path);
    const remoteRaw=base64ToUtf8(remote.content);
    const alreadyPublished=sameText(remoteRaw,nextRaw);
    if(!alreadyPublished&&!sameText(remoteRaw,edit.raw)){
      const err=new Error("O capítulo oficial mudou desde que você abriu esta edição. Reabra o capítulo para não sobrescrever uma versão mais nova.");
      err.code="conflict";
      throw err;
    }
    if(alreadyPublished){
      return {path,saved:null,original:edit.raw,alreadyPublished:true};
    }
    const body={
      message:"Edit cap. "+edit.ctx.chapter.n+" via Editor de Livros App",
      content:utf8ToBase64(nextRaw),
      sha:remote.sha,
      branch:BRANCH
    };
    const saved=await github(path,{method:"PUT",body});
    return {path,saved,original:remoteRaw,alreadyPublished:false};
  }
  async function rollbackCanonical(pub){
    try{
      const latest=await github(pub.path);
      await github(pub.path,{
        method:"PUT",
        body:{
          message:"Rollback editor publication after feedback remap failure",
          content:utf8ToBase64(pub.original),
          sha:latest.sha,
          branch:BRANCH
        }
      });
      return true;
    }catch(e){
      console.error("Rollback failed",e);
      return false;
    }
  }

  function setBusy(on,label){
    busy=on;
    const bar=qs("#chapterEditorBar");
    if(bar)bar.classList.toggle("is-busy",on);
    qsa("#chapterEditorBar button").forEach(b=>b.disabled=on);
    const publish=qs("#chapterEditorPublish");
    if(publish)publish.textContent=on?(label||"Publicando…"):"Salvar e publicar";
    if(edit?.textarea)edit.textarea.disabled=on;
  }

  async function saveAndPublish(){
    if(!edit||busy||!isAdmin())return;
    const p=proposed();
    if(!p||sameText(p.raw,edit.raw)){
      toast("Nenhuma alteração para publicar.","warn");
      return;
    }

    if(p.newParas.length===0&&edit.paras.length===1){
      toast("Não é possível apagar o único parágrafo do capítulo.","error");
      return;
    }

    const assignments=await chooseRemap(p.newParas);
    if(assignments===null)return;

    let pub=null;
    try{
      setBusy(true,"Verificando…");
      pub=await publishCanonical(p.raw);
      setBusy(true,"Reposicionando feedback…");
      const moved=await applyFeedbackRemap(p.newParas,assignments);

      const ctx=edit.ctx;
      const raw=p.raw;
      const structural=p.newParas.length-1;
      const chapterN=ctx.chapter.n;

      edit.textarea?.remove();
      if(edit.p)edit.p.hidden=false;
      edit.block?.classList.remove("chapter-editing");
      edit=null;
      qs("#chapterEditorBar").hidden=true;

      // Atualiza o capítulo aberto imediatamente, sem reload de página.
      // A próxima edição parte deste raw recém-publicado.
      const scroller=qs("#readerScroll");
      const previousScroll=scroller?.scrollTop||0;
      if(window.BookReader?.applyPublishedChapter){
        await window.BookReader.applyPublishedChapter(raw);
      }else{
        window.BookReader?.renderCurrentRaw?.(raw);
      }
      requestAnimationFrame(()=>{
        if(scroller)scroller.scrollTop=previousScroll;
        refreshEditButtons();
      });
      const detail=structural>0
        ? " · "+structural+" parágrafo"+(structural>1?"s":"")+" criado"+(structural>1?"s":"")
        : (structural<0?" · 1 parágrafo removido":"");
      toast("Capítulo "+chapterN+" publicado"+detail+(moved?" · feedback preservado":"")+".","ok");
    }catch(err){
      if(pub){
        setBusy(true,"Revertendo…");
        const rolled=await rollbackCanonical(pub);
        if(!rolled){
          toast("O texto foi publicado, mas o remapeamento falhou e o rollback também. Não faça outra edição antes de revisar o capítulo.","error");
          console.error(err);
          setBusy(false);
          return;
        }
      }
      toast(err.message||"Não foi possível publicar a alteração.","error");
      console.error(err);
    }finally{
      setBusy(false);
    }
  }

  function makeEditButton(block){
    const actions=qs(".para-actions",block);
    if(!actions||qs(".chapter-edit-toggle",actions))return;
    const btn=document.createElement("button");
    btn.type="button";
    btn.className="chapter-edit-toggle";
    btn.title="Editar parágrafo";
    btn.setAttribute("aria-label","Editar parágrafo");
    btn.innerHTML='<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm2.92 2.25H4.5v-1.42l9.56-9.56 1.42 1.42-9.56 9.56zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.34a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>';
    btn.onclick=e=>{e.preventDefault();e.stopPropagation();startEdit(block);};
    const picker=qs(".reaction-picker",actions);
    if(picker)actions.insertBefore(btn,picker);
    else actions.appendChild(btn);
  }

  function refreshEditButtons(){
    const root=qs("#chapterText");
    if(!root)return;
    if(!isAdmin()){
      qsa(".chapter-edit-toggle",root).forEach(x=>x.remove());
      return;
    }
    qsa(".para-block",root).forEach(makeEditButton);
  }

  function observe(){
    const root=qs("#chapterText");
    if(!root)return;
    observer?.disconnect();
    observer=new MutationObserver(()=>{
      if(!busy)requestAnimationFrame(refreshEditButtons);
    });
    observer.observe(root,{childList:true,subtree:true});
  }

  function init(){
    ensureUi();
    observe();
    refreshEditButtons();
    document.addEventListener("beta:chapter-open",()=>{
      if(edit&&!busy)cancelEdit(false);
      setTimeout(()=>{observe();refreshEditButtons();},80);
    });
    document.addEventListener("beta:admin",()=>{
      if(!isAdmin()&&edit&&!busy)cancelEdit(false);
      setTimeout(refreshEditButtons,60);
    });
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
  else init();

  window.ChapterEditor={
    refresh:refreshEditButtons,
    cancel:cancelEdit,
    forgetGitHub:forgetToken
  };
})();
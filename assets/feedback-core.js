// Beta feedback v2: threaded comments + paragraph reactions
const Comments = (() => {
  const NAME_KEY="jesed:username", USER_KEY="jesed:readerId", ACCESS_KEY="jesed:readerAccessCode";
  const CODEHASH_KEY="jesed:readerCodeHash";
  const SEEN_ANNOUNCE_KEY="jesed:lastSeenAnnouncement";
  const PROFILE_COLLECTION="readerProfiles";
  const ADMIN_COLLECTION="admins";
  const OWNER_ADMIN_UID="KfNaJsvIUMgpsPMPYRQ6017T1Ct2";
  const ANNOUNCE_COLLECTION="announcements";
  const EMOJIS=["😍","😂","😱","😢","🤔"];
  let db=null, auth=null, enabled=false, showAll=false, active=null, subBook=null, unsubC=null, adminUser=null, authReady=false, readerResetting=false;
  const cCache={}, rCache={};

  const norm=s=>String(s||"").replace(/\s+/g," ").trim().toLowerCase();
  const ACCESS_ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function normalizeAccessCode(v){return String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"");}
  function formatAccessCode(v){
    const clean=normalizeAccessCode(v);
    if(clean.length<=8) return clean; // código curto: sem separadores
    return clean.match(/.{1,4}/g)?.join("-")||"";
  }
  function generateAccessCode(){
    // código curto (6 caracteres) — não há dado sensível por trás dele,
    // só precisa ser fácil de guardar e compartilhar entre aparelhos.
    const bytes=new Uint8Array(6);
    crypto.getRandomValues(bytes);
    let out="";
    for(const b of bytes) out+=ACCESS_ALPHABET[b%ACCESS_ALPHABET.length];
    return out;
  }
  function accessCode(){return formatAccessCode(localStorage.getItem(ACCESS_KEY)||"");}
  function hashText(s){let h=2166136261;for(const ch of norm(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
  function uid(){let id=localStorage.getItem(USER_KEY);if(!id){id=(crypto.randomUUID?crypto.randomUUID():"r_"+Date.now().toString(36)+Math.random().toString(36).slice(2));localStorage.setItem(USER_KEY,id);}return id;}
  const name=()=>String(localStorage.getItem(NAME_KEY)||"").trim();
  const admin=()=>!!adminUser;

  function clearReaderIdentity(){
    // Apaga somente a identidade do beta reader. Preferências de leitura e
    // progresso dos livros ficam preservados no aparelho.
    localStorage.removeItem(NAME_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(CODEHASH_KEY);
    localStorage.removeItem(SEEN_ANNOUNCE_KEY);
  }

  function resetDeletedReaderProfile({reload=true}={}){
    if(readerResetting)return;
    readerResetting=true;
    clearReaderIdentity();

    // Fora do boot, recarrega já como visitante novo. No boot podemos limpar
    // antes de montar a interface e abrir diretamente a tela de novo perfil.
    if(reload)setTimeout(()=>location.reload(),0);
  }

  async function validateStoredReaderProfile(){
    if(!enabled||!db||!name())return false;

    let codeHash=localStorage.getItem(CODEHASH_KEY)||"";
    if(!codeHash&&accessCode()){
      codeHash=await sha256(normalizeAccessCode(accessCode()));
      localStorage.setItem(CODEHASH_KEY,codeHash);
    }
    if(!codeHash)return false;

    try{
      const doc=await db.collection(PROFILE_COLLECTION).doc(codeHash).get();
      if(!doc.exists || doc.data()?.deleted===true){
        resetDeletedReaderProfile({reload:false});
        return true;
      }
    }catch(e){
      // Falha de rede não deve expulsar um leitor válido.
      console.warn("Não foi possível validar a identidade do leitor:",e);
    }
    return false;
  }

  function profileDeletedError(){
    const err=new Error("Este perfil foi removido pelo autor. Crie um novo perfil para continuar.");
    err.code="app/profile-deleted";
    return err;
  }
  async function authorizedAdminUser(user,{throwOnFailure=false}={}){
    if(user?.uid===OWNER_ADMIN_UID)return true;
    if(!user||!db){
      if(throwOnFailure){
        const err=new Error("Firebase ainda não terminou de inicializar.");
        err.code="app/admin-check-unavailable";
        throw err;
      }
      return false;
    }
    try{
      const snap=await db.collection(ADMIN_COLLECTION).doc(user.uid).get();
      if(!snap.exists){
        if(throwOnFailure){
          const err=new Error("O documento admins/"+user.uid+" não existe no Firestore.");
          err.code="app/admin-doc-missing";
          throw err;
        }
        return false;
      }
      const data=snap.data()||{};
      if(data.enabled!==true){
        if(throwOnFailure){
          const err=new Error("O documento de admin existe, mas o campo enabled precisa ser boolean true.");
          err.code="app/admin-disabled";
          throw err;
        }
        return false;
      }
      if(data.disabled===true){
        if(throwOnFailure){
          const err=new Error("Esta conta de administrador está marcada como disabled.");
          err.code="app/admin-disabled";
          throw err;
        }
        return false;
      }
      return true;
    }catch(e){
      if(String(e?.code||"").startsWith("app/"))throw e;
      console.warn("Não foi possível validar a permissão de administrador:",e);
      if(throwOnFailure){
        const err=new Error(
          e?.code==="permission-denied"
            ? "O Firestore negou a leitura de admins/"+user.uid+". As Rules publicadas ainda não permitem que esta conta leia o próprio documento."
            : "Falha ao consultar a permissão de administrador: "+(e?.message||"erro desconhecido")
        );
        err.code=e?.code||"app/admin-check-failed";
        throw err;
      }
      return false;
    }
  }
  function emitAdminState(){
    document.dispatchEvent(new CustomEvent("beta:admin",{detail:{on:admin()}}));
    render();
    updateIdentityBar();
  }
  async function applyAuthUser(user){
    adminUser=(user&&await authorizedAdminUser(user))?user:null;
    authReady=true;
    emitAdminState();
    return admin();
  }
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const when=t=>t?new Date(t).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
  function shortId(id){const v=String(id||"").replace(/[^a-z0-9]/gi,"").toUpperCase();return v?v.slice(-6):"LEGADO";}
  function updateIdentityBar(){
    const el=document.getElementById("readerIdentityBar");
    if(!el)return;
    if(name()){
      el.hidden=false;
      const code=accessCode();
      el.textContent=code?(name()+" · #"+code):(name()+" · #"+shortId(uid()));
    }else{
      el.hidden=true;
    }
  }
  function showAccessCodeModal(code){
    let el=document.getElementById("accessCodeSheet");
    if(!el){
      el=document.createElement("div");
      el.id="accessCodeSheet";
      el.className="sheet";
      el.innerHTML='<div class="sheet-card">'
        +'<h2>Guarde seu código</h2>'
        +'<p class="sheet-hint">Esse é o seu código de acesso. Guarde-o: é com ele que você entra nessa biblioteca por qualquer outro aparelho, usando "Já tenho um código".</p>'
        +'<div class="access-code-display" id="accessCodeDisplay"></div>'
        +'<div class="sheet-actions">'
        +'<button id="accessCodeCopy" class="btn-ghost" type="button">Copiar código</button>'
        +'<button id="accessCodeOk" class="btn-primary" type="button">Entendi</button>'
        +'</div></div>';
      document.body.appendChild(el);
      el.querySelector("#accessCodeOk").addEventListener("click",()=>{el.hidden=true;});
      el.querySelector("#accessCodeCopy").addEventListener("click",async()=>{
        const btn=el.querySelector("#accessCodeCopy");
        try{await navigator.clipboard.writeText(el.dataset.code||"");btn.textContent="Copiado!";setTimeout(()=>btn.textContent="Copiar código",1500);}
        catch(e){}
      });
    }
    el.dataset.code=code;
    el.querySelector("#accessCodeDisplay").textContent="#"+code;
    el.hidden=false;
  }
  function showAnnouncementModal(items){
    let el=document.getElementById("announceSheet");
    if(!el){
      el=document.createElement("div");
      el.id="announceSheet";
      el.className="sheet";
      el.innerHTML='<div class="sheet-card">'
        +'<h2>Recado</h2>'
        +'<div id="announceList" class="announce-list"></div>'
        +'<div class="sheet-actions"><button id="announceOk" class="btn-primary" type="button">Entendi</button></div>'
        +'</div>';
      document.body.appendChild(el);
      el.querySelector("#announceOk").addEventListener("click",()=>{el.hidden=true;});
    }
    el.querySelector("#announceList").innerHTML=items.map(x=>
      '<div class="announce-item"><p>'+esc(x.text).replace(/\n/g,"<br>")+'</p><span class="announce-when">'+when(x.createdAt)+'</span></div>'
    ).join("");
    el.hidden=false;
  }

  async function checkAnnouncements(){
    if(!enabled||!db||admin())return;
    try{
      const snap=await db.collection(ANNOUNCE_COLLECTION).orderBy("createdAt","desc").limit(8).get();
      const all=[];snap.forEach(d=>all.push({id:d.id,...d.data()}));
      const lastSeen=Number(localStorage.getItem(SEEN_ANNOUNCE_KEY)||0);
      const unseen=all.filter(x=>Number(x.createdAt)>lastSeen).sort((a,b)=>a.createdAt-b.createdAt);
      if(!unseen.length)return;
      showAnnouncementModal(unseen);
      const newest=Math.max(...all.map(x=>Number(x.createdAt)||0));
      localStorage.setItem(SEEN_ANNOUNCE_KEY,String(newest));
    }catch(e){console.warn("Não foi possível checar recados:",e);}
  }

  async function sendAnnouncement(text){
    if(!admin()||!text?.trim())return;
    await db.collection(ANNOUNCE_COLLECTION).add({text:text.trim(),createdAt:Date.now(),authorId:adminUser?.uid||null});
  }

  function pInfo(block){const p=block.querySelector("p");const raw=p?p.textContent:block.textContent;const q=norm(raw);return {key:"p_"+hashText(q),quote:q.slice(0,220)};}
  function loc(x,ch,i,key){if(Number(x.chapter)!==Number(ch))return false;if(key&&x.paragraphKey&&x.paragraphKey===key)return true;return Number(x.paraIdx)===Number(i);}
  function own(x){return admin()||(x.authorId?x.authorId===uid():norm(x.author)===norm(name()));}
  function rootVisible(x){return admin()||showAll||(x.authorId?x.authorId===uid():norm(x.author)===norm(name()));}

  async function sha256(s){
    const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
  }

  async function ensureAccessProfile(initialBookId){
    if(!enabled||!db||!name()) return null;
    let code=accessCode();
    const hadExistingCode=!!code;
    if(!code){
      code=generateAccessCode();
      localStorage.setItem(ACCESS_KEY,code);
    }
    const codeHash=await sha256(normalizeAccessCode(code));
    localStorage.setItem(CODEHASH_KEY,codeHash);
    const ref=db.collection(PROFILE_COLLECTION).doc(codeHash);
    let profileDoc=null,exists=false,profileReadOk=false;
    try{
      profileDoc=await ref.get();
      exists=profileDoc.exists;
      profileReadOk=true;
    }catch(e){
      console.warn("Não foi possível verificar o perfil no Firestore:",e);
    }

    // Perfil apagado pelo painel: nunca recriar silenciosamente a identidade
    // antiga no próximo acesso.
    if(profileReadOk&&exists&&profileDoc?.data()?.deleted){
      resetDeletedReaderProfile();
      throw profileDeletedError();
    }

    // Se este aparelho já possuía um código mas o documento realmente
    // desapareceu do Firestore (por exemplo, exclusão manual no Console),
    // trate igualmente como perfil removido. Falha de rede NÃO apaga o perfil.
    if(profileReadOk&&hadExistingCode&&!exists){
      resetDeletedReaderProfile();
      throw profileDeletedError();
    }
    const payload={
      readerId:uid(),
      name:name(),
      updatedAt:Date.now()
    };
    if(!exists){
      const firstBook=String(initialBookId||"").trim();
      if(!firstBook)throw new Error("Escolha o primeiro livro antes de criar o perfil.");
      payload.createdAt=Date.now();
      payload.initialBookId=firstBook;
      payload.allowedBooks=[firstBook];
    }
    await ref.set(payload,{merge:true});
    return code;
  }

  // ---------------- Acesso a livros ----------------
  // O leitor escolhe exatamente um livro ao criar o perfil. Depois disso,
  // o admin pode acrescentar ou remover outros livros. Admin sempre vê tudo.
  async function getAllowedBooks(){
    if(admin())return null; // null = sem restrição, mostra tudo
    if(!enabled||!db)return [];
    const codeHash=localStorage.getItem(CODEHASH_KEY);
    if(!codeHash)return [];
    try{
      const doc=await db.collection(PROFILE_COLLECTION).doc(codeHash).get();
      if(!doc.exists)return [];
      const data=doc.data()||{};
      if(data.deleted){
        resetDeletedReaderProfile();
        return [];
      }
      const granted=Array.isArray(data.allowedBooks)?data.allowedBooks:[];
      return [...new Set(granted)];
    }catch(e){
      console.warn("Não foi possível carregar os livros liberados:",e);
      return [];
    }
  }
  async function listReaderProfiles(){
    if(!admin()||!db)return [];
    try{
      const snap=await db.collection(PROFILE_COLLECTION).orderBy("updatedAt","desc").get();
      const out=[];snap.forEach(d=>{const data=d.data()||{};if(!data.deleted)out.push({id:d.id,...data});});
      return out;
    }catch(e){console.warn("Não foi possível listar os perfis de leitores:",e);return [];}
  }
  async function setAllowedBooks(profileId,allowedBooks){
    if(!admin()||!db)return;
    await db.collection(PROFILE_COLLECTION).doc(profileId).set({allowedBooks},{merge:true});
  }

  async function deleteReaderProfile(profileId,readerId){
    if(!admin()||!db)throw new Error("Apenas o administrador pode apagar leitores.");
    const ref=db.collection(PROFILE_COLLECTION).doc(profileId);
    const snap=await ref.get();
    if(!snap.exists)return {deletedFeedback:0,cleanupFailed:false};
    const profile=snap.data()||{};
    const rid=String(readerId||profile.readerId||"");
    const now=Date.now();

    // Mantemos somente uma lápide técnica no mesmo ID (hash do código).
    // Isso impede que um aparelho antigo recrie automaticamente o perfil
    // apagado com o mesmo código, sem conservar nome, livros ou readerId.
    await ref.set({
      deleted:true,
      deletedAt:now,
      deletedBy:adminUser?.uid||null,
      updatedAt:now
    });

    if(!rid)return {deletedFeedback:0,cleanupFailed:false};

    try{
      const commentsSnap=await db.collection("comments").get();
      const rows=[];
      commentsSnap.forEach(d=>rows.push({id:d.id,data:d.data()||{}}));

      const ownedRootIds=new Set(
        rows
          .filter(x=>x.data.authorId===rid&&!x.data.parentId&&x.data.kind!=="reply"&&x.data.kind!=="reaction")
          .map(x=>x.id)
      );
      const ids=[...new Set(rows.filter(x=>
        x.data.authorId===rid||
        ownedRootIds.has(x.data.parentId)||
        ownedRootIds.has(x.data.rootId)
      ).map(x=>x.id))];

      for(let i=0;i<ids.length;i+=400){
        const batch=db.batch();
        ids.slice(i,i+400).forEach(id=>batch.delete(db.collection("comments").doc(id)));
        await batch.commit();
      }
      if(rid&&rid===localStorage.getItem(USER_KEY))resetDeletedReaderProfile();
      return {deletedFeedback:ids.length,cleanupFailed:false};
    }catch(e){
      console.warn("Leitor removido, mas a limpeza do feedback falhou:",e);
      if(rid&&rid===localStorage.getItem(USER_KEY))resetDeletedReaderProfile();
      return {deletedFeedback:0,cleanupFailed:true};
    }
  }

  async function loginWithCode(rawCode){
    if(!enabled||!db) throw new Error("O login por código está indisponível neste momento.");
    const clean=normalizeAccessCode(rawCode);
    if(clean.length<4) throw new Error("Confira o código digitado.");
    const codeHash=await sha256(clean);
    const doc=await db.collection(PROFILE_COLLECTION).doc(codeHash).get();
    if(!doc.exists) throw new Error("Código não encontrado.");
    const profile=doc.data()||{};
    if(profile.deleted) throw new Error("Este código foi removido pelo autor. Crie um novo perfil para continuar.");
    if(!profile.readerId||!profile.name) throw new Error("Este perfil está incompleto.");
    localStorage.setItem(USER_KEY,String(profile.readerId));
    localStorage.setItem(NAME_KEY,String(profile.name));
    localStorage.setItem(ACCESS_KEY,formatAccessCode(clean));
    localStorage.setItem(CODEHASH_KEY,codeHash);
    document.dispatchEvent(new CustomEvent("beta:profile-login",{detail:{readerId:profile.readerId,name:profile.name}}));
    return {readerId:profile.readerId,name:profile.name,accessCode:formatAccessCode(clean)};
  }

  async function init(){
    if(window.FIREBASE_CONFIG&&window.firebase){
      try{
        if(!firebase.apps.length)firebase.initializeApp(window.FIREBASE_CONFIG);
        db=firebase.firestore();enabled=true;
        if(firebase.auth){
          auth=firebase.auth();
          auth.onAuthStateChanged(u=>{
            applyAuthUser(u).catch(e=>{
              console.warn("Falha ao validar sessão de administrador:",e);
              adminUser=null;
              authReady=true;
              emitAdminState();
            });
          });
        }
      }catch(e){console.warn(e);}
    }

    // Antes de montar a interface, confirma que o perfil local ainda existe.
    // Se o admin o removeu, limpamos nome/ID/código primeiro, evitando o
    // "fantasma" do utilizador apagado aparecer novamente após F5.
    if(name())await validateStoredReaderProfile();

    if(name())uid();
    wireName();
    wireSettings();
    updateIdentityBar();
    document.addEventListener("beta:profile-ready",updateIdentityBar);
    document.addEventListener("beta:profile-login",updateIdentityBar);
    window.addEventListener("load",updateIdentityBar);
    setTimeout(updateIdentityBar,0);
    if(name()){
      ensureAccessProfile().catch(e=>console.warn("Perfil portátil indisponível:",e));
    }
  }

  function wireName(){
    const sheet=document.getElementById("nameSheet"),input=document.getElementById("nameInput"),save=document.getElementById("nameSave");
    const useCode=document.getElementById("nameUseCode"),codeBox=document.getElementById("nameCodeBox");
    const codeInput=document.getElementById("nameCodeInput"),codeLogin=document.getElementById("nameCodeLogin"),codeStatus=document.getElementById("nameCodeStatus");
    const bookField=document.getElementById("initialBookField"),bookPicker=document.getElementById("initialBookPicker");
    if(!sheet||!input||!save)return;
    if(!name()){
      sheet.hidden=false;
      loadInitialBooks();
    }

    async function loadInitialBooks(){
      if(!bookPicker)return;
      save.disabled=true;
      try{
        const res=await fetch("data/books.json",{cache:"no-cache"});
        if(!res.ok)throw new Error("Não foi possível carregar os livros.");
        const books=(await res.json()).books||[];
        if(!books.length)throw new Error("Nenhum livro está disponível no momento.");
        bookPicker.innerHTML=books.map(book=>
          '<label class="initial-book-option">'+
            '<input type="radio" name="initialBook" value="'+esc(book.id)+'">'+
            '<span><strong>'+esc(book.title||"Livro")+'</strong><small>'+esc(book.subtitle||"")+'</small></span>'+
          '</label>'
        ).join("");
        save.disabled=true;
        bookPicker.querySelectorAll('input[name="initialBook"]').forEach(radio=>{
          radio.addEventListener("change",()=>{
            save.disabled=false;
            bookPicker.querySelectorAll(".initial-book-option").forEach(option=>option.classList.toggle("selected",!!option.querySelector("input:checked")));
          });
        });
      }catch(e){
        bookPicker.innerHTML='<p class="initial-book-status error">'+esc(e.message||"Não foi possível carregar os livros.")+'</p>';
      }
    }

    const go=async()=>{
      const v=input.value.trim();
      if(!v)return input.focus();
      const isNew=!name();
      const initialBook=bookPicker?.querySelector('input[name="initialBook"]:checked')?.value||"";
      if(isNew&&!initialBook){
        bookPicker?.querySelector("input")?.focus();
        return;
      }
      save.disabled=true;
      localStorage.setItem(NAME_KEY,v);
      // perfil novo: não precisa ver recados antigos, só os futuros
      if(isNew&&!localStorage.getItem(SEEN_ANNOUNCE_KEY))localStorage.setItem(SEEN_ANNOUNCE_KEY,String(Date.now()));
      try{
        const code=await ensureAccessProfile(initialBook);
        if(!code)throw new Error("Não foi possível criar o perfil agora.");
      }catch(e){
        if(isNew){
          localStorage.removeItem(NAME_KEY);
          localStorage.removeItem(USER_KEY);
          localStorage.removeItem(ACCESS_KEY);
          localStorage.removeItem(CODEHASH_KEY);
        }
        console.warn("Não foi possível registrar o código de acesso:",e);
        const previous=bookPicker?.querySelector(".initial-book-status.error");
        if(previous)previous.remove();
        const code=String(e?.code||"");
        const msg=code==="permission-denied"
          ?"O cadastro foi bloqueado pelas permissões do servidor. Avise o autor para corrigir o acesso."
          :(e?.message||"Não foi possível criar o perfil agora.");
        bookPicker?.insertAdjacentHTML("beforeend",'<p class="initial-book-status error">'+esc(msg)+'</p>');
        save.disabled=false;
        return;
      }
      sheet.hidden=true;
      document.dispatchEvent(new CustomEvent("beta:profile-ready"));
      const code=accessCode();
      if(code) showAccessCodeModal(code);
    };
    save.addEventListener("click",go);
    input.addEventListener("keydown",e=>{if(e.key==="Enter")go();});

    useCode?.addEventListener("click",()=>{
      codeBox.hidden=false;
      if(bookField)bookField.hidden=true;
      save.hidden=true;
      codeInput?.focus();
    });
    codeLogin?.addEventListener("click",async()=>{
      if(!codeInput?.value.trim()) return codeInput?.focus();
      codeLogin.disabled=true;
      if(codeStatus){codeStatus.textContent="Entrando…";codeStatus.classList.remove("error");}
      try{
        const profile=await loginWithCode(codeInput.value);
        if(codeStatus)codeStatus.textContent="Perfil encontrado: "+profile.name;
        location.reload();
      }catch(e){
        if(codeStatus){codeStatus.textContent=e.message||"Não foi possível entrar.";codeStatus.classList.add("error");}
      }finally{
        codeLogin.disabled=false;
      }
    });
    codeInput?.addEventListener("keydown",e=>{if(e.key==="Enter")codeLogin?.click();});
  }

  const ADMIN_EMAIL_KEY="jesed:lastAdminEmail";

  function adminAuthMessage(e){
    const code=String(e?.code||"");
    if(code==="app/not-admin"||code==="app/admin-doc-missing"||code==="app/admin-disabled"||code==="app/admin-check-unavailable"||code==="permission-denied") return e.message||"Esta conta não está autorizada como administrador.";
    if(code==="auth/invalid-credential"||code==="auth/user-not-found"||code==="auth/wrong-password") return "E-mail ou senha inválidos. Se não lembrar a senha, use “Esqueci a senha”.";
    if(code==="auth/invalid-email") return "Digite um e-mail válido.";
    if(code==="auth/user-disabled") return "Esta conta foi desativada no Firebase.";
    if(code==="auth/too-many-requests") return "Muitas tentativas seguidas. Aguarde um pouco e tente novamente.";
    if(code==="auth/operation-not-allowed") return "O login por e-mail e senha ainda não está habilitado no Firebase Authentication.";
    if(code==="auth/network-request-failed") return "Falha de conexão. Confira a internet e tente novamente.";
    return e?.message||"Não foi possível entrar no modo admin.";
  }

  function ensureAdminLoginSheet(){
    let el=document.getElementById("adminLoginSheet");
    if(el)return el;
    el=document.createElement("div");
    el.id="adminLoginSheet";
    el.className="sheet";
    el.hidden=true;
    el.innerHTML='<div class="sheet-card">'
      +'<h2>Entrar como administrador</h2>'
      +'<p class="sheet-hint">Use a conta de administrador cadastrada no Firebase. Contas comuns não recebem acesso ao painel.</p>'
      +'<label class="field"><span>E-mail</span><input id="adminLoginEmail" type="email" inputmode="email" autocomplete="username" placeholder="seu@email.com"></label>'
      +'<label class="field"><span>Senha</span><input id="adminLoginPassword" type="password" autocomplete="current-password"></label>'
      +'<p id="adminLoginStatus" class="reader-code-status" aria-live="polite"></p>'
      +'<div class="sheet-actions">'
      +'<button id="adminLoginSubmit" class="btn-primary" type="button">Entrar</button>'
      +'<button id="adminResetPassword" class="btn-ghost" type="button">Esqueci a senha</button>'
      +'<button id="adminLoginCancel" class="btn-ghost" type="button">Cancelar</button>'
      +'</div>'
      +'</div>';
    document.body.appendChild(el);

    const email=el.querySelector("#adminLoginEmail");
    const pass=el.querySelector("#adminLoginPassword");
    const status=el.querySelector("#adminLoginStatus");
    const submit=el.querySelector("#adminLoginSubmit");
    const reset=el.querySelector("#adminResetPassword");
    const setStatus=(msg,isError=false)=>{
      status.textContent=msg||"";
      status.classList.toggle("error",!!isError);
    };
    const close=()=>{
      el.hidden=true;
      pass.value="";
      setStatus("");
    };

    el.querySelector("#adminLoginCancel").addEventListener("click",close);
    el.addEventListener("click",e=>{if(e.target===el)close();});

    async function doLogin(){
      const mail=email.value.trim();
      if(!mail){email.focus();return;}
      if(!pass.value){pass.focus();return;}
      submit.disabled=true;
      reset.disabled=true;
      setStatus("Entrando…");
      try{
        const credential=await auth.signInWithEmailAndPassword(mail,pass.value);
        try{
          await authorizedAdminUser(credential.user,{throwOnFailure:true});
        }catch(checkError){
          await auth.signOut();
          throw checkError;
        }
        localStorage.setItem(ADMIN_EMAIL_KEY,mail);
        adminUser=credential.user;
        authReady=true;
        emitAdminState();
        setStatus("Acesso autorizado.");
        setTimeout(close,250);
      }catch(e){
        setStatus(adminAuthMessage(e),true);
      }finally{
        submit.disabled=false;
        reset.disabled=false;
      }
    }

    async function resetPassword(){
      const mail=email.value.trim();
      if(!mail){email.focus();setStatus("Digite seu e-mail primeiro.",true);return;}
      reset.disabled=true;
      submit.disabled=true;
      setStatus("Enviando e-mail de recuperação…");
      try{
        await auth.sendPasswordResetEmail(mail);
        localStorage.setItem(ADMIN_EMAIL_KEY,mail);
        setStatus("E-mail de recuperação enviado. Confira sua caixa de entrada.");
      }catch(e){
        setStatus(adminAuthMessage(e),true);
      }finally{
        reset.disabled=false;
        submit.disabled=false;
      }
    }

    submit.addEventListener("click",doLogin);
    reset.addEventListener("click",resetPassword);
    pass.addEventListener("keydown",e=>{if(e.key==="Enter")doLogin();});
    email.addEventListener("keydown",e=>{if(e.key==="Enter")pass.focus();});
    return el;
  }

  function openAdminLoginSheet(){
    if(!auth){alert("Login de admin indisponível neste momento.");return;}
    const el=ensureAdminLoginSheet();
    const email=el.querySelector("#adminLoginEmail");
    const pass=el.querySelector("#adminLoginPassword");
    const status=el.querySelector("#adminLoginStatus");
    email.value=localStorage.getItem(ADMIN_EMAIL_KEY)||"";
    pass.value="";
    status.textContent="";
    status.classList.remove("error");
    el.hidden=false;
    setTimeout(()=>{(email.value?pass:email).focus();},0);
  }

  function wireSettings(){
    const n=document.getElementById("cfgName"),box=document.getElementById("adminBox"),all=document.getElementById("cfgShowAll");
    const toggle=document.getElementById("btnAdminTop"),settings=document.getElementById("btnSettings"),save=document.getElementById("cfgSave");
    if(!n)return;
    async function refresh(){
      if(admin()){
        box.hidden=false;
        if(toggle){
          toggle.classList.add("active");
          toggle.setAttribute("aria-pressed","true");
          toggle.setAttribute("aria-label","Abrir painel do autor");
          toggle.title="Abrir painel do autor";
        }
        if(enabled){try{const d=await db.collection("config").doc("settings").get();showAll=d.exists&&!!d.data().showAllComments;}catch(e){}all.checked=showAll;}
        document.dispatchEvent(new CustomEvent("beta:admin",{detail:{on:true}}));
      }else{
        box.hidden=true;
        if(toggle){
          toggle.classList.remove("active");
          toggle.setAttribute("aria-pressed","false");
          toggle.setAttribute("aria-label","Entrar no modo admin");
          toggle.title="Entrar no modo admin";
        }
        document.dispatchEvent(new CustomEvent("beta:admin",{detail:{on:false}}));
      }
    }
    settings?.addEventListener("click",()=>{n.value=name();refresh();});
    document.getElementById("btnSendAnnounce")?.addEventListener("click",()=>{
      if(!admin())return;
      document.dispatchEvent(new CustomEvent("beta:popup-admin"));
    });
    toggle?.addEventListener("click",async()=>{
      if(!auth){alert("Login de admin indisponível neste momento.");return;}
      if(admin()){
        document.dispatchEvent(new CustomEvent("beta:admin-home"));
        return;
      }
      openAdminLoginSheet();
    });

    document.addEventListener("beta:admin-logout",async()=>{
      if(!auth||!admin())return;
      await auth.signOut();
      adminUser=null;
      await refresh();
      render();
    });
    save?.addEventListener("click",async()=>{
      if(n.value.trim()){
        localStorage.setItem(NAME_KEY,n.value.trim());
        try{await ensureAccessProfile();}catch(e){console.warn("Não foi possível atualizar o perfil portátil:",e);}
      }
      if(admin()&&enabled){showAll=!!all.checked;await db.collection("config").doc("settings").set({showAllComments:showAll},{merge:true});render();}
      document.dispatchEvent(new CustomEvent("beta:profile-ready"));
    });
    refresh();
  }

  function splitFeedback(book,list){
    cCache[book]=list;
    rCache[book]=list.filter(x=>x.kind==="reaction");
  }

  async function load(book){
    if(!enabled){ cCache[book]=[]; rCache[book]=[]; return; }
    try{
      const snap=await db.collection("comments").where("bookId","==",book).get();
      const list=[];snap.forEach(d=>list.push({id:d.id,...d.data()}));
      splitFeedback(book,list);
    }catch(e){
      console.warn("Não foi possível carregar o feedback:",e);
      cCache[book]=cCache[book]||[];
      rCache[book]=rCache[book]||[];
    }
  }

  function subscribe(book){
    if(!enabled||subBook===book)return;
    unsubC?.();subBook=book;
    unsubC=db.collection("comments").where("bookId","==",book).onSnapshot(s=>{
      const list=[];s.forEach(d=>list.push({id:d.id,...d.data()}));
      splitFeedback(book,list);render();
    },e=>console.warn("Atualização de feedback indisponível:",e));
  }

  const roots=book=>(cCache[book]||[]).filter(x=>!x.parentId&&x.kind!=="reply"&&x.kind!=="reaction");
  const replies=(book,id)=>(cCache[book]||[]).filter(x=>x.parentId===id||x.rootId===id).sort((a,b)=>(a.at||0)-(b.at||0));
  function findItem(book,id){return (cCache[book]||[]).find(x=>x.id===id);}

  async function addRoot(book,ch,i,key,quote,text){
    const now=Date.now(),entry={kind:"comment",bookId:book,chapter:ch,paraIdx:i,paragraphKey:key,quote,author:name()||"Anônimo",authorId:uid(),role:admin()?"admin":"reader",text,status:"open",adminSeen:admin(),at:now,updatedAt:now};
    await db.collection("comments").add(entry);
  }
  async function reply(root,text){
    const now=Date.now();
    await db.collection("comments").add({kind:"reply",parentId:root.id,rootId:root.id,bookId:root.bookId,chapter:root.chapter,paraIdx:root.paraIdx,paragraphKey:root.paragraphKey||null,quote:root.quote||"",author:name()||"Anônimo",authorId:uid(),role:admin()?"admin":"reader",text,at:now,updatedAt:now});
    await db.collection("comments").doc(root.id).set({updatedAt:now,status:"open",adminSeen:admin()},{merge:true});
  }
  async function edit(x){
    if(!own(x))return;const v=prompt("Editar:",x.text||"");if(v===null||!v.trim())return;
    await db.collection("comments").doc(x.id).set({text:v.trim(),editedAt:Date.now(),updatedAt:Date.now(),...(admin()?{}:{adminSeen:false})},{merge:true});
    if(x.parentId&&!admin())await db.collection("comments").doc(x.parentId).set({adminSeen:false,updatedAt:Date.now()},{merge:true});
  }
  async function del(x){
    if(!own(x)||!confirm(x.parentId?"Apagar esta resposta?":"Apagar este comentário e as respostas?"))return;
    if(x.parentId)return db.collection("comments").doc(x.id).delete();
    const s=await db.collection("comments").where("parentId","==",x.id).get(),b=db.batch();s.forEach(d=>b.delete(d.ref));b.delete(db.collection("comments").doc(x.id));await b.commit();
  }
  async function resolve(x,on){if(admin())await db.collection("comments").doc(x.id).set({status:on?"resolved":"open",adminSeen:true,updatedAt:Date.now()},{merge:true});}
  async function seen(x){if(admin()&&!x.adminSeen)await db.collection("comments").doc(x.id).set({adminSeen:true},{merge:true});}
  async function unseen(x){if(admin()&&x.adminSeen)await db.collection("comments").doc(x.id).set({adminSeen:false},{merge:true});}
  async function markAllSeen(items,seenValue){
    if(!admin()||!items?.length)return;
    const batch=db.batch();
    items.forEach(x=>{if(!!x.adminSeen!==seenValue)batch.set(db.collection("comments").doc(x.id),{adminSeen:seenValue},{merge:true});});
    await batch.commit();
  }

  async function react(book,ch,i,key,quote,emoji){
    const mine=(rCache[book]||[]).find(x=>x.authorId===uid()&&loc(x,ch,i,key));
    if(mine&&mine.emoji===emoji)return db.collection("comments").doc(mine.id).delete();
    const p={kind:"reaction",bookId:book,chapter:ch,paraIdx:i,paragraphKey:key,quote,author:name()||"Anônimo",authorId:uid(),emoji,updatedAt:Date.now(),at:mine?.at||Date.now()};
    if(mine)await db.collection("comments").doc(mine.id).set(p,{merge:true});else await db.collection("comments").add(p);
  }

  function thread(root,book){
    const reps=replies(book,root.id);
    const acts=[];
    if(own(root)){acts.push('<button data-act="edit" data-id="'+root.id+'">Editar</button>','<button data-act="del" data-id="'+root.id+'">Apagar</button>');}
    if(admin()){acts.push('<button data-act="resolve" data-id="'+root.id+'">'+(root.status==="resolved"?"Reabrir":"Resolver")+'</button>');if(!root.adminSeen)acts.push('<button data-act="seen" data-id="'+root.id+'">Marcar lido</button>');}
    const rh=reps.map(r=>'<div class="feedback-reply '+(r.role==="admin"?"by-admin":"")+'"><div class="feedback-meta"><strong>'+esc(r.role==="admin"?"Autor":r.author)+'</strong><span>'+when(r.at)+'</span>'+(own(r)?'<span class="feedback-mini-actions"><button data-act="edit" data-id="'+r.id+'">Editar</button><button data-act="del" data-id="'+r.id+'">Apagar</button></span>':"")+'</div><div class="feedback-text">'+esc(r.text)+'</div></div>').join("");
    return '<div class="feedback-thread" data-thread-id="'+root.id+'"><div class="feedback-meta"><strong>'+esc(root.author)+'</strong><span>'+when(root.at)+'</span>'+(!root.adminSeen&&admin()?'<span class="feedback-status new">Novo</span>':"")+(root.status==="resolved"?'<span class="feedback-status resolved">Resolvido</span>':"")+'</div><div class="feedback-text">'+esc(root.text)+'</div>'+(acts.length?'<div class="feedback-actions">'+acts.join("")+'</div>':"")+(rh?'<div class="feedback-replies">'+rh+'</div>':"")+'<form class="feedback-reply-form" data-root="'+root.id+'"><input maxlength="500" placeholder="Responder…" required><button>Responder</button></form></div>';
  }

  function wireThreads(el,book){
    el.querySelectorAll("[data-act]").forEach(b=>b.onclick=async()=>{
      const x=findItem(book,b.dataset.id);if(!x)return;
      if(b.dataset.act==="edit")await edit(x); if(b.dataset.act==="del")await del(x); if(b.dataset.act==="resolve")await resolve(x,x.status!=="resolved"); if(b.dataset.act==="seen")await seen(x);
    });
    el.querySelectorAll(".feedback-reply-form").forEach(f=>f.onsubmit=async e=>{e.preventDefault();const x=findItem(book,f.dataset.root),inp=f.querySelector("input");if(x&&inp.value.trim()){await reply(x,inp.value.trim());inp.value="";}});
  }

  function render(){
    if(!active)return;
    const {bookId:book,chapterN:ch,containerEl,notesEl}=active, rr=roots(book), reactions=rCache[book]||[];
    const general=rr.filter(x=>x.chapter===ch&&Number(x.paraIdx)===-1&&rootVisible(x));
    if(notesEl){notesEl.hidden=!general.length;notesEl.innerHTML=general.length?'<div class="chapter-note-label">Notas do capítulo</div>'+general.map(x=>thread(x,book)).join(""):"";if(general.length)wireThreads(notesEl,book);}
    containerEl.querySelectorAll(".para-block").forEach(block=>{
      const i=Number(block.dataset.paraIdx),info=pInfo(block);block.dataset.paragraphKey=info.key;
      const vr=rr.filter(x=>loc(x,ch,i,info.key)&&rootVisible(x)), rx=reactions.filter(x=>loc(x,ch,i,info.key)), mine=rx.find(x=>x.authorId===uid());
      let a=block.querySelector(".para-actions"),panel=block.querySelector(".comment-panel");
      if(!a){
        a=document.createElement("div");a.className="para-actions";a.innerHTML='<button class="comment-toggle" title="Comentários"><svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M4 4h16v12H7l-3 3V4z"/></svg><span class="comment-count" hidden></span></button><button class="reaction-toggle" title="Reagir"><span class="reaction-face">☺</span></button><div class="reaction-summary"></div><div class="reaction-picker" hidden></div>';block.appendChild(a);
        panel=document.createElement("div");panel.className="comment-panel";panel.hidden=true;panel.innerHTML='<div class="comment-list"></div><form class="comment-form"><input maxlength="500" placeholder="Escreva um comentário…" required><button>Enviar</button></form>';block.appendChild(panel);
        a.querySelector(".comment-toggle").onclick=()=>{panel.hidden=!panel.hidden;if(!panel.hidden&&admin())vr.forEach(seen);};
        a.querySelector(".reaction-toggle").onclick=()=>{const p=a.querySelector(".reaction-picker");p.hidden=!p.hidden;};
        panel.querySelector(".comment-form").onsubmit=async e=>{e.preventDefault();const inp=e.currentTarget.querySelector("input");if(inp.value.trim()){await addRoot(book,ch,i,info.key,info.quote,inp.value.trim());inp.value="";}};
      }
      a=block.querySelector(".para-actions");panel=block.querySelector(".comment-panel");
      const cnt=a.querySelector(".comment-count");cnt.hidden=!vr.length;if(vr.length)cnt.textContent=vr.length;
      a.querySelector(".reaction-face").textContent=mine?.emoji||"☺";
      const counts={};rx.forEach(x=>counts[x.emoji]=(counts[x.emoji]||0)+1);
      a.querySelector(".reaction-summary").innerHTML=EMOJIS.filter(e=>counts[e]).map(e=>'<span class="reaction-count '+(mine?.emoji===e?"mine":"")+'">'+e+' '+counts[e]+'</span>').join("");
      const pick=a.querySelector(".reaction-picker");pick.innerHTML=EMOJIS.map(e=>'<button type="button" data-e="'+e+'" class="'+(mine?.emoji===e?"selected":"")+'">'+e+'</button>').join("");pick.querySelectorAll("button").forEach(b=>b.onclick=async()=>{pick.hidden=true;await react(book,ch,i,info.key,info.quote,b.dataset.e);});
      const list=panel.querySelector(".comment-list");list.innerHTML=vr.length?vr.sort((a,b)=>(a.at||0)-(b.at||0)).map(x=>thread(x,book)).join(""):'<p class="comment-empty">Nenhum comentário ainda.</p>';wireThreads(panel,book);
    });
  }

  async function attachChapter(bookId,chapterN,containerEl,notesEl){
    if(!enabled)return;active={bookId,chapterN,containerEl,notesEl};
    try{const d=await db.collection("config").doc("settings").get();showAll=d.exists&&!!d.data().showAllComments;}catch(e){}
    await load(bookId);subscribe(bookId);render();
  }

  return {
    init,attachChapter,isEnabled:()=>enabled,isAdmin:admin,getUserName:name,getUserId:uid,getAccessCode:accessCode,
    loginWithCode,ensureAccessProfile,hashText,
    getDb:()=>db,getCachedComments:book=>(cCache[book]||[]),reply,edit,del,resolve,seen,unseen,markAllSeen,
    sendAnnouncement,getAllowedBooks,listReaderProfiles,setAllowedBooks,deleteReaderProfile
  };
})();
window.Comments=Comments;
document.addEventListener("DOMContentLoaded",()=>Comments.init());
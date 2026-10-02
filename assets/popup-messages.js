// Mensagens popup segmentadas por leitor + modelos reutilizáveis
(() => {
  'use strict';

  const MESSAGE_COLLECTION = 'popupMessages';
  const TEMPLATE_COLLECTION = 'popupTemplates';
  const PROFILE_ID_KEY = 'jesed:readerCodeHash';
  let adminTab = 'messages';
  let adminCache = {messages:[], templates:[], profiles:[]};

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = s => String(s || '').replace(/\s+/g,' ').trim().toLowerCase();
  const when = t => t ? new Date(t).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
  const shortId = id => {
    const v=String(id||'').replace(/[^a-z0-9]/gi,'').toUpperCase();
    return v ? v.slice(-6) : 'LEGADO';
  };
  const db = () => window.Comments?.getDb?.();
  const isAdmin = () => !!window.Comments?.isAdmin?.();
  const profileId = () => localStorage.getItem(PROFILE_ID_KEY) || '';

  function statusOf(m){
    if(m.readAt) return 'read';
    if(m.shownAt) return 'shown';
    return 'pending';
  }
  function statusLabel(m){
    const s=statusOf(m);
    return s==='read' ? 'Lida' : s==='shown' ? 'Disparada' : 'Pendente';
  }
  function statusClass(m){ return 'popup-status ' + statusOf(m); }

  async function listMessages(){
    if(!db() || !isAdmin()) return [];
    const snap=await db().collection(MESSAGE_COLLECTION).get();
    const out=[];snap.forEach(d=>out.push({id:d.id,...d.data()}));
    return out.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  }

  async function listTemplates(){
    if(!db() || !isAdmin()) return [];
    const snap=await db().collection(TEMPLATE_COLLECTION).get();
    const out=[];snap.forEach(d=>out.push({id:d.id,...d.data()}));
    return out.sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));
  }

  async function sendToProfile(profile, payload={}){
    if(!db() || !isAdmin()) throw new Error('Apenas o administrador pode enviar popups.');
    if(!profile?.id || !profile?.readerId) throw new Error('Perfil de leitor inválido.');
    const text=String(payload.text||'').trim();
    if(!text) throw new Error('Escreva a mensagem.');
    const now=Date.now();
    return db().collection(MESSAGE_COLLECTION).add({
      recipientProfileId:String(profile.id),
      recipientReaderId:String(profile.readerId),
      recipientName:String(profile.name||'Leitor'),
      title:String(payload.title||'Recado do autor').trim() || 'Recado do autor',
      text,
      templateId:payload.templateId||null,
      templateTitle:payload.templateTitle||null,
      source:payload.source||'individual',
      broadcastId:payload.broadcastId||null,
      createdAt:now,
      updatedAt:now,
      shownAt:null,
      readAt:null,
      authorId:window.firebase?.auth?.()?.currentUser?.uid||null
    });
  }

  async function broadcast(payload={}){
    if(!isAdmin()) throw new Error('Apenas o administrador pode enviar popups.');
    const profiles=await window.Comments?.listReaderProfiles?.() || [];
    if(!profiles.length) throw new Error('Nenhum leitor atual para receber a mensagem.');
    const text=String(payload.text||'').trim();
    if(!text) throw new Error('Escreva a mensagem.');
    const broadcastId='broadcast_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
    const now=Date.now();
    for(let i=0;i<profiles.length;i+=350){
      const batch=db().batch();
      profiles.slice(i,i+350).forEach(profile=>{
        const ref=db().collection(MESSAGE_COLLECTION).doc();
        batch.set(ref,{
          recipientProfileId:String(profile.id),
          recipientReaderId:String(profile.readerId),
          recipientName:String(profile.name||'Leitor'),
          title:String(payload.title||'Recado do autor').trim() || 'Recado do autor',
          text,
          templateId:payload.templateId||null,
          templateTitle:payload.templateTitle||null,
          source:'broadcast',
          broadcastId,
          createdAt:now,
          updatedAt:now,
          shownAt:null,
          readAt:null,
          authorId:window.firebase?.auth?.()?.currentUser?.uid||null
        });
      });
      await batch.commit();
    }
    return {count:profiles.length,broadcastId};
  }

  async function updatePendingMessage(id, patch={}){
    if(!db() || !isAdmin()) throw new Error('Apenas o administrador pode editar popups.');
    const ref=db().collection(MESSAGE_COLLECTION).doc(id);
    const snap=await ref.get();
    if(!snap.exists) throw new Error('Mensagem não encontrada.');
    const current=snap.data()||{};
    if(current.shownAt || current.readAt) throw new Error('Essa mensagem já foi disparada e não pode mais ser editada.');
    const update={updatedAt:Date.now()};
    if(patch.title!==undefined) update.title=String(patch.title||'').trim()||'Recado do autor';
    if(patch.text!==undefined){
      const text=String(patch.text||'').trim();
      if(!text) throw new Error('A mensagem não pode ficar vazia.');
      update.text=text;
    }
    await ref.set(update,{merge:true});
  }

  async function deletePendingMessage(id){
    if(!db() || !isAdmin()) throw new Error('Apenas o administrador pode apagar popups.');
    const ref=db().collection(MESSAGE_COLLECTION).doc(id);
    const snap=await ref.get();
    if(!snap.exists) return;
    const current=snap.data()||{};
    if(current.shownAt || current.readAt) throw new Error('Essa mensagem já foi disparada e fica preservada no histórico.');
    await ref.delete();
  }

  async function saveTemplate(template){
    if(!db() || !isAdmin()) throw new Error('Apenas o administrador pode gerir modelos.');
    const title=String(template?.title||'').trim();
    const text=String(template?.text||'').trim();
    if(!title || !text) throw new Error('Preencha nome e mensagem do modelo.');
    const now=Date.now();
    if(template.id){
      await db().collection(TEMPLATE_COLLECTION).doc(template.id).set({title,text,updatedAt:now},{merge:true});
      return template.id;
    }
    const ref=await db().collection(TEMPLATE_COLLECTION).add({title,text,createdAt:now,updatedAt:now});
    return ref.id;
  }

  async function deleteTemplate(id){
    if(!db() || !isAdmin()) throw new Error('Apenas o administrador pode apagar modelos.');
    await db().collection(TEMPLATE_COLLECTION).doc(id).delete();
  }

  function ensureReaderSheet(){
    if(document.getElementById('targetedPopupSheet')) return;
    const el=document.createElement('div');
    el.id='targetedPopupSheet';
    el.className='sheet';
    el.hidden=true;
    el.innerHTML='<div class="sheet-card popup-reader-card">'
      +'<h2>Recado do autor</h2>'
      +'<div id="targetedPopupList" class="announce-list"></div>'
      +'<div class="sheet-actions"><button id="targetedPopupOk" class="btn-primary" type="button">Entendi</button></div>'
      +'</div>';
    document.body.appendChild(el);
    el.querySelector('#targetedPopupOk').addEventListener('click',async()=>{
      const ids=(el.dataset.ids||'').split(',').filter(Boolean);
      const now=Date.now();
      try{
        for(let i=0;i<ids.length;i+=350){
          const batch=db().batch();
          ids.slice(i,i+350).forEach(id=>batch.set(db().collection(MESSAGE_COLLECTION).doc(id),{readAt:now,updatedAt:now},{merge:true}));
          await batch.commit();
        }
      }catch(e){ console.warn('Não foi possível confirmar leitura dos popups:',e); }
      el.hidden=true;
    });
  }

  async function checkReaderMessages(){
    if(!db() || isAdmin()) return;
    const pid=profileId();
    if(!pid) return;
    try{
      const snap=await db().collection(MESSAGE_COLLECTION).where('recipientProfileId','==',pid).get();
      const items=[];snap.forEach(d=>items.push({id:d.id,...d.data()}));
      const pending=items.filter(x=>!x.readAt).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
      if(!pending.length) return;

      const now=Date.now();
      const notShown=pending.filter(x=>!x.shownAt);
      for(let i=0;i<notShown.length;i+=350){
        const batch=db().batch();
        notShown.slice(i,i+350).forEach(m=>batch.set(db().collection(MESSAGE_COLLECTION).doc(m.id),{shownAt:now,updatedAt:now},{merge:true}));
        await batch.commit();
      }

      ensureReaderSheet();
      const el=document.getElementById('targetedPopupSheet');
      el.dataset.ids=pending.map(x=>x.id).join(',');
      el.querySelector('#targetedPopupList').innerHTML=pending.map(m=>
        '<div class="announce-item popup-reader-message">'
          +'<strong>'+esc(m.title||'Recado do autor')+'</strong>'
          +'<p>'+esc(m.text||'').replace(/\n/g,'<br>')+'</p>'
          +'<span class="announce-when">'+when(m.createdAt)+'</span>'
        +'</div>'
      ).join('');
      el.hidden=false;
    }catch(e){
      console.warn('Não foi possível carregar mensagens popup:',e);
    }
  }

  function ensureAdminSheet(){
    if(document.getElementById('popupAdminSheet')) return;
    const el=document.createElement('div');
    el.id='popupAdminSheet';
    el.className='admin-dashboard-sheet';
    el.hidden=true;
    el.innerHTML='<section class="admin-dashboard popup-admin-dashboard">'
      +'<header class="admin-dashboard-head"><div><h2>Mensagens popup</h2><p>Envios individuais, gerais, modelos e confirmações de leitura.</p></div><button id="popupAdminClose" class="icon-btn" type="button">✕</button></header>'
      +'<nav class="popup-admin-tabs"><button type="button" data-popup-tab="messages" class="active">Mensagens</button><button type="button" data-popup-tab="templates">Modelos</button></nav>'
      +'<div class="popup-admin-tools"><button id="popupBroadcastBtn" class="btn-primary" type="button">Enviar para todos os leitores atuais</button><button id="popupNewTemplateBtn" class="btn-ghost" type="button">Novo modelo</button></div>'
      +'<div id="popupMessageFilters" class="admin-dashboard-filters"><select id="popupStatusFilter"><option value="all">Todos os estados</option><option value="pending">Pendentes</option><option value="shown">Disparadas</option><option value="read">Lidas</option></select><input id="popupSearch" type="search" placeholder="Buscar leitor ou mensagem…"></div>'
      +'<div id="popupAdminList" class="admin-dashboard-list"></div>'
      +'</section>';
    document.body.appendChild(el);
    el.querySelector('#popupAdminClose').onclick=()=>{el.hidden=true;};
    el.onclick=e=>{if(e.target===el)el.hidden=true;};
    el.querySelectorAll('[data-popup-tab]').forEach(btn=>btn.onclick=()=>{adminTab=btn.dataset.popupTab;renderAdmin();});
    el.querySelector('#popupBroadcastBtn').onclick=()=>openCompose(null);
    el.querySelector('#popupNewTemplateBtn').onclick=()=>openTemplateEditor(null);
    el.querySelector('#popupStatusFilter').onchange=renderAdmin;
    el.querySelector('#popupSearch').oninput=renderAdmin;
  }

  async function refreshAdminCache(){
    const [messages,templates,profiles]=await Promise.all([
      listMessages(),
      listTemplates(),
      window.Comments?.listReaderProfiles?.()||[]
    ]);
    adminCache={messages,templates,profiles};
  }

  async function openAdmin(){
    if(!isAdmin()) return;
    ensureAdminSheet();
    const sheet=document.getElementById('popupAdminSheet');
    sheet.hidden=false;
    sheet.querySelector('#popupAdminList').innerHTML='<p class="admin-empty">Carregando…</p>';
    try{ await refreshAdminCache(); renderAdmin(); }
    catch(e){ sheet.querySelector('#popupAdminList').innerHTML='<p class="admin-empty">Não foi possível carregar as mensagens.</p>'; }
  }

  function renderAdmin(){
    ensureAdminSheet();
    const sheet=document.getElementById('popupAdminSheet');
    if(sheet.hidden) return;
    sheet.querySelectorAll('[data-popup-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.popupTab===adminTab));
    sheet.querySelector('#popupMessageFilters').hidden=adminTab!=='messages';
    const list=sheet.querySelector('#popupAdminList');
    if(adminTab==='templates'){
      renderTemplates(list);
      return;
    }
    renderMessages(list);
  }

  function renderMessages(list){
    const status=document.getElementById('popupStatusFilter')?.value||'all';
    const q=norm(document.getElementById('popupSearch')?.value||'');
    const items=adminCache.messages.filter(m=>{
      if(status!=='all' && statusOf(m)!==status) return false;
      if(q && !norm((m.recipientName||'')+' '+(m.title||'')+' '+(m.text||'')).includes(q)) return false;
      return true;
    });
    if(!items.length){list.innerHTML='<p class="admin-empty">Nenhuma mensagem neste filtro.</p>';return;}
    list.innerHTML=items.map(m=>{
      const pending=statusOf(m)==='pending';
      const origin=m.source==='broadcast'?'Envio geral':m.templateId?'Modelo: '+(m.templateTitle||'sem nome'):'Envio individual';
      return '<article class="admin-comment-card popup-message-card">'
        +'<div class="admin-card-top"><div><strong>'+esc(m.recipientName||'Leitor')+' · #'+shortId(m.recipientReaderId)+'</strong><span>'+esc(origin)+' · '+when(m.createdAt)+'</span></div><span class="'+statusClass(m)+'">'+statusLabel(m)+'</span></div>'
        +'<h3>'+esc(m.title||'Recado do autor')+'</h3>'
        +'<div class="admin-root-text popup-message-text">'+esc(m.text||'')+'</div>'
        +'<div class="popup-message-times">'+(m.shownAt?'<span>Disparada: '+when(m.shownAt)+'</span>':'<span>Aguardando o leitor abrir o app</span>')+(m.readAt?'<span>Lida: '+when(m.readAt)+'</span>':'')+'</div>'
        +(pending?'<div class="admin-card-actions"><button data-popup-edit="'+m.id+'">Editar</button><button data-popup-delete="'+m.id+'">Apagar</button></div>':'')
        +'</article>';
    }).join('');
    list.querySelectorAll('[data-popup-edit]').forEach(btn=>btn.onclick=()=>editMessage(btn.dataset.popupEdit));
    list.querySelectorAll('[data-popup-delete]').forEach(btn=>btn.onclick=()=>removeMessage(btn.dataset.popupDelete));
  }

  function renderTemplates(list){
    if(!adminCache.templates.length){list.innerHTML='<p class="admin-empty">Nenhum modelo ainda. Crie mensagens prontas para disparar quando quiser.</p>';return;}
    list.innerHTML=adminCache.templates.map(t=>{
      const msgs=adminCache.messages.filter(m=>m.templateId===t.id);
      const pending=msgs.filter(m=>statusOf(m)==='pending').length;
      const shown=msgs.filter(m=>statusOf(m)==='shown').length;
      const read=msgs.filter(m=>statusOf(m)==='read').length;
      return '<article class="admin-comment-card popup-template-card">'
        +'<div class="admin-card-top"><div><strong>'+esc(t.title)+'</strong><span>Enviada a '+msgs.length+' · Pendente '+pending+' · Disparada '+shown+' · Lida '+read+'</span></div></div>'
        +'<div class="admin-root-text popup-message-text">'+esc(t.text||'')+'</div>'
        +'<div class="admin-card-actions"><button data-template-broadcast="'+t.id+'">Enviar para todos atuais</button><button data-template-edit="'+t.id+'">Editar modelo</button><button data-template-delete="'+t.id+'">Apagar modelo</button></div>'
        +'</article>';
    }).join('');
    list.querySelectorAll('[data-template-broadcast]').forEach(btn=>{
      btn.onclick=()=>{
        const t=adminCache.templates.find(x=>x.id===btn.dataset.templateBroadcast);
        openCompose(null,t?.id);
      };
    });
    list.querySelectorAll('[data-template-edit]').forEach(btn=>{
      const t=adminCache.templates.find(x=>x.id===btn.dataset.templateEdit);
      btn.onclick=()=>openTemplateEditor(t);
    });
    list.querySelectorAll('[data-template-delete]').forEach(btn=>btn.onclick=async()=>{
      const t=adminCache.templates.find(x=>x.id===btn.dataset.templateDelete);
      if(!t || !confirm('Apagar o modelo "'+t.title+'"?\n\nAs mensagens já enviadas continuam no histórico.')) return;
      try{await deleteTemplate(t.id);await refreshAdminCache();renderAdmin();}
      catch(e){alert(e.message||'Não foi possível apagar o modelo.');}
    });
  }

  async function editMessage(id){
    const m=adminCache.messages.find(x=>x.id===id);
    if(!m) return;
    const text=prompt('Editar popup de '+(m.recipientName||'leitor')+':',m.text||'');
    if(text===null) return;
    try{
      await updatePendingMessage(id,{text});
      await refreshAdminCache();renderAdmin();
    }catch(e){alert(e.message||'Não foi possível editar.');}
  }

  async function removeMessage(id){
    const m=adminCache.messages.find(x=>x.id===id);
    if(!m || !confirm('Apagar este popup antes de ele ser disparado para '+(m.recipientName||'o leitor')+'?')) return;
    try{await deletePendingMessage(id);await refreshAdminCache();renderAdmin();}
    catch(e){alert(e.message||'Não foi possível apagar.');}
  }

  function ensureComposeSheet(){
    if(document.getElementById('popupComposeSheet')) return;
    const el=document.createElement('div');
    el.id='popupComposeSheet';
    el.className='admin-dashboard-sheet';
    el.hidden=true;
    el.innerHTML='<section class="admin-dashboard popup-compose-dashboard">'
      +'<header class="admin-dashboard-head"><div><h2 id="popupComposeHeading">Enviar popup</h2><p id="popupComposeSub"></p></div><button id="popupComposeClose" class="icon-btn" type="button">✕</button></header>'
      +'<div class="popup-compose-form">'
      +'<label class="field"><span>Usar modelo</span><select id="popupComposeTemplate"><option value="">Mensagem personalizada</option></select></label>'
      +'<p id="popupTemplateStatus" class="popup-template-status"></p>'
      +'<label class="field"><span>Título</span><input id="popupComposeTitle" type="text" maxlength="80" value="Recado do autor"></label>'
      +'<label class="field"><span>Mensagem</span><textarea id="popupComposeText" rows="8" maxlength="2000" placeholder="Escreva o recado…"></textarea></label>'
      +'<div class="popup-compose-note" id="popupComposeNote"></div>'
      +'<div class="sheet-actions"><button id="popupComposeSend" class="btn-primary" type="button">Enviar popup</button><button id="popupComposeCancel" class="btn-ghost" type="button">Cancelar</button></div>'
      +'</div></section>';
    document.body.appendChild(el);
    el.querySelector('#popupComposeClose').onclick=()=>{el.hidden=true;};
    el.querySelector('#popupComposeCancel').onclick=()=>{el.hidden=true;};
    el.onclick=e=>{if(e.target===el)el.hidden=true;};
    el.querySelector('#popupComposeTemplate').onchange=()=>{
      const template=adminCache.templates.find(t=>t.id===el.querySelector('#popupComposeTemplate').value);
      if(template){
        el.querySelector('#popupComposeTitle').value=template.title;
        el.querySelector('#popupComposeText').value=template.text;
      }
      updateComposeTemplateStatus();
    };
    el.querySelector('#popupComposeSend').onclick=submitCompose;
  }

  async function openCompose(profile, presetTemplateId=''){
    if(!isAdmin()) return;
    try{await refreshAdminCache();}catch(e){}
    ensureComposeSheet();
    const el=document.getElementById('popupComposeSheet');
    el.dataset.profileId=profile?.id||'';
    el.querySelector('#popupComposeHeading').textContent=profile?'Popup para '+(profile.name||'leitor'):'Popup para todos';
    el.querySelector('#popupComposeSub').textContent=profile
      ? 'A mensagem ficará pendente até este leitor abrir o app.'
      : 'Será criada uma cópia individual para cada leitor atual. Usuários criados depois não receberão.';
    el.querySelector('#popupComposeNote').textContent=profile
      ? 'Você pode editar ou apagar enquanto estiver Pendente.'
      : 'Depois do envio, cada cópia pode ser editada ou apagada separadamente enquanto ainda estiver Pendente.';
    const select=el.querySelector('#popupComposeTemplate');
    select.innerHTML='<option value="">Mensagem personalizada</option>'+adminCache.templates.map(t=>{
      let suffix='';
      if(profile){
        const msgs=adminCache.messages.filter(m=>m.templateId===t.id&&m.recipientProfileId===profile.id).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
        if(msgs[0]) suffix=' · '+statusLabel(msgs[0]);
        else suffix=' · Nunca enviada';
      }
      return '<option value="'+esc(t.id)+'">'+esc(t.title+suffix)+'</option>';
    }).join('');
    select.value=presetTemplateId&&adminCache.templates.some(t=>t.id===presetTemplateId)?presetTemplateId:'';
    const preset=adminCache.templates.find(t=>t.id===select.value);
    el.querySelector('#popupComposeTitle').value=preset?.title||'Recado do autor';
    el.querySelector('#popupComposeText').value=preset?.text||'';
    updateComposeTemplateStatus();
    el.hidden=false;
    setTimeout(()=>el.querySelector('#popupComposeText').focus(),0);
  }

  function updateComposeTemplateStatus(){
    const el=document.getElementById('popupComposeSheet');
    if(!el) return;
    const tid=el.querySelector('#popupComposeTemplate').value;
    const out=el.querySelector('#popupTemplateStatus');
    if(!tid){out.textContent='';return;}
    const profile=adminCache.profiles.find(p=>p.id===el.dataset.profileId);
    const template=adminCache.templates.find(t=>t.id===tid);
    if(!template){out.textContent='';return;}
    if(profile){
      const msgs=adminCache.messages.filter(m=>m.templateId===tid&&m.recipientProfileId===profile.id).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      if(!msgs.length) out.textContent='Este modelo ainda não foi disparado para '+profile.name+'.';
      else{
        const m=msgs[0];
        out.textContent='Último envio para '+profile.name+': '+statusLabel(m)+(m.readAt?' em '+when(m.readAt):m.shownAt?' em '+when(m.shownAt):'.');
      }
    }else{
      const msgs=adminCache.messages.filter(m=>m.templateId===tid);
      const read=msgs.filter(m=>m.readAt).length;
      const shown=msgs.filter(m=>m.shownAt&&!m.readAt).length;
      const pending=msgs.filter(m=>!m.shownAt).length;
      out.textContent='Histórico deste modelo: '+msgs.length+' envios · '+pending+' pendentes · '+shown+' disparados · '+read+' lidos.';
    }
  }

  async function submitCompose(){
    const el=document.getElementById('popupComposeSheet');
    const send=el.querySelector('#popupComposeSend');
    const text=el.querySelector('#popupComposeText').value.trim();
    const title=el.querySelector('#popupComposeTitle').value.trim()||'Recado do autor';
    const template=adminCache.templates.find(t=>t.id===el.querySelector('#popupComposeTemplate').value);
    if(!text){el.querySelector('#popupComposeText').focus();return;}
    const profile=adminCache.profiles.find(p=>p.id===el.dataset.profileId);
    send.disabled=true;
    send.textContent='Enviando…';
    try{
      if(profile){
        await sendToProfile(profile,{title,text,templateId:template?.id||null,templateTitle:template?.title||null,source:template?'template':'individual'});
        alert('Popup preparado para '+profile.name+'.');
      }else{
        const result=await broadcast({title,text,templateId:template?.id||null,templateTitle:template?.title||null});
        alert('Popup preparado para '+result.count+' leitor(es) atuais.');
      }
      el.hidden=true;
      await refreshAdminCache();
      if(!document.getElementById('popupAdminSheet').hidden) renderAdmin();
    }catch(e){
      alert(e.message||'Não foi possível enviar.');
    }finally{
      send.disabled=false;
      send.textContent='Enviar popup';
    }
  }

  function ensureTemplateSheet(){
    if(document.getElementById('popupTemplateSheet')) return;
    const el=document.createElement('div');
    el.id='popupTemplateSheet';
    el.className='admin-dashboard-sheet';
    el.hidden=true;
    el.innerHTML='<section class="admin-dashboard popup-compose-dashboard">'
      +'<header class="admin-dashboard-head"><div><h2 id="popupTemplateHeading">Novo modelo</h2><p>Modelos ficam guardados para você disparar a qualquer leitor quando quiser.</p></div><button id="popupTemplateClose" class="icon-btn" type="button">✕</button></header>'
      +'<div class="popup-compose-form"><label class="field"><span>Nome do modelo</span><input id="popupTemplateTitle" type="text" maxlength="80"></label>'
      +'<label class="field"><span>Mensagem</span><textarea id="popupTemplateText" rows="10" maxlength="2000"></textarea></label>'
      +'<div class="sheet-actions"><button id="popupTemplateSave" class="btn-primary" type="button">Salvar modelo</button><button id="popupTemplateCancel" class="btn-ghost" type="button">Cancelar</button></div></div>'
      +'</section>';
    document.body.appendChild(el);
    el.querySelector('#popupTemplateClose').onclick=()=>{el.hidden=true;};
    el.querySelector('#popupTemplateCancel').onclick=()=>{el.hidden=true;};
    el.onclick=e=>{if(e.target===el)el.hidden=true;};
    el.querySelector('#popupTemplateSave').onclick=async()=>{
      const id=el.dataset.templateId||'';
      const title=el.querySelector('#popupTemplateTitle').value.trim();
      const text=el.querySelector('#popupTemplateText').value.trim();
      const btn=el.querySelector('#popupTemplateSave');
      btn.disabled=true;
      try{
        await saveTemplate({id:id||null,title,text});
        el.hidden=true;
        await refreshAdminCache();
        if(!document.getElementById('popupAdminSheet').hidden){adminTab='templates';renderAdmin();}
      }catch(e){alert(e.message||'Não foi possível salvar o modelo.');}
      finally{btn.disabled=false;}
    };
  }

  function openTemplateEditor(template){
    ensureTemplateSheet();
    const el=document.getElementById('popupTemplateSheet');
    el.dataset.templateId=template?.id||'';
    el.querySelector('#popupTemplateHeading').textContent=template?'Editar modelo':'Novo modelo';
    el.querySelector('#popupTemplateTitle').value=template?.title||'';
    el.querySelector('#popupTemplateText').value=template?.text||'';
    el.hidden=false;
    setTimeout(()=>el.querySelector('#popupTemplateTitle').focus(),0);
  }

  async function statusForTemplate(profileIdValue,templateId){
    if(!isAdmin()) return null;
    const messages=await listMessages();
    const latest=messages.filter(m=>m.recipientProfileId===profileIdValue&&m.templateId===templateId)
      .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];
    return latest?{status:statusOf(latest),label:statusLabel(latest),shownAt:latest.shownAt||null,readAt:latest.readAt||null}:null;
  }

  document.addEventListener('DOMContentLoaded',()=>{
    ensureReaderSheet();
    ensureAdminSheet();
    ensureComposeSheet();
    ensureTemplateSheet();
    setTimeout(checkReaderMessages,1100);
  });
  document.addEventListener('beta:profile-ready',()=>setTimeout(checkReaderMessages,700));
  document.addEventListener('beta:profile-login',()=>setTimeout(checkReaderMessages,700));
  document.addEventListener('beta:popup-admin',openAdmin);

  window.PopupMessages={
    openAdmin,openCompose,openTemplateEditor,refreshAdminCache,
    listMessages,listTemplates,sendToProfile,broadcast,
    updatePendingMessage,deletePendingMessage,saveTemplate,deleteTemplate,statusForTemplate
  };
})();
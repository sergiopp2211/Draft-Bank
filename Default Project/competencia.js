/* DRAFT BANK · Motor reutilizable de competiciones
   Cada página define window.DRAFT_COMP = { id, nombre, modo } antes de cargar este archivo.
   modo: 'liga'   → Primera / Segunda (todos contra todos, ida y vuelta, sin eliminatorias)
         'directo'→ Copa (eliminatoria directa a partido único, con equipos exentos/byes)
   Cada competición guarda sus propios datos en localStorage con claves separadas
   (draftbank_<id>_*) para que nunca se mezclen entre sí.
*/
(function(){
  "use strict";

  var COMP = window.DRAFT_COMP || { id:'comp', nombre:'Competición', modo:'liga' };
  var MODO = COMP.modo || 'liga';
  var PREFIX = 'draftbank_' + COMP.id + '_';
  var KEY_TEAMS = PREFIX + 'teams_v1';
  var KEY_LIVE  = PREFIX + 'live_v1';
  var KEY_PRED  = PREFIX + 'pred_v1';
  var KEY_TEXTS = PREFIX + 'texts_v1';
  var ADMIN_PASSWORD = 'cordoba2214';

  function notificar(msg){ if(window.mostrarNotificacion) window.mostrarNotificacion(msg); }
  function lsGet(key, def){ try{ var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : def; }catch(e){ return def; } }
  function lsSet(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }
  function escapeHtml(str){ return String(str==null?'':str).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function isCountryCode(flag){ return /^[A-Za-z]{2}$/.test(flag || ''); }
  function flagImgHtml(t, cls){
    if(!t) return '';
    if(typeof t === 'string') t = { flag: t };
    if(t.logo) return '<img class="'+cls+'" src="'+escapeHtml(t.logo)+'" alt="" loading="lazy">';
    var flag = t.flag;
    if(!flag) return '';
    if(isCountryCode(flag)) return '<img class="'+cls+'" src="https://flagcdn.com/w40/'+flag.toLowerCase()+'.png" alt="" crossorigin="anonymous">';
    return '<span class="flag-emoji">'+escapeHtml(flag)+'</span>';
  }
  function teamById(id){
    for(var i=0;i<teams.length;i++) if(teams[i].id === id) return teams[i];
    return null;
  }

  /* ---------------- DATOS ---------------- */
  var teams = lsGet(KEY_TEAMS, []);
  var live = lsGet(KEY_LIVE, { matches:{} });
  var pred = lsGet(KEY_PRED, { matches:{}, detail:true, koPick:false });
  if(!live.matches) live.matches = {};
  if(!pred.matches) pred.matches = {};

  var KEY_SETTINGS = PREFIX + 'settings_v1';
  var KEY_SQUADS = PREFIX + 'squads_v1';
  var KEY_PHOTOS = PREFIX + 'photos_v1';
  var KEY_STATS = PREFIX + 'stats_v1';
  var KEY_RULESNEWS = PREFIX + 'rulesnews_v1';
  var KEY_HALLFAME = 'draftbank_hallfame_v1';

  var compSettings = lsGet(KEY_SETTINGS, {});
  var squads = lsGet(KEY_SQUADS, {});
  var matchPhotos = lsGet(KEY_PHOTOS, {});
  var statsData = lsGet(KEY_STATS, { matches:{}, motm:{} });
  if(!statsData.matches) statsData.matches = {};
  if(!statsData.motm) statsData.motm = {};
  var rulesNews = lsGet(KEY_RULESNEWS, { rules:[], news:[] });
  if(!rulesNews.rules) rulesNews.rules = [];
  if(!rulesNews.news) rulesNews.news = [];
  var hallFameEntries = lsGet(KEY_HALLFAME, []);
  var ligaOrder = (compSettings.ligaOrder || []).slice();

  function saveSquads(){ lsSet(KEY_SQUADS, squads); SquadsStore.write(squads); }
  function savePhotos(){ lsSet(KEY_PHOTOS, matchPhotos); PhotosStore.write(matchPhotos); }
  function saveStats(){ lsSet(KEY_STATS, statsData); StatsStore.write(statsData); }
  function saveRulesNews(){ lsSet(KEY_RULESNEWS, rulesNews); RulesNewsStore.write(rulesNews); }
  function saveHallFame(){ lsSet(KEY_HALLFAME, hallFameEntries); HallFameStore.write(hallFameEntries); }

  function saveLive(){ lsSet(KEY_LIVE, live); LiveStore.write(live); }
  function savePred(){ lsSet(KEY_PRED, pred); }
  function saveTeams(){ lsSet(KEY_TEAMS, teams); TeamsStore.write(teams); }
  function clearAllScores(){
    live = { matches:{} };
    pred = { matches:{}, detail:(pred.detail!==undefined?pred.detail:true), koPick:(pred.koPick!==undefined?pred.koPick:false) };
    saveLive(); savePred();
  }

  /* ---------------- SINCRONIZACIÓN EN LA NUBE (Firebase) ----------------
     Mismo patrón que el Mundial: equipos, resultados, textos editables y el
     resto de datos se sincronizan en tu Realtime Database para que todos los
     dispositivos vean los mismos datos. "Mi Predicción" es personal (local).
     ------------------------------------------------------------------ */
  var CLOUD_ROOT = 'draftbank/' + COMP.id;
  var CLOUD_ENABLED = !!(window.firebase && window.DRAFT_FIREBASE && window.DRAFT_FIREBASE.databaseURL && window.DRAFT_FIREBASE.databaseURL.indexOf('PON_AQUI') === -1);
  var _fbApp = null, _fbDb = null;
  var cloudConnected = false;
  var cloudConnectTimer = null;

  function setCloudStatus(mode, text){
    var badge = document.getElementById('cloudStatus');
    var label = document.getElementById('cloudStatusText');
    if(badge) badge.className = 'cloud-status ' + mode;
    if(label) label.textContent = text;
  }
  function showCloudBanner(show){
    var b = document.getElementById('cloudBanner');
    if(b) b.classList.toggle('show', show);
  }

  function getFbDb(){
    if(!CLOUD_ENABLED) return null;
    try{
      if(!_fbApp){
        var existing = null;
        for(var i=0;i<window.firebase.apps.length;i++){
          if(window.firebase.apps[i].name === 'draftbank-'+COMP.id){ existing = window.firebase.apps[i]; break; }
        }
        _fbApp = existing || window.firebase.initializeApp(window.DRAFT_FIREBASE, 'draftbank-'+COMP.id);
      }
      if(!_fbDb) _fbDb = window.firebase.database(_fbApp);
      return _fbDb;
    }catch(err){
      console.error('No se pudo iniciar Firebase:', err);
      setCloudStatus('err', 'Error de configuración de Firebase');
      showCloudBanner(true);
      return null;
    }
  }

  function makeCloudStore(sub, localKey, root){
    var dbRef = null;
    var base = root || CLOUD_ROOT;
    return {
      init: function(onData){
        var db = getFbDb();
        if(!db){
          if(window.addEventListener){
            window.addEventListener('storage', function(e){
              if(e.key === localKey){
                try{ onData(e.newValue ? JSON.parse(e.newValue) : null); }catch(err){}
              }
            });
          }
          setCloudStatus('local', 'Guardado en este dispositivo');
          return;
        }
        try{
          dbRef = db.ref(base + '/' + sub);
          cloudConnectTimer = setTimeout(function(){
            if(!cloudConnected){ setCloudStatus('err', 'Sin respuesta de la nube'); showCloudBanner(true); }
          }, 7000);
          dbRef.on('value', function(snap){
            cloudConnected = true;
            if(cloudConnectTimer){ clearTimeout(cloudConnectTimer); cloudConnectTimer = null; }
            setCloudStatus('ok', 'Sincronizado en la nube');
            showCloudBanner(false);
            onData(snap.val());
          }, function(err){
            if(cloudConnectTimer){ clearTimeout(cloudConnectTimer); cloudConnectTimer = null; }
            console.error('Firebase error (' + sub + '):', err);
            setCloudStatus('err', 'Error de conexión con la nube');
            showCloudBanner(true);
          });
        }catch(err){
          console.error('No se pudo iniciar Firebase (' + sub + '):', err);
          setCloudStatus('err', 'Error de configuración de Firebase');
          showCloudBanner(true);
        }
      },
      write: function(data){
        var db = getFbDb();
        if(db && dbRef){
          dbRef.set(data).catch(function(err){
            console.error('Error guardando en la nube (' + sub + '):', err);
            if(window.mostrarNotificacion) window.mostrarNotificacion('⚠️ No se pudo sincronizar en la nube — revisa tu conexión');
          });
        }
      }
    };
  }

  function shuffle(arr){
    for(var i=arr.length-1;i>0;i--){
      var j = Math.floor(Math.random()*(i+1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  var TeamsStore = makeCloudStore('teams', KEY_TEAMS);
  var LiveStore  = makeCloudStore('live', KEY_LIVE);
  var TextsStore = makeCloudStore('customTexts', KEY_TEXTS);
  var SettingsStore = makeCloudStore('settings', PREFIX + 'settings_v1');
  var SquadsStore = makeCloudStore('squads', PREFIX + 'squads_v1');
  var PhotosStore = makeCloudStore('matchPhotos', PREFIX + 'photos_v1');
  var StatsStore  = makeCloudStore('stats', PREFIX + 'stats_v1');
  var RulesNewsStore = makeCloudStore('rulesnews', PREFIX + 'rulesnews_v1');
  var HallFameStore = makeCloudStore('entries', KEY_HALLFAME, 'draftbank/hallFame');

  function saveSettings(){
    compSettings.ligaOrder = ligaOrder;
    lsSet(KEY_SETTINGS, compSettings);
    SettingsStore.write(compSettings);
  }
  function applyRemoteSettings(data){
    if(!data || typeof data !== 'object') return;
    var orderChanged = JSON.stringify(data.ligaOrder || []) !== JSON.stringify(compSettings.ligaOrder || []);
    compSettings = data;
    lsSet(KEY_SETTINGS, compSettings);
    applyAccent();
    if(orderChanged){
      ligaOrder = (compSettings.ligaOrder || []).slice();
      rebuildAll();
    }
  }
  function applyRemoteSquads(data){
    if(!data || typeof data !== 'object') return;
    squads = data;
    lsSet(KEY_SQUADS, squads);
    renderSquadsTeamList();
    if(currentSquadTeam) renderSquadDetail(currentSquadTeam);
  }
  function applyRemotePhotos(data){
    if(!data || typeof data !== 'object') return;
    matchPhotos = data;
    lsSet(KEY_PHOTOS, matchPhotos);
    renderCalendar();
  }
  function applyRemoteStats(data){
    if(!data || typeof data !== 'object') return;
    statsData = { matches:(data.matches||{}), motm:(data.motm||{}) };
    lsSet(KEY_STATS, statsData);
    renderStatsLeaderboards();
  }
  function applyRemoteRulesNews(data){
    if(!data || typeof data !== 'object') return;
    rulesNews = data;
    lsSet(KEY_RULESNEWS, rulesNews);
    renderRulesNews();
  }
  function applyRemoteHallFame(data){
    if(!data || typeof data !== 'object') return;
    hallFameEntries = data;
    lsSet(KEY_HALLFAME, hallFameEntries);
    renderFame();
  }

  function applyRemoteTeams(data){
    if(!data || !Array.isArray(data)) return;
    var changed = JSON.stringify(data) !== JSON.stringify(teams);
    teams = data;
    lsSet(KEY_TEAMS, teams);
    if(changed){ rebuildAll(); renderTeamsGrid(); }
  }
  function applyRemoteLive(data){
    if(!data || !data.matches || typeof data.matches !== 'object') return;
    var changed = JSON.stringify(data.matches) !== JSON.stringify(live.matches);
    live.matches = data.matches;
    lsSet(KEY_LIVE, live);
    if(changed) rebuildAll();
  }
  function applyRemoteTexts(data){
    if(!data || typeof data !== 'object') return;
    var changed = JSON.stringify(data) !== JSON.stringify(customTexts);
    Object.keys(customTexts).forEach(function(k){ delete customTexts[k]; });
    Object.keys(data).forEach(function(k){ customTexts[k] = data[k]; });
    if(changed) applyCustomTexts();
  }

  function initCloudSync(){
    TeamsStore.init(applyRemoteTeams);
    LiveStore.init(applyRemoteLive);
    TextsStore.init(applyRemoteTexts);
    SettingsStore.init(applyRemoteSettings);
    SquadsStore.init(applyRemoteSquads);
    PhotosStore.init(applyRemotePhotos);
    StatsStore.init(applyRemoteStats);
    RulesNewsStore.init(applyRemoteRulesNews);
    HallFameStore.init(applyRemoteHallFame);
  }

  /* ---------------- EDICIÓN DE TEXTOS (como en el Mundial) ---------------- */
  var customTexts = lsGet(KEY_TEXTS, {});
  var textEditMode = false;
  var textsPushTimer = null;

  function applyCustomTexts(){
    document.querySelectorAll('[data-tkey]').forEach(function(el){
      var key = el.dataset.tkey;
      if(Object.prototype.hasOwnProperty.call(customTexts, key) && document.activeElement !== el){
        el.textContent = customTexts[key];
      }
    });
  }

  function scheduleTextsPush(){
    clearTimeout(textsPushTimer);
    textsPushTimer = setTimeout(function(){
      lsSet(KEY_TEXTS, customTexts);
      TextsStore.write(customTexts);
    }, 500);
  }

  function setTextEditMode(active){
    textEditMode = !!active && isAdmin;
    document.body.classList.toggle('text-edit-mode', textEditMode);
    document.querySelectorAll('[data-tkey]').forEach(function(el){
      el.contentEditable = textEditMode ? 'true' : 'false';
      el.spellcheck = false;
    });
    var btn = document.getElementById('editTextsBtn');
    if(btn) btn.textContent = textEditMode ? '✅ Terminar Edición' : '✏️ Editar Textos';
  }

  function setupTextEditing(){
    var btn = document.getElementById('editTextsBtn');
    if(!btn) return;
    btn.addEventListener('click', function(){
      setTextEditMode(!textEditMode);
      notificar(textEditMode
        ? '✏️ Modo edición activado: haz clic en cualquier texto resaltado para escribir el tuyo'
        : '✅ Edición de textos finalizada');
    });
    document.addEventListener('blur', function(e){
      if(!textEditMode) return;
      var el = e.target && e.target.closest ? e.target.closest('[data-tkey]') : null;
      if(!el) return;
      var key = el.dataset.tkey;
      var value = el.textContent.replace(/\s+/g,' ').trim();
      if(!value){
        el.textContent = Object.prototype.hasOwnProperty.call(customTexts, key) ? customTexts[key] : el.textContent;
        return;
      }
      if(customTexts[key] !== value){
        customTexts[key] = value;
        scheduleTextsPush();
      }
    }, true);
    document.addEventListener('keydown', function(e){
      if(!textEditMode) return;
      var el = e.target && e.target.closest ? e.target.closest('[data-tkey]') : null;
      if(!el) return;
      if(e.key === 'Enter'){ e.preventDefault(); el.blur(); }
      else if(e.key === 'Escape'){ el.blur(); }
    });
  }

  /* ---------------- TEMA DE COLOR (acento por competición + editor admin) ---------------- */
  var DEFAULT_ACCENT = window.DRAFT_ACCENT || '#d4af37';

  function hexToRgb(hex){
    var h = String(hex || '').replace('#','').trim();
    if(h.length === 3) h = h.split('').map(function(c){ return c+c; }).join('');
    if(!/^[0-9a-fA-F]{6}$/.test(h)) return { r:212, g:175, b:55 };
    var n = parseInt(h, 16);
    return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
  }
  function mixHex(hex, other, t){
    var a = hexToRgb(hex), b = hexToRgb(other);
    var r = Math.round(a.r+(b.r-a.r)*t), g = Math.round(a.g+(b.g-a.g)*t), bl = Math.round(a.b+(b.b-a.b)*t);
    return '#'+((1<<24)+(r<<16)+(g<<8)+bl).toString(16).slice(1);
  }
  function applyAccent(hex, persist){
    var accent = hex || compSettings.accent || DEFAULT_ACCENT;
    var rgb = hexToRgb(accent);
    var root = document.documentElement;
    if(root && root.style){
      root.style.setProperty('--gold', accent);
      root.style.setProperty('--gold-soft', mixHex(accent, '#ffffff', 0.45));
      root.style.setProperty('--gold-dim', mixHex(accent, '#000000', 0.5));
      root.style.setProperty('--panel-line', 'rgba('+rgb.r+','+rgb.g+','+rgb.b+',0.16)');
    }
    var input = document.getElementById('accentPreview');
    if(input && input.value !== accent) input.value = accent;
    if(persist && accent !== compSettings.accent){
      compSettings.accent = accent;
      lsSet(KEY_SETTINGS, compSettings);
      SettingsStore.write(compSettings);
    }
  }
  function setupColorSettings(){
    var btn = document.getElementById('colorSettingsBtn');
    if(!btn) return;
    btn.addEventListener('click', function(){
      var panel = document.getElementById('colorSettingsPanel');
      if(panel) panel.classList.toggle('show');
    });
    var input = document.getElementById('accentPreview');
    if(input){
      input.addEventListener('input', function(){ applyAccent(input.value, false); });
      input.addEventListener('change', function(){
        applyAccent(input.value, true);
        notificar('🎨 Color de acento actualizado en la nube');
      });
    }
  }

  function sortearJornadas(){
    if(!isAdmin){ notificar('🔒 Activa el Modo Administrador'); return; }
    if(teams.length < 2){ notificar('⚠️ Necesitas al menos 2 equipos'); return; }
    ligaOrder = shuffle(teams.map(function(t){ return t.id; }));
    saveSettings();
    clearAllScores();
    buildLigaRounds();
    rebuildAll();
    notificar('🔀 Jornadas sorteadas aleatoriamente');
  }
  function setupSorteo(){
    var btn = document.getElementById('sortearJornadasBtn');
    if(btn) btn.addEventListener('click', sortearJornadas);
  }

  /* ---------------- PLANTILLAS ---------------- */
  var currentSquadTeam = null;
  var editingPlayerId = null;
  var POSITIONS = ['POR','DEF','CM','DEL'];

  function squadPlayersOf(teamId){ return (squads[teamId] || []).slice(); }

  function renderSquadsTeamList(){
    var host = document.getElementById('squadsList');
    if(!host) return;
    if(!teams.length){
      host.innerHTML = '<div class="empty-state"><div class="es-icon">👥</div><div class="es-title">No hay equipos</div><p class="es-text">Crea equipos en la pestaña <strong>Equipos</strong> para empezar a formar plantillas.</p></div>';
      return;
    }
    host.innerHTML = '<div class="squads-grid">' + teams.map(function(t){
      var count = squadPlayersOf(t.id).length;
      return '<button type="button" class="squad-card" data-squad-team="'+t.id+'">' +
        '<span class="squad-card-flag">'+flagImgHtml(t,'flag-icon')+'</span>' +
        '<span class="squad-card-name">'+escapeHtml(t.name)+'</span>' +
        '<span class="squad-card-count">'+(count ? count+' jugadores' : 'Sin plantilla')+'</span>' +
      '</button>';
    }).join('') + '</div>';
  }

  function renderSquadDetail(teamId){
    currentSquadTeam = teamId;
    var host = document.getElementById('squadDetail');
    var list = document.getElementById('squadsList');
    if(!host) return;
    var t = teamById(teamId);
    if(!t) return;
    var pl = squadPlayersOf(teamId);
    var html = '<div class="sd-head">' +
      '<button type="button" class="sd-back" data-sd-back="1">← Equipos</button>' +
      '<div class="sd-title"><span class="lm-flag">'+flagImgHtml(t,'flag-icon')+'</span> Plantilla de '+escapeHtml(t.name)+'</div>' +
      '<span class="sd-count">'+pl.length+' jugadores</span>' +
    '</div>';
    if(isAdmin){
      html += '<form class="sd-add" data-sd-add="'+teamId+'">' +
        '<input type="text" class="sd-name" data-sd-add-name placeholder="Nombre del jugador">' +
        '<input type="number" min="1" class="sd-num" data-sd-add-num placeholder="Nº">' +
        '<select class="sd-pos" data-sd-add-pos>' + POSITIONS.map(function(p){ return '<option>'+p+'</option>'; }).join('') + '</select>' +
        '<select class="sd-vet" data-sd-add-vet><option value="">Veteranía</option><option>Veterano</option><option>Novato</option></select>' +
        '<select class="sd-prop" data-sd-add-prop><option value="">Propiedad</option><option>Titular</option><option>Fijo</option><option>Suplente</option></select>' +
        '<button type="button" class="sd-add-btn" data-sd-add-btn="'+teamId+'">Añadir</button>' +
      '</form>';
    }
    if(!pl.length){
      html += '<div class="empty-state mini"><div class="es-icon">🪪</div><div class="es-title">Plantilla vacía</div><p class="es-text">'+(isAdmin ? 'Usa el formulario de arriba para fichar al primer jugador.' : 'El administrador aún no ha dado de alta jugadores.')+'</p></div>';
    } else {
      html += '<div class="roster-list">' + pl.map(function(p, i){
        return '<div class="roster-row">' +
          '<span class="rr-num">'+escapeHtml(p.number || '—')+'</span>' +
          '<span class="rr-name">'+escapeHtml(p.name)+'</span>' +
          '<span class="rr-pos">'+escapeHtml(p.position || '')+'</span>' +
          '<span class="rr-tags">'+(p.veterania ? '<em class="tag-t">'+escapeHtml(p.veterania)+'</em>' : '')+(p.propiedad ? '<em class="tag-p">'+escapeHtml(p.propiedad)+'</em>' : '')+'</span>' +
          '<span class="rr-actions">' +
            (isAdmin ? '<button type="button" class="rr-btn" data-sd-edit="'+i+'" title="Editar">✏️</button>' : '') +
            (isAdmin ? '<button type="button" class="rr-btn rr-del" data-sd-del="'+i+'" title="Baja">🗑</button>' : '') +
          '</span>' +
        '</div>';
      }).join('') + '</div>';
    }
    host.innerHTML = html;
    if(list) list.style.display = 'none';
    host.style.display = 'block';
  }

  function closeSquadDetail(){
    currentSquadTeam = null;
    editingPlayerId = null;
    var host = document.getElementById('squadDetail');
    var list = document.getElementById('squadsList');
    if(host) host.style.display = 'none';
    if(list){ list.style.display = ''; renderSquadsTeamList(); }
  }

  function openPlayerModal(playerIdx){
    if(currentSquadTeam == null) return;
    var pl = squadPlayersOf(currentSquadTeam);
    var p = pl[playerIdx] || null;
    editingPlayerId = p ? playerIdx : null;
    var modal = document.getElementById('playerModal');
    if(!modal) return;
    var teamOpts = teams.map(function(t){
      return '<option value="'+t.id+'"'+(t.id===currentSquadTeam?' selected':'')+'>'+escapeHtml(t.name)+'</option>';
    }).join('');
    modal.innerHTML = '<div class="pm-card">' +
      '<div class="pm-title">'+ (p ? 'Editar jugador' : 'Nuevo jugador') +'</div>' +
      '<label>Nombre<input type="text" class="pm-input" id="pm-name" value="'+escapeHtml(p ? p.name : '')+'"></label>' +
      '<label>Dorsal<input type="number" min="1" class="pm-input" id="pm-num" value="'+escapeHtml(p && p.number ? p.number : '')+'"></label>' +
      '<label>Posición<select class="pm-input" id="pm-pos">' + POSITIONS.map(function(pos){ return '<option'+(p && p.position===pos?' selected':'')+'>'+pos+'</option>'; }).join('') + '</select></label>' +
      '<label>Veteranía<select class="pm-input" id="pm-vet"><option value="">—</option><option'+(p && p.veterania==='Veterano'?' selected':'')+'>Veterano</option><option'+(p && p.veterania==='Novato'?' selected':'')+'>Novato</option></select></label>' +
      '<label>Propiedad<select class="pm-input" id="pm-prop"><option value="">—</option><option'+(p && p.propiedad==='Titular'?' selected':'')+'>Titular</option><option'+(p && p.propiedad==='Fijo'?' selected':'')+'>Fijo</option><option'+(p && p.propiedad==='Suplente'?' selected':'')+'>Suplente</option></select></label>' +
      '<label>Equipo (traspaso)<select class="pm-input" id="pm-team">'+teamOpts+'</select></label>' +
      '<div class="pm-actions">' +
        '<button type="button" class="pm-btn" id="pm-save">Guardar</button>' +
        '<button type="button" class="pm-btn pm-cancel" id="pm-cancel">Cancelar</button>' +
      '</div>' +
    '</div>';
    modal.classList.add('show');
  }
  function closePlayerModal(){ var modal = document.getElementById('playerModal'); if(modal) modal.classList.remove('show'); }
  function savePlayerFromModal(){
    if(currentSquadTeam == null) return;
    var name = (document.getElementById('pm-name').value || '').trim();
    var num = document.getElementById('pm-num').value;
    var pos = document.getElementById('pm-pos').value;
    var vet = document.getElementById('pm-vet').value;
    var prop = document.getElementById('pm-prop').value;
    var teamId = document.getElementById('pm-team').value;
    if(!name){ notificar('⚠️ Escribe el nombre del jugador'); return; }
    var player = { id:('p'+Date.now()+'_'+Math.random().toString(36).slice(2,6)), name:name, number:num, position:pos, veterania:vet, propiedad:prop };
    if(!squads[teamId]) squads[teamId] = [];
    if(editingPlayerId != null && teamId === currentSquadTeam){
      player.id = squads[teamId][editingPlayerId].id || player.id;
      squads[teamId][editingPlayerId] = player;
      notificar('✅ Jugador actualizado');
    } else {
      if(editingPlayerId != null) squads[currentSquadTeam].splice(editingPlayerId, 1);
      squads[teamId].push(player);
      notificar('✅ ' + name + ' fichó por ' + (teamById(teamId) ? teamById(teamId).name : ''));
    }
    saveSquads();
    closePlayerModal();
    renderSquadDetail(teamId);
  }

  function setupSquadsUI(){
    var listHost = document.getElementById('squadsList');
    if(listHost){
      listHost.addEventListener('click', function(e){
        var card = e.target.closest ? e.target.closest('.squad-card') : null;
        if(card) renderSquadDetail(card.getAttribute('data-squad-team'));
      });
    }
    var detailHost = document.getElementById('squadDetail');
    if(detailHost){
      detailHost.addEventListener('click', function(e){
        if(e.target.closest('.sd-back')){ closeSquadDetail(); return; }
        var addBtn = e.target.closest('.sd-add-btn');
        if(addBtn){
          if(!isAdmin){ notificar('🔒 Activa el Modo Administrador'); return; }
          var tid = addBtn.getAttribute('data-sd-add-btn');
          var nameInp = detailHost.querySelector('[data-sd-add-name]');
          var numInp = detailHost.querySelector('[data-sd-add-num]');
          var posSel = detailHost.querySelector('[data-sd-add-pos]');
          var vetSel = detailHost.querySelector('[data-sd-add-vet]');
          var propSel = detailHost.querySelector('[data-sd-add-prop]');
          if(!nameInp || !nameInp.value.trim()){ notificar('⚠️ Escribe el nombre del jugador'); return; }
          if(!squads[tid]) squads[tid] = [];
          squads[tid].push({ id:'p'+Date.now()+'_'+Math.random().toString(36).slice(2,6), name:nameInp.value.trim(), number:numInp.value, position:posSel.value, veterania:vetSel.value, propiedad:propSel.value });
          saveSquads();
          renderSquadDetail(tid);
          notificar('✅ Jugador añadido a la plantilla');
          return;
        }
        var delBtn = e.target.closest('.rr-del');
        if(delBtn){
          if(!isAdmin){ notificar('🔒 Activa el Modo Administrador'); return; }
          squads[currentSquadTeam].splice(Number(delBtn.getAttribute('data-sd-del')), 1);
          saveSquads();
          renderSquadDetail(currentSquadTeam);
          notificar('🗑 Jugador dado de baja');
          return;
        }
        var editBtn = e.target.closest('[data-sd-edit]');
        if(editBtn){
          if(!isAdmin){ notificar('🔒 Activa el Modo Administrador'); return; }
          openPlayerModal(Number(editBtn.getAttribute('data-sd-edit')));
        }
      });
    }
    var modal = document.getElementById('playerModal');
    if(modal){
      modal.addEventListener('click', function(e){
        if(e.target === modal) closePlayerModal();
        if(e.target.id === 'pm-cancel') closePlayerModal();
        if(e.target.id === 'pm-save') savePlayerFromModal();
      });
    }
  }

  /* ---------------- CALENDARIO (fotos de los partidos) ---------------- */
  var _fbStorage = null;
  function getFbStorage(){
    if(!CLOUD_ENABLED || !window.firebase || !window.firebase.storage) return null;
    try{
      if(!_fbStorage) _fbStorage = window.firebase.storage(_fbApp);
      return _fbStorage;
    }catch(err){ return null; }
  }
  function matchList(){
    if(MODO === 'liga'){
      var out = [];
      ligaRounds.forEach(function(jor, ri){
        jor.matches.forEach(function(mt){
          var home = teamById(mt.a), away = teamById(mt.b);
          if(!home || !away) return;
          out.push({ key: mt.key, round: 'Jornada '+(ri+1)+(jor.vuelta?' (vuelta)':''), home:home, away:away });
        });
      });
      return out;
    }
    var out = [];
    var rounds = computeBracket('live');
    rounds.forEach(function(ms, r){
      var participants = Math.pow(2, rounds.length - r);
      ms.forEach(function(mt, j){
        var home = mt.ta ? teamById(mt.ta) : null;
        var away = mt.tb ? teamById(mt.tb) : null;
        if(!home || !away) return;
        out.push({ key: r+'-'+j, round: (ROUND_LABELS[participants] || 'Ronda '+(r+1)), home:home, away:away });
      });
    });
    return out;
  }

  function renderCalendar(){
    var host = document.getElementById('calendarList');
    if(!host) return;
    if(teams.length < 2){
      host.innerHTML = '<div class="empty-state"><div class="es-icon">📅</div><div class="es-title">Sin partidos</div><p class="es-text">Cuando haya equipos se mostrarán aquí los partidos para subir fotos del resultado.</p></div>';
      return;
    }
    var rows = matchList();
    var html = '<div class="calendar-grid">';
    rows.forEach(function(m){
      var list = matchPhotos[m.key] || {};
      var items = Object.keys(list).map(function(k){ return list[k]; }).sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
      html += '<div class="cal-card">' +
        '<div class="cal-head"><span class="cal-round">'+escapeHtml(m.round)+'</span><span class="cal-teams">'+escapeHtml(m.home.name)+' <span class="cal-vs">vs</span> '+escapeHtml(m.away.name)+'</span></div>' +
        '<div class="cal-photos" data-cal-key="'+m.key+'">' +
          (items.length ? items.map(function(p){
            return '<div class="cal-photo" data-photo-url="'+escapeHtml(p.url)+'">' +
              '<img src="'+escapeHtml(p.url)+'" alt="Foto del partido" loading="lazy">' +
              (isAdmin ? '<button type="button" class="cal-photo-del" data-photo-del="'+escapeHtml(p.url)+'" title="Eliminar foto">🗑</button>' : '') +
            '</div>';
          }).join('') : '<div class="cal-empty">Aún sin fotos</div>') +
        '</div>' +
        '<label class="cal-upload"><input type="file" accept="image/*" data-cal-up="'+m.key+'">📷 Subir captura</label>' +
      '</div>';
    });
    html += '</div>';
    host.innerHTML = html;
  }

  function handleCalendarChange(file, key){
    var storage = getFbStorage();
    if(!storage){
      notificar('⚠️ Para subir fotos a la nube necesitas la base de datos configurada');
      return;
    }
    var pid = 'ph'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
    var ref = storage.ref('draftbank/'+COMP.id+'/photos/'+key+'/'+pid);
    notificar('⬆️ Subiendo foto…');
    ref.put(file).then(function(snap){ return snap.ref.getDownloadURL(); })
      .then(function(url){
        if(!matchPhotos[key]) matchPhotos[key] = {};
        matchPhotos[key][pid] = { url:url, ts:Date.now() };
        savePhotos();
        renderCalendar();
        notificar('✅ Foto subida al partido');
      })
      .catch(function(err){
        console.error('Error subiendo foto:', err);
        notificar('❌ No se pudo subir la foto' + (err && err.message ? ': '+err.message : ''));
      });
  }

  function setupCalendarUI(){
    var host = document.getElementById('calendarList');
    if(!host) return;
    host.addEventListener('click', function(e){
      var lb = document.getElementById('lightbox');
      var delBtn = e.target.closest('.cal-photo-del');
      if(delBtn){
        if(!isAdmin){ notificar('🔒 Activa el Modo Administrador'); return; }
        var url = delBtn.getAttribute('data-photo-del');
        var key = delBtn.closest('.cal-photos').getAttribute('data-cal-key');
        if(!confirm('¿Eliminar esta foto?')) return;
        var list = matchPhotos[key] || {};
        Object.keys(list).forEach(function(pid){ if(list[pid].url === url) delete list[pid]; });
        savePhotos();
        renderCalendar();
        notificar('🗑 Foto eliminada');
        return;
      }
      var img = e.target.closest('.cal-photo img');
      if(img && lb){
        lb.innerHTML = '<img src="'+escapeHtml(img.getAttribute('src'))+'" alt="Foto ampliada"><button type="button" class="lb-close">✕</button>';
        lb.classList.add('show');
      }
    });
    host.addEventListener('change', function(e){
      var input = e.target;
      if(!input.dataset || !input.dataset.calUp) return;
      var file = input.files && input.files[0];
      if(file) handleCalendarChange(file, input.dataset.calUp);
      input.value = '';
    });
    var lb = document.getElementById('lightbox');
    if(lb){
      lb.addEventListener('click', function(e){
        if(e.target === lb || e.target.classList.contains('lb-close')) lb.classList.remove('show');
      });
    }
  }

  /* ---------------- ESTADÍSTICAS Y EXTRAS ---------------- */
  function statsKeyTeams(key){
    if(MODO === 'liga'){
      for(var i=0;i<ligaRounds.length;i++){
        for(var j=0;j<ligaRounds[i].matches.length;j++){
          var mt = ligaRounds[i].matches[j];
          if(mt.key === key) return { home: mt.a, away: mt.b };
        }
      }
      return null;
    }
    var rounds = computeBracket('live');
    for(var r=0;r<rounds.length;r++){
      for(var k=0;k<rounds[r].length;k++){
        if(rounds[r][k].key === key) return { home: rounds[r][k].ta, away: rounds[r][k].tb };
      }
    }
    return null;
  }

  function statsPanelHtml(key){
    if(!isAdmin) return '';
    var ids = statsKeyTeams(key);
    if(!ids || !ids.home || !ids.away) return '';
    var home = teamById(ids.home), away = teamById(ids.away);
    var html = '<div class="sp-wrap">' +
      '<button type="button" class="sp-toggle" data-stats-key="'+key+'">📊 Estadísticas del partido</button>' +
      '<div class="sp-body" data-stats-key="'+key+'">' +
        '<div class="sp-row">' +
          '<select class="sp-team" data-stats-key="'+key+'">' +
            '<option value="A">'+escapeHtml(home.name)+'</option>' +
            '<option value="B">'+escapeHtml(away.name)+'</option>' +
          '</select>' +
          '<select class="sp-player" data-stats-key="'+key+'"></select>' +
          '<input type="number" min="0" class="sp-num sp-goals" data-stats-key="'+key+'" placeholder="Goles">' +
          '<input type="number" min="0" class="sp-num sp-assists" data-stats-key="'+key+'" placeholder="Asist.">' +
          '<input type="number" min="0" class="sp-num sp-yellow" data-stats-key="'+key+'" placeholder="Amar.">' +
          '<input type="number" min="0" class="sp-num sp-red" data-stats-key="'+key+'" placeholder="Rojas">' +
          '<button type="button" class="sp-add" data-stats-key="'+key+'" title="Añadir registro">＋</button>' +
        '</div>' +
        '<div class="sp-motm-row">' +
          '<span class="sp-motm-label">⭐ MVP</span>' +
          '<select class="sp-m-team" data-stats-key="'+key+'">' +
            '<option value="A">'+escapeHtml(home.name)+'</option>' +
            '<option value="B">'+escapeHtml(away.name)+'</option>' +
          '</select>' +
          '<select class="sp-m-player" data-stats-key="'+key+'"></select>' +
          '<button type="button" class="sp-motm-btn" data-stats-key="'+key+'">Marcar MVP</button>' +
        '</div>' +
        '<div class="sp-entries" data-stats-key="'+key+'"></div>' +
      '</div>' +
    '</div>';
    return html;
  }
  function spPlayerOptions(teamId){
    var pl = squadPlayersOf(teamId);
    if(!pl.length) return '<option value="">— Sin jugadores —</option>';
    return pl.map(function(p){ return '<option value="'+escapeHtml(p.id || p.name)+'" data-name="'+escapeHtml(p.name)+'">'+escapeHtml(p.name)+(p.number?' (#'+escapeHtml(p.number)+')':'')+'</option>'; }).join('');
  }
  function populateSpPlayer(playerSel){
    var key = playerSel.getAttribute('data-stats-key');
    var teamSel = document.querySelector('.sp-team[data-stats-key="'+key+'"]');
    var ids = statsKeyTeams(key);
    if(!teamSel || !ids) return;
    var teamId = teamSel.value === 'B' ? ids.away : ids.home;
    playerSel.innerHTML = spPlayerOptions(teamId);
  }
  function renderStatsEntries(key){
    var host = document.querySelector('.sp-entries[data-stats-key="'+key+'"]');
    if(!host) return;
    var ids = statsKeyTeams(key);
    var home = ids ? teamById(ids.home) : null;
    var away = ids ? teamById(ids.away) : null;
    var entries = statsData.matches[key] || [];
    var motm = statsData.motm[key] || null;
    var html = '';
    if(entries.length){
      html = '<div class="sp-entries-list">' + entries.map(function(entry, i){
        var teamName = (entry.tid && entry.tid === (home ? home.id : null)) ? home.name : ((entry.tid && entry.tid === (away ? away.id : null)) ? away.name : (entry.team === 'A' ? (home?home.name:'') : (away?away.name:'')));
        return '<div class="sp-entry">' +
          '<span class="spe-team">'+escapeHtml(teamName)+'</span>' +
          '<span class="spe-player">'+escapeHtml(entry.player)+'</span>' +
          (entry.goals ? '<span class="spe-num" title="Goles">⚽'+entry.goals+'</span>' : '') +
          (entry.assists ? '<span class="spe-num" title="Asistencias">🅰️'+entry.assists+'</span>' : '') +
          (entry.yellow ? '<span class="spe-num" title="Amarillas">🟨'+entry.yellow+'</span>' : '') +
          (entry.red ? '<span class="spe-num" title="Rojas">🟥'+entry.red+'</span>' : '') +
          '<button type="button" class="sp-del" data-stats-key="'+key+'" data-sp-del="'+i+'">🗑</button>' +
        '</div>';
      }).join('') + '</div>';
    } else {
      html = '<div class="sp-noentries">Aún sin registros de estadísticas</div>';
    }
    if(motm){
      var motmT = motm.team === 'B' ? away : home;
      html += '<div class="sp-motm-show">⭐ MVP del partido: <strong>'+escapeHtml(motm.player)+'</strong> <span>('+escapeHtml(motmT ? motmT.name : '')+')</span></div>';
    }
    host.innerHTML = html;
  }
  function addStatsEntry(key){
    var row = document.querySelector('.sp-row[data-stats-key="'+key+'"]');
    if(!row) return;
    var teamSel = row.querySelector('.sp-team');
    var playerSel = row.querySelector('.sp-player');
    var opt = playerSel.options[playerSel.selectedIndex];
    var playerName = opt ? (opt.getAttribute('data-name') || opt.value) : '';
    var ids = statsKeyTeams(key);
    if(!playerName || !ids){ notificar('⚠️ Elige un jugador'); return; }
    var teamId = teamSel.value === 'B' ? ids.away : ids.home;
    var goals = parseInt(row.querySelector('.sp-goals').value,10) || 0;
    var assists = parseInt(row.querySelector('.sp-assists').value,10) || 0;
    var yellow = parseInt(row.querySelector('.sp-yellow').value,10) || 0;
    var red = parseInt(row.querySelector('.sp-red').value,10) || 0;
    if(goals === 0 && assists === 0 && yellow === 0 && red === 0){ notificar('⚠️ Rellena al menos un valor'); return; }
    if(!statsData.matches[key]) statsData.matches[key] = [];
    statsData.matches[key].push({ team: teamSel.value, tid: teamId, player: playerName, goals:goals, assists:assists, yellow:yellow, red:red, ts:Date.now() });
    saveStats();
    renderStatsEntries(key);
    renderStatsLeaderboards();
    row.querySelectorAll('.sp-num').forEach(function(n){ n.value=''; });
    notificar('✅ Estadística registrada');
  }
  function setMotm(key){
    var row = document.querySelector('.sp-motm-row[data-stats-key="'+key+'"]');
    if(!row) return;
    var mTeam = row.querySelector('.sp-m-team');
    var mPlayer = row.querySelector('.sp-m-player');
    var opt = mPlayer.options[mPlayer.selectedIndex];
    var playerName = opt ? (opt.getAttribute('data-name') || opt.value) : '';
    var ids = statsKeyTeams(key);
    if(!playerName || !ids){ notificar('⚠️ Elige un jugador'); return; }
    statsData.motm[key] = { team: mTeam.value, tid: mTeam.value === 'B' ? ids.away : ids.home, player: playerName, ts: Date.now() };
    saveStats();
    renderStatsEntries(key);
    renderStatsLeaderboards();
    notificar('⭐ MVP marcado');
  }
  function postRenderLiveStats(){
    document.querySelectorAll('.sp-team').forEach(function(teamSel){
      var key = teamSel.getAttribute('data-stats-key');
      var playerSel = document.querySelector('.sp-player[data-stats-key="'+key+'"]');
      if(playerSel) populateSpPlayer(playerSel);
    });
    document.querySelectorAll('.sp-m-team').forEach(function(teamSel){
      var key = teamSel.getAttribute('data-stats-key');
      var mSel = document.querySelector('.sp-m-player[data-stats-key="'+key+'"]');
      if(mSel) populateSpPlayer(mSel);
    });
    document.querySelectorAll('.sp-entries').forEach(function(el){
      renderStatsEntries(el.getAttribute('data-stats-key'));
    });
  }
  function setupStatsUI(){
    ['live-ligaMatches','live-koRounds'].forEach(function(id){
      var host = document.getElementById(id);
      if(!host) return;
      host.addEventListener('click', function(e){
        var toggle = e.target.closest('.sp-toggle');
        if(toggle){
          var body = document.querySelector('.sp-body[data-stats-key="'+toggle.getAttribute('data-stats-key')+'"]');
          if(body) body.classList.toggle('show');
          return;
        }
        var add = e.target.closest('.sp-add');
        if(add){ addStatsEntry(add.getAttribute('data-stats-key')); return; }
        var motmBtn = e.target.closest('.sp-motm-btn');
        if(motmBtn){ setMotm(motmBtn.getAttribute('data-stats-key')); return; }
        var del = e.target.closest('.sp-del');
        if(del){
          var key = del.getAttribute('data-stats-key');
          var idx = Number(del.getAttribute('data-sp-del'));
          if(statsData.matches[key]) statsData.matches[key].splice(idx,1);
          saveStats();
          renderStatsEntries(key);
          renderStatsLeaderboards();
          notificar('🗑 Registro eliminado');
        }
      });
      host.addEventListener('change', function(e){
        var t = e.target;
        if(t.classList && t.classList.contains('sp-team')){
          var playerSel = document.querySelector('.sp-player[data-stats-key="'+t.getAttribute('data-stats-key')+'"]');
          if(playerSel) populateSpPlayer(playerSel);
        }
        if(t.classList && t.classList.contains('sp-m-team')){
          var mSel = document.querySelector('.sp-m-player[data-stats-key="'+t.getAttribute('data-stats-key')+'"]');
          if(mSel) populateSpPlayer(mSel);
        }
      });
    });
  }
  function computeLeaders(){
    var scorers = {}, mvps = {};
    Object.keys(statsData.matches).forEach(function(key){
      (statsData.matches[key] || []).forEach(function(entry){
        if(!scorers[entry.player]) scorers[entry.player] = { name: entry.player, team: '', goals:0, assists:0, yellows:0, reds:0, cards:0 };
        var rec = scorers[entry.player];
        rec.goals += entry.goals||0; rec.assists += entry.assists||0; rec.yellows += entry.yellow||0; rec.reds += entry.red||0; rec.cards += (entry.yellow||0)+(entry.red||0);
        if(rec.team === ''){
          var t = entry.tid ? teamById(entry.tid) : null;
          if(t) rec.team = t.name;
        }
      });
    });
    Object.keys(statsData.motm).forEach(function(key){
      var m = statsData.motm[key];
      if(!m) return;
      if(!mvps[m.player]) mvps[m.player] = { name: m.player, team: '', count: 0 };
      mvps[m.player].count++;
      if(mvps[m.player].team === ''){
        var t = m.tid ? teamById(m.tid) : null;
        if(t) mvps[m.player].team = t.name;
      }
    });
    var topScorers = Object.keys(scorers).map(function(k){ return scorers[k]; }).sort(function(a,b){ return (b.goals-a.goals) || (b.assists-a.assists); }).filter(function(x){ return x.goals > 0; });
    var topAssists = Object.keys(scorers).map(function(k){ return scorers[k]; }).sort(function(a,b){ return (b.assists-a.assists) || (b.goals-a.goals); }).filter(function(x){ return x.assists > 0; });
    var topCards = Object.keys(scorers).map(function(k){ return scorers[k]; }).sort(function(a,b){ return (b.cards-a.cards) || (b.reds-a.reds); }).filter(function(x){ return x.cards > 0; });
    var topMvps = Object.keys(mvps).map(function(k){ return mvps[k]; }).sort(function(a,b){ return b.count-a.count; }).filter(function(x){ return x.count > 0; });
    return { scorers: topScorers, assists: topAssists, cards: topCards, mvps: topMvps };
  }
  function renderLeaderList(title, icon, list, getVal){
    var html = '<div class="lb-card"><div class="lb-title">'+icon+' '+title+'</div>';
    if(!list.length){ html += '<div class="lb-empty">Aún no hay registros</div>'; }
    else {
      html += '<ol class="lb-list">';
      list.forEach(function(rec, i){
        var medals = ['🥇','🥈','🥉'];
        html += '<li>' +
          '<span class="lb-pos">'+(i<3?medals[i]:(i+1))+'</span>' +
          '<span class="lb-name">'+escapeHtml(rec.name)+'</span>' +
          '<span class="lb-team">'+escapeHtml(rec.team||'')+'</span>' +
          '<span class="lb-val">'+getVal(rec)+'</span>' +
        '</li>';
      });
      html += '</ol>';
    }
    html += '</div>';
    return html;
  }
  function renderStatsLeaderboards(){
    var host = document.getElementById('statsLeaderboards');
    if(!host) return;
    if(teams.length < 2){ host.innerHTML = ''; return; }
    var L = computeLeaders();
    host.innerHTML =
      renderLeaderList('Goleadores','⚽', L.scorers, function(r){ return r.goals; }) +
      renderLeaderList('Asistentes','🅰️', L.assists, function(r){ return r.assists; }) +
      renderLeaderList('Amonestados','🟨', L.cards, function(r){ return r.cards; }) +
      renderLeaderList('Mejores jugadores (MVP)','⭐', L.mvps, function(r){ return r.count; });
  }
  function renderStatsExtras(){
    var host = document.getElementById('statsExtras');
    if(!host) return;
    if(teams.length < 2){ host.innerHTML = ''; return; }
    var rows = matchList();
    var html = '<div class="lb-card extras-card"><div class="lb-title">📌 Partidos del calendario</div><ul class="lb-list">';
    rows.forEach(function(m){
      var sc = ligaScore('live', m.key);
      var label = sc ? (sc.a+' – '+sc.b) : 'sin jugar';
      html += '<li><span class="lb-team">'+escapeHtml(m.round)+'</span><span class="lb-name">'+escapeHtml(m.home.name)+' <span class="cal-vs">vs</span> '+escapeHtml(m.away.name)+'</span><span class="lb-val">'+label+'</span></li>';
    });
    html += '</ul></div>';
    host.innerHTML = html;
  }

  /* ---------------- VITRINA HISTÓRICA (Hall de la Fama global) ---------------- */
  function renderFame(){
    var host = document.getElementById('fameGrid');
    if(!host) return;
    var mine = hallFameEntries.filter(function(e){
      return !e.comp || e.comp === COMP.id;
    });
    if(!mine.length){
      host.innerHTML = '<div class="empty-state"><div class="es-icon">🏆</div><div class="es-title">Vitrina vacía</div><p class="es-text">Las leyendas de '+escapeHtml(COMP.nombre)+' entran desde la página <strong>Hall de la Fama</strong> (solo Modo Administrador).</p></div>';
      return;
    }
    var seasonOrder = {};
    var sorted = mine.slice().sort(function(a,b){ return (a.puesto!=null?a.puesto:9999) - (b.puesto!=null?b.puesto:9999); });
    var html = '';
    var bySeason = {};
    sorted.forEach(function(e){
      var s = e.season || '';
      if(!bySeason[s]) bySeason[s] = [];
      bySeason[s].push(e);
    });
    var seasons = Object.keys(bySeason).sort(function(a,b){ return b.localeCompare(a); });
    seasons.forEach(function(s){
      var list = bySeason[s];
      if(s) html += '<div class="fame-group-head"><span class="fg-season">Temporada '+escapeHtml(s)+'</span></div>';
      var podium = list.slice(0,3);
      var rest = list.slice(3);
      html += '<div class="fame-podium">';
      podium.forEach(function(e, i){
        var rank = i===0?'🥇':(i===1?'🥈':'🥉');
        html += '<div class="fame-card fame-top" style="border-color:'+escapeHtml(e.color||'#d4af37')+'">' +
          '<div class="fc-rank">'+rank+'</div>' +
          (e.logo ? '<div class="fc-logo"><img src="'+escapeHtml(e.logo)+'" alt=""></div>' : '<div class="fc-logo fc-logo-none">🛡️</div>') +
          '<div class="fc-name">'+escapeHtml(e.nombre||'')+'</div>' +
          (e.dueño ? '<div class="fc-owner">'+escapeHtml(e.dueño)+'</div>' : '') +
          (e.puesto != null ? '<div class="fc-year">Puesto #'+escapeHtml(e.puesto)+(e.anno ? ' · '+escapeHtml(e.anno) : '')+'</div>' : '') +
        '</div>';
      });
      html += '</div>';
      if(rest.length){
        html += '<div class="fame-list">' + rest.map(function(e){
          return '<div class="fame-row" style="border-color:'+escapeHtml(e.color||'#d4af37')+'">' +
            (e.logo ? '<div class="fr-logo"><img src="'+escapeHtml(e.logo)+'" alt=""></div>' : '<div class="fr-logo fr-logo-none">🛡️</div>') +
            '<span class="fr-name">'+escapeHtml(e.nombre||'')+'</span>' +
            (e.dueño ? '<span class="fr-owner">'+escapeHtml(e.dueño)+'</span>' : '') +
            (e.puesto != null ? '<span class="fr-year">#'+escapeHtml(e.puesto)+(e.anno?' · '+escapeHtml(e.anno):'')+'</span>' : '') +
            (e.season ? '<span class="fr-year">📅 '+escapeHtml(e.season)+'</span>' : '') +
          '</div>';
        }).join('') + '</div>';
      }
    });
    host.innerHTML = html;
  }

  /* ---------------- NORMATIVA (normas + noticias de la competición) ---------------- */
  function renderRulesNews(){
    var host = document.getElementById('rulesNewsWrap');
    if(!host) return;
    var html = '';
    if(isAdmin){
      html += '<div class="rn-admin"><button type="button" class="rn-add-rule" data-rn-add-rule="1">＋ Añadir norma</button><button type="button" class="rn-add-news" data-rn-add-news="1">＋ Añadir noticia</button></div>';
    }
    html += '<div class="rn-rules">' + rulesNews.rules.map(function(r, i){
      return '<div class="rule-card"><div class="rule-num">'+ (i+1) +'</div><div class="rule-body"><div class="rule-title">'+escapeHtml(r.title||'')+'</div><div class="rule-text">'+escapeHtml(r.text||'')+'</div>' +
        (isAdmin ? '<div class="rule-actions"><button type="button" class="rn-del" data-rn-del-rule="'+i+'">🗑</button></div>' : '') +
      '</div></div>';
    }).join('') + '</div>';
    if(rulesNews.news.length){
      html += '<div class="rn-news"><div class="block-title small">📰 Noticias</div>' + rulesNews.news.slice().reverse().map(function(n, i){
        var realIdx = rulesNews.news.length - 1 - i;
        return '<div class="news-card">' +
          '<div class="news-date">'+escapeHtml(n.date||'')+'</div>' +
          (isAdmin ? '<button type="button" class="rn-del news-del" data-rn-del-news="'+realIdx+'">🗑</button>' : '') +
          '<div class="news-title">'+escapeHtml(n.title||'')+'</div>' +
          '<div class="news-text">'+escapeHtml(n.text||'')+'</div>' +
        '</div>';
      }).join('') + '</div>';
    }
    if(!rulesNews.rules.length && !rulesNews.news.length){
      html = '<div class="empty-state"><div class="es-icon">📜</div><div class="es-title">Normativa vacía</div><p class="es-text">'+(isAdmin ? 'Añade las normas y noticias de la competición con los botones de arriba.' : 'El administrador aún no ha publicado la normativa.')+'</p></div>';
    }
    host.innerHTML = html;
  }
  function openRuleEditor(idx){
    var modal = document.getElementById('rnModal');
    if(!modal) return;
    var r = idx != null ? rulesNews.rules[idx] : null;
    modal.innerHTML = '<div class="pm-card">' +
      '<div class="pm-title">'+(r?'Editar norma':'Nueva norma')+'</div>' +
      '<label>Título<input type="text" class="pm-input" id="rn-title" value="'+escapeHtml(r?r.title:'')+'"></label>' +
      '<label>Contenido<textarea class="pm-input" id="rn-text" rows="4">'+escapeHtml(r?r.text:'')+'</textarea></label>' +
      '<div class="pm-actions"><button type="button" class="pm-btn" id="rn-save">Guardar</button><button type="button" class="pm-btn pm-cancel" id="rn-cancel">Cancelar</button></div>' +
    '</div>';
    modal.classList.add('show');
    modal.setAttribute('data-rn-edit', idx != null ? idx : '');
    modal.setAttribute('data-rn-news', '');
  }
  function openNewsEditor(idx){
    var modal = document.getElementById('rnModal');
    if(!modal) return;
    var n = idx != null ? rulesNews.news[idx] : null;
    modal.innerHTML = '<div class="pm-card">' +
      '<div class="pm-title">'+(n?'Editar noticia':'Nueva noticia')+'</div>' +
      '<label>Fecha<input type="text" class="pm-input" id="rn-title" value="'+escapeHtml(n?n.date:'')+'" placeholder="ej. 12/03/2026"></label>' +
      '<label>Título<input type="text" class="pm-input" id="rn-text2" value="'+escapeHtml(n?n.title:'')+'"></label>' +
      '<label>Contenido<textarea class="pm-input" id="rn-text" rows="4">'+escapeHtml(n?n.text:'')+'</textarea></label>' +
      '<div class="pm-actions"><button type="button" class="pm-btn" id="rn-save">Guardar</button><button type="button" class="pm-btn pm-cancel" id="rn-cancel">Cancelar</button></div>' +
    '</div>';
    modal.classList.add('show');
    modal.setAttribute('data-rn-edit', idx != null ? idx : '');
    modal.setAttribute('data-rn-news', '1');
  }
  function saveRuleFromModal(){
    var modal = document.getElementById('rnModal');
    var titleInput = document.getElementById('rn-title');
    var textInput = document.getElementById('rn-text');
    var text2Input = document.getElementById('rn-text2');
    if(!titleInput || !textInput || !modal) return;
    var isNews = modal.getAttribute('data-rn-news') === '1';
    var idxRaw = modal.getAttribute('data-rn-edit');
    var idx = (idxRaw === '' || idxRaw === null) ? null : Number(idxRaw);
    if(isNews){
      var nTitle = text2Input ? text2Input.value.trim() : titleInput.value.trim();
      if(!nTitle){ notificar('⚠️ Escribe un título'); return; }
      if(idx != null) rulesNews.news[idx] = { date: titleInput.value.trim(), title: nTitle, text: textInput.value.trim() };
      else rulesNews.news.push({ id:'n'+Date.now(), date: titleInput.value.trim(), title: nTitle, text: textInput.value.trim() });
    } else {
      var title = titleInput.value.trim();
      if(!title){ notificar('⚠️ Escribe un título'); return; }
      if(idx != null) rulesNews.rules[idx] = { title: title, text: textInput.value.trim() };
      else rulesNews.rules.push({ id:'r'+Date.now(), title: title, text: textInput.value.trim() });
    }
    saveRulesNews();
    renderRulesNews();
    modal.classList.remove('show');
    notificar('✅ Guardado en la normativa');
  }
  function setupRulesNewsUI(){
    var host = document.getElementById('rulesNewsWrap');
    if(!host) return;
    host.addEventListener('click', function(e){
      if(e.target.closest('.rn-add-rule')){ openRuleEditor(null); return; }
      if(e.target.closest('.rn-add-news')){ openNewsEditor(null); return; }
      var delRule = e.target.closest('[data-rn-del-rule]');
      if(delRule){
        if(!confirm('¿Eliminar esta norma?')) return;
        rulesNews.rules.splice(Number(delRule.getAttribute('data-rn-del-rule')),1);
        saveRulesNews(); renderRulesNews(); return;
      }
      var delNews = e.target.closest('[data-rn-del-news]');
      if(delNews){
        rulesNews.news.splice(Number(delNews.getAttribute('data-rn-del-news')),1);
        saveRulesNews(); renderRulesNews();
      }
    });
    var modal = document.getElementById('rnModal');
    if(modal){
      modal.addEventListener('click', function(e){
        if(e.target === modal) modal.classList.remove('show');
        if(e.target.id === 'rn-cancel') modal.classList.remove('show');
        if(e.target.id === 'rn-save') saveRuleFromModal();
      });
    }
  }

  /* ---------------- MODO LIGA: calendario (ida y vuelta) ---------------- */
  var ligaRounds = [];
  function buildLigaRounds(){
    ligaRounds = [];
    var ids = teams.map(function(t){ return t.id; });
    var n = ids.length;
    if(n < 2) return;
    var valid = ligaOrder.length === ids.length && ids.every(function(id){ return ligaOrder.indexOf(id) !== -1; });
    if(!valid){
      ligaOrder = shuffle(ids.slice());
      saveSettings();
    }
    var m = (n % 2 === 1) ? n + 1 : n;
    var arr = [];
    for(var i=0;i<m;i++) arr.push(i < ligaOrder.length ? ligaOrder[i] : null);
    var single = [];
    for(var r=0;r<m-1;r++){
      var ms = [];
      for(var j=0;j<m/2;j++){
        var a = arr[j], b = arr[m-1-j];
        if(a != null && b != null) ms.push({ a:a, b:b });
      }
      single.push(ms);
      var last = arr[m-1];
      for(var k=m-1;k>1;k--) arr[k] = arr[k-1];
      arr[1] = last;
    }
    single.forEach(function(ms, ri){
      ligaRounds.push({ vuelta:false, matches: ms.map(function(mt, mi){ return { key: ri+'-'+mi, a: mt.a, b: mt.b }; }) });
    });
    single.forEach(function(ms, ri){
      ligaRounds.push({ vuelta:true, matches: ms.map(function(mt, mi){ return { key: (single.length+ri)+'-'+mi, a: mt.b, b: mt.a }; }) });
    });
  }

  function ligaScore(ns, key){
    var r = (ns === 'live') ? live.matches[key] : pred.matches[key];
    if(!r) return null;
    if(ns === 'pred' && typeof r.q === 'number'){
      return { a: (r.q===0?1:0), b: (r.q===2?1:0) };
    }
    var a = r.a, b = r.b;
    if(a == null || a === '' || b == null || b === '') return null;
    a = parseInt(a,10); b = parseInt(b,10);
    if(Number.isNaN(a) || Number.isNaN(b)) return null;
    return { a:a, b:b };
  }

  function computeLigaStandings(ns){
    var rows = {};
    teams.forEach(function(t){
      rows[t.id] = { id:t.id, name:t.name, flag:t.flag, logo:t.logo, owner:t.owner, pj:0, pg:0, pe:0, pp:0, gf:0, gc:0, pts:0 };
    });
    ligaRounds.forEach(function(jor){
      jor.matches.forEach(function(mt){
        var sc = ligaScore(ns, mt.key);
        if(!sc) return;
        var ra = rows[mt.a], rb = rows[mt.b];
        if(!ra || !rb) return;
        ra.pj++; rb.pj++;
        ra.gf += sc.a; ra.gc += sc.b; rb.gf += sc.b; rb.gc += sc.a;
        if(sc.a > sc.b){ ra.pg++; ra.pts += 3; rb.pp++; }
        else if(sc.a < sc.b){ rb.pg++; rb.pts += 3; ra.pp++; }
        else { ra.pe++; rb.pe++; ra.pts++; rb.pts++; }
      });
    });
    var list = Object.keys(rows).map(function(k){ return rows[k]; });
    list.sort(function(x,y){
      var dx = x.gf - x.gc, dy = y.gf - y.gc;
      if(y.pts !== x.pts) return y.pts - x.pts;
      if(dy !== dx) return dy - dx;
      if(y.gf !== x.gf) return y.gf - x.gf;
      return String(x.name).localeCompare(String(y.name));
    });
    return list;
  }

  function renderLigaTable(ns){
    var tbl = document.getElementById(ns+'-ligaTable');
    if(!tbl) return;
    var champ = document.getElementById(ns+'-ligaChamp');
    if(teams.length < 2){
      tbl.innerHTML = '<div class="empty-state"><div class="es-icon">🏟️</div><div class="es-title">Todavía no hay equipos</div><p class="es-text">Ve a la pestaña <strong>Equipos</strong> y activa el <strong>Modo Administrador</strong> para añadir al menos 2 equipos y generar la liga.</p></div>';
      if(champ){ champ.innerHTML = ''; champ.style.display = 'none'; }
      return;
    }
    var st = computeLigaStandings(ns);
    var total = 0, played = 0;
    ligaRounds.forEach(function(j){ j.matches.forEach(function(mt){ total++; if(ligaScore(ns, mt.key)) played++; }); });
    var done = total > 0 && played >= total;
    var champion = done ? st[0] : null;
    var html = '<table class="liga-table"><thead><tr>' +
      '<th class="tl-pos">#</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th class="tl-pts">PTS</th>' +
      '</tr></thead><tbody>';
    st.forEach(function(t, i){
      var dg = t.gf - t.gc;
      var sign = dg > 0 ? '+' : '';
      html += '<tr class="'+(i===0 ? 'row-leader' : '')+'">';
      html += '<td class="tl-pos">'+(champion && i===0 ? '🥇' : (i+1))+'</td>';
      html += '<td class="tl-team"><span class="tl-flag">'+flagImgHtml(t,'flag-icon')+'</span><span class="tl-name">'+escapeHtml(t.name)+'</span>'+(t.owner?'<span class="tl-owner">'+escapeHtml(t.owner)+'</span>':'')+'</td>';
      html += '<td>'+t.pj+'</td><td>'+t.pg+'</td><td>'+t.pe+'</td><td>'+t.pp+'</td><td>'+t.gf+'</td><td>'+t.gc+'</td><td>'+(sign+dg)+'</td><td class="tl-pts">'+t.pts+'</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    tbl.innerHTML = html;
    if(champ){
      if(champion){
        champ.innerHTML = '<div class="champ-banner"><span class="cb-cup">🏆</span><span class="cb-txt"><strong>'+escapeHtml(champion.name)+'</strong> es campeón de '+escapeHtml(COMP.nombre)+'</span></div>';
        champ.style.display = '';
      } else {
        champ.innerHTML = '';
        champ.style.display = 'none';
      }
    }
  }

  function renderLigaMatches(ns){
    var host = document.getElementById(ns+'-ligaMatches');
    if(!host) return;
    if(teams.length < 2){ host.innerHTML = ''; return; }
    var data = (ns === 'live') ? live.matches : pred.matches;
    var html = '';
    ligaRounds.forEach(function(jor, ri){
      html += '<div class="jornada"><div class="jornada-head">Jornada '+(ri+1)+(jor.vuelta?' <span class="jv">(vuelta)</span>':'')+'</div><div class="jornada-matches">';
      jor.matches.forEach(function(mt){
        var home = teamById(mt.a), away = teamById(mt.b);
        if(!home || !away) return;
        var r = data[mt.key];
        html += '<div class="liga-match" id="lm-'+ns+'-'+mt.key+'">';
        html += '<div class="lm-name lm-home"><span class="lm-flag">'+flagImgHtml(home,'flag-icon')+'</span><span>'+escapeHtml(home.name)+'</span></div>';
        html += '<div class="lm-center">';
        if(ns === 'live' || (ns === 'pred' && pred.detail)){
          html += '<input type="number" min="0" step="1" inputmode="numeric" class="score-input lm-score" data-ns="'+ns+'" data-key="'+mt.key+'" data-side="a" value="'+escapeHtml(r && r.a != null ? r.a : '')+'" placeholder="0">';
          html += '<span class="lm-dash">–</span>';
          html += '<input type="number" min="0" step="1" inputmode="numeric" class="score-input lm-score" data-ns="'+ns+'" data-key="'+mt.key+'" data-side="b" value="'+escapeHtml(r && r.b != null ? r.b : '')+'" placeholder="0">';
          if(ns === 'live'){
            html += '<button type="button" class="score-clear-btn lm-clear" data-ns="live" data-key="'+mt.key+'" title="Borrar resultado">🗑</button>';
          }
        } else {
          var q = (r && typeof r.q === 'number') ? r.q : -1;
          html += '<div class="lm-quick">';
          html += '<button type="button" class="qbtn'+(q===0?' on':'')+'" data-ns="pred" data-key="'+mt.key+'" data-q="0" title="Gana el local">1</button>';
          html += '<button type="button" class="qbtn'+(q===1?' on':'')+'" data-ns="pred" data-key="'+mt.key+'" data-q="1" title="Empate">X</button>';
          html += '<button type="button" class="qbtn'+(q===2?' on':'')+'" data-ns="pred" data-key="'+mt.key+'" data-q="2" title="Gana el visitante">2</button>';
          html += '</div>';
        }
        html += '</div>';
        html += '<div class="lm-name lm-away"><span class="lm-flag">'+flagImgHtml(away,'flag-icon')+'</span><span>'+escapeHtml(away.name)+'</span></div>';
        if(ns === 'live') html += statsPanelHtml(mt.key);
        html += '</div>';
      });
      html += '</div></div>';
    });
    host.innerHTML = html;
    if(ns === 'live'){ applyLiveLock(); postRenderLiveStats(); }
  }

  function initLigaEvents(){
    ['live','pred'].forEach(function(ns){
      var host = document.getElementById(ns+'-ligaMatches');
      if(!host) return;
      host.addEventListener('input', function(e){
        var inp = e.target;
        if(!inp.classList || !inp.classList.contains('score-input')) return;
        var ens = inp.dataset.ns;
        if(ens === 'live' && !isAdmin) return;
        var key = inp.dataset.key, side = inp.dataset.side;
        var store = (ens === 'live') ? live.matches : pred.matches;
        if(!store[key]) store[key] = {};
        store[key][side] = inp.value;
        if(ens === 'live') saveLive(); else savePred();
        renderLigaTable(ens);
      });
      host.addEventListener('click', function(e){
        var t = e.target;
        if(t.classList && t.classList.contains('qbtn')){
          var key = t.dataset.key, q = Number(t.dataset.q);
          var store = pred.matches;
          if(store[key] && typeof store[key].q === 'number' && store[key].q === q) delete store[key];
          else store[key] = { q: q };
          savePred();
          renderLigaMatches('pred');
          renderLigaTable('pred');
        }
        if(t.classList && t.classList.contains('score-clear-btn') && t.dataset.ns === 'live'){
          if(!isAdmin) return;
          delete live.matches[t.dataset.key];
          saveLive();
          renderLigaMatches('live');
          renderLigaTable('live');
          notificar('🗑 Resultado borrado');
        }
      });
    });
  }

  /* ---------------- MODO DIRECTO: cuadro eliminatorio (byes) ---------------- */
  var ROUND_LABELS = { 2:'Gran Final', 4:'Semifinales', 8:'Cuartos de Final', 16:'Octavos de Final', 32:'Dieciseisavos de Final', 64:'Treintaidosavos de Final', 128:'Sesentaicuatroavos de Final' };

  function computeBracket(ns){
    var data = (ns === 'live') ? live.matches : pred.matches;
    var n = teams.length;
    var size = 1;
    while(size < n) size *= 2;
    var slots = [];
    for(var i=0;i<size;i++) slots.push(i < n ? teams[i].id : null);
    var rounds = [];
    var cur = slots;
    var r = 0;
    while(cur.length > 1){
      var ms = [];
      var next = [];
      for(var j=0;j<cur.length/2;j++){
        var ta = cur[j], tb = cur[cur.length-1-j];
        var key = r+'-'+j;
        var res = data[key] || null;
        var winner = null;
        if(ta && tb){
          if(res){
            if(typeof res.p === 'string'){
              winner = (res.p === 'A') ? ta : tb;
            } else {
              var a = (res.a != null && res.a !== '') ? parseInt(res.a,10) : null;
              var b = (res.b != null && res.b !== '') ? parseInt(res.b,10) : null;
              if(a != null && b != null && !Number.isNaN(a) && !Number.isNaN(b)){
                if(a > b) winner = ta;
                else if(b > a) winner = tb;
                else if(res.pa != null && res.pb != null && res.pa !== '' && res.pb !== ''){
                  var pa = parseInt(res.pa,10), pb = parseInt(res.pb,10);
                  if(!Number.isNaN(pa) && !Number.isNaN(pb)){ if(pa > pb) winner = ta; else if(pb > pa) winner = tb; }
                }
              }
            }
          }
        } else if(ta && !tb){ winner = ta; }
        else if(!ta && tb){ winner = tb; }
        ms.push({ key:key, ta:ta, tb:tb, winner:winner, res:res, bye:!(ta && tb) });
        next.push(winner);
      }
      rounds.push(ms);
      cur = next;
      r++;
    }
    return rounds;
  }

  function directoCardHtml(ns, r, j, mt, isFinal){
    var uid = ns+'-'+r+'-'+j;
    var res = mt.res || {};
    var ha = (res.a != null && res.a !== '') ? res.a : '';
    var hb = (res.b != null && res.b !== '') ? res.b : '';
    var scoreDisabled = (!mt.ta || !mt.tb) || (ns === 'live' && !isAdmin);
    return '<div class="kmatch'+(isFinal ? ' final-match' : '')+'" id="kmatch-'+uid+'">' +
      '<div class="kside" id="kside-'+uid+'-A" data-ns="'+ns+'" data-r="'+r+'" data-i="'+j+'" data-side="A">' +
        '<div class="kteam"><div class="kteam-top"><span id="kflag-'+uid+'-A" class="kteam-flag" style="display:none;"></span><span class="kname" id="kname-'+uid+'-A">Pendiente</span></div><span class="kowner" id="kowner-'+uid+'-A"></span></div>' +
        '<input type="number" min="0" class="kscore" id="kscore-'+uid+'-A" data-ns="'+ns+'" data-r="'+r+'" data-i="'+j+'" data-side="A" value="'+escapeHtml(ha)+'" '+(scoreDisabled?'disabled':'')+'>' +
      '</div>' +
      '<div class="kside" id="kside-'+uid+'-B" data-ns="'+ns+'" data-r="'+r+'" data-i="'+j+'" data-side="B">' +
        '<div class="kteam"><div class="kteam-top"><span id="kflag-'+uid+'-B" class="kteam-flag" style="display:none;"></span><span class="kname" id="kname-'+uid+'-B">Pendiente</span></div><span class="kowner" id="kowner-'+uid+'-B"></span></div>' +
        '<input type="number" min="0" class="kscore" id="kscore-'+uid+'-B" data-ns="'+ns+'" data-r="'+r+'" data-i="'+j+'" data-side="B" value="'+escapeHtml(hb)+'" '+(scoreDisabled?'disabled':'')+'>' +
      '</div>' +
      '<div class="penalty-box" id="kpen-'+uid+'">' +
        '<div class="plabel">Empate — penales</div>' +
        '<div class="penalty-btns">' +
          '<button type="button" class="pbtn" id="kpenA-'+uid+'" data-ns="'+ns+'" data-r="'+r+'" data-i="'+j+'" data-side="A">—</button>' +
          '<button type="button" class="pbtn" id="kpenB-'+uid+'" data-ns="'+ns+'" data-r="'+r+'" data-i="'+j+'" data-side="B">—</button>' +
        '</div>' +
      '</div>' +
      (ns === 'live' ? '<button type="button" class="kmatch-clear-btn" data-ns="live" data-r="'+r+'" data-i="'+j+'">🗑 Borrar cruce</button>' : '') +
      (ns === 'live' ? statsPanelHtml(r+'-'+j) : '') +
    '</div>';
  }

  function renderDirecto(ns){
    var host = document.getElementById(ns+'-koRounds');
    if(!host) return;
    if(teams.length < 2){
      host.innerHTML = '<div class="empty-state"><div class="es-icon">🏆</div><div class="es-title">Todavía no hay equipos</div><p class="es-text">Ve a la pestaña <strong>Equipos</strong> y activa el <strong>Modo Administrador</strong> para añadir al menos 2 equipos y generar el cuadro de la copa.</p></div>';
      return;
    }
    var rounds = computeBracket(ns);
    var html = '';
    rounds.forEach(function(ms, r){
      var participants = Math.pow(2, rounds.length - r);
      var label = ROUND_LABELS[participants] || ('Ronda '+(r+1));
      var isFinal = (r === rounds.length - 1);
      html += '<div class="stage">';
      html += '<div class="stage-head"><span class="chip">'+(!isFinal ? '' : '🏆')+'</span><h3>'+label+'</h3><span class="stage-rule"></span></div>';
      if(r === 0) html += '<p class="block-note" style="margin:-6px 0 16px;">Eliminatoria directa a partido único. Los equipos con <strong>Exento</strong> pasan de ronda automáticamente.</p>';
      html += '<div class="matches-row">';
      ms.forEach(function(mt, j){
        html += directoCardHtml(ns, r, j, mt, isFinal);
      });
      html += '</div></div>';
      if(r < rounds.length - 1) html += '<div class="chevron-divider">▾</div>';
    });
    host.innerHTML = html;
    host.classList.toggle('ko-pick-mode', (ns === 'pred' && pred.koPick));
    if(ns === 'live'){ applyLiveLock(); postRenderLiveStats(); }
    updateDirecto(ns);
  }

  function updateDirecto(ns){
    var rounds = computeBracket(ns);
    rounds.forEach(function(ms, r){
      ms.forEach(function(mt, j){
        var uid = ns+'-'+r+'-'+j;
        var nameA = document.getElementById('kname-'+uid+'-A');
        if(!nameA) return;
        var ownerA = document.getElementById('kowner-'+uid+'-A');
        var flagA = document.getElementById('kflag-'+uid+'-A');
        var nameB = document.getElementById('kname-'+uid+'-B');
        var ownerB = document.getElementById('kowner-'+uid+'-B');
        var flagB = document.getElementById('kflag-'+uid+'-B');
        var sideA = document.getElementById('kside-'+uid+'-A');
        var sideB = document.getElementById('kside-'+uid+'-B');
        var scoreA = document.getElementById('kscore-'+uid+'-A');
        var scoreB = document.getElementById('kscore-'+uid+'-B');
        var penBox = document.getElementById('kpen-'+uid);
        var tA = mt.ta ? teamById(mt.ta) : null;
        var tB = mt.tb ? teamById(mt.tb) : null;
        var res = mt.res || {};

        function fillSide(name, owner, flag, t, slotId){
          name.textContent = t ? t.name : (slotId ? 'Exento' : 'Pendiente');
          owner.textContent = t ? t.owner : '';
          if(t && (t.flag || t.logo)){ flag.innerHTML = flagImgHtml(t,'flag-icon-sm'); flag.style.display = 'inline-flex'; }
          else flag.style.display = 'none';
        }
        fillSide(nameA, ownerA, flagA, tA, mt.ta != null);
        fillSide(nameB, ownerB, flagB, tB, mt.tb != null);

        var winnerSide = null;
        if(mt.winner){
          winnerSide = (mt.winner === mt.ta) ? 'A' : 'B';
        }
        sideA.classList.remove('winner','loser','pending');
        sideB.classList.remove('winner','loser','pending');
        if(!tA) sideA.classList.add('pending');
        if(!tB) sideB.classList.add('pending');
        if(winnerSide === 'A'){ sideA.classList.add('winner'); sideB.classList.add('loser'); }
        else if(winnerSide === 'B'){ sideB.classList.add('winner'); sideA.classList.add('loser'); }

        var locked = (ns === 'live' && !isAdmin);
        if(scoreA) scoreA.disabled = !(tA && tB) || locked;
        if(scoreB) scoreB.disabled = !(tA && tB) || locked;

        if(penBox){
          var tied = false;
          if(tA && tB && res && res.a != null && res.a !== '' && res.b != null && res.b !== '' && typeof res.p !== 'string'){
            var aN = parseInt(res.a,10), bN = parseInt(res.b,10);
            if(!Number.isNaN(aN) && !Number.isNaN(bN) && aN === bN) tied = true;
          }
          penBox.classList.toggle('show', tied);
          if(tied){
            var penA = document.getElementById('kpenA-'+uid);
            var penB = document.getElementById('kpenB-'+uid);
            if(penA){ penA.textContent = tA.name; penA.classList.toggle('active', !!(res.pa !== undefined && res.pa !== null && res.pa !== '')); }
            if(penB){ penB.textContent = tB.name; penB.classList.toggle('active', !!(res.pb !== undefined && res.pb !== null && res.pb !== '')); }
          }
        }
      });
    });
    var banner = document.getElementById(ns+'-trophyBanner');
    if(banner){
      var finalR = rounds[rounds.length - 1];
      var finalWinner = (finalR && finalR[0]) ? finalR[0].winner : null;
      var wt = finalWinner ? teamById(finalWinner) : null;
      if(wt){
        banner.textContent = '🏆 Campeón de '+COMP.nombre+': ' + wt.name + (wt.owner ? ' (' + wt.owner + ')' : '');
        banner.classList.add('show');
      } else {
        banner.classList.remove('show');
      }
    }
  }

  function initDirectoEvents(){
    ['live','pred'].forEach(function(ns){
      var host = document.getElementById(ns+'-koRounds');
      if(!host) return;
      host.addEventListener('input', function(e){
        var inp = e.target;
        if(!inp.classList || !inp.classList.contains('kscore')) return;
        var ens = inp.dataset.ns;
        if(ens === 'live' && !isAdmin) return;
        var store = (ens === 'live') ? live.matches : pred.matches;
        var key = inp.dataset.r + '-' + inp.dataset.i;
        if(!store[key]) store[key] = {};
        store[key][inp.dataset.side.toLowerCase()] = inp.value;
        if(store[key].a === '' && store[key].b === ''){ delete store[key].a; delete store[key].b; }
        if(ens === 'live') saveLive(); else savePred();
        updateDirecto(ens);
      });
      host.addEventListener('click', function(e){
        var t = e.target;
        if(!t.classList) return;
        if(t.classList.contains('pbtn')){
          var ens = t.dataset.ns;
          if(ens === 'live' && !isAdmin) return;
          var store = (ens === 'live') ? live.matches : pred.matches;
          var key = t.dataset.r + '-' + t.dataset.i;
          if(!store[key]) store[key] = {};
          var side = t.dataset.side.toLowerCase();
          if(store[key][side] === '1') delete store[key][side];
          else store[key][side] = '1';
          if(ens === 'live') saveLive(); else savePred();
          updateDirecto(ens);
        }
        if(t.classList.contains('kside')){
          var ens = t.dataset.ns;
          if(ens !== 'pred' || !pred.koPick) return;
          var store = pred.matches;
          var key = t.dataset.r + '-' + t.dataset.i;
          if(!store[key]) store[key] = {};
          var side = t.dataset.side;
          if(store[key].p === side) delete store[key].p;
          else store[key].p = side;
          savePred();
          updateDirecto('pred');
        }
        if(t.classList.contains('kmatch-clear-btn')){
          if(!isAdmin) return;
          var key = t.dataset.r + '-' + t.dataset.i;
          delete live.matches[key];
          saveLive();
          renderDirecto('live');
          notificar('🗑 Resultado del cruce borrado');
        }
      });
    });
  }

  /* ---------------- PESTAÑAS ---------------- */
  function initTabs(){
    document.querySelectorAll('.tab-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var target = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.toggle('active', b === btn); });
        document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.toggle('active', p.id === 'tab-'+target); });
      });
    });
  }

  /* ---------------- ADMIN ---------------- */
  var isAdmin = false;
  function applyLiveLock(){
    var els = document.querySelectorAll('#tab-live input.score-input, #tab-live input.kscore, #tab-live .pbtn, #tab-live .score-clear-btn, #tab-live .kmatch-clear-btn');
    els.forEach(function(el){ el.disabled = isAdmin ? false : true; });
  }

  function setupAdminAuth(){
    var toggleBtn = document.getElementById('adminToggleBtn');
    var login = document.getElementById('adminLogin');
    var pwInput = document.getElementById('adminPasswordInput');
    var submitBtn = document.getElementById('adminSubmitBtn');
    var statusText = document.getElementById('adminStatusText');
    if(!toggleBtn) return;

    function setAdmin(v){
      isAdmin = v;
      if(!isAdmin && textEditMode) setTextEditMode(false);
      toggleBtn.textContent = isAdmin ? '🔓 Cerrar sesión' : '🔐 Modo Administrador';
      if(statusText) statusText.textContent = isAdmin ? '✅ Administrador activo' : '';
      document.body.classList.toggle('admin-mode', isAdmin);
      if(login) login.classList.toggle('show', !isAdmin);
      applyLiveLock();
      rebuildAll();
    }

    toggleBtn.addEventListener('click', function(){
      if(isAdmin){ setAdmin(false); notificar('🔒 Sesión de administrador cerrada'); }
      else { if(login) login.classList.toggle('show'); }
    });

    if(submitBtn && pwInput){
      function tryLogin(){
        if(pwInput.value === ADMIN_PASSWORD){
          setAdmin(true);
          notificar('🔓 Bienvenido, administrador');
          if(login) login.classList.remove('show');
          pwInput.value = '';
        } else {
          notificar('❌ Contraseña incorrecta');
        }
      }
      submitBtn.addEventListener('click', tryLogin);
      pwInput.addEventListener('keydown', function(e){ if(e.key === 'Enter') tryLogin(); });
    }
    setAdmin(false);
  }

  /* ---------------- EQUIPOS ---------------- */
  function renderTeamsGrid(){
    var grid = document.getElementById('teamsGrid');
    if(!grid) return;
    if(!teams.length){
      grid.innerHTML = '<div class="teams-empty">Aún no hay equipos. Activa el Modo Administrador y añade el primero.</div>';
      return;
    }
    grid.innerHTML = teams.map(function(t, idx){
      return '<div class="team-row">' +
        '<div class="team-row-flag">'+flagImgHtml(t,'team-row-flag')+'</div>' +
        '<div class="tr-info"><span class="tr-name">'+escapeHtml(t.name)+'</span><span class="tr-owner">'+escapeHtml(t.owner||'Sin responsable')+'</span></div>' +
        '<button type="button" class="tr-del" data-idx="'+idx+'" title="Eliminar equipo">🗑</button>' +
      '</div>';
    }).join('');
  }

  function initTeamsAdmin(){
    var addBtn = document.getElementById('teamAddBtn');
    if(addBtn){
      addBtn.addEventListener('click', addTeam);
      var nameInput = document.getElementById('teamNameInput');
      if(nameInput) nameInput.addEventListener('keydown', function(e){ if(e.key === 'Enter') addTeam(); });
    }
    var logoFile = document.getElementById('teamLogoFile');
    if(logoFile){
      logoFile.addEventListener('change', function(e){
        var f = e.target.files && e.target.files[0];
        if(f) uploadTeamLogo(f);
        e.target.value = '';
      });
    }
    var grid = document.getElementById('teamsGrid');
    if(grid){
      grid.addEventListener('click', function(e){
        var btn = e.target.closest ? e.target.closest('.tr-del') : null;
        if(!btn) return;
        if(!isAdmin){ notificar('🔒 Activa el Modo Administrador'); return; }
        var idx = Number(btn.getAttribute('data-idx'));
        var name = teams[idx] ? teams[idx].name : '';
        if(!confirm('¿Eliminar a "'+name+'" de '+COMP.nombre+'? Se borrarán también los resultados y predicciones de esta competición.')) return;
        teams.splice(idx, 1);
        saveTeams();
        clearAllScores();
        rebuildAll();
        notificar('🗑 Equipo eliminado');
      });
    }
    var clearLiveBtn = document.getElementById('clearLiveBtn');
    if(clearLiveBtn){
      clearLiveBtn.addEventListener('click', clearLive);
    }
  }

  var _pendingTeamLogo = null;
  function uploadTeamLogo(file){
    var storage = getFbStorage();
    if(!storage){ notificar('⚠️ No se pudo conectar con el almacenamiento en la nube'); return; }
    var pid = 'tlogo'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
    var ref = storage.ref('draftbank/'+COMP.id+'/teamlogos/'+pid);
    notificar('⬆️ Subiendo logo del equipo…');
    ref.put(file).then(function(snap){ return snap.ref.getDownloadURL(); })
      .then(function(url){
        _pendingTeamLogo = url;
        var input = document.getElementById('teamLogoUrl');
        if(input) input.value = url;
        notificar('✅ Logo listo (pulsa "Añadir equipo" para guardar)');
      })
      .catch(function(err){
        console.error(err);
        notificar('❌ No se pudo subir el logo' + (err && err.message ? ': '+err.message : ''));
      });
  }

  function addTeam(){
    if(!isAdmin){ notificar('🔒 Activa el Modo Administrador para editar equipos'); return; }
    var nameInput = document.getElementById('teamNameInput');
    var ownerInput = document.getElementById('teamOwnerInput');
    var flagInput = document.getElementById('teamFlagInput');
    var logoInput = document.getElementById('teamLogoUrl');
    if(!nameInput) return;
    var name = nameInput.value.trim();
    if(!name){ notificar('⚠️ Escribe el nombre del equipo'); return; }
    var logo = (logoInput && logoInput.value.trim()) || _pendingTeamLogo || '';
    teams.push({ id:'t'+Date.now()+'_'+teams.length, name:name, owner:(ownerInput?ownerInput.value.trim():''), flag:(flagInput?flagInput.value.trim():''), logo:logo });
    saveTeams();
    nameInput.value = ''; if(ownerInput) ownerInput.value = ''; if(flagInput) flagInput.value = '';
    if(logoInput) logoInput.value = '';
    _pendingTeamLogo = null;
    clearAllScores();
    rebuildAll();
    notificar('✅ Equipo añadido a '+COMP.nombre+' · se reiniciaron los marcadores');
  }

  function clearLive(){
    if(!isAdmin){ notificar('🔒 Activa el Modo Administrador'); return; }
    if(!confirm('¿Borrar todos los resultados "En Directo" de '+COMP.nombre+'?')) return;
    live = { matches:{} };
    saveLive();
    rebuildAll();
    notificar('🗑 Resultados en directo borrados');
  }

  function rebuildAll(){
    if(MODO === 'liga'){
      buildLigaRounds();
      renderLigaTable('live'); renderLigaTable('pred');
      renderLigaMatches('live'); renderLigaMatches('pred');
    } else {
      renderDirecto('live'); renderDirecto('pred');
    }
    renderTeamsGrid();
    renderSquadsTeamList();
    if(currentSquadTeam) renderSquadDetail(currentSquadTeam);
    renderCalendar();
    renderStatsLeaderboards();
    renderStatsExtras();
    renderFame();
    renderRulesNews();
    applyLiveLock();
  }

  /* ---------------- MODO PREDICCIÓN + BOTONES ---------------- */
  function initModeSwitches(){
    var gm = document.getElementById('groupModeSwitch');
    if(gm){
      gm.querySelectorAll('.mode-btn').forEach(function(btn){
        btn.classList.toggle('active', (btn.dataset.mode === 'detailed') === pred.detail);
        btn.addEventListener('click', function(){
          gm.querySelectorAll('.mode-btn').forEach(function(b){ b.classList.toggle('active', b === btn); });
          pred.detail = (btn.dataset.mode === 'detailed');
          savePred();
          renderLigaMatches('pred');
          renderLigaTable('pred');
        });
      });
    }
    var km = document.getElementById('koModeSwitch');
    if(km){
      km.querySelectorAll('.mode-btn').forEach(function(btn){
        btn.classList.toggle('active', (btn.dataset.mode === 'pick') === pred.koPick);
        btn.addEventListener('click', function(){
          km.querySelectorAll('.mode-btn').forEach(function(b){ b.classList.toggle('active', b === btn); });
          pred.koPick = (btn.dataset.mode === 'pick');
          savePred();
          renderDirecto('pred');
        });
      });
    }
    var hint = document.getElementById('groupModeHint');
    if(hint){
      hint.textContent = pred.detail
        ? 'Introduce el marcador de cada partido y la clasificación se calcula sola.'
        : 'Elige 1 (local), X (empate) o 2 (visitante) por partido. La clasificación se calcula sola.';
    }
    var khint = document.getElementById('koModeHint');
    if(khint){
      khint.textContent = pred.koPick
        ? 'Toca el equipo que crees que gana cada cruce. Un segundo toque lo deselecciona.'
        : 'Introduce el resultado de cada cruce; en caso de empate define el ganador por penaltis.';
    }
  }

  function initPredButtons(){
    var reset = document.getElementById('predResetBtn');
    if(reset){
      reset.addEventListener('click', function(){
        if(!confirm('¿Reiniciar "Mi Predicción" de '+COMP.nombre+'? Se borrarán tus marcadores y elecciones de este navegador.')) return;
        pred.matches = {};
        savePred();
        if(MODO === 'liga'){ renderLigaMatches('pred'); renderLigaTable('pred'); }
        else renderDirecto('pred');
        notificar('🔄 Predicción reiniciada');
      });
    }
    var load = document.getElementById('loadLiveBtn');
    if(load){
      load.addEventListener('click', function(){
        pred.matches = JSON.parse(JSON.stringify(live.matches));
        savePred();
        if(MODO === 'liga'){ renderLigaMatches('pred'); renderLigaTable('pred'); }
        else renderDirecto('pred');
        notificar('⬇ Resultados en directo copiados a tu predicción');
      });
    }
  }

  /* ---------------- INIT ---------------- */
  function init(){
    applyCustomTexts();
    setupTextEditing();
    initCloudSync();
    applyAccent();
    setupColorSettings();
    setupSorteo();
    if(MODO === 'liga'){
      buildLigaRounds();
      renderLigaTable('live'); renderLigaTable('pred');
      renderLigaMatches('live'); renderLigaMatches('pred');
    } else {
      renderDirecto('live'); renderDirecto('pred');
    }
    initTabs();
    setupAdminAuth();
    initTeamsAdmin();
    initModeSwitches();
    initPredButtons();
    initLigaEvents();
    initDirectoEvents();
    setupSquadsUI();
    setupCalendarUI();
    setupStatsUI();
    setupRulesNewsUI();
    renderTeamsGrid();
    renderSquadsTeamList();
    renderCalendar();
    renderStatsLeaderboards();
    renderStatsExtras();
    renderFame();
    renderRulesNews();
    applyLiveLock();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

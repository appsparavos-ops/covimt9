// ============================================================
// MÁQUINAS Y HERRAMIENTAS — Inventario (fase inicial)
// ============================================================
const MaquinasHerramientas = (() => {
  'use strict';
  let inventario = [];
  let prestamos = [];
  let entregas = [];
  let itemsPrestamo = [];
  let devoluciones = [];
  let reparaciones = [];
  let setsInventario = [];
  let unsubscribes = [];
  let carritoEntrega = [];
  let carritoSets = [];
  let componentesSetEdicion = [];
  let colaEntregasJornada = [];
  let entregaAbiertaDesdeJornada = false;
  let fechaJornadaEntrega = '';
  let scannerStream = null;
  let scannerTimer = null;
  let iniciado = false;
  let csvValido = [];
  let csvErrores = [];

  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const norm = (v) => String(v ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nowIso = () => new Date().toISOString();
  const uid = () => (firebase.auth().currentUser || {}).uid || 'offline';
  const docId = codigo => norm(codigo).replace(/[^A-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const editando = () => typeof modoEdicion !== 'undefined' && modoEdicion;

  function init() {
    if (iniciado) return;
    iniciado = true;
    bindUI();
    firebase.auth().onAuthStateChanged(user => {
      if (user) waitForDbAndListen();
      else stopListen();
    });
  }

  function waitForDbAndListen(intentos = 0) {
    if (typeof db !== 'undefined' && db) return listen();
    if (intentos < 40) setTimeout(() => waitForDbAndListen(intentos + 1), 125);
  }

  function stopListen() {
    unsubscribes.forEach(fn => fn && fn());
    unsubscribes = [];
    inventario = [];
    prestamos = [];
    entregas = [];
    itemsPrestamo = [];
    devoluciones = [];
    reparaciones = [];
    setsInventario = [];
    render();
  }

  function listen() {
    if (unsubscribes.length) return;
    unsubscribes.push(db.collection('inventario').onSnapshot(snapshot => {
      inventario = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    }, error => showToast('Error al sincronizar inventario: ' + error.message, 'error')));
    unsubscribes.push(db.collection('prestamos').onSnapshot(snapshot => {
      prestamos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderPrestamos();
      if (typeof renderJornadasActivas === 'function') renderJornadasActivas();
    }, error => showToast('Error al sincronizar préstamos: ' + error.message, 'error')));
    unsubscribes.push(db.collection('entregasPrestamo').onSnapshot(snapshot => {
      entregas = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderPrestamos();
    }, error => console.warn('No se pudieron leer las entregas:', error.message)));
    unsubscribes.push(db.collection('prestamoItems').onSnapshot(snapshot => {
      itemsPrestamo = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }, error => showToast('Error al leer artículos prestados: ' + error.message, 'error')));
    unsubscribes.push(db.collection('devolucionesPrestamo').onSnapshot(snapshot => {
      devoluciones = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderPrestamos();
    }, error => console.warn('No se pudieron leer las devoluciones:', error.message)));
    unsubscribes.push(db.collection('reparaciones').onSnapshot(snapshot => {
      reparaciones = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderReparaciones();
      renderKpis();
    }, error => showToast('Error al leer reparaciones: ' + error.message, 'error')));
    unsubscribes.push(db.collection('setsInventario').onSnapshot(snapshot => {
      setsInventario = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderSets();
      filtrarDatalistEntrega();
    }, error => showToast('Error al leer sets: ' + error.message, 'error')));
  }

  function bindUI() {
    document.getElementById('mh-buscar')?.addEventListener('input', renderTabla);
    document.getElementById('mh-filtro-tipo')?.addEventListener('change', renderTabla);
    document.getElementById('mh-filtro-estado')?.addEventListener('change', renderTabla);
    document.getElementById('mh-form-inventario')?.addEventListener('submit', guardarArticulo);
    document.getElementById('mh-tipo')?.addEventListener('change', aplicarReglasTipo);
    document.getElementById('mh-control')?.addEventListener('change', aplicarReglasControl);
    document.getElementById('mh-csv-input')?.addEventListener('change', leerCSV);
    document.getElementById('mh-form-entrega')?.addEventListener('submit', confirmarEntrega);
    document.getElementById('mh-entrega-socio')?.addEventListener('change', poblarReceptores);
    document.getElementById('mh-entrega-destino')?.addEventListener('change', actualizarModalEntrega);
    document.getElementById('mh-entrega-codigo')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); agregarArticuloEntrega(); } });
    document.getElementById('mh-form-devolucion')?.addEventListener('submit', confirmarDevolucion);
    document.getElementById('mh-form-reparacion')?.addEventListener('submit', guardarReparacion);
    document.getElementById('mh-form-set')?.addEventListener('submit', guardarSet);
    setEditMode(editando());
  }

  function setEditMode(activo) {
    document.querySelectorAll('.mh-edit-only').forEach(el => el.classList.toggle('hidden', !activo));
    if (!activo) {
      closeModal('mh-modal-inventario');
      closeModal('mh-modal-csv');
      closeModal('mh-modal-set');
    }
    renderTabla();
    renderSets();
  }

  function render() {
    renderKpis();
    renderTabla();
    renderPrestamos();
    renderReparaciones();
    renderSets();
    setEditMode(editando());
  }

  function disponibilidad(item) {
    if (item.estado === 'BAJA' || item.estado === 'NO_REPARABLE') return 0;
    const total = Number(item.cantidadTotal || 0);
    const prestada = Number(item.cantidadPrestada || 0);
    const reparacion = Number(item.cantidadReparacion || 0);
    const perdida = Number(item.cantidadPerdida || 0);
    return Math.max(0, total - prestada - reparacion - perdida);
  }

  function renderKpis() {
    const activos = inventario.filter(i => i.estado !== 'BAJA');
    const unidades = activos.reduce((n, i) => n + Number(i.cantidadTotal || 0), 0);
    const disponibles = activos.reduce((n, i) => n + disponibilidad(i), 0);
    const reparacion = activos.reduce((n, i) => n + Number(i.cantidadReparacion || 0), 0);
    setText('mh-kpi-articulos', activos.length);
    setText('mh-kpi-unidades', unidades);
    setText('mh-kpi-disponibles', disponibles);
    setText('mh-kpi-reparacion', reparacion);
  }

  function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }

  function renderTabla() {
    const tbody = document.getElementById('mh-inventario-body');
    const empty = document.getElementById('mh-inventario-empty');
    if (!tbody) return;
    const q = norm(document.getElementById('mh-buscar')?.value || '');
    const tipo = document.getElementById('mh-filtro-tipo')?.value || 'TODOS';
    const estado = document.getElementById('mh-filtro-estado')?.value || 'ACTIVOS';
    const lista = inventario.filter(i => {
      const coincide = !q || norm([i.codigo, i.nombre, i.marca, i.modelo, i.numeroSerie].join(' ')).includes(q);
      const coincideTipo = tipo === 'TODOS' || i.tipo === tipo;
      const coincideEstado = estado === 'TODOS' || (estado === 'ACTIVOS' ? i.estado !== 'BAJA' : i.estado === estado);
      return coincide && coincideTipo && coincideEstado;
    }).sort((a,b) => norm(a.nombre).localeCompare(norm(b.nombre)) || norm(a.codigo).localeCompare(norm(b.codigo)));

    tbody.innerHTML = lista.map(i => {
      const disp = disponibilidad(i);
      const destino = i.tipo === 'MAQUINA' ? 'Sólo obra' : ({OBRA:'Sólo obra',PERSONAL:'Sólo personal',AMBOS:'Obra y personal'}[i.destinoPermitido] || i.destinoPermitido);
      const estadoClase = i.estado === 'BAJA' ? 'mh-badge-red' : disp > 0 ? 'mh-badge-green' : 'mh-badge-amber';
      return `<tr>
        <td><span class="mh-code">${esc(i.codigo)}</span></td>
        <td><strong>${esc(i.nombre)}</strong><br><small>${esc([i.marca,i.modelo,i.numeroSerie].filter(Boolean).join(' · '))}</small></td>
        <td>${i.tipo === 'MAQUINA' ? 'Máquina' : 'Herramienta'}<br><small>${i.control === 'UNIDAD' ? 'Individual' : 'Por cantidad'}</small></td>
        <td>${esc(destino)}</td>
        <td>${disp} / ${Number(i.cantidadTotal || 0)}</td>
        <td><span class="mh-badge ${estadoClase}">${i.estado === 'BAJA' ? 'Baja' : disp > 0 ? 'Disponible' : 'Sin disponibilidad'}</span></td>
        <td>${esc(i.ubicacion || '—')}</td>
        <td>${editando() ? `<button class="mh-btn mh-btn-secondary" onclick="MaquinasHerramientas.editar('${esc(i.id)}')">Editar</button> ${i.estado !== 'BAJA' ? `<button class="mh-btn mh-btn-danger" onclick="MaquinasHerramientas.baja('${esc(i.id)}')">Baja</button>` : ''}` : '—'}</td>
      </tr>`;
    }).join('');
    empty?.classList.toggle('mh-hidden', lista.length > 0);
    lucide.createIcons();
  }

  function openNuevo() {
    if (!editando()) return showToast('Active el Modo Edición para administrar el inventario.', 'info');
    document.getElementById('mh-form-inventario')?.reset();
    setValue('mh-doc-id', ''); setValue('mh-tipo','HERRAMIENTA'); setValue('mh-control','CANTIDAD');
    setValue('mh-cantidad','1'); setValue('mh-destino','AMBOS'); setValue('mh-estado','DISPONIBLE');
    document.getElementById('mh-modal-titulo').textContent = 'Nuevo artículo';
    aplicarReglasTipo(); aplicarReglasControl();
    openModal('mh-modal-inventario');
  }

  function editar(id) {
    if (!editando()) return;
    const i = inventario.find(x => x.id === id); if (!i) return;
    setValue('mh-doc-id', i.id); setValue('mh-codigo', i.codigo); setValue('mh-nombre', i.nombre);
    setValue('mh-tipo', i.tipo); setValue('mh-control', i.control); setValue('mh-cantidad', i.cantidadTotal);
    setValue('mh-marca', i.marca); setValue('mh-modelo', i.modelo); setValue('mh-serie', i.numeroSerie);
    setValue('mh-destino', i.destinoPermitido); setValue('mh-estado', i.estado || 'DISPONIBLE');
    setValue('mh-ubicacion', i.ubicacion); setValue('mh-observaciones', i.observaciones);
    document.getElementById('mh-modal-titulo').textContent = 'Editar artículo';
    aplicarReglasTipo(); aplicarReglasControl(); openModal('mh-modal-inventario');
  }

  function setValue(id,v){ const el=document.getElementById(id); if(el) el.value=v ?? ''; }
  function openModal(id){ document.getElementById(id)?.classList.remove('mh-hidden'); }
  function closeModal(id){ document.getElementById(id)?.classList.add('mh-hidden'); }

  function aplicarReglasTipo() {
    const maquina = document.getElementById('mh-tipo')?.value === 'MAQUINA';
    const control = document.getElementById('mh-control'); const destino = document.getElementById('mh-destino');
    if (maquina) { control.value='UNIDAD'; control.disabled=true; destino.value='OBRA'; destino.disabled=true; }
    else { control.disabled=false; destino.disabled=false; }
    aplicarReglasControl();
  }

  function aplicarReglasControl() {
    const unidad = document.getElementById('mh-control')?.value === 'UNIDAD';
    const cant = document.getElementById('mh-cantidad');
    if (cant) { if (unidad) cant.value='1'; cant.readOnly=unidad; }
    document.getElementById('mh-serie-wrap')?.classList.toggle('mh-hidden', !unidad);
  }

  function dataFormulario() {
    const tipo = document.getElementById('mh-tipo').value;
    const control = tipo === 'MAQUINA' ? 'UNIDAD' : document.getElementById('mh-control').value;
    const cantidad = control === 'UNIDAD' ? 1 : Number(document.getElementById('mh-cantidad').value);
    return {
      codigo: norm(document.getElementById('mh-codigo').value), nombre: document.getElementById('mh-nombre').value.trim(),
      tipo, control, cantidadTotal: cantidad, marca: document.getElementById('mh-marca').value.trim(),
      modelo: document.getElementById('mh-modelo').value.trim(), numeroSerie: document.getElementById('mh-serie').value.trim(),
      destinoPermitido: tipo === 'MAQUINA' ? 'OBRA' : document.getElementById('mh-destino').value,
      estado: document.getElementById('mh-estado').value, ubicacion: document.getElementById('mh-ubicacion').value.trim(),
      observaciones: document.getElementById('mh-observaciones').value.trim()
    };
  }

  function validar(data, idActual='') {
    if (!data.codigo || !/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(data.codigo)) return 'El código debe tener 2 a 40 caracteres: letras, números, guion o guion bajo.';
    if (!data.nombre) return 'Ingrese el nombre del artículo.';
    if (!['MAQUINA','HERRAMIENTA'].includes(data.tipo)) return 'Tipo de artículo inválido.';
    if (!['UNIDAD','CANTIDAD'].includes(data.control)) return 'Control de inventario inválido.';
    if (!['OBRA','PERSONAL','AMBOS'].includes(data.destinoPermitido)) return 'Destino permitido inválido.';
    if (!['DISPONIBLE','BAJA'].includes(data.estado)) return 'Estado administrativo inválido.';
    if (!Number.isInteger(data.cantidadTotal) || data.cantidadTotal < 1 || data.cantidadTotal > 9999) return 'La cantidad debe ser un entero entre 1 y 9999.';
    if (data.tipo === 'MAQUINA' && (data.control !== 'UNIDAD' || data.destinoPermitido !== 'OBRA')) return 'Las máquinas deben ser individualizadas y sólo para obra.';
    const repetido = inventario.find(i => norm(i.codigo) === data.codigo && i.id !== idActual);
    if (repetido) return `El código ${data.codigo} ya pertenece a ${repetido.nombre}.`;
    const previo = inventario.find(i => i.id === idActual);
    if (previo && data.cantidadTotal < Number(previo.cantidadPrestada || 0) + Number(previo.cantidadReparacion || 0) + Number(previo.cantidadPerdida || 0)) return 'La cantidad total no puede ser menor que las unidades no disponibles.';
    return '';
  }

  async function guardarArticulo(event) {
    event.preventDefault(); if (!editando()) return;
    const oldId = document.getElementById('mh-doc-id').value;
    const data = dataFormulario(); const error = validar(data, oldId);
    if (error) return showToast(error, 'error');
    const id = docId(data.codigo); const previo = inventario.find(i => i.id === oldId);
    if (oldId && id !== oldId) return showToast('El código no puede cambiarse al editar. Cree otro artículo y dé de baja el anterior.', 'error');
    const payload = { ...data, cantidadPrestada:Number(previo?.cantidadPrestada||0), cantidadReparacion:Number(previo?.cantidadReparacion||0), cantidadPerdida:Number(previo?.cantidadPerdida||0), actualizadoEn:nowIso(), actualizadoPor:uid(), creadoEn:previo?.creadoEn||nowIso() };
    try {
      if (!navigator.onLine) {
        OfflineSync.enqueue('inventario', id, 'set', payload); upsertLocal(id,payload);
        showToast('Artículo guardado offline. Se sincronizará al recuperar conexión.', 'info');
      } else { await db.collection('inventario').doc(id).set(payload); showToast('Artículo guardado.', 'success'); }
      closeModal('mh-modal-inventario');
      if (typeof registrarLog === 'function') registrarLog('Inventario', `${oldId?'Modificado':'Creado'} ${data.codigo} — ${data.nombre}.`);
    } catch(e){ showToast('No se pudo guardar: '+e.message,'error'); }
  }

  function upsertLocal(id,data){ const idx=inventario.findIndex(i=>i.id===id); if(idx>=0) inventario[idx]={id,...data}; else inventario.push({id,...data}); render(); }

  async function baja(id) {
    if (!editando()) return;
    const i=inventario.find(x=>x.id===id); if(!i) return;
    if (Number(i.cantidadPrestada||0)>0 || Number(i.cantidadReparacion||0)>0) return showToast('No se puede dar de baja mientras tenga unidades prestadas o en reparación.','error');
    if (!await showConfirmModal('Dar de baja', `¿Dar de baja ${i.codigo} — ${i.nombre}? El historial se conservará.`)) return;
    const data={estado:'BAJA',actualizadoEn:nowIso(),actualizadoPor:uid()};
    try { if(!navigator.onLine){OfflineSync.enqueue('inventario',id,'merge',data);upsertLocal(id,{...i,...data});} else await db.collection('inventario').doc(id).set(data,{merge:true}); showToast('Artículo dado de baja.','info'); }
    catch(e){showToast('No se pudo dar de baja: '+e.message,'error');}
  }

  function abrirCSV(){ if(!editando()) return; csvValido=[];csvErrores=[]; const input=document.getElementById('mh-csv-input'); if(input){input.value='';input.click();} }
  function descargarPlantilla(){
    const contenido='codigo;nombre;tipo;control;cantidad;marca;modelo;numero_serie;destino_permitido;estado;ubicacion;observaciones\nMAQ-001;Bordeadora;MAQUINA;UNIDAD;1;Ejemplo;ABC;SERIE-001;OBRA;DISPONIBLE;Pañol;Ejemplo, reemplazar o eliminar\nHER-001;Escobilla;HERRAMIENTA;CANTIDAD;10;;;;AMBOS;DISPONIBLE;Pañol;';
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+contenido],{type:'text/csv;charset=utf-8'}));a.download='plantilla_inventario_covimt9.csv';a.click();URL.revokeObjectURL(a.href);
  }

  function parseCSV(texto){
    const lineas=texto.replace(/^\uFEFF/,'').split(/\r?\n/).filter(l=>l.trim()); if(!lineas.length)return[];
    const delim=(lineas[0].match(/;/g)||[]).length >= (lineas[0].match(/,/g)||[]).length?';':',';
    return lineas.map(line=>{let out=[],cur='',quote=false;for(let x=0;x<line.length;x++){const c=line[x];if(c==='"'){if(quote&&line[x+1]==='"'){cur+='"';x++;}else quote=!quote;}else if(c===delim&&!quote){out.push(cur.trim());cur='';}else cur+=c;}out.push(cur.trim());return out;});
  }

  function leerCSV(event){
    const file=event.target.files?.[0]; if(!file)return;
    const reader=new FileReader(); reader.onload=e=>previsualizarCSV(e.target.result,file.name); reader.readAsText(file,'UTF-8');
  }

  function previsualizarCSV(texto,nombre){
    csvValido=[];csvErrores=[]; const rows=parseCSV(texto); if(rows.length<2)return showToast('El CSV no contiene filas de datos.','error');
    const header=rows[0].map(norm); const aliases={CODIGO:'codigo',NOMBRE:'nombre',TIPO:'tipo',CONTROL:'control',CANTIDAD:'cantidadTotal',MARCA:'marca',MODELO:'modelo',NUMERO_SERIE:'numeroSerie',DESTINO_PERMITIDO:'destinoPermitido',ESTADO:'estado',UBICACION:'ubicacion',OBSERVACIONES:'observaciones'};
    const cols=header.map(h=>aliases[h]||''); const required=['codigo','nombre','tipo','control','cantidadTotal'];
    const faltan=required.filter(r=>!cols.includes(r)); if(faltan.length)return showToast('Faltan columnas obligatorias: '+faltan.join(', '),'error');
    const vistos=new Set();
    rows.slice(1).forEach((row,idx)=>{
      const raw={};cols.forEach((key,i)=>{if(key)raw[key]=row[i]||'';});
      const data={codigo:norm(raw.codigo),nombre:String(raw.nombre||'').trim(),tipo:norm(raw.tipo),control:norm(raw.control),cantidadTotal:Number(raw.cantidadTotal),marca:String(raw.marca||'').trim(),modelo:String(raw.modelo||'').trim(),numeroSerie:String(raw.numeroSerie||'').trim(),destinoPermitido:norm(raw.destinoPermitido||'OBRA'),estado:norm(raw.estado||'DISPONIBLE'),ubicacion:String(raw.ubicacion||'').trim(),observaciones:String(raw.observaciones||'').trim()};
      if(data.tipo==='MAQUINA'){data.control='UNIDAD';data.cantidadTotal=1;data.destinoPermitido='OBRA';}
      const id=docId(data.codigo); let error=validar(data,id);
      if(vistos.has(data.codigo))error='Código duplicado dentro del archivo.'; vistos.add(data.codigo);
      if(error)csvErrores.push({fila:idx+2,codigo:data.codigo||'—',error}); else csvValido.push({id,data});
    });
    setText('mh-csv-nombre',nombre);setText('mh-csv-validos',csvValido.length);setText('mh-csv-errores',csvErrores.length);
    const body=document.getElementById('mh-csv-preview-body');body.innerHTML=[...csvValido.slice(0,20).map(x=>`<tr><td>${esc(x.data.codigo)}</td><td>${esc(x.data.nombre)}</td><td><span class="mh-badge mh-badge-green">Válido</span></td></tr>`),...csvErrores.slice(0,20).map(x=>`<tr><td>Fila ${x.fila}: ${esc(x.codigo)}</td><td colspan="2"><span class="mh-badge mh-badge-red">${esc(x.error)}</span></td></tr>`)].join('');
    document.getElementById('mh-btn-importar').disabled=csvValido.length===0||csvErrores.length>0; openModal('mh-modal-csv');
  }

  async function importarCSV(){
    if(!editando()||!csvValido.length||csvErrores.length)return;
    const btn=document.getElementById('mh-btn-importar');btn.disabled=true;btn.textContent='Importando…';
    try{
      const marca=nowIso();
      if(!navigator.onLine){csvValido.forEach(({id,data})=>{const previo=inventario.find(i=>i.id===id);const payload={...data,cantidadPrestada:Number(previo?.cantidadPrestada||0),cantidadReparacion:Number(previo?.cantidadReparacion||0),cantidadPerdida:Number(previo?.cantidadPerdida||0),creadoEn:previo?.creadoEn||marca,actualizadoEn:marca,actualizadoPor:uid()};OfflineSync.enqueue('inventario',id,'set',payload);upsertLocal(id,payload);});}
      else { for(let inicio=0;inicio<csvValido.length;inicio+=400){const batch=db.batch();csvValido.slice(inicio,inicio+400).forEach(({id,data})=>{const previo=inventario.find(i=>i.id===id);batch.set(db.collection('inventario').doc(id),{...data,cantidadPrestada:Number(previo?.cantidadPrestada||0),cantidadReparacion:Number(previo?.cantidadReparacion||0),cantidadPerdida:Number(previo?.cantidadPerdida||0),creadoEn:previo?.creadoEn||marca,actualizadoEn:marca,actualizadoPor:uid()});});await batch.commit();}}
      if(typeof registrarLog==='function')registrarLog('Importación inventario',`${csvValido.length} artículos importados desde CSV.`);
      showToast(`${csvValido.length} artículos importados${navigator.onLine?'':' offline'}.`,'success');closeModal('mh-modal-csv');
    }catch(e){showToast('Error al importar: '+e.message,'error');}finally{btn.disabled=false;btn.textContent='Importar inventario';}
  }

  // ------------------------------------------------------------
  // SETS DE INVENTARIO
  // ------------------------------------------------------------
  function componentesActivosSet(set) {
    return Array.isArray(set?.componentes) ? set.componentes.filter(c => c && c.inventarioId && Number(c.cantidad || 0) > 0) : [];
  }

  function disponibilidadSet(set) {
    const obligatorios = componentesActivosSet(set).filter(c => c.obligatorio !== false);
    if (!obligatorios.length || set.estado === 'BAJA') return 0;
    return Math.max(0, Math.min(...obligatorios.map(c => {
      const item = inventario.find(i => i.id === c.inventarioId);
      return item ? Math.floor(disponibilidad(item) / Number(c.cantidad || 1)) : 0;
    })));
  }

  function estadoDisponibilidadSet(set) {
    const componentes = componentesActivosSet(set);
    const faltanObligatorios = componentes.some(c => c.obligatorio !== false && disponibilidad(inventario.find(i => i.id === c.inventarioId) || {}) < Number(c.cantidad || 1));
    const alguno = componentes.some(c => disponibilidad(inventario.find(i => i.id === c.inventarioId) || {}) > 0);
    if (!faltanObligatorios) return { texto:'Disponible completo', clase:'mh-badge-green' };
    if (alguno && set.permiteEntregaParcial) return { texto:'Disponible parcial', clase:'mh-badge-amber' };
    return { texto:'No disponible', clase:'mh-badge-red' };
  }

  function renderSets() {
    const body=document.getElementById('mh-sets-body'); if(!body)return;
    const q=norm(document.getElementById('mh-set-buscar')?.value||'');
    const filtro=document.getElementById('mh-set-filtro')?.value||'ACTIVOS';
    const lista=setsInventario.filter(s => (filtro==='TODOS'||(filtro==='ACTIVOS'&&s.estado!=='BAJA')||s.estado===filtro) && (!q||norm([s.codigo,s.nombre].join(' ')).includes(q))).sort((a,b)=>norm(a.nombre).localeCompare(norm(b.nombre)));
    body.innerHTML=lista.map(s=>{
      const estado=s.estado==='BAJA'?{texto:'Baja',clase:'mh-badge-red'}:estadoDisponibilidadSet(s);
      const componentes=componentesActivosSet(s).map(c=>{const i=inventario.find(x=>x.id===c.inventarioId);return `${esc(i?.nombre||c.inventarioId)} × ${Number(c.cantidad)}${c.obligatorio===false?' (opcional)':''}`;}).join('<br>');
      return `<tr><td><span class="mh-code">${esc(s.codigo)}</span><br><strong>${esc(s.nombre)}</strong></td><td>${componentes||'Sin componentes'}</td><td>${s.destinoPermitido==='OBRA'?'Sólo obra':s.destinoPermitido==='PERSONAL'?'Sólo personal':'Obra y personal'}</td><td>${s.permiteEntregaParcial?'Admite parcial':'Completo obligatorio'}</td><td><span class="mh-badge ${estado.clase}">${estado.texto}</span><br><small>${disponibilidadSet(s)} completo(s)</small></td><td>${editando()?`<button class="mh-btn mh-btn-secondary" onclick="MaquinasHerramientas.editarSet('${esc(s.id)}')">Editar</button> ${s.estado!=='BAJA'?`<button class="mh-btn mh-btn-danger" onclick="MaquinasHerramientas.bajaSet('${esc(s.id)}')">Baja</button>`:''}`:'—'}</td></tr>`;
    }).join('');
    document.getElementById('mh-sets-empty')?.classList.toggle('mh-hidden',lista.length>0);lucide.createIcons();
  }

  function opcionesInventarioSet(tipo, seleccionado='') {
    const lista=inventario.filter(i=>i.estado!=='BAJA' && (tipo==='EXACTA'?i.control==='UNIDAD':true)).sort((a,b)=>norm(a.nombre).localeCompare(norm(b.nombre)));
    return '<option value="">Seleccione…</option>'+lista.map(i=>`<option value="${esc(i.id)}" ${i.id===seleccionado?'selected':''}>${esc(i.codigo)} — ${esc(i.nombre)} (${i.control==='UNIDAD'?'unidad':'cantidad'})</option>`).join('');
  }

  function renderComponentesSet() {
    const cont=document.getElementById('mh-set-componentes');if(!cont)return;
    cont.innerHTML=componentesSetEdicion.map((c,index)=>`<div class="mh-set-component-row">
      <select onchange="MaquinasHerramientas.cambiarComponenteSet(${index},'tipoReferencia',this.value)"><option value="EXACTA" ${c.tipoReferencia==='EXACTA'?'selected':''}>Unidad exacta</option><option value="GENERICO" ${c.tipoReferencia==='GENERICO'?'selected':''}>Artículo genérico</option></select>
      <select onchange="MaquinasHerramientas.cambiarComponenteSet(${index},'inventarioId',this.value)">${opcionesInventarioSet(c.tipoReferencia,c.inventarioId)}</select>
      <input type="number" min="1" max="999" step="1" value="${Number(c.cantidad||1)}" ${c.tipoReferencia==='EXACTA'?'readonly':''} onchange="MaquinasHerramientas.cambiarComponenteSet(${index},'cantidad',this.value)">
      <label class="mh-check"><input type="checkbox" ${c.obligatorio!==false?'checked':''} onchange="MaquinasHerramientas.cambiarComponenteSet(${index},'obligatorio',this.checked)"> Obligatorio</label>
      <button type="button" class="mh-btn mh-btn-danger" onclick="MaquinasHerramientas.quitarComponenteSet(${index})">Quitar</button>
    </div>`).join('');
    document.getElementById('mh-set-sin-componentes')?.classList.toggle('mh-hidden',componentesSetEdicion.length>0);
  }

  function agregarComponenteSet(){componentesSetEdicion.push({tipoReferencia:'GENERICO',inventarioId:'',cantidad:1,obligatorio:true});renderComponentesSet();}
  function quitarComponenteSet(index){componentesSetEdicion.splice(index,1);renderComponentesSet();}
  function cambiarComponenteSet(index,campo,valor){const c=componentesSetEdicion[index];if(!c)return;c[campo]=campo==='cantidad'?Number(valor):valor;if(campo==='tipoReferencia'){c.inventarioId='';if(valor==='EXACTA')c.cantidad=1;}renderComponentesSet();}

  function abrirNuevoSet(){
    if(!editando())return showToast('Active el Modo Edición para administrar sets.','info');
    document.getElementById('mh-form-set')?.reset();setValue('mh-set-id','');setValue('mh-set-destino','OBRA');setValue('mh-set-estado','ACTIVO');
    componentesSetEdicion=[];agregarComponenteSet();poblarPrincipalesSet();document.getElementById('mh-set-title').textContent='Nuevo set';openModal('mh-modal-set');
  }

  function poblarPrincipalesSet(seleccionado=''){
    const sel=document.getElementById('mh-set-principal');if(!sel)return;sel.innerHTML='<option value="">Sin artículo principal</option>'+inventario.filter(i=>i.estado!=='BAJA'&&i.control==='UNIDAD').sort((a,b)=>norm(a.nombre).localeCompare(norm(b.nombre))).map(i=>`<option value="${esc(i.id)}" ${i.id===seleccionado?'selected':''}>${esc(i.codigo)} — ${esc(i.nombre)}</option>`).join('');
  }

  function editarSet(id){
    if(!editando())return;const s=setsInventario.find(x=>x.id===id);if(!s)return;
    setValue('mh-set-id',id);setValue('mh-set-codigo',s.codigo);setValue('mh-set-nombre',s.nombre);setValue('mh-set-destino',s.destinoPermitido);setValue('mh-set-estado',s.estado||'ACTIVO');document.getElementById('mh-set-parcial').checked=Boolean(s.permiteEntregaParcial);setValue('mh-set-observaciones',s.observaciones);componentesSetEdicion=componentesActivosSet(s).map(c=>({...c}));poblarPrincipalesSet(s.articuloPrincipalId||'');renderComponentesSet();document.getElementById('mh-set-title').textContent='Editar set';openModal('mh-modal-set');
  }

  function validarSet(data,idActual=''){
    if(!data.codigo||!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(data.codigo))return 'El código del set debe tener 2 a 40 caracteres válidos.';
    if(!data.nombre)return 'Ingrese el nombre del set.';
    if(inventario.some(i=>norm(i.codigo)===data.codigo))return 'El código del set no puede coincidir con un artículo.';
    if(setsInventario.some(s=>norm(s.codigo)===data.codigo&&s.id!==idActual))return 'Ya existe otro set con ese código.';
    if(!data.componentes.length)return 'Agregue al menos un componente.';
    if(data.componentes.some(c=>!c.inventarioId||!Number.isInteger(c.cantidad)||c.cantidad<1))return 'Complete correctamente todos los componentes.';
    if(new Set(data.componentes.map(c=>c.inventarioId)).size!==data.componentes.length)return 'Un artículo no puede repetirse dentro del mismo set.';
    for(const c of data.componentes){const item=inventario.find(i=>i.id===c.inventarioId);if(!item)return 'Uno de los componentes ya no existe.';if(c.tipoReferencia==='EXACTA'&&item.control!=='UNIDAD')return `${item.nombre} no es una unidad individualizada.`;if(c.tipoReferencia==='EXACTA'&&c.cantidad!==1)return 'Las unidades exactas deben tener cantidad 1.';if(data.destinoPermitido==='PERSONAL'&&(item.tipo==='MAQUINA'||!['PERSONAL','AMBOS'].includes(item.destinoPermitido)))return `${item.nombre} no está habilitado para uso personal.`;if(data.destinoPermitido==='OBRA'&&!['OBRA','AMBOS'].includes(item.destinoPermitido))return `${item.nombre} no está habilitado para obra.`;if(data.destinoPermitido==='AMBOS'&&(item.tipo==='MAQUINA'||item.destinoPermitido!=='AMBOS'))return `${item.nombre} no puede integrar un set para ambos destinos.`;}
    if(data.articuloPrincipalId&&!data.componentes.some(c=>c.inventarioId===data.articuloPrincipalId))return 'El artículo principal debe formar parte de los componentes.';
    return '';
  }

  async function guardarSet(event){
    event.preventDefault();if(!editando())return;const oldId=document.getElementById('mh-set-id').value;const data={codigo:norm(document.getElementById('mh-set-codigo').value),nombre:document.getElementById('mh-set-nombre').value.trim(),destinoPermitido:document.getElementById('mh-set-destino').value,permiteEntregaParcial:document.getElementById('mh-set-parcial').checked,articuloPrincipalId:document.getElementById('mh-set-principal').value,estado:document.getElementById('mh-set-estado').value,observaciones:document.getElementById('mh-set-observaciones').value.trim(),componentes:componentesSetEdicion.map(c=>({...c,cantidad:Number(c.cantidad),obligatorio:c.obligatorio!==false}))};const error=validarSet(data,oldId);if(error)return showToast(error,'error');const id=docId(data.codigo);if(oldId&&oldId!==id)return showToast('El código del set no puede cambiarse al editar.','error');const previo=setsInventario.find(s=>s.id===oldId);const payload={...data,creadoEn:previo?.creadoEn||nowIso(),actualizadoEn:nowIso(),actualizadoPor:uid()};try{if(!navigator.onLine){OfflineSync.enqueue('setsInventario',id,'set',payload);const idx=setsInventario.findIndex(s=>s.id===id);if(idx>=0)setsInventario[idx]={id,...payload};else setsInventario.push({id,...payload});renderSets();}else await db.collection('setsInventario').doc(id).set(payload);if(typeof registrarLog==='function')registrarLog('Set de herramientas',`${oldId?'Modificado':'Creado'} ${data.codigo} — ${data.nombre}.`);closeModal('mh-modal-set');showToast('Set guardado.','success');}catch(e){showToast('No se pudo guardar el set: '+e.message,'error');}
  }

  async function bajaSet(id){if(!editando())return;const s=setsInventario.find(x=>x.id===id);if(!s)return;if(!await showConfirmModal('Dar de baja set',`¿Dar de baja ${s.codigo} — ${s.nombre}?`))return;const data={estado:'BAJA',actualizadoEn:nowIso(),actualizadoPor:uid()};try{if(!navigator.onLine){OfflineSync.enqueue('setsInventario',id,'merge',data);Object.assign(s,data);renderSets();}else await db.collection('setsInventario').doc(id).set(data,{merge:true});showToast('Set dado de baja.','info');}catch(e){showToast('No se pudo dar de baja: '+e.message,'error');}}

  // ------------------------------------------------------------
  // PRÉSTAMOS: entrega inicial y ampliaciones durante la jornada
  // ------------------------------------------------------------
  function fechaLocal(fecha = new Date()) {
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    const d = String(fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function sumarDias(fecha, dias) {
    const [y,m,d] = fecha.split('-').map(Number);
    const valor = new Date(y, m - 1, d, 12);
    valor.setDate(valor.getDate() + dias);
    return fechaLocal(valor);
  }

  function idOperacion(prefijo) {
    return `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  }

  function prestamoActivo(p) {
    return ['ABIERTO','DEVUELTO_PARCIAL'].includes(p.estado) && Number(p.totalPendiente || 0) > 0;
  }

  function renderPrestamos() {
    const body = document.getElementById('mh-prestamos-body');
    if (!body) return;
    const hoy = fechaLocal();
    const q = norm(document.getElementById('mh-prestamo-buscar')?.value || '');
    const filtro = document.getElementById('mh-prestamo-filtro')?.value || 'ACTIVOS';
    const lista = prestamos.filter(p => {
      const activo = prestamoActivo(p);
      const vencido = activo && p.vencimiento < hoy;
      const coincideFiltro = filtro === 'TODOS' || (filtro === 'ACTIVOS' && activo) || (filtro === 'VENCIDOS' && vencido) || p.estado === filtro;
      return coincideFiltro && (!q || norm([p.socioId,p.socioNombre,p.id].join(' ')).includes(q));
    }).sort((a,b) => String(b.actualizadoEn || b.creadoEn || '').localeCompare(String(a.actualizadoEn || a.creadoEn || '')));

    const activos = prestamos.filter(prestamoActivo);
    const vencidos = activos.filter(p => p.vencimiento < hoy);
    const vencenHoy = activos.filter(p => p.vencimiento === hoy);
    setText('mh-prestamos-activos', activos.length);
    setText('mh-prestamos-vencen', vencenHoy.length);
    setText('mh-prestamos-vencidos', vencidos.length);

    body.innerHTML = lista.map(p => {
      const vencido = prestamoActivo(p) && p.vencimiento < hoy;
      const estadoTexto = vencido ? 'Vencido' : ({ABIERTO:'Abierto',DEVUELTO_PARCIAL:'Devuelto parcialmente',CERRADO:'Cerrado'}[p.estado] || p.estado);
      const badge = vencido ? 'mh-badge-red' : prestamoActivo(p) ? 'mh-badge-green' : 'mh-badge-blue';
      const setsDetalle=(p.setsResumen||[]).map(s=>`<span class="mh-badge ${s.estado==='ENTREGADO_PARCIAL'||s.estado==='DEVOLUCION_PARCIAL'?'mh-badge-amber':s.estado==='CERRADO'?'mh-badge-blue':'mh-badge-green'}">${esc(s.nombre)} · ${esc(({ENTREGADO_PARCIAL:'parcial',ENTREGADO_COMPLETO:'completo',DEVOLUCION_PARCIAL:'devolución parcial',CERRADO:'cerrado'}[s.estado]||s.estado).toLowerCase())}</span>`).join(' ');
      const items = `${setsDetalle}${setsDetalle?'<br>':''}`+((p.resumenPendiente || []).filter(i => Number(i.cantidad || 0) > 0).map(i => `${esc(i.nombre)} × ${Number(i.cantidad)}`).join('<br>') || 'Sin pendientes');
      const ultima = entregas.filter(e => e.prestamoId === p.id).sort((a,b) => String(b.fechaHora).localeCompare(String(a.fechaHora)))[0];
      const ultimaDevolucion = devoluciones.filter(e => e.prestamoId === p.id).sort((a,b) => String(b.fechaHora).localeCompare(String(a.fechaHora)))[0];
      return `<tr>
        <td><strong>${esc(p.socioNombre)}</strong><br><small>Socio ${esc(p.socioId)}</small></td>
        <td>${p.destino === 'OBRA' ? 'Obra / jornada' : 'Uso personal'}</td>
        <td>${esc(p.fechaInicio)}<br><small>Vence: ${esc(p.vencimiento)}</small></td>
        <td>${items}</td>
        <td><span class="mh-badge ${badge}">${estadoTexto}</span></td>
        <td><div class="mh-row-actions">
          ${prestamoActivo(p) ? `<button class="mh-btn mh-btn-primary" onclick="MaquinasHerramientas.abrirDevolucion('${esc(p.id)}')">Devolver</button>` : ''}
          ${p.destino === 'OBRA' && prestamoActivo(p) ? `<button class="mh-btn mh-btn-secondary" onclick="MaquinasHerramientas.ampliarEntrega('${esc(p.id)}')">Agregar</button>` : ''}
          ${ultima ? `<button class="mh-btn mh-btn-secondary" onclick="MaquinasHerramientas.comprobanteEntrega('${esc(ultima.id)}')">Entrega PDF</button>` : ''}
          ${ultimaDevolucion ? `<button class="mh-btn mh-btn-secondary" onclick="MaquinasHerramientas.comprobanteDevolucion('${esc(ultimaDevolucion.id)}')">Devolución PDF</button>` : ''}
        </div></td>
      </tr>`;
    }).join('');
    document.getElementById('mh-prestamos-empty')?.classList.toggle('mh-hidden', lista.length > 0);
    lucide.createIcons();
  }

  function personasSocio(socio) {
    const titular = { clave:'TITULAR', nombre:socio.nombre, tipo:'TITULAR', fechaNacimiento:socio.fechaNacimiento || '', autorizacionMenor:Boolean(socio.autorizacionMenor) };
    return [titular, ...(socio.nucleo || []).map((f,i) => ({ clave:`FAMILIAR:${i}`, nombre:f.nombre, tipo:'FAMILIAR', parentesco:f.parentesco || '', fechaNacimiento:f.fechaNacimiento || '', autorizacionMenor:Boolean(f.autorizacionMenor) }))];
  }

  function edadEnFecha(fechaNac, referencia = fechaLocal()) {
    if (!fechaNac) return -1;
    const [y,m,d] = String(fechaNac).split('-').map(Number);
    const [ry,rm,rd] = referencia.split('-').map(Number);
    if (![y,m,d,ry,rm,rd].every(Number.isFinite)) return -1;
    let edad = ry - y;
    if (rm < m || (rm === m && rd < d)) edad--;
    return edad;
  }

  function abrirEntrega(prestamoId = '', contextoJornada = null) {
    if (!inventario.some(i => i.estado !== 'BAJA' && disponibilidad(i) > 0)) return showToast('No hay artículos disponibles para entregar.', 'error');
    carritoEntrega = [];
    carritoSets = [];
    entregaAbiertaDesdeJornada = Boolean(contextoJornada);
    fechaJornadaEntrega = contextoJornada?.fecha || '';
    document.getElementById('mh-form-entrega')?.reset();
    setValue('mh-entrega-prestamo-id', prestamoId);
    const select = document.getElementById('mh-entrega-socio');
    const ordenados = [...(typeof socios !== 'undefined' ? socios : [])].sort((a,b) => String(a.id).localeCompare(String(b.id), 'es', {numeric:true}));
    select.innerHTML = '<option value="">Seleccione un socio…</option>' + ordenados.map(s => `<option value="${esc(s.id)}">${esc(s.id)} — ${esc(s.nombre)}</option>`).join('');
    setValue('mh-entrega-destino','OBRA');
    setValue('mh-entrega-vencimiento', fechaJornadaEntrega || fechaLocal());
    if (contextoJornada?.socioId) setValue('mh-entrega-socio', contextoJornada.socioId);
    const existente = prestamos.find(p => p.id === prestamoId);
    if (existente) {
      setValue('mh-entrega-socio', existente.socioId);
      setValue('mh-entrega-destino', existente.destino);
      select.disabled = true;
      document.getElementById('mh-entrega-destino').disabled = true;
      document.getElementById('mh-entrega-titulo').textContent = 'Agregar artículos a la entrega';
    } else {
      select.disabled = Boolean(contextoJornada);
      document.getElementById('mh-entrega-destino').disabled = Boolean(contextoJornada);
      document.getElementById('mh-entrega-titulo').textContent = contextoJornada ? `Equipo de obra — ${contextoJornada.trabajadorNombre}` : 'Nueva entrega';
    }
    poblarReceptores();
    if (contextoJornada?.trabajadorNombre) {
      const socio = (typeof socios !== 'undefined' ? socios : []).find(s => String(s.id) === String(contextoJornada.socioId));
      const persona = socio ? personasSocio(socio).find(p => norm(p.nombre) === norm(contextoJornada.trabajadorNombre)) : null;
      if (persona) setValue('mh-entrega-receptor', persona.clave);
    }
    actualizarModalEntrega();
    renderCarritoEntrega();
    openModal('mh-modal-entrega');
    setTimeout(() => {
      const canvas = document.getElementById('mh-signature-canvas');
      if (typeof prepararCanvasFirma === 'function') prepararCanvasFirma(canvas);
    }, 60);
  }

  function ampliarEntrega(id) { abrirEntrega(id); }

  function hayPrestamoObraPendiente(socioId, fecha = fechaLocal()) {
    return prestamos.some(p => String(p.socioId) === String(socioId) && p.destino === 'OBRA' && p.fechaInicio === fecha && prestamoActivo(p));
  }

  function iniciarEntregasDesdeJornada(socioId, trabajadores = [], fecha = fechaLocal()) {
    colaEntregasJornada = trabajadores.map(trabajadorNombre => ({ socioId:String(socioId), trabajadorNombre, fecha }));
    abrirSiguienteEntregaJornada();
  }

  function abrirSiguienteEntregaJornada() {
    if (!colaEntregasJornada.length) { entregaAbiertaDesdeJornada = false; fechaJornadaEntrega = ''; return; }
    const contexto = colaEntregasJornada.shift();
    const abierto = prestamos.find(p => String(p.socioId) === String(contexto.socioId) && p.destino === 'OBRA' && p.fechaInicio === contexto.fecha && prestamoActivo(p));
    abrirEntrega(abierto?.id || '', contexto);
  }

  function abrirDesdeJornada(socioId, trabajadorNombre, fecha = fechaLocal()) {
    colaEntregasJornada = [];
    const abierto = prestamos.find(p => String(p.socioId) === String(socioId) && p.destino === 'OBRA' && p.fechaInicio === fecha && prestamoActivo(p));
    abrirEntrega(abierto?.id || '', {socioId:String(socioId), trabajadorNombre, fecha});
  }

  function abrirDesdeRegistroJornada(registroId) {
    const reg = (typeof registros !== 'undefined' ? registros : []).find(r => r.id === registroId);
    if (!reg) return showToast('No se encontró la jornada activa.', 'error');
    abrirDesdeJornada(reg.socioId, reg.trabajadorNombre, reg.fecha);
  }

  function cancelarEntrega() {
    closeModal('mh-modal-entrega');
    const continuar = entregaAbiertaDesdeJornada && colaEntregasJornada.length > 0;
    entregaAbiertaDesdeJornada = false;
    if (!continuar) fechaJornadaEntrega = '';
    if (continuar) setTimeout(abrirSiguienteEntregaJornada, 80);
  }

  function poblarReceptores() {
    const socioId = document.getElementById('mh-entrega-socio')?.value;
    const socio = (typeof socios !== 'undefined' ? socios : []).find(s => String(s.id) === String(socioId));
    const select = document.getElementById('mh-entrega-receptor');
    if (!select) return;
    select.innerHTML = socio ? personasSocio(socio).map(p => {
      const edad = edadEnFecha(p.fechaNacimiento);
      const detalle = p.tipo === 'TITULAR' ? 'titular' : (p.parentesco || 'familiar');
      return `<option value="${esc(p.clave)}">${esc(p.nombre)} — ${esc(detalle)}, ${edad >= 0 ? edad + ' años' : 'edad no registrada'}</option>`;
    }).join('') : '<option value="">Seleccione primero el socio</option>';
    actualizarModalEntrega();
  }

  function actualizarModalEntrega() {
    const destino = document.getElementById('mh-entrega-destino')?.value || 'OBRA';
    const socioId = document.getElementById('mh-entrega-socio')?.value || '';
    const fecha = fechaJornadaEntrega || fechaLocal();
    const venc = document.getElementById('mh-entrega-vencimiento');
    const fijo = destino === 'OBRA';
    if (venc) { venc.value = fijo ? fecha : (venc.value && venc.value > fecha ? venc.value : sumarDias(fecha,7)); venc.readOnly = fijo; }
    let prestamoId = document.getElementById('mh-entrega-prestamo-id')?.value || '';
    if (!prestamoId && destino === 'OBRA' && socioId) {
      const abierto = prestamos.find(p => String(p.socioId) === String(socioId) && p.destino === 'OBRA' && p.fechaInicio === fecha && prestamoActivo(p));
      if (abierto) prestamoId = abierto.id;
    }
    const aviso = document.getElementById('mh-entrega-aviso-ampliacion');
    if (aviso) {
      aviso.classList.toggle('mh-hidden', !prestamoId);
      aviso.textContent = prestamoId ? 'Se agregará esta entrega al préstamo abierto del socio para la jornada de hoy.' : '';
    }
    filtrarDatalistEntrega();
  }

  function destinoCompatible(valor,destino){return destino==='OBRA'?['OBRA','AMBOS'].includes(valor):['PERSONAL','AMBOS'].includes(valor);}

  function filtrarDatalistEntrega() {
    const destino = document.getElementById('mh-entrega-destino')?.value || 'OBRA';
    const datalist = document.getElementById('mh-articulos-disponibles');
    if (!datalist) return;
    const articulos=inventario.filter(i => i.estado !== 'BAJA' && disponibilidad(i) > 0 && destinoCompatible(i.destinoPermitido,destino) && !(destino==='PERSONAL'&&i.tipo==='MAQUINA')).map(i => `<option value="${esc(i.codigo)}">Artículo: ${esc(i.nombre)} — disponibles ${disponibilidad(i)}</option>`);
    const sets=setsInventario.filter(s=>s.estado!=='BAJA'&&destinoCompatible(s.destinoPermitido,destino)).map(s=>`<option value="${esc(s.codigo)}">Set: ${esc(s.nombre)} — ${estadoDisponibilidadSet(s).texto}</option>`);
    datalist.innerHTML=[...sets,...articulos].join('');
  }

  function cantidadSolicitadaInventario(inventarioId){return carritoEntrega.filter(i=>i.inventarioId===inventarioId).reduce((n,i)=>n+Number(i.cantidad||0),0);}
  function itemsInventarioAgregados(){const mapa=new Map();carritoEntrega.forEach(i=>{const a=mapa.get(i.inventarioId);if(a)a.cantidad+=Number(i.cantidad);else mapa.set(i.inventarioId,{inventarioId:i.inventarioId,codigo:i.codigo,nombre:i.nombre,tipo:i.tipo,control:i.control,cantidad:Number(i.cantidad)});});return [...mapa.values()];}

  async function agregarArticuloEntrega(codigoEscaneado = '') {
    const codigo = norm(codigoEscaneado || document.getElementById('mh-entrega-codigo')?.value);
    const setDirecto=setsInventario.find(s=>s.estado!=='BAJA'&&norm(s.codigo)===codigo);
    if(setDirecto){await agregarSetEntrega(setDirecto.id);setValue('mh-entrega-codigo','');return;}
    const cantidad = Number(document.getElementById('mh-entrega-cantidad')?.value || 1);
    const destino = document.getElementById('mh-entrega-destino')?.value || 'OBRA';
    const item = inventario.find(i => norm(i.codigo) === codigo);
    if (!item) return showToast('No se encontró un artículo o set con ese código.', 'error');
    const setPrincipal=setsInventario.find(s=>s.estado!=='BAJA'&&s.articuloPrincipalId===item.id&&destinoCompatible(s.destinoPermitido,destino));
    if(setPrincipal){const usarSet=await showConfirmModal('Artículo principal de un set',`${item.nombre} pertenece a ${setPrincipal.nombre}. Presione Confirmar para agregar el set; Cancelar para entregar sólo este artículo.`);if(usarSet){await agregarSetEntrega(setPrincipal.id);setValue('mh-entrega-codigo','');return;}}
    agregarLineaEntrega(item,cantidad,'');
  }

  function agregarLineaEntrega(item,cantidad,setInstanciaId='',setNombre=''){
    const destino=document.getElementById('mh-entrega-destino')?.value||'OBRA';
    if(item.estado==='BAJA'||disponibilidad(item)<=0)return showToast('El artículo no está disponible.','error');
    if(!destinoCompatible(item.destinoPermitido,destino)||(destino==='PERSONAL'&&item.tipo==='MAQUINA'))return showToast('El artículo no está habilitado para este destino.','error');
    if(!Number.isInteger(cantidad)||cantidad<1)return showToast('Ingrese una cantidad válida.','error');
    const solicitada=cantidadSolicitadaInventario(item.id)+cantidad;
    if(item.control==='UNIDAD'&&solicitada>1)return showToast('La unidad individualizada ya fue agregada.','error');
    if(solicitada>disponibilidad(item))return showToast(`Sólo hay ${disponibilidad(item)} unidades disponibles de ${item.nombre}.`,'error');
    const anterior=carritoEntrega.find(x=>x.inventarioId===item.id&&String(x.setInstanciaId||'')===String(setInstanciaId||''));
    if(anterior)anterior.cantidad+=cantidad;else carritoEntrega.push({lineaId:idOperacion('LIN'),inventarioId:item.id,codigo:item.codigo,nombre:item.nombre,tipo:item.tipo,control:item.control,cantidad,setInstanciaId,setNombre});
    setValue('mh-entrega-codigo','');setValue('mh-entrega-cantidad','1');renderCarritoEntrega();return true;
  }

  async function agregarSetEntrega(setId){
    const set=setsInventario.find(s=>s.id===setId);if(!set)return showToast('No se encontró el set.','error');
    const destino=document.getElementById('mh-entrega-destino')?.value||'OBRA';if(!destinoCompatible(set.destinoPermitido,destino))return showToast('El set no está habilitado para este destino.','error');
    let componentesObjetivo=componentesActivosSet(set);let completaInstanciaId='';
    let prestamoId=document.getElementById('mh-entrega-prestamo-id')?.value||'';const socioId=document.getElementById('mh-entrega-socio')?.value||'';const fecha=fechaJornadaEntrega||fechaLocal();if(!prestamoId&&destino==='OBRA')prestamoId=prestamos.find(p=>String(p.socioId)===String(socioId)&&p.destino==='OBRA'&&p.fechaInicio===fecha&&prestamoActivo(p))?.id||'';
    const loan=prestamos.find(p=>p.id===prestamoId);const parcial=(loan?.setsResumen||[]).find(x=>x.setId===set.id&&x.estado==='ENTREGADO_PARCIAL'&&Array.isArray(x.componentesFaltantes)&&x.componentesFaltantes.length);
    if(parcial){const completar=await showConfirmModal('Set parcial pendiente',`${set.nombre} ya fue entregado parcialmente. Presione Confirmar para intentar completar sus faltantes; Cancelar para agregar otro set.`);if(completar){completaInstanciaId=parcial.instanciaId;componentesObjetivo=parcial.componentesFaltantes.map(f=>({inventarioId:f.inventarioId,cantidad:f.cantidad,obligatorio:f.obligatorio!==false,tipoReferencia:f.tipoReferencia||'GENERICO'}));}}
    const instanciaId=completaInstanciaId||idOperacion('SET');const entregados=[],faltantes=[];
    for(const comp of componentesObjetivo){const item=inventario.find(i=>i.id===comp.inventarioId);const requerida=Number(comp.cantidad||1);const libre=item?Math.max(0,disponibilidad(item)-cantidadSolicitadaInventario(item.id)):0;const entregar=Math.min(requerida,libre);if(entregar>0)entregados.push({...comp,cantidad:entregar,item});if(entregar<requerida)faltantes.push({inventarioId:comp.inventarioId,codigo:item?.codigo||'',nombre:item?.nombre||comp.inventarioId,cantidad:requerida-entregar,obligatorio:comp.obligatorio!==false,tipoReferencia:comp.tipoReferencia});}
    const faltanObligatorios=faltantes.some(f=>f.obligatorio!==false);if(faltanObligatorios&&!set.permiteEntregaParcial)return showToast(`No se puede entregar ${set.nombre}: faltan componentes obligatorios.`,'error');if(!entregados.length)return showToast(`No hay componentes disponibles para ${set.nombre}.`,'error');
    entregados.forEach(e=>agregarLineaEntrega(e.item,e.cantidad,instanciaId,set.nombre));
    const estado=faltanObligatorios?'ENTREGADO_PARCIAL':'ENTREGADO_COMPLETO';carritoSets.push({instanciaId,setId:set.id,codigo:set.codigo,nombre:set.nombre,estado,completaInstanciaId,componentesPrevistos:componentesObjetivo.map(c=>({...c})),componentesEntregados:entregados.map(e=>({inventarioId:e.inventarioId,codigo:e.item.codigo,nombre:e.item.nombre,cantidad:e.cantidad,obligatorio:e.obligatorio!==false,tipoReferencia:e.tipoReferencia})),componentesFaltantes:faltantes,motivoParcial:''});renderCarritoEntrega();if(estado==='ENTREGADO_PARCIAL')showToast('Set agregado parcialmente. Indique el motivo antes de firmar.','info');
  }

  function quitarArticuloEntrega(lineaId) {const linea=carritoEntrega.find(i=>i.lineaId===lineaId);if(linea?.setInstanciaId)return showToast('Quite el set completo desde su tarjeta.','info');carritoEntrega=carritoEntrega.filter(i=>i.lineaId!==lineaId);renderCarritoEntrega();}
  function quitarSetEntrega(instanciaId){carritoEntrega=carritoEntrega.filter(i=>i.setInstanciaId!==instanciaId);carritoSets=carritoSets.filter(s=>s.instanciaId!==instanciaId);renderCarritoEntrega();}
  function setMotivoParcial(instanciaId,valor){const s=carritoSets.find(x=>x.instanciaId===instanciaId);if(s)s.motivoParcial=String(valor||'').trim();}

  function renderCarritoEntrega() {
    const body=document.getElementById('mh-entrega-items');if(!body)return;
    const setsBox=document.getElementById('mh-entrega-sets');if(setsBox)setsBox.innerHTML=carritoSets.map(s=>`<div class="mh-delivery-set ${s.estado==='ENTREGADO_PARCIAL'?'partial':''}"><div class="mh-toolbar"><div><strong>${esc(s.nombre)}</strong> <span class="mh-badge ${s.estado==='ENTREGADO_PARCIAL'?'mh-badge-amber':'mh-badge-green'}">${s.estado==='ENTREGADO_PARCIAL'?'Parcial':'Completo'}</span><div class="mh-help">${s.componentesEntregados.map(c=>`${esc(c.nombre)} × ${c.cantidad}`).join(' · ')}</div>${s.componentesFaltantes.length?`<div class="mh-set-missing">Falta: ${s.componentesFaltantes.map(c=>`${esc(c.nombre)} × ${c.cantidad}`).join(' · ')}</div>`:''}</div><button type="button" class="mh-btn mh-btn-danger" onclick="MaquinasHerramientas.quitarSetEntrega('${esc(s.instanciaId)}')">Quitar set</button></div>${s.estado==='ENTREGADO_PARCIAL'?`<label class="mh-field" style="display:block;margin-top:.65rem"><span>Motivo de entrega parcial *</span><input maxlength="240" value="${esc(s.motivoParcial)}" oninput="MaquinasHerramientas.setMotivoParcial('${esc(s.instanciaId)}',this.value)" placeholder="Ej. Sin escobillas disponibles"></label>`:''}</div>`).join('');
    body.innerHTML=carritoEntrega.map(i=>`<tr><td><span class="mh-code">${esc(i.codigo)}</span></td><td>${esc(i.nombre)}${i.setNombre?`<br><small>Set: ${esc(i.setNombre)}</small>`:''}</td><td>${i.cantidad}</td><td>${i.setInstanciaId?'Incluido en set':`<button type="button" class="mh-btn mh-btn-danger" onclick="MaquinasHerramientas.quitarArticuloEntrega('${esc(i.lineaId)}')">Quitar</button>`}</td></tr>`).join('');
    document.getElementById('mh-entrega-sin-items')?.classList.toggle('mh-hidden',carritoEntrega.length>0);
  }

  function validarReceptor(socio, clave, items, fecha) {
    const persona = personasSocio(socio).find(p => p.clave === clave);
    if (!persona) return { error:'Seleccione quién retira.', persona:null };
    const edad = edadEnFecha(persona.fechaNacimiento, fecha);
    if (edad < 16) return { error:'La persona que retira debe tener al menos 16 años.', persona };
    if (items.some(i => i.tipo === 'MAQUINA') && edad < 18) return { error:'Las máquinas sólo pueden ser retiradas por mayores de 18 años.', persona };
    if (edad < 18 && !persona.autorizacionMenor) return { error:'El familiar de 16 o 17 años necesita autorización registrada.', persona };
    return { persona:{...persona,edad}, error:'' };
  }

  function resumenSumado(actual = [], nuevos = []) {
    const mapa = new Map(actual.map(i => [i.inventarioId, {...i, cantidad:Number(i.cantidad||0)}]));
    nuevos.forEach(i => { const a=mapa.get(i.inventarioId); if(a)a.cantidad += i.cantidad; else mapa.set(i.inventarioId,{inventarioId:i.inventarioId,codigo:i.codigo,nombre:i.nombre,cantidad:i.cantidad}); });
    return [...mapa.values()];
  }

  function combinarSetsResumen(actual=[],nuevos=[]){
    const normalizar=c=>({...c,cantidadPendiente:Number(c.cantidadPendiente??c.cantidad??0)});
    const salida=actual.map(s=>({...s,componentesEntregados:(s.componentesEntregados||[]).map(normalizar),componentesFaltantes:[...(s.componentesFaltantes||[])]}));
    nuevos.forEach(n=>{const entregados=(n.componentesEntregados||[]).map(normalizar);if(n.completaInstanciaId){const previo=salida.find(s=>s.instanciaId===n.completaInstanciaId);if(previo){entregados.forEach(c=>{const ex=previo.componentesEntregados.find(x=>x.inventarioId===c.inventarioId);if(ex){ex.cantidad=Number(ex.cantidad||0)+Number(c.cantidad);ex.cantidadPendiente=Number(ex.cantidadPendiente||0)+Number(c.cantidad);}else previo.componentesEntregados.push(c);});previo.componentesFaltantes=n.componentesFaltantes;previo.estado=n.componentesFaltantes.some(f=>f.obligatorio!==false)?'ENTREGADO_PARCIAL':'ENTREGADO_COMPLETO';previo.actualizadoEn=nowIso();return;}}salida.push({...n,componentesEntregados:entregados});});return salida;
  }

  function setsTrasDevolucion(actual=[],seleccion=[]){
    const salida=combinarSetsResumen(actual,[]);
    seleccion.forEach(grupo=>{let restante=Number(grupo.cantidad||0);for(const lote of grupo.lotes){if(restante<=0)break;const usar=Math.min(restante,Number(lote.cantidadPendiente||0));if(usar>0&&lote.setInstanciaId){const set=salida.find(s=>s.instanciaId===lote.setInstanciaId);const comp=set?.componentesEntregados?.find(c=>c.inventarioId===grupo.inventarioId);if(comp)comp.cantidadPendiente=Math.max(0,Number(comp.cantidadPendiente??comp.cantidad)-usar);}restante-=usar;}});
    salida.forEach(s=>{const total=(s.componentesEntregados||[]).reduce((n,c)=>n+Number((c.cantidadPendiente??c.cantidad)||0),0);const devuelto=(s.componentesEntregados||[]).some(c=>Number((c.cantidadPendiente??c.cantidad)||0)<Number(c.cantidad||0));if(total===0)s.estado='CERRADO';else if(devuelto)s.estado='DEVOLUCION_PARCIAL';});return salida;
  }

  async function confirmarEntrega(event) {
    event.preventDefault();
    const socioId = document.getElementById('mh-entrega-socio').value;
    const socio = (typeof socios !== 'undefined' ? socios : []).find(s => String(s.id) === String(socioId));
    const destino = document.getElementById('mh-entrega-destino').value;
    const fecha = fechaJornadaEntrega || fechaLocal();
    const vencimiento = document.getElementById('mh-entrega-vencimiento').value;
    const receptorClave = document.getElementById('mh-entrega-receptor').value;
    if (!socio) return showToast('Seleccione un socio.', 'error');
    if (!carritoEntrega.length) return showToast('Agregue al menos un artículo o set.', 'error');
    const setSinMotivo=carritoSets.find(s=>s.estado==='ENTREGADO_PARCIAL'&&!String(s.motivoParcial||'').trim());
    if(setSinMotivo)return showToast(`Indique el motivo de la entrega parcial de ${setSinMotivo.nombre}.`,'error');
    const itemsAgregados=itemsInventarioAgregados();
    for(const linea of itemsAgregados){const item=inventario.find(i=>i.id===linea.inventarioId);if(!item||!destinoCompatible(item.destinoPermitido,destino)||(destino==='PERSONAL'&&item.tipo==='MAQUINA'))return showToast(`${linea.nombre} no está habilitado para el destino seleccionado.`,'error');}
    if(carritoSets.some(s=>{const def=setsInventario.find(x=>x.id===s.setId);return !def||!destinoCompatible(def.destinoPermitido,destino);} ))return showToast('Uno de los sets no está habilitado para el destino seleccionado.','error');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimiento) || vencimiento < fecha) return showToast('La fecha de vencimiento no puede ser anterior a hoy.', 'error');
    if (destino === 'OBRA' && vencimiento !== fecha) return showToast('Los préstamos de obra vencen al finalizar la jornada.', 'error');
    const validacion = validarReceptor(socio,receptorClave,carritoEntrega,fecha);
    if (validacion.error) return showToast(validacion.error,'error');
    const canvas = document.getElementById('mh-signature-canvas');
    if (!canvas || (typeof isCanvasBlank === 'function' && isCanvasBlank(canvas))) return showToast('La firma de quien retira es obligatoria.', 'error');
    const firma = canvas.toDataURL('image/png');
    const observaciones = document.getElementById('mh-entrega-observaciones').value.trim();
    let prestamoId = document.getElementById('mh-entrega-prestamo-id').value;
    if (!prestamoId && destino === 'OBRA') {
      prestamoId = prestamos.find(p => String(p.socioId) === String(socioId) && p.destino === 'OBRA' && p.fechaInicio === fecha && prestamoActivo(p))?.id || '';
    }
    const existente = prestamos.find(p => p.id === prestamoId);
    if (!prestamoId) prestamoId = idOperacion(`PREST-${fecha.replace(/-/g,'')}-${docId(socioId)}`);
    const entregaId = idOperacion('ENT');
    const marca = nowIso();
    const receptor = validacion.persona;
    const entrega = { prestamoId, socioId:String(socio.id), socioNombre:socio.nombre, destino, receptor:{nombre:receptor.nombre,tipo:receptor.tipo,parentesco:receptor.parentesco||'',edad:receptor.edad}, items:carritoEntrega.map(i=>({...i})), sets:carritoSets.map(s=>({...s})), firma, observaciones, fechaHora:marca, fecha, operadorUid:uid(), operadorEmail:(firebase.auth().currentUser||{}).email||'' };
    const resumen = resumenSumado(existente?.resumenPendiente || [], itemsAgregados);
    const loanData = { socioId:String(socio.id), socioNombre:socio.nombre, destino, fechaInicio:existente?.fechaInicio||fecha, vencimiento:destino==='OBRA'?fecha:vencimiento, estado:'ABIERTO', totalPendiente:Number(existente?.totalPendiente||0)+itemsAgregados.reduce((n,i)=>n+i.cantidad,0), resumenPendiente:resumen, setsResumen:combinarSetsResumen(existente?.setsResumen||[],carritoSets), ultimaEntregaId:entregaId, actualizadoEn:marca, creadoEn:existente?.creadoEn||marca, creadoPor:existente?.creadoPor||uid() };
    const btn = document.getElementById('mh-btn-confirmar-entrega'); btn.disabled=true; btn.textContent='Guardando…';
    try {
      if (navigator.onLine) {
        await guardarEntregaOnline(prestamoId,entregaId,loanData,entrega);
        const indiceLocal=prestamos.findIndex(p=>p.id===prestamoId);
        if(indiceLocal>=0)prestamos[indiceLocal]={id:prestamoId,...loanData};else prestamos.push({id:prestamoId,...loanData});
        if(!entregas.some(e=>e.id===entregaId))entregas.push({id:entregaId,...entrega});
      } else guardarEntregaOffline(prestamoId,entregaId,loanData,entrega);
      if (typeof registrarLog === 'function') registrarLog('Préstamo de herramientas', `${existente?'Ampliación':'Entrega'} ${prestamoId}: socio ${socio.id}, ${carritoEntrega.map(i=>`${i.codigo} x${i.cantidad}`).join(', ')}.`);
      closeModal('mh-modal-entrega');
      showToast(existente || document.getElementById('mh-entrega-prestamo-id').value ? 'Artículos agregados a la entrega abierta.' : 'Entrega registrada correctamente.', 'success');
      setTimeout(() => comprobanteDesdeDatos(entrega, {...loanData,id:prestamoId}), 100);
      const continuarJornada = entregaAbiertaDesdeJornada && colaEntregasJornada.length > 0;
      entregaAbiertaDesdeJornada = false;
      if (continuarJornada) setTimeout(abrirSiguienteEntregaJornada, 350);
    } catch(e) { showToast('No se pudo registrar la entrega: '+e.message,'error'); }
    finally { btn.disabled=false;btn.textContent='Firmar y registrar entrega'; }
  }

  async function guardarEntregaOnline(prestamoId, entregaId, loanData, entrega) {
    await db.runTransaction(async tx => {
      const agregados=itemsInventarioAgregados();
      const invRefs = agregados.map(i => db.collection('inventario').doc(i.inventarioId));
      const loanRef = db.collection('prestamos').doc(prestamoId);
      const lecturas = await Promise.all([...invRefs.map(r=>tx.get(r)), tx.get(loanRef)]);
      const invDocs = lecturas.slice(0,-1);
      invDocs.forEach((doc,index) => {
        if (!doc.exists) throw new Error(`No existe ${agregados[index].codigo}.`);
        const disponibleActual = disponibilidad(doc.data());
        if (disponibleActual < agregados[index].cantidad) throw new Error(`Disponibilidad insuficiente para ${agregados[index].codigo}.`);
      });
      invDocs.forEach((doc,index) => tx.update(invRefs[index], { cantidadPrestada:Number(doc.data().cantidadPrestada||0)+agregados[index].cantidad, actualizadoEn:entrega.fechaHora, actualizadoPor:uid() }));
      tx.set(loanRef, loanData);
      tx.set(db.collection('entregasPrestamo').doc(entregaId), entrega);
      carritoEntrega.forEach(item => {
        const itemId = `${prestamoId}__${entregaId}__${docId(item.lineaId)}`;
        tx.set(db.collection('prestamoItems').doc(itemId), { prestamoId, entregaId, inventarioId:item.inventarioId, codigo:item.codigo, nombre:item.nombre, cantidadEntregada:item.cantidad, cantidadDevuelta:0, cantidadPendiente:item.cantidad, estado:'PRESTADO', setInstanciaId:item.setInstanciaId||'', setNombre:item.setNombre||'', creadoEn:entrega.fechaHora });
        tx.set(db.collection('movimientosInventario').doc(idOperacion('MOV')), { tipo:'ENTREGA', prestamoId, entregaId, inventarioId:item.inventarioId, codigo:item.codigo, cantidad:item.cantidad, setInstanciaId:item.setInstanciaId||'', setNombre:item.setNombre||'', socioId:entrega.socioId, receptorNombre:entrega.receptor.nombre, fechaHora:entrega.fechaHora, operadorUid:uid() });
      });
    });
  }

  function guardarEntregaOffline(prestamoId, entregaId, loanData, entrega) {
    OfflineSync.enqueue('prestamos',prestamoId,'set',loanData);
    OfflineSync.enqueue('entregasPrestamo',entregaId,'set',entrega);
    itemsInventarioAgregados().forEach(item => {
      const inv = inventario.find(i=>i.id===item.inventarioId);
      const cambio={cantidadPrestada:Number(inv.cantidadPrestada||0)+item.cantidad,actualizadoEn:entrega.fechaHora,actualizadoPor:uid()};
      OfflineSync.enqueue('inventario',item.inventarioId,'merge',cambio);Object.assign(inv,cambio);
    });
    carritoEntrega.forEach(item=>{
      const itemId=`${prestamoId}__${entregaId}__${docId(item.lineaId)}`;
      OfflineSync.enqueue('prestamoItems',itemId,'set',{prestamoId,entregaId,inventarioId:item.inventarioId,codigo:item.codigo,nombre:item.nombre,cantidadEntregada:item.cantidad,cantidadDevuelta:0,cantidadPendiente:item.cantidad,estado:'PRESTADO',setInstanciaId:item.setInstanciaId||'',setNombre:item.setNombre||'',creadoEn:entrega.fechaHora});
      OfflineSync.enqueue('movimientosInventario',idOperacion('MOV'),'set',{tipo:'ENTREGA',prestamoId,entregaId,inventarioId:item.inventarioId,codigo:item.codigo,cantidad:item.cantidad,setInstanciaId:item.setInstanciaId||'',setNombre:item.setNombre||'',socioId:entrega.socioId,receptorNombre:entrega.receptor.nombre,fechaHora:entrega.fechaHora,operadorUid:uid()});
    });
    const pi=prestamos.findIndex(p=>p.id===prestamoId);if(pi>=0)prestamos[pi]={id:prestamoId,...loanData};else prestamos.push({id:prestamoId,...loanData});
    entregas.push({id:entregaId,...entrega});render();
  }

  function limpiarFirmaEntrega() { const c=document.getElementById('mh-signature-canvas'); if(typeof limpiarCanvasFirma==='function')limpiarCanvasFirma(c); }

  async function abrirScanner() {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) return showToast('Este navegador no admite escaneo directo. Ingrese el código impreso debajo del QR.', 'info');
    try {
      const formatos = await BarcodeDetector.getSupportedFormats();
      if (!formatos.includes('qr_code')) return showToast('El navegador no admite lectura QR. Use el código manual.', 'info');
      scannerStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});
      const video=document.getElementById('mh-scanner-video');video.srcObject=scannerStream;await video.play();openModal('mh-modal-scanner');
      const detector=new BarcodeDetector({formats:['qr_code']});
      scannerTimer=setInterval(async()=>{try{const codes=await detector.detect(video);if(codes.length){const valor=codes[0].rawValue;cerrarScanner();setValue('mh-entrega-codigo',valor);agregarArticuloEntrega(valor);}}catch{}},350);
    } catch(e) { cerrarScanner(); showToast('No se pudo abrir la cámara: '+e.message,'error'); }
  }

  function cerrarScanner() {
    if(scannerTimer)clearInterval(scannerTimer);scannerTimer=null;
    if(scannerStream)scannerStream.getTracks().forEach(t=>t.stop());scannerStream=null;
    closeModal('mh-modal-scanner');
  }

  function comprobanteEntrega(entregaId) {
    const entrega=entregas.find(e=>e.id===entregaId);if(!entrega)return showToast('No se encontró la entrega.','error');
    const loan=prestamos.find(p=>p.id===entrega.prestamoId)||{};comprobanteDesdeDatos(entrega,loan);
  }

  function comprobanteDesdeDatos(entrega, prestamo) {
    if (!window.jspdf?.jsPDF) return;
    const {jsPDF}=window.jspdf;const doc=new jsPDF();
    doc.setFont('helvetica','bold');doc.setFontSize(16);doc.text('COVIMT 9',14,18);doc.setFontSize(13);doc.text('Comprobante de entrega',14,27);
    doc.setFont('helvetica','normal');doc.setFontSize(10);
    doc.text(`Préstamo: ${entrega.prestamoId}`,14,37);doc.text(`Socio: ${entrega.socioId} — ${entrega.socioNombre}`,14,43);
    doc.text(`Destino: ${entrega.destino==='OBRA'?'Obra / jornada':'Uso personal'}`,14,49);doc.text(`Retira: ${entrega.receptor.nombre}`,14,55);
    doc.text(`Fecha: ${new Date(entrega.fechaHora).toLocaleString('es-UY')}`,14,61);doc.text(`Vencimiento: ${prestamo.vencimiento||entrega.fecha}`,14,67);
    doc.autoTable({startY:74,head:[['Código','Artículo','Cantidad','Origen']],body:entrega.items.map(i=>[i.codigo,i.nombre,String(i.cantidad),i.setNombre||'Individual']),theme:'grid',styles:{fontSize:9},headStyles:{fillColor:[6,95,70]}});
    let y=doc.lastAutoTable.finalY+8;
    (entrega.sets||[]).forEach(s=>{doc.setFont('helvetica','bold');doc.text(`${s.nombre}: ${s.estado==='ENTREGADO_PARCIAL'?'ENTREGA PARCIAL':'COMPLETO'}`,14,y);y+=5;doc.setFont('helvetica','normal');if((s.componentesFaltantes||[]).length){doc.text(`No entregado: ${s.componentesFaltantes.map(c=>`${c.nombre} x${c.cantidad}`).join(', ')}`,14,y,{maxWidth:180});y+=6;doc.text(`Motivo: ${s.motivoParcial||'—'}`,14,y,{maxWidth:180});y+=7;}});
    if(entrega.observaciones){doc.text(`Observaciones: ${entrega.observaciones}`,14,y,{maxWidth:180});y+=12;}
    try{doc.addImage(entrega.firma,'PNG',14,y,60,24);}catch{} doc.line(14,y+27,78,y+27);doc.text(entrega.receptor.nombre,14,y+33);
    doc.save(`entrega_${entrega.socioId}_${entrega.fecha}.pdf`);
  }

  // ------------------------------------------------------------
  // DEVOLUCIONES TOTALES/PARCIALES Y APERTURA DE REPARACIONES
  // ------------------------------------------------------------
  function pendientesAgrupados(prestamoId) {
    const mapa = new Map();
    itemsPrestamo.filter(i => i.prestamoId === prestamoId && Number(i.cantidadPendiente || 0) > 0).sort((a,b) => String(a.creadoEn).localeCompare(String(b.creadoEn))).forEach(i => {
      if (!mapa.has(i.inventarioId)) mapa.set(i.inventarioId, { inventarioId:i.inventarioId, codigo:i.codigo, nombre:i.nombre, cantidadPendiente:0, lotes:[], sets:new Set() });
      const grupo = mapa.get(i.inventarioId);
      grupo.cantidadPendiente += Number(i.cantidadPendiente || 0);
      grupo.lotes.push(i);if(i.setNombre)grupo.sets.add(i.setNombre);
    });
    return [...mapa.values()];
  }

  function abrirDevolucion(prestamoId, personaPreferida = '') {
    const prestamo = prestamos.find(p => p.id === prestamoId);
    if (!prestamo || !prestamoActivo(prestamo)) return showToast('El préstamo ya no tiene artículos pendientes.', 'info');
    const grupos = pendientesAgrupados(prestamoId);
    if (!grupos.length) return showToast('No se encontraron artículos pendientes para devolver.', 'error');
    setValue('mh-devolucion-prestamo-id', prestamoId);
    setText('mh-devolucion-socio', `${prestamo.socioId} — ${prestamo.socioNombre}`);
    const socio = (typeof socios !== 'undefined' ? socios : []).find(s => String(s.id) === String(prestamo.socioId));
    const receptor = document.getElementById('mh-devolucion-receptor');
    receptor.innerHTML = socio ? personasSocio(socio).map(p => `<option value="${esc(p.clave)}">${esc(p.nombre)} — ${esc(p.tipo === 'TITULAR' ? 'titular' : (p.parentesco || 'familiar'))}</option>`).join('') : '';
    if (socio && personaPreferida) {
      const persona = personasSocio(socio).find(p => norm(p.nombre) === norm(personaPreferida));
      if (persona) receptor.value = persona.clave;
    }
    document.getElementById('mh-devolucion-items').innerHTML = grupos.map(g => `<tr data-inventario-id="${esc(g.inventarioId)}">
      <td><span class="mh-code">${esc(g.codigo)}</span><br>${esc(g.nombre)}${g.sets?.size?`<br><small>Set: ${esc([...g.sets].join(', '))}</small>`:''}</td>
      <td>${g.cantidadPendiente}</td>
      <td><input class="mh-return-qty" type="number" min="0" max="${g.cantidadPendiente}" step="1" value="${g.cantidadPendiente}"></td>
      <td><select class="mh-return-condition"><option value="BUENO">Bueno</option><option value="DANADO">Dañado</option><option value="PERDIDO">Perdido</option></select></td>
      <td><input class="mh-return-note" maxlength="180" placeholder="Detalle opcional"></td>
    </tr>`).join('');
    setValue('mh-devolucion-observaciones','');
    setText('mh-devolucion-encargado', ((firebase.auth().currentUser||{}).email) || 'sesión sin correo');
    openModal('mh-modal-devolucion');
    setTimeout(() => {
      if (typeof prepararCanvasFirma === 'function') {
        // Los dos trazos comparten helper: prepararCanvasFirma es por-canvas (usa
        // canvas.dataset para no enlazar los listeners dos veces).
        prepararCanvasFirma(document.getElementById('mh-return-devuelve-canvas'));
        prepararCanvasFirma(document.getElementById('mh-return-signature-canvas'));
      }
    }, 60);
  }

  function abrirDevolucionDesdeJornada(socioId, trabajadorNombre, fecha = fechaLocal()) {
    const prestamo = prestamos.find(p => String(p.socioId) === String(socioId) && p.destino === 'OBRA' && p.fechaInicio === fecha && prestamoActivo(p));
    if (!prestamo) return showToast('El núcleo no tiene préstamos de obra pendientes para hoy.', 'info');
    abrirDevolucion(prestamo.id, trabajadorNombre);
  }

  function abrirDevolucionDesdeRegistro(registroId) {
    const reg = (typeof registros !== 'undefined' ? registros : []).find(r => r.id === registroId);
    if (!reg) return showToast('No se encontró la jornada activa.', 'error');
    abrirDevolucionDesdeJornada(reg.socioId, reg.trabajadorNombre, reg.fecha);
  }

  function datosDevolucionSeleccionados(prestamoId) {
    const grupos = pendientesAgrupados(prestamoId);
    const porId = new Map(grupos.map(g => [g.inventarioId,g]));
    return [...document.querySelectorAll('#mh-devolucion-items tr')].map(row => {
      const grupo = porId.get(row.dataset.inventarioId);
      return { ...grupo, cantidad:Number(row.querySelector('.mh-return-qty').value || 0), condicion:row.querySelector('.mh-return-condition').value, observacion:row.querySelector('.mh-return-note').value.trim() };
    }).filter(i => i.cantidad > 0);
  }

  function validarPersonaDevolucion(socio, clave, fecha) {
    const persona = personasSocio(socio).find(p => p.clave === clave);
    if (!persona) return {error:'Seleccione quién devuelve.'};
    const edad = edadEnFecha(persona.fechaNacimiento,fecha);
    if (edad < 16) return {error:'La persona que devuelve debe tener al menos 16 años.'};
    if (edad < 18 && !persona.autorizacionMenor) return {error:'El familiar de 16 o 17 años necesita autorización registrada.'};
    return {persona:{...persona,edad},error:''};
  }

  function restarResumen(resumen, devueltos) {
    const cantidades = new Map(devueltos.map(i => [i.inventarioId,Number(i.cantidad)]));
    return (resumen || []).map(i => ({...i,cantidad:Math.max(0,Number(i.cantidad||0)-Number(cantidades.get(i.inventarioId)||0))})).filter(i => i.cantidad > 0);
  }

  async function confirmarDevolucion(event) {
    event.preventDefault();
    const prestamoId=document.getElementById('mh-devolucion-prestamo-id').value;
    const prestamo=prestamos.find(p=>p.id===prestamoId);
    if(!prestamo)return showToast('No se encontró el préstamo.','error');
    const seleccion=datosDevolucionSeleccionados(prestamoId);
    if(!seleccion.length)return showToast('Indique al menos una cantidad a devolver.','error');
    for(const item of seleccion){if(!Number.isInteger(item.cantidad)||item.cantidad<1||item.cantidad>item.cantidadPendiente)return showToast(`Cantidad inválida para ${item.codigo}.`,'error');}
    const socio=(typeof socios!=='undefined'?socios:[]).find(s=>String(s.id)===String(prestamo.socioId));
    if(!socio)return showToast('No se encontró el socio responsable.','error');
    const personaVal=validarPersonaDevolucion(socio,document.getElementById('mh-devolucion-receptor').value,fechaLocal());
    if(personaVal.error)return showToast(personaVal.error,'error');
    const canvasDevuelve=document.getElementById('mh-return-devuelve-canvas');
    const canvas=document.getElementById('mh-return-signature-canvas');
    const vacia=c=>!c||(typeof isCanvasBlank==='function'&&isCanvasBlank(c));
    // Orden deliberado: primero el que devuelve (paso 1 en pantalla), después el control.
    if(vacia(canvasDevuelve))return showToast('La firma de quien devuelve es obligatoria.','error');
    if(vacia(canvas))return showToast('La firma del encargado que controla la devolución es obligatoria.','error');
    const devolucionId=idOperacion('DEV');const marca=nowIso();
    const totalDevuelto=seleccion.reduce((n,i)=>n+i.cantidad,0);
    const pendienteFinal=Math.max(0,Number(prestamo.totalPendiente||0)-totalDevuelto);
    const loanUpdate={totalPendiente:pendienteFinal,resumenPendiente:restarResumen(prestamo.resumenPendiente,seleccion),setsResumen:setsTrasDevolucion(prestamo.setsResumen||[],seleccion),estado:pendienteFinal===0?'CERRADO':'DEVUELTO_PARCIAL',actualizadoEn:marca};
    if(pendienteFinal===0)loanUpdate.cerradoEn=marca;
    const devolucion={prestamoId,socioId:prestamo.socioId,socioNombre:prestamo.socioNombre,destino:prestamo.destino,personaDevuelve:{nombre:personaVal.persona.nombre,tipo:personaVal.persona.tipo,parentesco:personaVal.persona.parentesco||'',edad:personaVal.persona.edad},items:seleccion.map(i=>({inventarioId:i.inventarioId,codigo:i.codigo,nombre:i.nombre,cantidad:i.cantidad,condicion:i.condicion,observacion:i.observacion,setNombres:[...(i.sets||[])]})),firma:canvas.toDataURL('image/png'),firmaDe:'ENCARGADO',firmaDevuelve:canvasDevuelve.toDataURL('image/png'),encargado:(()=>{const u=firebase.auth().currentUser||{};return {uid:u.uid||'offline',email:u.email||'',nombre:u.displayName||u.email||'Encargado'};})(),observaciones:document.getElementById('mh-devolucion-observaciones').value.trim(),fechaHora:marca,fecha:fechaLocal(),operadorUid:uid(),operadorEmail:(firebase.auth().currentUser||{}).email||''};
    const btn=document.getElementById('mh-btn-confirmar-devolucion');btn.disabled=true;btn.textContent='Guardando…';
    try{
      if(navigator.onLine)await guardarDevolucionOnline(prestamo,devolucionId,devolucion,seleccion,loanUpdate);
      else guardarDevolucionOffline(prestamo,devolucionId,devolucion,seleccion,loanUpdate);
      if(typeof registrarLog==='function')registrarLog('Devolución de herramientas',`Préstamo ${prestamoId}: ${seleccion.map(i=>`${i.codigo} x${i.cantidad} ${i.condicion}`).join(', ')}.`);
      closeModal('mh-modal-devolucion');showToast(pendienteFinal===0?'Préstamo cerrado: todos los artículos fueron devueltos.':'Devolución parcial registrada.','success');
      setTimeout(()=>comprobanteDevolucionDesdeDatos(devolucion,{...prestamo,...loanUpdate}),100);
    }catch(e){showToast('No se pudo registrar la devolución: '+e.message,'error');}
    finally{btn.disabled=false;btn.textContent='Firmar y registrar devolución';}
  }

  function asignarDevolucionALotes(grupo,cantidad,docsActuales){
    let restante=cantidad;const cambios=[];
    grupo.lotes.forEach(lote=>{if(restante<=0)return;const actual=docsActuales.get(lote.id);const pendiente=Number(actual?.cantidadPendiente||0);const usar=Math.min(restante,pendiente);if(usar>0){cambios.push({id:lote.id,data:actual,usar});restante-=usar;}});
    if(restante>0)throw new Error(`La disponibilidad pendiente de ${grupo.codigo} cambió. Recargue e intente nuevamente.`);
    return cambios;
  }

  async function guardarDevolucionOnline(prestamo,devolucionId,devolucion,seleccion,loanUpdate){
    const reparacionesNuevas=[];
    await db.runTransaction(async tx=>{
      const loanRef=db.collection('prestamos').doc(prestamo.id);
      const lotes=[...new Map(seleccion.flatMap(i=>i.lotes).map(l=>[l.id,l])).values()];
      const loteRefs=lotes.map(l=>db.collection('prestamoItems').doc(l.id));
      const invRefs=seleccion.map(i=>db.collection('inventario').doc(i.inventarioId));
      const lecturas=await Promise.all([tx.get(loanRef),...loteRefs.map(r=>tx.get(r)),...invRefs.map(r=>tx.get(r))]);
      const loanDoc=lecturas[0];if(!loanDoc.exists)throw new Error('El préstamo ya no existe.');
      const loteDocs=lecturas.slice(1,1+loteRefs.length);const invDocs=lecturas.slice(1+loteRefs.length);
      const mapaLotes=new Map(loteDocs.map((d,i)=>[lotes[i].id,d.exists?d.data():null]));
      seleccion.forEach((grupo,index)=>{
        const invDoc=invDocs[index];if(!invDoc.exists)throw new Error(`No existe ${grupo.codigo}.`);
        const inv=invDoc.data();if(Number(inv.cantidadPrestada||0)<grupo.cantidad)throw new Error(`El stock prestado de ${grupo.codigo} cambió.`);
        asignarDevolucionALotes(grupo,grupo.cantidad,mapaLotes).forEach(c=>{const nuevoPend=Number(c.data.cantidadPendiente)-c.usar;tx.update(db.collection('prestamoItems').doc(c.id),{cantidadDevuelta:Number(c.data.cantidadDevuelta||0)+c.usar,cantidadPendiente:nuevoPend,estado:nuevoPend===0?(grupo.condicion==='BUENO'?'DEVUELTO':grupo.condicion):'PARCIAL',ultimaDevolucionId:devolucionId,actualizadoEn:devolucion.fechaHora});});
        const invUpdate={cantidadPrestada:Number(inv.cantidadPrestada||0)-grupo.cantidad,actualizadoEn:devolucion.fechaHora,actualizadoPor:uid()};
        if(grupo.condicion==='DANADO')invUpdate.cantidadReparacion=Number(inv.cantidadReparacion||0)+grupo.cantidad;
        if(grupo.condicion==='PERDIDO')invUpdate.cantidadPerdida=Number(inv.cantidadPerdida||0)+grupo.cantidad;
        tx.update(invRefs[index],invUpdate);
        const movId=idOperacion('MOV');tx.set(db.collection('movimientosInventario').doc(movId),{tipo:'DEVOLUCION',condicion:grupo.condicion,prestamoId:prestamo.id,devolucionId,inventarioId:grupo.inventarioId,codigo:grupo.codigo,cantidad:grupo.cantidad,socioId:prestamo.socioId,fechaHora:devolucion.fechaHora,operadorUid:uid()});
        if(grupo.condicion==='DANADO'){
          const repId=idOperacion('REP');const rep={inventarioId:grupo.inventarioId,codigo:grupo.codigo,nombre:grupo.nombre,cantidad:grupo.cantidad,prestamoId:prestamo.id,devolucionId,socioId:prestamo.socioId,socioNombre:prestamo.socioNombre,detalleDanio:grupo.observacion,estado:'PENDIENTE_DIAGNOSTICO',responsable:'',diagnostico:'',costoEstimado:0,costoReal:0,fechaDeteccion:devolucion.fecha,fechaInicio:'',fechaPrevista:'',fechaFinalizacion:'',resultado:'',inventarioAjustado:false,creadoEn:devolucion.fechaHora,actualizadoEn:devolucion.fechaHora};tx.set(db.collection('reparaciones').doc(repId),rep);reparacionesNuevas.push({id:repId,...rep});
        }
      });
      tx.update(loanRef,loanUpdate);tx.set(db.collection('devolucionesPrestamo').doc(devolucionId),devolucion);
    });
  }

  function guardarDevolucionOffline(prestamo,devolucionId,devolucion,seleccion,loanUpdate){
    OfflineSync.enqueue('prestamos',prestamo.id,'merge',loanUpdate);OfflineSync.enqueue('devolucionesPrestamo',devolucionId,'set',devolucion);
    const mapaDocs=new Map(itemsPrestamo.map(i=>[i.id,i]));
    seleccion.forEach(grupo=>{
      asignarDevolucionALotes(grupo,grupo.cantidad,mapaDocs).forEach(c=>{const nuevoPend=Number(c.data.cantidadPendiente)-c.usar;const cambio={cantidadDevuelta:Number(c.data.cantidadDevuelta||0)+c.usar,cantidadPendiente:nuevoPend,estado:nuevoPend===0?(grupo.condicion==='BUENO'?'DEVUELTO':grupo.condicion):'PARCIAL',ultimaDevolucionId:devolucionId,actualizadoEn:devolucion.fechaHora};OfflineSync.enqueue('prestamoItems',c.id,'merge',cambio);Object.assign(c.data,cambio);});
      const inv=inventario.find(i=>i.id===grupo.inventarioId);const cambioInv={cantidadPrestada:Number(inv.cantidadPrestada||0)-grupo.cantidad,actualizadoEn:devolucion.fechaHora,actualizadoPor:uid()};if(grupo.condicion==='DANADO')cambioInv.cantidadReparacion=Number(inv.cantidadReparacion||0)+grupo.cantidad;if(grupo.condicion==='PERDIDO')cambioInv.cantidadPerdida=Number(inv.cantidadPerdida||0)+grupo.cantidad;OfflineSync.enqueue('inventario',grupo.inventarioId,'merge',cambioInv);Object.assign(inv,cambioInv);
      OfflineSync.enqueue('movimientosInventario',idOperacion('MOV'),'set',{tipo:'DEVOLUCION',condicion:grupo.condicion,prestamoId:prestamo.id,devolucionId,inventarioId:grupo.inventarioId,codigo:grupo.codigo,cantidad:grupo.cantidad,socioId:prestamo.socioId,fechaHora:devolucion.fechaHora,operadorUid:uid()});
      if(grupo.condicion==='DANADO'){const repId=idOperacion('REP');const rep={inventarioId:grupo.inventarioId,codigo:grupo.codigo,nombre:grupo.nombre,cantidad:grupo.cantidad,prestamoId:prestamo.id,devolucionId,socioId:prestamo.socioId,socioNombre:prestamo.socioNombre,detalleDanio:grupo.observacion,estado:'PENDIENTE_DIAGNOSTICO',responsable:'',diagnostico:'',costoEstimado:0,costoReal:0,fechaDeteccion:devolucion.fecha,fechaInicio:'',fechaPrevista:'',fechaFinalizacion:'',resultado:'',inventarioAjustado:false,creadoEn:devolucion.fechaHora,actualizadoEn:devolucion.fechaHora};OfflineSync.enqueue('reparaciones',repId,'set',rep);reparaciones.push({id:repId,...rep});}
    });
    Object.assign(prestamo,loanUpdate);devoluciones.push({id:devolucionId,...devolucion});render();
  }

  function limpiarFirmaControl(){const c=document.getElementById('mh-return-signature-canvas');if(typeof limpiarCanvasFirma==='function')limpiarCanvasFirma(c);}
  function limpiarFirmaQuienDevuelve(){const c=document.getElementById('mh-return-devuelve-canvas');if(typeof limpiarCanvasFirma==='function')limpiarCanvasFirma(c);}
  // Nombre histórico: ahora limpia los dos trazos, para no dejar uno huérfano.
  function limpiarFirmaDevolucion(){limpiarFirmaQuienDevuelve();limpiarFirmaControl();}

  function comprobanteDevolucion(id){const dev=devoluciones.find(d=>d.id===id);if(!dev)return showToast('No se encontró la devolución.','error');const loan=prestamos.find(p=>p.id===dev.prestamoId)||{};comprobanteDevolucionDesdeDatos(dev,loan);}
  function comprobanteDevolucionDesdeDatos(dev,loan){
    if(!window.jspdf?.jsPDF)return;const {jsPDF}=window.jspdf;const doc=new jsPDF();doc.setFont('helvetica','bold');doc.setFontSize(16);doc.text('COVIMT 9',14,18);doc.setFontSize(13);doc.text('Comprobante de devolución',14,27);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(`Préstamo: ${dev.prestamoId}`,14,37);doc.text(`Socio: ${dev.socioId} — ${dev.socioNombre}`,14,43);doc.text(`Devuelve: ${dev.personaDevuelve.nombre}`,14,49);doc.text(`Fecha: ${new Date(dev.fechaHora).toLocaleString('es-UY')}`,14,55);doc.autoTable({startY:63,head:[['Código','Artículo','Cantidad','Condición','Origen']],body:dev.items.map(i=>[i.codigo,i.nombre,String(i.cantidad),({BUENO:'Bueno',DANADO:'Dañado',PERDIDO:'Perdido'}[i.condicion]||i.condicion),(i.setNombres||[]).join(', ')||'Individual']),theme:'grid',styles:{fontSize:9},headStyles:{fillColor:[6,95,70]}});let y=doc.lastAutoTable.finalY+10;if(dev.observaciones){doc.text(`Observaciones: ${dev.observaciones}`,14,y,{maxWidth:180});y+=12;}const firmante=dev.firmaDe==='ENCARGADO'?`Recibe y controla: ${(dev.encargado&&dev.encargado.nombre)||dev.operadorEmail||'encargado'}`:(dev.personaDevuelve||{}).nombre||'';
    if(dev.firmaDevuelve){
      // Doble firma: quien devuelve a la izquierda, quien controla a la derecha.
      try{doc.addImage(dev.firmaDevuelve,'PNG',14,y,60,24);}catch{}
      doc.line(14,y+27,74,y+27);
      doc.text(`Devuelve: ${((dev.personaDevuelve||{}).nombre)||'—'}`,14,y+32);
      try{doc.addImage(dev.firma,'PNG',118,y,60,24);}catch{}
      doc.line(118,y+27,178,y+27);
      doc.text(firmante,118,y+32);
      doc.text(loan.estado==='CERRADO'?'Préstamo cerrado':'Devolución parcial',14,y+40);
    }else{
      try{doc.addImage(dev.firma,'PNG',14,y,60,24);}catch{}
      doc.line(14,y+27,78,y+27);
      doc.text(firmante,14,y+33);
      doc.text(loan.estado==='CERRADO'?'Préstamo cerrado':'Devolución parcial',120,y+15);
    }doc.save(`devolucion_${dev.socioId}_${dev.fecha}.pdf`);
  }

  // ------------------------------------------------------------
  // REPARACIONES
  // ------------------------------------------------------------
  function textoEstadoReparacion(e){return {PENDIENTE_DIAGNOSTICO:'Pendiente de diagnóstico',EN_REPARACION:'En reparación',REPARADO:'Reparado',NO_REPARABLE:'No reparable'}[e]||e;}
  function renderReparaciones(){
    const body=document.getElementById('mh-reparaciones-body');if(!body)return;
    const filtro=document.getElementById('mh-reparacion-filtro')?.value||'ACTIVAS';const q=norm(document.getElementById('mh-reparacion-buscar')?.value||'');
    const lista=reparaciones.filter(r=>{const activa=!['REPARADO','NO_REPARABLE'].includes(r.estado);return (filtro==='TODAS'||(filtro==='ACTIVAS'&&activa)||r.estado===filtro)&&(!q||norm([r.codigo,r.nombre,r.socioNombre,r.responsable].join(' ')).includes(q));}).sort((a,b)=>String(b.actualizadoEn||b.creadoEn).localeCompare(String(a.actualizadoEn||a.creadoEn)));
    setText('mh-reparaciones-activas',reparaciones.filter(r=>!['REPARADO','NO_REPARABLE'].includes(r.estado)).length);
    body.innerHTML=lista.map(r=>`<tr><td><span class="mh-code">${esc(r.codigo)}</span><br>${esc(r.nombre)} × ${Number(r.cantidad||1)}</td><td>${esc(r.fechaDeteccion||'—')}<br><small>${esc(r.socioNombre||'')}</small></td><td>${esc(r.detalleDanio||'Sin detalle')}</td><td>${esc(r.responsable||'Sin asignar')}</td><td><span class="mh-badge ${['REPARADO'].includes(r.estado)?'mh-badge-green':r.estado==='NO_REPARABLE'?'mh-badge-red':'mh-badge-amber'}">${esc(textoEstadoReparacion(r.estado))}</span></td><td>$ ${Number(r.costoReal||r.costoEstimado||0).toFixed(2)}</td><td><button class="mh-btn mh-btn-primary" onclick="MaquinasHerramientas.abrirReparacion('${esc(r.id)}')">Gestionar</button></td></tr>`).join('');
    document.getElementById('mh-reparaciones-empty')?.classList.toggle('mh-hidden',lista.length>0);lucide.createIcons();
  }

  function abrirReparacion(id){
    const r=reparaciones.find(x=>x.id===id);if(!r)return;
    setValue('mh-reparacion-id',id);setText('mh-reparacion-articulo',`${r.codigo} — ${r.nombre} × ${r.cantidad||1}`);setValue('mh-reparacion-estado',r.estado);setValue('mh-reparacion-responsable',r.responsable);setValue('mh-reparacion-diagnostico',r.diagnostico);setValue('mh-reparacion-costo-estimado',Number(r.costoEstimado||0));setValue('mh-reparacion-costo-real',Number(r.costoReal||0));setValue('mh-reparacion-fecha-inicio',r.fechaInicio);setValue('mh-reparacion-fecha-prevista',r.fechaPrevista);setValue('mh-reparacion-fecha-final',r.fechaFinalizacion);setValue('mh-reparacion-resultado',r.resultado);document.getElementById('mh-reparacion-resuelta').classList.toggle('mh-hidden',!r.inventarioAjustado);openModal('mh-modal-reparacion');
  }

  async function guardarReparacion(event){
    event.preventDefault();const id=document.getElementById('mh-reparacion-id').value;const r=reparaciones.find(x=>x.id===id);if(!r)return;
    const estado=document.getElementById('mh-reparacion-estado').value;if(r.inventarioAjustado&&estado!==r.estado)return showToast('Una reparación finalizada no puede cambiar de resultado.','error');
    const costoEstimado=Number(document.getElementById('mh-reparacion-costo-estimado').value||0),costoReal=Number(document.getElementById('mh-reparacion-costo-real').value||0);if(costoEstimado<0||costoReal<0)return showToast('Los costos no pueden ser negativos.','error');
    const responsable=document.getElementById('mh-reparacion-responsable').value.trim(),diagnostico=document.getElementById('mh-reparacion-diagnostico').value.trim(),resultado=document.getElementById('mh-reparacion-resultado').value.trim();
    const finaliza=['REPARADO','NO_REPARABLE'].includes(estado);
    if(estado!=='PENDIENTE_DIAGNOSTICO'&&(!responsable||!diagnostico))return showToast('Para iniciar o finalizar la reparación indique responsable y diagnóstico.','error');
    if(finaliza&&!resultado)return showToast('Indique el resultado final de la reparación.','error');
    const data={estado,responsable,diagnostico,costoEstimado,costoReal,fechaInicio:document.getElementById('mh-reparacion-fecha-inicio').value,fechaPrevista:document.getElementById('mh-reparacion-fecha-prevista').value,fechaFinalizacion:document.getElementById('mh-reparacion-fecha-final').value,resultado,actualizadoEn:nowIso(),actualizadoPor:uid()};
    if(estado!=='PENDIENTE_DIAGNOSTICO'&&!data.fechaInicio)data.fechaInicio=fechaLocal();
    if(finaliza&&!data.fechaFinalizacion)data.fechaFinalizacion=fechaLocal();
    try{
      if(navigator.onLine)await db.runTransaction(async tx=>{const repRef=db.collection('reparaciones').doc(id),invRef=db.collection('inventario').doc(r.inventarioId);const [repDoc,invDoc]=await Promise.all([tx.get(repRef),tx.get(invRef)]);if(!repDoc.exists||!invDoc.exists)throw new Error('No se encontró la reparación o el artículo.');const actual=repDoc.data(),inv=invDoc.data();if(finaliza&&!actual.inventarioAjustado){const cantidad=Number(actual.cantidad||1);const invData={cantidadReparacion:Math.max(0,Number(inv.cantidadReparacion||0)-cantidad),actualizadoEn:data.actualizadoEn,actualizadoPor:uid()};if(estado==='NO_REPARABLE'){invData.cantidadTotal=Math.max(0,Number(inv.cantidadTotal||0)-cantidad);if(invData.cantidadTotal===0)invData.estado='BAJA';}tx.update(invRef,invData);data.inventarioAjustado=true;}tx.update(repRef,data);});
      else{const inv=inventario.find(i=>i.id===r.inventarioId);if(finaliza&&!r.inventarioAjustado){const cantidad=Number(r.cantidad||1),invData={cantidadReparacion:Math.max(0,Number(inv.cantidadReparacion||0)-cantidad),actualizadoEn:data.actualizadoEn,actualizadoPor:uid()};if(estado==='NO_REPARABLE'){invData.cantidadTotal=Math.max(0,Number(inv.cantidadTotal||0)-cantidad);if(invData.cantidadTotal===0)invData.estado='BAJA';}OfflineSync.enqueue('inventario',r.inventarioId,'merge',invData);Object.assign(inv,invData);data.inventarioAjustado=true;}OfflineSync.enqueue('reparaciones',id,'merge',data);Object.assign(r,data);render();}
      if(typeof registrarLog==='function')registrarLog('Reparación',`${r.codigo}: ${textoEstadoReparacion(estado)}.`);closeModal('mh-modal-reparacion');showToast('Reparación actualizada.','success');
    }catch(e){showToast('No se pudo actualizar la reparación: '+e.message,'error');}
  }

  function switchSubtab(tab){
    document.querySelectorAll('.mh-subtab').forEach(b=>b.classList.toggle('active',b.dataset.mhTab===tab));
    document.querySelectorAll('[data-mh-section]').forEach(s=>s.classList.toggle('mh-section-hidden',s.dataset.mhSection!==tab));
    if(tab==='sets')renderSets();
    if(tab==='prestamos')renderPrestamos();
    if(tab==='reparaciones')renderReparaciones();
  }

  return {init,setEditMode,openNuevo,editar,baja,closeModal,abrirCSV,descargarPlantilla,importarCSV,switchSubtab,abrirEntrega,ampliarEntrega,agregarArticuloEntrega,quitarArticuloEntrega,limpiarFirmaEntrega,abrirScanner,cerrarScanner,comprobanteEntrega,abrirDevolucion,limpiarFirmaDevolucion,limpiarFirmaQuienDevuelve,limpiarFirmaControl,comprobanteDevolucion,abrirReparacion,hayPrestamoObraPendiente,iniciarEntregasDesdeJornada,abrirDesdeJornada,abrirDesdeRegistroJornada,abrirDevolucionDesdeJornada,abrirDevolucionDesdeRegistro,cancelarEntrega,abrirNuevoSet,editarSet,bajaSet,agregarComponenteSet,quitarComponenteSet,cambiarComponenteSet,agregarSetEntrega,quitarSetEntrega,setMotivoParcial};
})();

// Disponible para los botones declarativos del HTML y para cooperativa.js.
window.MaquinasHerramientas = MaquinasHerramientas;
document.addEventListener('DOMContentLoaded', () => MaquinasHerramientas.init());

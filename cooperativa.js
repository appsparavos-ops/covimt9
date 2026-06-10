// --- CONFIGURACIÓN E INICIALIZACIÓN ---
let db = null;
let socios = [];
let registros = [];
let config = { objetivoHoras: 40 };
let saldosHistoricos = {};
let modoEdicion = false;
const COMISIONES_VALIDAS = ["Ninguna", "Consejo Directivo", "Comisión Fiscal", "Comisión Fomento", "Comisión de Obra", "Comisión Electoral"];
const COMISIONES_LEGACY = {
  Directiva: "Consejo Directivo",
  Obra: "Comisión de Obra",
  Finanzas: "Comisión Fiscal",
  Fomento: "Comisión Fomento",
  Electoral: "Comisión Electoral"

};

// Inicializar iconos de Lucide al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  checkAuthAndInit();
});

// --- AUTENTICACIÓN Y SEGURIDAD ---
function checkAuthAndInit() {
  if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') {
    showToast("Error: SDK de Firebase o firebaseConfig.js no cargados.", "error");
    return;
  }

  // Inicializar Firebase si no está iniciado
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  
  db = firebase.firestore();

  // Escuchar estado de autenticación
  firebase.auth().onAuthStateChanged((user) => {
    const viewLogin = document.getElementById('view-login');
    const appContainer = document.getElementById('app-container');

    if (user) {
      // Usuario autenticado: mostrar app, ocultar login
      viewLogin.classList.add('hidden');
      appContainer.classList.remove('hidden');
      showToast("Bienvenido al sistema.", "success");
      
      // Sincronizar Firestore
      startFirestoreSync();
    } else {
      // Usuario no autenticado: mostrar login, ocultar app
      viewLogin.classList.remove('hidden');
      appContainer.classList.add('hidden');
      
      // Limpiar listeners si es necesario
      socios = [];
      registros = [];
      saldosHistoricos = {};
    }
  });
}

function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const submitBtn = document.getElementById('btn-login-submit');

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Autenticando...`;
  lucide.createIcons();

  firebase.auth().signInWithEmailAndPassword(email, password)
    .then(() => {
      // Login exitoso, onAuthStateChanged se encarga de reestructurar la UI
      document.getElementById('login-email').value = '';
      document.getElementById('login-password').value = '';
    })
    .catch((error) => {
      showToast("Acceso denegado: " + error.message, "error");
    })
    .finally(() => {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="log-in" class="w-4 h-4"></i> Iniciar Sesión`;
      lucide.createIcons();
    });
}

function handleLogout() {
  if (confirm("¿Confirmas que deseas cerrar sesión?")) {
    firebase.auth().signOut()
      .then(() => {
        showToast("Sesión cerrada.", "info");
      })
      .catch((error) => {
        showToast("Error al cerrar sesión: " + error.message, "error");
      });
  }
}

// --- SINCRONIZACIÓN FIRESTORE EN TIEMPO REAL ---
function startFirestoreSync() {
  if (!db) return;

  // 1. Escuchar Socios
  db.collection('socios').onSnapshot((snapshot) => {
    socios = snapshot.docs.map(doc => doc.data());
    
    // Mostrar Banner Semilla si la base de datos está vacía
    if (socios.length === 0) {
      document.getElementById('seed-banner').classList.remove('hidden');
    } else {
      document.getElementById('seed-banner').classList.add('hidden');
    }

    renderSociosList();
    renderDashboard();
    renderPlanilla();
    setupHistorial();
    setupAsistenciaForms();
    applyModoEdicion();
  }, (error) => {
    showToast("Error al sincronizar socios: " + error.message, "error");
  });

  // 2. Escuchar Jornadas
  db.collection('registros').onSnapshot((snapshot) => {
    registros = snapshot.docs.map(doc => doc.data());
    renderJornadasActivas();
    renderDashboard();
    renderPlanilla();
    renderHistorialTable();
  }, (error) => {
    showToast("Error al sincronizar jornadas: " + error.message, "error");
  });

  // 3. Escuchar Objetivo Global
  db.collection('config').doc('metaGlobal').onSnapshot((doc) => {
    if (doc.exists) {
      config = normalizarConfig(doc.data());
    } else {
      config = normalizarConfig({});
    }
    renderDashboard();
    renderPlanilla();
  });

  // 4. Escuchar Saldos e Históricos del Cierre mensual
  db.collection('saldosHistoricos').onSnapshot((snapshot) => {
    saldosHistoricos = {};
    snapshot.docs.forEach(doc => {
      saldosHistoricos[doc.id] = doc.data();
    });
    renderPlanilla();
    renderDashboard();
  });
}

// --- CARGA DE DATOS DE PRUEBA EN CLOUD (SEMILLA) ---
const mockSocios = [
  {
    id: "1.234.567-8",
    nombre: "Carlos Pérez",
    vivienda: "Vivienda 12",
    fechaNacimiento: "1985-05-15",
    comision: "Comisión de Obra",
    nucleo: [
      { nombre: "Luis Pérez", fechaNacimiento: "2012-08-20", parentesco: "Hijo/a", comision: "Ninguna" },
      { nombre: "María Gómez", fechaNacimiento: "1988-12-01", parentesco: "Cónyuge/Pareja", comision: "Comisión Fomento" }
    ]
  },
  {
    id: "4.567.890-1",
    nombre: "Ana Rodríguez",
    vivienda: "Vivienda 45",
    fechaNacimiento: "1992-04-10",
    comision: "Consejo Directivo",
    nucleo: [
      { nombre: "Jorge Martínez", fechaNacimiento: "1990-11-25", parentesco: "Cónyuge/Pareja", comision: "Comisión de Obra" }
    ]
  },
  {
    id: "2.345.678-9",
    nombre: "Julio Méndez",
    vivienda: "Vivienda 03",
    fechaNacimiento: "1950-01-01",
    comision: "Ninguna",
    nucleo: []
  }
];

const mockFirma = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='80' viewBox='0 0 200 80'><path d='M10,45 Q40,15 70,55 T120,35 T170,55' fill='none' stroke='black' stroke-width='2'/></svg>";

const mockRegistros = [
  {
    id: "reg-1",
    socioId: "1.234.567-8",
    trabajadorNombre: "Carlos Pérez",
    fecha: "2026-06-01",
    horaIngreso: "08:00",
    horaSalida: "12:30",
    horasTrabajadas: 4.5,
    tarea: "Acopio de materiales en el obrador general",
    firma: mockFirma,
    estado: "finalizado"
  },
  {
    id: "reg-2",
    socioId: "4.567.890-1",
    trabajadorNombre: "Ana Rodríguez",
    fecha: "2026-06-03",
    horaIngreso: "14:00",
    horaSalida: "18:00",
    horasTrabajadas: 4.0,
    tarea: "Organización de documentación en oficina",
    firma: mockFirma,
    estado: "finalizado"
  }
];

async function seedInitialDataToCloud() {
  if (!db) return;
  try {
    showToast("Subiendo datos semilla...", "info");
    for (const s of mockSocios) {
      await db.collection('socios').doc(s.id).set(s);
    }
    for (const r of mockRegistros) {
      await db.collection('registros').doc(r.id).set(r);
    }
    await db.collection('config').doc('metaGlobal').set(normalizarConfig({ objetivoHoras: 40 }));
    showToast("Datos semilla subidos correctamente.", "success");
    document.getElementById('seed-banner').classList.add('hidden');
  } catch (err) {
    showToast("Error al sembrar datos: " + err.message, "error");
  }
}

async function clearCloudDatabase() {
  if (!db) return;
  if (confirm("¿Confirmas que deseas limpiar todos los datos de socios e historiales en Firebase?")) {
    try {
      showToast("Vaciando base de datos...", "info");
      const snapSocios = await db.collection('socios').get();
      for (const doc of snapSocios.docs) await doc.ref.delete();

      const snapReg = await db.collection('registros').get();
      for (const doc of snapReg.docs) await doc.ref.delete();

      const snapSaldos = await db.collection('saldosHistoricos').get();
      for (const doc of snapSaldos.docs) await doc.ref.delete();

      showToast("Base de datos de la nube vaciada.", "info");
    } catch (err) {
      showToast("Error al borrar en la nube: " + err.message, "error");
    }
  }
}

// --- ACCIONES ESCRITURA FIRESTORE ---
async function saveSocio() {
  const id = document.getElementById('socio-id').value.trim();
  const nombre = document.getElementById('socio-nombre').value.trim();
  const vivienda = document.getElementById('socio-vivienda').value.trim();
  const fechaNacimiento = document.getElementById('socio-nacimiento').value;
  const comision = normalizarComision(document.getElementById('socio-comision').value);
  const certificadoMedico = document.getElementById('socio-certificado-medico').checked;

  if (socios.some(s => s.id === id)) {
    showToast("ID de socio ya se encuentra registrado.", "error");
    return;
  }

  try {
    await db.collection('socios').doc(id).set({
      id,
      nombre,
      vivienda,
      fechaNacimiento,
      comision,
      certificadoMedico,
      nucleo: []
    });
    showToast("Socio titular guardado.", "success");
    document.getElementById('form-socio').reset();
  } catch (err) {
    showToast("Error al guardar socio: " + err.message, "error");
  }
}

async function deleteSocio(socioId) {
  if (confirm("¿Deseas eliminar este socio en la nube?")) {
    try {
      await db.collection('socios').doc(socioId).delete();
      showToast("Socio eliminado.", "info");
    } catch (err) {
      showToast("Error al borrar socio: " + err.message, "error");
    }
  }
}

async function saveNucleoMember() {
  const socioId = document.getElementById('nucleo-socio-id').value;
  const editIndexValue = document.getElementById('nucleo-edit-index').value;
  const editIndex = editIndexValue === '' ? -1 : parseInt(editIndexValue);
  const nombre = document.getElementById('nucleo-nombre').value.trim();
  const fechaNacimiento = document.getElementById('nucleo-nacimiento').value;
  const parentesco = document.getElementById('nucleo-parentesco').value;
  const comision = normalizarComision(document.getElementById('nucleo-comision').value);
  const certificadoMedico = document.getElementById('nucleo-certificado-medico').checked;

  const idx = socios.findIndex(s => s.id === socioId);
  if (idx !== -1) {
    const socio = socios[idx];
    const nuevoNucleo = [...(socio.nucleo || [])];
    const familiar = { nombre, fechaNacimiento, parentesco, comision, certificadoMedico };
    if (editIndex >= 0) {
      nuevoNucleo[editIndex] = familiar;
    } else {
      nuevoNucleo.push(familiar);
    }
    try {
      await db.collection('socios').doc(socioId).update({ nucleo: nuevoNucleo });
      showToast(editIndex >= 0 ? "Familiar actualizado." : "Familiar agregado al núcleo.", "success");
      closeNucleoModal();
    } catch (err) {
      showToast("Error al guardar familiar: " + err.message, "error");
    }
  }
}

function updateSocioComision(socioId) {
  const socio = socios.find(s => s.id === socioId);
  if (!socio) return;
  openComisionModal('socio', socioId, '', socio.comision);
}

function updateNucleoComision(socioId, index) {
  const socio = socios.find(s => s.id === socioId);
  if (!socio || !socio.nucleo || !socio.nucleo[index]) return;
  openComisionModal('nucleo', socioId, index, socio.nucleo[index].comision);
}

async function removeNucleoMember(socioId, index) {
  if (confirm("¿Deseas eliminar a este familiar del núcleo?")) {
    const idx = socios.findIndex(s => s.id === socioId);
    if (idx !== -1) {
      const socio = socios[idx];
      const nuevoNucleo = [...socio.nucleo];
      nuevoNucleo.splice(index, 1);
      try {
        await db.collection('socios').doc(socioId).update({ nucleo: nuevoNucleo });
        showToast("Miembro removido.", "info");
      } catch (err) {
        showToast("Error al remover familiar: " + err.message, "error");
      }
    }
  }
}

async function registerIngreso() {
  const socioId = document.getElementById('ingreso-socio').value;
  const trabajadorNombre = document.getElementById('ingreso-trabajador').value;
  const fecha = document.getElementById('ingreso-fecha').value;
  const horaIngreso = document.getElementById('ingreso-hora').value;
  const tarea = document.getElementById('ingreso-tarea').value.trim();

  if (!trabajadorNombre) {
    showToast("No se seleccionó un trabajador habilitado.", "error");
    return;
  }

  if (registros.some(r => r.socioId === socioId && r.estado === 'activo')) {
    showToast("La vivienda seleccionada ya cuenta con una jornada activa.", "error");
    return;
  }

  const id = 'reg-' + Date.now();
  const nuevoIngreso = {
    id,
    socioId,
    trabajadorNombre,
    fecha,
    horaIngreso,
    horaSalida: '',
    horasTrabajadas: 0,
    tarea,
    firma: '',
    estado: 'activo'
  };

  try {
    await db.collection('registros').doc(id).set(nuevoIngreso);
    showToast("Ingreso marcado.", "success");
    document.getElementById('form-ingreso').reset();
    setupAsistenciaForms();
  } catch (err) {
    showToast("Error al registrar ingreso: " + err.message, "error");
  }
}

async function submitEgresoWithSignature() {
  if (isCanvasBlank()) {
    showToast("Es obligatorio firmar.", "error");
    return;
  }

  const id = document.getElementById('egreso-registro-id').value;
  const horaSalida = document.getElementById('egreso-hora').value;
  const firma = signatureCanvas.toDataURL();

  const reg = registros.find(r => r.id === id);
  if (reg) {
    const calculated = calculateHours(reg.horaIngreso, horaSalida);
    if (calculated <= 0) {
      showToast("La hora de salida debe ser posterior a la de ingreso.", "error");
      return;
    }

    try {
      await db.collection('registros').doc(id).update({
        horaSalida,
        horasTrabajadas: calculated,
        firma,
        estado: 'finalizado'
      });
      showToast(`Egreso registrado: ${calculated} hs guardadas.`, "success");
      closeEgresoModal();
      switchTab('tab-planilla');
    } catch (err) {
      showToast("Error al registrar egreso: " + err.message, "error");
    }
  }
}

async function deleteRecord(recordId) {
  if (confirm("¿Deseas eliminar permanentemente esta jornada?")) {
    try {
      await db.collection('registros').doc(recordId).delete();
      showToast("Jornada eliminada.", "info");
    } catch (err) {
      showToast("Error al eliminar registro: " + err.message, "error");
    }
  }
}

async function saveConfig() {
  const obj = parseInt(document.getElementById('config-objetivo').value);
  if (obj > 0) {
    try {
      await db.collection('config').doc('metaGlobal').set(normalizarConfig({ objetivoHoras: obj }));
      // Guardar modo edición
      const toggleEl = document.getElementById('config-modo-edicion');
      const nuevoModo = toggleEl ? toggleEl.checked : modoEdicion;

      // Si se intenta HABILITAR, validar la clave
      if (nuevoModo && !modoEdicion) {
        const clave = (document.getElementById('clave-modo-edicion')?.value || '').trim();
        if (clave !== 'admin') {
          showToast('Clave incorrecta. No se habilitó el Modo Edición.', 'error');
          if (toggleEl) toggleEl.checked = false;
          document.getElementById('campo-clave-edicion')?.classList.add('hidden');
          if (document.getElementById('clave-modo-edicion')) document.getElementById('clave-modo-edicion').value = '';
          return;
        }
      }

      modoEdicion = nuevoModo;
      applyModoEdicion();
      showToast(modoEdicion ? 'Configuración guardada. Modo Edición activado.' : 'Configuración guardada. Modo Edición desactivado.', 'success');
      closeConfigModal();
    } catch (err) {
      showToast('Error al guardar configuración: ' + err.message, 'error');
    }
  }
}

function onToggleModoEdicion(checkbox) {
  const campoClave = document.getElementById('campo-clave-edicion');
  const inputClave = document.getElementById('clave-modo-edicion');
  if (!campoClave) return;
  // Mostrar campo de clave solo cuando se activa (y el modo edición estaba desactivado)
  if (checkbox.checked && !modoEdicion) {
    campoClave.classList.remove('hidden');
    if (inputClave) { inputClave.value = ''; inputClave.focus(); }
  } else {
    campoClave.classList.add('hidden');
    if (inputClave) inputClave.value = '';
  }
}

function applyModoEdicion() {
  // Panel de registro de socios
  const panelRegistro = document.getElementById('panel-registro-socio');
  if (panelRegistro) {
    panelRegistro.style.display = modoEdicion ? '' : 'none';
  }
  // Badge de indicador en la pestaña de socios
  const badge = document.getElementById('badge-modo-edicion');
  if (badge) {
    badge.classList.toggle('hidden', !modoEdicion);
  }
  // Botón de sincronización CSV
  const btnSync = document.getElementById('btn-sync-csv');
  if (btnSync) {
    btnSync.classList.toggle('hidden', !modoEdicion);
  }
  // Botones de Cerrar Mes y Descargar CSV
  const btnCerrarMes = document.getElementById('btn-cerrar-mes');
  const btnDescargarCSV = document.getElementById('btn-descargar-csv');
  if (btnCerrarMes) {
    btnCerrarMes.style.display = modoEdicion ? '' : 'none';
  }
  if (btnDescargarCSV) {
    btnDescargarCSV.style.display = modoEdicion ? '' : 'none';
  }
  // Re-renderizar la lista de socios para mostrar/ocultar botones
  renderSociosList();
}

// --- SINCRONIZACIÓN DESDE CSV ---
function sincronizarDesdeCSV() {
  if (!modoEdicion) return;
  document.getElementById('input-csv-sync').value = '';
  document.getElementById('input-csv-sync').click();
}

async function procesarCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const anio = document.getElementById('planilla-anio')?.value || String(new Date().getFullYear());
  const mes  = document.getElementById('planilla-mes')?.value  || String(new Date().getMonth() + 1).padStart(2, '0');

  if (!confirm(
    `¿Deseas sobreescribir TODOS los socios en la base de datos con los datos del archivo "${file.name}"?\n` +
    `Los saldos anteriores se cargarán para el período ${mes}/${anio}.\n\n` +
    `Esta acción no se puede deshacer.`
  )) {
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      showToast('Procesando CSV…', 'info');

      // Quitar BOM si existe
      let texto = e.target.result.replace(/^\uFEFF/, '');
      const datos = parsearCSVSocios(texto);

      if (datos.length === 0) {
        showToast('El CSV no contiene datos válidos.', 'error');
        return;
      }

      // 1. Borrar socios existentes
      const snapSocios = await db.collection('socios').get();
      let batchDel = db.batch();
      let c = 0;
      for (const doc of snapSocios.docs) {
        batchDel.delete(doc.ref);
        if (++c === 499) { await batchDel.commit(); batchDel = db.batch(); c = 0; }
      }
      if (c > 0) await batchDel.commit();

      // 2. Borrar saldos históricos existentes
      const snapSaldos = await db.collection('saldosHistoricos').get();
      let batchDel2 = db.batch();
      c = 0;
      for (const doc of snapSaldos.docs) {
        batchDel2.delete(doc.ref);
        if (++c === 499) { await batchDel2.commit(); batchDel2 = db.batch(); c = 0; }
      }
      if (c > 0) await batchDel2.commit();

      // 3. Escribir nuevos socios
      let batchW = db.batch();
      c = 0;
      for (const { socio } of datos) {
        batchW.set(db.collection('socios').doc(socio.id), socio);
        if (++c === 499) { await batchW.commit(); batchW = db.batch(); c = 0; }
      }
      if (c > 0) await batchW.commit();

      // 4. Escribir saldos anteriores del período seleccionado
      let batchS = db.batch();
      c = 0;
      for (const { socio, saldoAnterior } of datos) {
        if (saldoAnterior !== 0) {
          const clave = `${socio.id}_${anio}-${mes}`;
          batchS.set(db.collection('saldosHistoricos').doc(clave), {
            deudaAnterior:      saldoAnterior < 0 ? Math.abs(saldoAnterior) : 0,
            remanenteAnterior:  saldoAnterior > 0 ? saldoAnterior : 0,
            tesoreriaAcumulada: 0
          });
          if (++c === 499) { await batchS.commit(); batchS = db.batch(); c = 0; }
        }
      }
      if (c > 0) await batchS.commit();

      showToast(`✓ ${datos.length} socios sincronizados correctamente para ${mes}/${anio}.`, 'success');
    } catch (err) {
      showToast('Error al sincronizar: ' + err.message, 'error');
      console.error(err);
    }
    event.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}

function parsearCSVSocios(texto) {
  const lineas = texto
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // Detectar si la primera línea es encabezado (no empieza con dígito)
  const inicio = /^\d/.test(lineas[0]?.split(';')[0]?.trim() ?? '') ? 0 : 1;
  const resultado = [];

  for (const linea of lineas.slice(inicio)) {
    const cols = linea.split(';').map(c => c.trim());
    const id     = cols[0];
    const nombre = cols[1] || '';
    if (!id || !nombre) continue;

    const fechaNacimiento = parsearFechaCSV(cols[2]);

    // Familiares: columnas 3..32 (hasta 10 familiares x 3 campos)
    const nucleo = [];
    for (let i = 0; i < 10; i++) {
      const base = 3 + i * 3;
      const nomFam     = (cols[base]     || '').trim();
      const parentesco = (cols[base + 1] || '').trim();
      const nacFam     = parsearFechaCSV(cols[base + 2] || '');
      if (nomFam) {
        nucleo.push({
          nombre: nomFam,
          parentesco: parentesco || 'Otro',
          fechaNacimiento: nacFam,
          comision: 'Ninguna'
        });
      }
    }

    // Saldo anterior: columna 33 (después de 10 familiares)
    const saldoAnterior = parseFloat((cols[33] || '0').replace(',', '.')) || 0;

    resultado.push({
      socio: {
        id,
        nombre,
        vivienda: id,          // vivienda = ID del socio
        fechaNacimiento,
        comision: 'Ninguna',
        nucleo
      },
      saldoAnterior
    });
  }
  return resultado;
}

function parsearFechaCSV(str) {
  if (!str) return '';
  str = str.trim();
  // DD/MM/YYYY → YYYY-MM-DD
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
  // YYYY-MM-DD ya está bien
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // DD-MM-YYYY
  const m2 = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  return str;
}

async function simularCierreMensual() {
  const anio = document.getElementById('planilla-anio').value;
  const mes = document.getElementById('planilla-mes').value;

  if (!confirm(`¿Deseas realizar el cierre del mes ${mes}/${anio}? Esto arrastrará los saldos.`)) {
    return;
  }

  let sigMes = parseInt(mes) + 1;
  let sigAnio = parseInt(anio);
  if (sigMes > 12) {
    sigMes = 1;
    sigAnio++;
  }
  const sigMesStr = String(sigMes).padStart(2, '0');
  const sigAnioStr = String(sigAnio);

  try {
    showToast("Calculando arrastres en Firebase...", "info");
    for (const s of socios) {
      const objetivo = obtenerObjetivoHorasSocio(s);

      const hist = obtenerSaldoHistoricoAlMes(s.id, anio, mes);
      const resHoras = obtenerResultadoHorasSocio(s, anio, mes);
      
      const comprometidas = objetivo + hist.deudaAnterior;
      const totalCredito = resHoras.computables + hist.remanenteAnterior;

      let remanenteFinal = 0;
      let deudaFinal = 0;
      let pasajeATesoreria = 0;

      if (totalCredito >= comprometidas) {
        remanenteFinal = totalCredito - comprometidas;
      } else {
        deudaFinal = comprometidas - totalCredito;
        
        const saldoTrasMesCorriente = Math.max(0, totalCredito - objetivo);
        if (saldoTrasMesCorriente < hist.deudaAnterior) {
          pasajeATesoreria = hist.deudaAnterior - saldoTrasMesCorriente;
          deudaFinal = Math.max(0, deudaFinal - pasajeATesoreria);
        }
      }

      const claveSiguiente = `${s.id}_${sigAnioStr}-${sigMesStr}`;
      await db.collection('saldosHistoricos').doc(claveSiguiente).set({
        deudaAnterior: deudaFinal,
        remanenteAnterior: remanenteFinal,
        tesoreriaAcumulada: (hist.tesoreriaAcumulada || 0) + pasajeATesoreria
      });
    }
    showToast(`Cierre procesado. Período ${sigMesStr}/${sigAnioStr} habilitado.`, "success");
    document.getElementById('planilla-anio').value = sigAnioStr;
    document.getElementById('planilla-mes').value = sigMesStr;
    renderPlanilla();
  } catch (err) {
    showToast("Error al realizar cierre: " + err.message, "error");
  }
}

// --- REGLAMENTO INTERNO (EDAD, EXONERACIONES, <4 HORAS) ---
function calcularEdad(fechaNacStr) {
  if (!fechaNacStr) return 0;
  const nacimiento = new Date(fechaNacStr);
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const m = hoy.getMonth() - nacimiento.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nacimiento.getDate())) {
    edad--;
  }
  return edad;
}

function esPersonaHabilitada(persona) {
  const edad = calcularEdad(persona.fechaNacimiento);
  return edad >= 16 && edad <= 70;
}

function esNucleoExonerado(socio) {
  // Si el socio titular tiene certificado médico y no hay integrantes habilitados, está exonerado
  if (socio.certificadoMedico && !esPersonaHabilitada(socio)) {
    if (socio.nucleo) {
      for (const familiar of socio.nucleo) {
        if (esPersonaHabilitada(familiar)) return false;
      }
    }
    return true;
  }
  
  // Lógica original: exonerado por edad
  if (esPersonaHabilitada(socio)) return false;
  if (socio.nucleo) {
    for (const familiar of socio.nucleo) {
      if (esPersonaHabilitada(familiar)) return false;
    }
  }
  return true;
}

function normalizarConfig(data = {}) {
  const objetivoHoras = parseInt(data.objetivoHoras) || 40;
  return { objetivoHoras };
}

function obtenerComisionAsignadaNucleo(socio) {
  if (socio.comision && socio.comision !== 'Ninguna') {
    return socio.comision;
  }
  if (socio.nucleo) {
    const familiarConComision = socio.nucleo.find(f => f.comision && f.comision !== 'Ninguna');
    if (familiarConComision) return familiarConComision.comision;
  }
  return null;
}

function obtenerObjetivoHorasSocio(socio) {
  if (esNucleoExonerado(socio)) return 0;
  return config.objetivoHoras;
}

function obtenerHorasRealizadasNucleo(socioId, anio, mes) {
  const horasFisicas = registros
    .filter(r => r.socioId === socioId && r.estado === 'finalizado')
    .filter(r => {
      const [regAnio, regMes] = r.fecha.split('-');
      return regAnio === anio && regMes === mes;
    })
    .reduce((sum, r) => sum + r.horasTrabajadas, 0);

  if (horasFisicas > 0 && horasFisicas < 4) {
    return { fisicas: horasFisicas, computables: 0, perdidas: true };
  }
  return { fisicas: horasFisicas, computables: horasFisicas, perdidas: false };
}

function obtenerResultadoHorasSocio(socio, anio, mes) {
  const horasCampo = obtenerHorasRealizadasNucleo(socio.id, anio, mes);
  const objetivo = obtenerObjetivoHorasSocio(socio);
  const comisionAsignada = obtenerComisionAsignadaNucleo(socio);

  if (objetivo > 0 && comisionAsignada) {
    return {
      fisicas: horasCampo.fisicas,
      computables: objetivo,
      perdidas: false,
      cubiertasPorComision: true,
      comision: comisionAsignada
    };
  }

  return {
    ...horasCampo,
    cubiertasPorComision: false,
    comision: null
  };
}

function obtenerSaldoHistoricoAlMes(socioId, anio, mes) {
  const clave = `${socioId}_${anio}-${mes}`;
  if (saldosHistoricos[clave]) {
    return saldosHistoricos[clave];
  }
  return { deudaAnterior: 0, remanenteAnterior: 0, tesoreriaAcumulada: 0 };
}

// --- MANEJO DE PESTAÑAS (TABS) ---
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.getElementById(tabId).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('bg-brand-700/50', 'bg-brand-700');
  });
  const activeBtn = document.getElementById(`btn-${tabId}`);
  if (activeBtn) activeBtn.classList.add('bg-brand-700/50');

  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.classList.remove('text-emerald-300', 'font-semibold');
    btn.classList.add('text-white/70');
  });
  const activeMobileBtn = document.getElementById(`m-btn-${tabId}`);
  if (activeMobileBtn) {
    activeMobileBtn.classList.remove('text-white/70');
    activeMobileBtn.classList.add('text-emerald-300', 'font-semibold');
  }

  if (tabId === 'tab-dashboard') renderDashboard();
  if (tabId === 'tab-socios') renderSociosList();
  if (tabId === 'tab-asistencia') setupAsistenciaForms();
  if (tabId === 'tab-planilla') renderPlanilla();
  if (tabId === 'tab-reportes') setupHistorial();
}

// --- RENDERS DE INTERFAZ ---

function renderSociosList() {
  const container = document.getElementById('listado-socios-container');
  if (!container) return;
  container.innerHTML = '';

  if (socios.length === 0) {
    container.innerHTML = `<p class="text-center py-6 text-slate-400">Sin socios registrados.</p>`;
    return;
  }

  socios.forEach(s => {
    const edad = calcularEdad(s.fechaNacimiento);
    const exoneradoNucleo = esNucleoExonerado(s);
    
    let badgeHabilidad = '';
    if (s.certificadoMedico) {
      badgeHabilidad = `<span class="bg-red-50 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold border border-red-200">Certificado Médico</span>`;
    } else if (edad > 70) {
      badgeHabilidad = `<span class="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[10px] font-bold border border-amber-200">Mayor de 70 años</span>`;
    } else if (edad < 16) {
      badgeHabilidad = `<span class="bg-red-50 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold border border-red-200">Menor de 16 años</span>`;
    } else {
      badgeHabilidad = `<span class="bg-brand-50 text-brand-700 px-2 py-0.5 rounded text-[10px] font-bold border border-brand-200">Habilitado</span>`;
    }

    const comisionBadge = s.comision !== 'Ninguna' ? `<span class="bg-purple-50 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold border border-purple-200">Comisión: ${s.comision}</span>` : '';

    let nucleoHTML = '';
    if (s.nucleo && s.nucleo.length > 0) {
      nucleoHTML = s.nucleo.map((f, i) => {
        const fEdad = calcularEdad(f.fechaNacimiento);
        const fHabilitado = esPersonaHabilitada(f);
        const fBadge = fHabilitado ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200';
        const fCom = f.comision !== 'Ninguna' ? `[C: ${f.comision}]` : '';
        const fCertificado = f.certificadoMedico ? ' 📋' : '';

        const botonesEdicionFamiliar = modoEdicion ? `
            <button onclick="openNucleoModal('${s.id}', ${i})" class="hover:text-brand-700" title="Editar familiar">
              <i data-lucide="pencil" class="w-3 h-3"></i>
            </button>
            <button onclick="updateNucleoComision('${s.id}', ${i})" class="hover:text-purple-700" title="Cambiar comisión">
              <i data-lucide="badge-check" class="w-3 h-3"></i>
            </button>
            <button onclick="removeNucleoMember('${s.id}', ${i})" class="hover:text-red-600" title="Eliminar familiar">
              <i data-lucide="x" class="w-3 h-3"></i>
            </button>` : '';

        return `
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${fBadge}">
            <span>${f.nombre} (${f.parentesco}, ${fEdad} años) ${fCom}${fCertificado}</span>
            ${botonesEdicionFamiliar}
          </span>
        `;
      }).join('');
    } else {
      nucleoHTML = '<span class="text-xs text-slate-400 italic">Núcleo familiar vacío.</span>';
    }

    const botonesAccionSocio = modoEdicion ? `
      <div class="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
        <button onclick="openEditarSocioModal('${s.id}')" class="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold transition flex items-center gap-1">
          <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> Editar
        </button>
        <button onclick="updateSocioComision('${s.id}')" class="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-xs font-semibold transition flex items-center gap-1">
          <i data-lucide="badge-check" class="w-3.5 h-3.5"></i> Comisión
        </button>
        <button onclick="openNucleoModal('${s.id}')" class="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1">
          <i data-lucide="plus" class="w-3.5 h-3.5"></i> Familiar
        </button>
        <button onclick="deleteSocio('${s.id}')" class="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-semibold transition flex items-center gap-1">
          <i data-lucide="trash" class="w-3.5 h-3.5"></i> Eliminar
        </button>
      </div>` : '';

    const card = document.createElement('div');
    card.className = `p-5 border rounded-2xl transition ${exoneradoNucleo ? 'bg-blue-50/20 border-blue-100' : 'bg-slate-50/50 hover:bg-white border-slate-150 hover:shadow-md'}`;
    card.innerHTML = `
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-xs text-brand-600 font-bold bg-brand-50 px-2.5 py-1 rounded-lg">${s.vivienda}</span>
            <span class="text-xs font-mono text-slate-400">ID: ${s.id}</span>
          </div>
          <div class="flex gap-1">
            ${badgeHabilidad}
            ${comisionBadge}
            ${exoneradoNucleo ? `<span class="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border border-blue-200 tracking-wider">NÚCLEO EXONERADO</span>` : ''}
          </div>
        </div>
        <div>
          <h4 class="text-base font-bold text-slate-800">${s.nombre} (${edad} años)</h4>
        </div>
        <div>
          <div class="text-xs font-semibold text-slate-500 mb-1.5">Integrantes del Núcleo:</div>
          <div class="flex flex-wrap gap-2">${nucleoHTML}</div>
        </div>
      </div>
      ${botonesAccionSocio}
    `;
    container.appendChild(card);
  });
  lucide.createIcons();
}

function setupAsistenciaForms() {
  const socioSelect = document.getElementById('ingreso-socio');
  if (!socioSelect) return;
  socioSelect.innerHTML = '<option value="" disabled selected>Seleccione un Socio</option>';
  
  socios.forEach(s => {
    const option = document.createElement('option');
    option.value = s.id;
    option.textContent = `${s.nombre} (${s.id})`;
    socioSelect.appendChild(option);
  });

  document.getElementById('ingreso-trabajador').innerHTML = '<option value="" disabled selected>Seleccione socio primero</option>';
  document.getElementById('ingreso-fecha').value = new Date().toISOString().split('T')[0];
  
  const ahora = new Date();
  const hh = String(ahora.getHours()).padStart(2, '0');
  const mm = String(ahora.getMinutes()).padStart(2, '0');
  document.getElementById('ingreso-hora').value = `${hh}:${mm}`;

  renderJornadasActivas();
}

function updateIngresoTrabajadores() {
  const socioId = document.getElementById('ingreso-socio').value;
  const trabajadorSelect = document.getElementById('ingreso-trabajador');
  trabajadorSelect.innerHTML = '';

  const socio = socios.find(s => s.id === socioId);
  if (!socio) return;

  let opcionesAgregadas = 0;

  if (esPersonaHabilitada(socio)) {
    const opt = document.createElement('option');
    opt.value = socio.nombre;
    opt.textContent = `${socio.nombre} (Titular)`;
    trabajadorSelect.appendChild(opt);
    opcionesAgregadas++;
  }

  if (socio.nucleo) {
    socio.nucleo.forEach(f => {
      if (esPersonaHabilitada(f)) {
        const opt = document.createElement('option');
        opt.value = f.nombre;
        opt.textContent = `${f.nombre} (${f.parentesco})`;
        trabajadorSelect.appendChild(opt);
        opcionesAgregadas++;
      }
    });
  }

  if (opcionesAgregadas === 0) {
    const opt = document.createElement('option');
    opt.value = "";
    opt.textContent = "Sin integrantes habilitados (16 a 70 años o con certificado médico)";
    opt.disabled = true;
    trabajadorSelect.appendChild(opt);
  }
}

function renderJornadasActivas() {
  const container = document.getElementById('listado-activas-container');
  if (!container) return;
  container.innerHTML = '';

  const activas = registros.filter(r => r.estado === 'activo');

  if (activas.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-400">
        <i data-lucide="info" class="w-8 h-8 mx-auto mb-2 text-slate-300"></i>
        No hay trabajadores fichados en curso.
      </div>
    `;
    lucide.createIcons();
    return;
  }

  activas.forEach(act => {
    const socio = socios.find(s => s.id === act.socioId) || { vivienda: '-', nombre: 'Desconocido' };
    
    const card = document.createElement('div');
    card.className = "p-4 border border-slate-100 rounded-xl bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3";
    card.innerHTML = `
      <div>
        <div class="flex items-center gap-2">
          <span class="bg-blue-100 text-blue-800 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider">En obra</span>
          <span class="text-xs text-slate-500 font-bold">${socio.vivienda}</span>
        </div>
        <h4 class="text-sm font-bold text-slate-800 mt-1">${act.trabajadorNombre}</h4>
        <p class="text-xs text-slate-500 mt-0.5">Ingresó: ${formatDateString(act.fecha)} a las ${act.horaIngreso} hs</p>
        <p class="text-xs italic text-slate-400 mt-1">Tarea: ${act.tarea}</p>
      </div>
      <button onclick="openEgresoModal('${act.id}')" class="w-full sm:w-auto px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1">
        <i data-lucide="log-out" class="w-4 h-4"></i> Registrar Salida
      </button>
    `;
    container.appendChild(card);
  });
  lucide.createIcons();
}

// --- CANVAS DE FIRMA ---
let signatureCanvas, signatureCtx;
let canvasDrawing = false;

function openEgresoModal(registroId) {
  const reg = registros.find(r => r.id === registroId);
  if (!reg) return;

  document.getElementById('egreso-registro-id').value = registroId;
  document.getElementById('lbl-egreso-trabajador').textContent = reg.trabajadorNombre;
  
  const ahora = new Date();
  const hh = String(ahora.getHours()).padStart(2, '0');
  const mm = String(ahora.getMinutes()).padStart(2, '0');
  document.getElementById('egreso-hora').value = `${hh}:${mm}`;

  document.getElementById('modal-egreso-firma').classList.remove('hidden');
  setupSignatureCanvas();
}

function closeEgresoModal() {
  document.getElementById('modal-egreso-firma').classList.add('hidden');
}

function setupSignatureCanvas() {
  signatureCanvas = document.getElementById('signature-canvas');
  signatureCtx = signatureCanvas.getContext('2d');

  const rect = signatureCanvas.getBoundingClientRect();
  signatureCanvas.width = rect.width;
  signatureCanvas.height = rect.height;

  signatureCtx.strokeStyle = '#0f172a';
  signatureCtx.lineWidth = 3;
  signatureCtx.lineCap = 'round';
  signatureCtx.lineJoin = 'round';

  clearCanvas();

  signatureCanvas.addEventListener('mousedown', (e) => {
    canvasDrawing = true;
    const pos = getCanvasPos(e);
    signatureCtx.beginPath();
    signatureCtx.moveTo(pos.x, pos.y);
  });
  signatureCanvas.addEventListener('mousemove', (e) => {
    if (!canvasDrawing) return;
    const pos = getCanvasPos(e);
    signatureCtx.lineTo(pos.x, pos.y);
    signatureCtx.stroke();
  });
  signatureCanvas.addEventListener('mouseup', () => canvasDrawing = false);
  signatureCanvas.addEventListener('mouseleave', () => canvasDrawing = false);

  signatureCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    canvasDrawing = true;
    const pos = getCanvasTouchPos(e);
    signatureCtx.beginPath();
    signatureCtx.moveTo(pos.x, pos.y);
  }, { passive: false });
  signatureCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!canvasDrawing) return;
    const pos = getCanvasTouchPos(e);
    signatureCtx.lineTo(pos.x, pos.y);
    signatureCtx.stroke();
  }, { passive: false });
  signatureCanvas.addEventListener('touchend', () => canvasDrawing = false);
}

function getCanvasPos(e) {
  const rect = signatureCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function getCanvasTouchPos(e) {
  const rect = signatureCanvas.getBoundingClientRect();
  const t = e.touches[0];
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}
function clearCanvas() {
  signatureCtx.fillStyle = '#ffffff';
  signatureCtx.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);
}
function isCanvasBlank() {
  const blank = document.createElement('canvas');
  blank.width = signatureCanvas.width;
  blank.height = signatureCanvas.height;
  const bCtx = blank.getContext('2d');
  bCtx.fillStyle = '#ffffff';
  bCtx.fillRect(0, 0, blank.width, blank.height);
  return signatureCanvas.toDataURL() === blank.toDataURL();
}

// --- PLANILLA DE CÁLCULO ---
function renderPlanilla() {
  const anio = document.getElementById('planilla-anio').value;
  const mes = document.getElementById('planilla-mes').value;
  const tbody = document.getElementById('tbl-planilla-cuerpo');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (socios.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-slate-400">Sin socios registrados.</td></tr>`;
    return;
  }

  const sociosOrdenados = [...socios].sort((a, b) => {
    const numA = parseInt(a.id, 10);
    const numB = parseInt(b.id, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a.id).localeCompare(String(b.id));
  });

  sociosOrdenados.forEach(s => {
    const exonerado = esNucleoExonerado(s);
    const objetivo = obtenerObjetivoHorasSocio(s);
    const comisionAsignada = obtenerComisionAsignadaNucleo(s);
    const hist = obtenerSaldoHistoricoAlMes(s.id, anio, mes);
    const resHoras = obtenerResultadoHorasSocio(s, anio, mes);

    const comprometidas = objetivo + hist.deudaAnterior;
    const saldoDelMes = objetivo - resHoras.computables;
    
    const totalCredito = resHoras.computables + hist.remanenteAnterior;

    let remanenteFinal = 0;
    let deudaFinal = 0;

    if (totalCredito >= comprometidas) {
      remanenteFinal = totalCredito - comprometidas;
    } else {
      deudaFinal = comprometidas - totalCredito;
    }

    let obs = [];
    if (exonerado) {
      if (s.certificadoMedico) {
        obs.push("Exonerado por certificado médico");
      } else {
        obs.push("Exonerado por edad");
      }
    }
    if (!exonerado && comisionAsignada) obs.push(`Objetivo cubierto por comisión: ${comisionAsignada} (${objetivo} hs)`);
    if (s.comision !== 'Ninguna') obs.push(`Titular en comisión: ${s.comision}`);
    
    if (s.nucleo) {
      let familiaresConCertificado = [];
      s.nucleo.forEach(f => {
        if (f.comision !== 'Ninguna') obs.push(`${f.nombre} (${f.comision})`);
        if (f.certificadoMedico) familiaresConCertificado.push(f.nombre);
      });
      if (familiaresConCertificado.length > 0 && !exonerado && !comisionAsignada) {
        obs.push(`Con certificado médico: ${familiaresConCertificado.join(', ')}`);
      }
    }

    if (resHoras.perdidas) {
      obs.push(`<span class="text-red-500 font-bold">Perdió ${resHoras.fisicas} hs (menor a 4 hs)</span>`);
    }
    if (resHoras.cubiertasPorComision && resHoras.fisicas > 0) {
      obs.push(`<span class="text-slate-500 font-semibold">${resHoras.fisicas.toFixed(1)} hs de campo no computables</span>`);
    }

    if (hist.deudaAnterior > 0) {
      obs.push(`Deuda arrastrada: ${hist.deudaAnterior} hs`);
    }
    if (hist.remanenteAnterior > 0) {
      obs.push(`Remanente arrastrado: ${hist.remanenteAnterior} hs`);
    }

    const row = document.createElement('tr');
    row.className = "hover:bg-slate-50 transition";
    row.innerHTML = `
      <td class="py-3 px-4">
        <div class="font-bold text-slate-800">${s.nombre}</div>
        <div class="text-[10px] text-slate-400 font-mono">Nº Socio: ${s.id}</div>
      </td>
      <td class="py-3 px-4 text-center font-semibold text-slate-700">
        ${comprometidas.toFixed(1)} hs
        <div class="text-[9px] text-slate-400 font-normal">(${objetivo} + ${hist.deudaAnterior} deudas)</div>
      </td>
      <td class="py-3 px-4 text-center">
        <span class="font-bold ${resHoras.perdidas ? 'text-red-500 line-through' : resHoras.cubiertasPorComision ? 'text-purple-700' : 'text-slate-800'}">
          ${resHoras.computables.toFixed(1)} hs
        </span>
        ${resHoras.cubiertasPorComision ? `<div class="text-[8px] text-purple-600 font-bold">Cubiertas por comisión</div>` : ''}
        ${resHoras.cubiertasPorComision && resHoras.fisicas > 0 ? `<div class="text-[8px] text-slate-400 line-through">${resHoras.fisicas.toFixed(1)} hs campo</div>` : ''}
        ${resHoras.perdidas ? '<div class="text-[8px] text-red-500 font-bold">Perdidas (<4 hs)</div>' : ''}
      </td>
      <td class="py-3 px-4 text-center font-bold ${saldoDelMes > 0 ? 'text-amber-600' : 'text-emerald-600'}">
        ${saldoDelMes.toFixed(1)} hs
      </td>
      <td class="py-3 px-4 text-center">
        ${remanenteFinal > 0 
          ? `<span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold border border-emerald-200">+${remanenteFinal.toFixed(1)} hs</span>`
          : deudaFinal > 0 
            ? `<span class="bg-red-50 text-red-700 px-2 py-0.5 rounded font-bold border border-red-200">Debe ${deudaFinal.toFixed(1)} hs</span>`
            : `<span class="text-slate-400 font-semibold">0.0 hs</span>`
        }
      </td>
      <td class="py-3 px-4 text-center font-bold text-red-700">
        ${hist.tesoreriaAcumulada > 0 ? `${hist.tesoreriaAcumulada.toFixed(1)} hs` : '-'}
      </td>
      <td class="py-3 px-4 text-slate-500 max-w-xs truncate">${obs.join(" | ") || '-'}</td>
    `;
    tbody.appendChild(row);
  });
}

// --- HISTORIAL ---
function setupHistorial() {
  const select = document.getElementById('filter-socio');
  if (!select) return;
  select.innerHTML = '<option value="todos">Todos los Socios</option>';
  socios.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.nombre} (${s.vivienda})`;
    select.appendChild(opt);
  });
  renderHistorialTable();
}

function renderHistorialTable() {
  const socioVal = document.getElementById('filter-socio') ? document.getElementById('filter-socio').value : 'todos';
  const trabVal = document.getElementById('filter-trabajador') ? document.getElementById('filter-trabajador').value.toLowerCase().trim() : '';
  const estVal = document.getElementById('filter-estado') ? document.getElementById('filter-estado').value : 'todos';

  const tbody = document.getElementById('tbl-reporte-cuerpo');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filtrados = registros.filter(r => {
    if (socioVal !== 'todos' && r.socioId !== socioVal) return false;
    if (trabVal && !r.trabajadorNombre.toLowerCase().includes(trabVal)) return false;
    if (estVal !== 'todos' && r.estado !== estVal) return false;
    return true;
  }).sort((a, b) => b.fecha.localeCompare(a.fecha));

  const alertNo = document.getElementById('no-records-alert');
  if (filtrados.length === 0) {
    if (alertNo) alertNo.classList.remove('hidden');
    return;
  }
  if (alertNo) alertNo.classList.add('hidden');

  filtrados.forEach(r => {
    const socio = socios.find(s => s.id === r.socioId) || { nombre: 'Eliminado/Desconocido', vivienda: '-' };
    const esActivo = r.estado === 'activo';

    const row = document.createElement('tr');
    row.className = "hover:bg-slate-50 transition";
    row.innerHTML = `
      <td class="py-3 px-6 font-medium text-slate-700">${formatDateString(r.fecha)}</td>
      <td class="py-3 px-6">
        <div class="font-bold">${socio.nombre}</div>
        <div class="text-[10px] text-brand-600 font-bold">${socio.vivienda}</div>
      </td>
      <td class="py-3 px-6 text-slate-700">${r.trabajadorNombre}</td>
      <td class="py-3 px-6">
        ${esActivo 
          ? `<span class="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded">En curso</span>` 
          : `<span class="bg-slate-100 text-slate-800 text-xs font-bold px-2.5 py-1 rounded-lg">${r.horasTrabajadas.toFixed(2)} hs</span>`
        }
        <div class="text-[9px] text-slate-400 mt-0.5">${r.horaIngreso} hs ${r.horaSalida ? `- ${r.horaSalida} hs` : ''}</div>
      </td>
      <td class="py-3 px-6 text-slate-500 max-w-xs truncate">${r.tarea}</td>
      <td class="py-3 px-6 text-center">
        ${esActivo 
          ? `<i data-lucide="minus" class="w-5 h-5 mx-auto text-slate-300"></i>`
          : `<button onclick="previewSignature('${r.id}')" class="text-brand-600 hover:text-brand-800 transition" title="Ver Firma">
              <i data-lucide="signature" class="w-5 h-5 mx-auto"></i>
             </button>`
        }
      </td>
      <td class="py-3 px-6 text-center">
        <button onclick="deleteRecord('${r.id}')" class="text-red-500 hover:text-red-700 transition" title="Eliminar Registro">
          <i data-lucide="trash-2" class="w-4 h-4 mx-auto"></i>
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
  lucide.createIcons();
}

function applyFilters() {
  renderHistorialTable();
}

function previewSignature(recordId) {
  const reg = registros.find(r => r.id === recordId);
  if (reg && reg.firma) {
    document.getElementById('img-firma-preview').src = reg.firma;
    document.getElementById('modal-firma-preview').classList.remove('hidden');
  }
}
function closeFirmaPreviewModal() {
  document.getElementById('modal-firma-preview').classList.add('hidden');
}

// --- DASHBOARD ---
function renderDashboard() {
  const lblGoal = document.getElementById('lbl-goal-hours');
  if (!lblGoal) return;
  
  lblGoal.textContent = config.objetivoHoras;
  
  const anio = "2026";
  const mes = "06";

  let totalComputables = 0;
  let totalExonerados = 0;

  socios.forEach(s => {
    if (esNucleoExonerado(s)) {
      totalExonerados++;
    } else {
      const res = obtenerResultadoHorasSocio(s, anio, mes);
      totalComputables += res.computables;
    }
  });
  
  document.getElementById('kpi-total-hours').textContent = `${totalComputables.toFixed(1)} hs`;
  document.getElementById('kpi-total-socios').textContent = socios.length;
  document.getElementById('kpi-exonerated-socios').textContent = `${totalExonerados} Exonerado(s)`;

  const activas = registros.filter(r => r.estado === 'activo').length;
  document.getElementById('kpi-active-jornadas').textContent = activas;

  let totalTesoreria = 0;
  for (const clave in saldosHistoricos) {
    totalTesoreria += (saldosHistoricos[clave].tesoreriaAcumulada || 0);
  }
  document.getElementById('kpi-total-tesoreria').textContent = `${totalTesoreria.toFixed(1)} hs`;

  const tbodyRiesgo = document.getElementById('tbl-riesgo-cuerpo');
  if (tbodyRiesgo) {
    tbodyRiesgo.innerHTML = '';
    let viviendasConRiesgo = 0;
    socios.forEach(s => {
      if (esNucleoExonerado(s)) return;
      if (obtenerComisionAsignadaNucleo(s)) return;

      const res = obtenerHorasRealizadasNucleo(s.id, anio, mes);
      if (res.fisicas > 0 && res.perdidas) {
        viviendasConRiesgo++;
        const row = document.createElement('tr');
        row.className = "bg-red-50/40 hover:bg-red-50 transition";
        row.innerHTML = `
          <td class="py-2 px-4 font-bold text-slate-800">${s.nombre} (${s.vivienda})</td>
          <td class="py-2 px-4 text-red-600 font-extrabold">${res.fisicas.toFixed(1)} hs trabajadas</td>
          <td class="py-2 px-4 text-red-700 font-semibold flex items-center gap-1">
            <i data-lucide="x-circle" class="w-3.5 h-3.5"></i> Horas en riesgo de pérdida (mínimo 4 hs)
          </td>
        `;
        tbodyRiesgo.appendChild(row);
      }
    });

    if (viviendasConRiesgo === 0) {
      tbodyRiesgo.innerHTML = `
        <tr>
          <td colspan="3" class="py-4 text-center text-slate-400 font-medium">Ningún socio tiene horas en riesgo de pérdida este mes.</td>
        </tr>
      `;
    }
  }
  lucide.createIcons();
}

// --- MODALES AUXILIARES ---
function openNucleoModal(socioId, index = null) {
  const socio = socios.find(s => s.id === socioId);
  if (!socio) return;

  const isEdit = index !== null;
  const familiar = isEdit && socio.nucleo ? socio.nucleo[index] : null;

  document.getElementById('nucleo-socio-id').value = socioId;
  document.getElementById('nucleo-edit-index').value = isEdit ? index : '';
  document.getElementById('nucleo-nombre').value = familiar ? familiar.nombre : '';
  document.getElementById('nucleo-nacimiento').value = familiar ? familiar.fechaNacimiento : '';
  document.getElementById('nucleo-parentesco').value = familiar ? familiar.parentesco : '';
  document.getElementById('nucleo-comision').value = familiar ? normalizarComision(familiar.comision) : 'Ninguna';
  document.getElementById('nucleo-certificado-medico').checked = familiar ? (familiar.certificadoMedico || false) : false;

  document.getElementById('modal-nucleo-title').innerHTML = `
    <i data-lucide="${isEdit ? 'pencil' : 'user-plus'}" class="w-5 h-5 text-emerald-300"></i>
    ${isEdit ? 'Editar Familiar del Núcleo' : 'Añadir Familiar al Núcleo'}
  `;
  document.getElementById('btn-nucleo-submit').textContent = isEdit ? 'Guardar Cambios' : 'Añadir Familiar';
  document.getElementById('modal-nucleo').classList.remove('hidden');
  lucide.createIcons();
}

function openConfigModal() {
  const input = document.getElementById('config-objetivo');
  if (input) input.value = config.objetivoHoras;
  const toggleEl = document.getElementById('config-modo-edicion');
  if (toggleEl) toggleEl.checked = modoEdicion;
  // Siempre ocultar el campo de clave al abrir el modal
  document.getElementById('campo-clave-edicion')?.classList.add('hidden');
  const inputClave = document.getElementById('clave-modo-edicion');
  if (inputClave) inputClave.value = '';
  document.getElementById('modal-config').classList.remove('hidden');
}

function closeConfigModal() {
  document.getElementById('modal-config').classList.add('hidden');
}

function closeNucleoModal() {
  document.getElementById('modal-nucleo').classList.add('hidden');
  document.getElementById('nucleo-edit-index').value = '';
}

function openComisionModal(targetType, socioId, nucleoIndex, valorActual = 'Ninguna') {
  document.getElementById('comision-target-type').value = targetType;
  document.getElementById('comision-socio-id').value = socioId;
  document.getElementById('comision-nucleo-index').value = nucleoIndex;
  document.getElementById('comision-valor').value = normalizarComision(valorActual);
  document.getElementById('modal-comision').classList.remove('hidden');
}

function closeComisionModal() {
  document.getElementById('modal-comision').classList.add('hidden');
}

function openEditarSocioModal(socioId) {
  const socio = socios.find(s => s.id === socioId);
  if (!socio) return;

  document.getElementById('editar-socio-id').value = socioId;
  document.getElementById('editar-socio-nombre').value = socio.nombre || '';
  document.getElementById('editar-socio-nacimiento').value = socio.fechaNacimiento || '';
  document.getElementById('editar-socio-vivienda').value = socio.vivienda || '';
  document.getElementById('editar-socio-certificado-medico').checked = socio.certificadoMedico || false;
  
  document.getElementById('modal-editar-socio').classList.remove('hidden');
  lucide.createIcons();
}

function closeEditarSocioModal() {
  document.getElementById('modal-editar-socio').classList.add('hidden');
}

async function saveEditedSocio() {
  const socioId = document.getElementById('editar-socio-id').value;
  const nombre = document.getElementById('editar-socio-nombre').value.trim();
  const fechaNacimiento = document.getElementById('editar-socio-nacimiento').value;
  const vivienda = document.getElementById('editar-socio-vivienda').value.trim();
  const certificadoMedico = document.getElementById('editar-socio-certificado-medico').checked;

  if (!nombre || !fechaNacimiento || !vivienda) {
    showToast("Por favor completa todos los campos.", "error");
    return;
  }

  try {
    await db.collection('socios').doc(socioId).update({
      nombre,
      fechaNacimiento,
      vivienda,
      certificadoMedico
    });

    showToast("Socio actualizado correctamente.", "success");
    closeEditarSocioModal();
  } catch (err) {
    showToast("Error al actualizar socio: " + err.message, "error");
  }
}

async function saveCommissionAssignment() {
  const targetType = document.getElementById('comision-target-type').value;
  const socioId = document.getElementById('comision-socio-id').value;
  const nucleoIndex = document.getElementById('comision-nucleo-index').value;
  const comision = normalizarComision(document.getElementById('comision-valor').value);
  const socio = socios.find(s => s.id === socioId);
  if (!socio) return;

  try {
    if (targetType === 'socio') {
      await db.collection('socios').doc(socioId).update({ comision });
    } else {
      const index = parseInt(nucleoIndex);
      const nuevoNucleo = [...(socio.nucleo || [])];
      if (!nuevoNucleo[index]) return;
      nuevoNucleo[index] = { ...nuevoNucleo[index], comision };
      await db.collection('socios').doc(socioId).update({ nucleo: nuevoNucleo });
    }

    showToast(comision === 'Ninguna' ? "Asignación a comisión dada de baja." : "Asignación a comisión guardada.", "success");
    closeComisionModal();
  } catch (err) {
    showToast("Error al guardar comisión: " + err.message, "error");
  }
}

// --- UTILIDADES ---
function normalizarComision(comision) {
  const valor = comision || 'Ninguna';
  const normalizado = COMISIONES_LEGACY[valor] || valor;
  return COMISIONES_VALIDAS.includes(normalizado) ? normalizado : 'Ninguna';
}

function formatDateString(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function calculateHours(ingreso, salida) {
  const [h1, m1] = ingreso.split(':').map(Number);
  const [h2, m2] = salida.split(':').map(Number);
  let diffMin = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (diffMin < 0) diffMin += 24 * 60;
  return Math.round((diffMin / 60) * 100) / 100;
}

// --- TOAST FEEDBACK ---
function exportPlanillaCSV() {
  const anio = document.getElementById('planilla-anio').value;
  const mes = document.getElementById('planilla-mes').value;
  
  if (socios.length === 0) {
    showToast("No hay socios para exportar.", "info");
    return;
  }

  const sociosOrdenados = [...socios].sort((a, b) => {
    const numA = parseInt(a.id, 10);
    const numB = parseInt(b.id, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a.id).localeCompare(String(b.id));
  });

  let csvContent = "sep=,\n";
  csvContent += "Socio,Nº Socio,Edad,Vivienda,Horas Objetivo,Horas Computables,Saldo del Mes,Deuda Anterior,Remanente Anterior,Comprometidas,Total Crédito,Remanente Final,Deuda Final,Observaciones\n";

  sociosOrdenados.forEach(s => {
    const fechaNac = new Date(s.fechaNacimiento);
    const hoy = new Date();
    const edad = hoy.getFullYear() - fechaNac.getFullYear() - (hoy.getMonth() < fechaNac.getMonth() || (hoy.getMonth() === fechaNac.getMonth() && hoy.getDate() < fechaNac.getDate()) ? 1 : 0);
    
    const exonerado = esNucleoExonerado(s);
    const objetivo = obtenerObjetivoHorasSocio(s);
    const comisionAsignada = obtenerComisionAsignadaNucleo(s);
    const hist = obtenerSaldoHistoricoAlMes(s.id, anio, mes);
    const resHoras = obtenerResultadoHorasSocio(s, anio, mes);

    const comprometidas = objetivo + hist.deudaAnterior;
    const saldoDelMes = objetivo - resHoras.computables;
    const totalCredito = resHoras.computables + hist.remanenteAnterior;

    let remanenteFinal = 0;
    let deudaFinal = 0;

    if (totalCredito >= comprometidas) {
      remanenteFinal = totalCredito - comprometidas;
    } else {
      deudaFinal = comprometidas - totalCredito;
    }

    let obs = [];
    if (exonerado) {
      if (s.certificadoMedico) {
        obs.push("Exonerado por certificado médico");
      } else {
        obs.push("Exonerado por edad");
      }
    }
    if (!exonerado && comisionAsignada) obs.push(`Objetivo cubierto por comisión: ${comisionAsignada} (${objetivo} hs)`);
    if (s.comision !== 'Ninguna') obs.push(`Titular en comisión: ${s.comision}`);

    const observacionesStr = obs.join("; ");

    csvContent += `"${s.nombre}","${s.id}","${edad}","${s.vivienda}","${objetivo}","${resHoras.computables.toFixed(2)}","${saldoDelMes.toFixed(2)}","${hist.deudaAnterior.toFixed(2)}","${hist.remanenteAnterior.toFixed(2)}","${comprometidas.toFixed(2)}","${totalCredito.toFixed(2)}","${remanenteFinal.toFixed(2)}","${deudaFinal.toFixed(2)}","${observacionesStr}"\n`;
  });

  // Crear blob y descargar
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `planilla-${mes}-${anio}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Planilla exportada: planilla-${mes}-${anio}.csv`, "success");
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `flex items-center gap-3 p-4 rounded-xl shadow-lg border text-sm transition-all duration-300 transform translate-y-2 opacity-0 select-none ${
    type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
    type === 'info' ? 'bg-blue-50 text-blue-800 border-blue-200' :
    'bg-red-50 text-red-800 border-red-200'
  }`;

  let iconName = 'check-circle';
  if (type === 'info') iconName = 'info';
  if (type === 'error') iconName = 'alert-triangle';

  toast.innerHTML = `<i data-lucide="${iconName}" class="w-5 h-5 flex-shrink-0"></i><span>${message}</span>`;
  container.appendChild(toast);
  lucide.createIcons();

  setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-[-8px]');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}



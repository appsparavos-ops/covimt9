// --- CONFIGURACIÓN E INICIALIZACIÓN ---
let db = null;
let socios = [];
let registros = [];
let config = { objetivoHoras: 4, periodoInicial: '' };
let saldosHistoricos = {};
let objetivosMensuales = {}; // Objetivo global por período YYYY-MM
let modoEdicion = false; // Variable para controlar el modo edición
const fechaDispositivoAdmin = new Date();
let periodoAdminAnio = String(fechaDispositivoAdmin.getFullYear());
let periodoAdminMes = String(fechaDispositivoAdmin.getMonth() + 1).padStart(2, '0');
const MESES_ADMIN = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
let COMISIONES_VALIDAS = ["Ninguna"]; // Inicialmente solo "Ninguna", se cargará de Firebase
const COMISIONES_LEGACY = {
  Directiva: "Consejo Directivo",
  Obra: "Comisión de Obra",
  Finanzas: "Comisión Fiscal",
  Fomento: "Comisión Fomento",
  Electoral: "Comisión Electoral"

};

// Helper function for formatting hours
function formatHours(value) {
  const roundedValue = Math.round(value);
  return `${roundedValue}Hs`;
}

// Inicializar iconos de Lucide al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  inicializarPeriodoAdminDesdeDispositivo();
  checkAuthAndInit();

  // Asignar manejadores de eventos a los botones para evitar ReferenceError por 'defer'
  document.getElementById('btn-descargar-pdf')?.addEventListener('click', exportPlanillaPDF);
  document.getElementById('btn-reporte-tesoreria')?.addEventListener('click', exportReporteTesoreriaPDF);
  document.getElementById('btn-cerrar-mes')?.addEventListener('click', simularCierreMensual);
  document.getElementById('btn-reabrir-mes')?.addEventListener('click', reabrirMes);
  document.getElementById('btn-descargar-csv')?.addEventListener('click', exportPlanillaCSV);
  populateCommissionSelect('socio-comision'); // Populate initial socio commission select

  // Listener para actualizar horas redondeadas en tiempo real en el modal
  document.getElementById('egreso-hora')?.addEventListener('input', updateRoundedHoursDisplay);
  setupOfflineDetector();

  // Listeners para mostrar/ocultar autorización de menor (16-17 años)
  document.getElementById('socio-nacimiento')?.addEventListener('change', () => toggleAutorizacionMenor('socio'));
  document.getElementById('nucleo-nacimiento')?.addEventListener('change', () => toggleAutorizacionMenor('nucleo'));
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
  
  // Habilitar persistencia offline de Firestore (para cache de lecturas)
  db.enablePersistence()
    .then(() => {
      console.log("Persistencia offline de Firestore habilitada.");
    })
    .catch((err) => {
      if (err.code == 'failed-precondition') {
        console.warn("La persistencia offline no pudo ser habilitada. Probablemente múltiples pestañas abiertas.");
      } else if (err.code == 'unimplemented') {
        console.warn("El navegador actual no soporta todas las características necesarias para la persistencia offline.");
      } else {
        console.error("Error al habilitar persistencia offline:", err);
      }
    });
  
  // Cambiamos a persistencia LOCAL para que la sesión sobreviva offline al cerrar el navegador
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err => console.error(err));

  // Inicializar sistema offline
  OfflineSync.init(db);
  OfflineSync.onSyncComplete(() => {
    // Re-renderizar todo tras sincronización exitosa
    renderSociosList();
    renderDashboard();
    renderPlanilla();
    renderHistorialTable();
    renderJornadasActivas();
    setupAsistenciaForms();
  });

  // Escuchar estado de autenticación
  firebase.auth().onAuthStateChanged((user) => {
    const viewLogin = document.getElementById('view-login');
    const appContainer = document.getElementById('app-container');

    if (user) {
      // Usuario autenticado: mostrar app, ocultar login
      viewLogin?.classList.add('hidden');
      appContainer?.classList.remove('hidden');
      
      // Sincronizar Firestore
      startFirestoreSync();

      // Precargar datos para modo offline (ahora sí hay auth)
      if (navigator.onLine) {
        OfflineSync.precargarDatos(db);
      }
    } else {
      // Usuario no autenticado: mostrar login, ocultar app
      viewLogin?.classList.remove('hidden');
      appContainer?.classList.add('hidden');
      
      // Limpiar listeners si es necesario
      socios = [];
      registros = [];
      saldosHistoricos = {};
    }
    // Refrescar iconos para elementos que acaban de hacerse visibles
    lucide.createIcons();
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
      showToast("Acceso correcto. Bienvenido.", "success");
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

async function handleLogout() {
  if (await showConfirmModal("Cerrar Sesión", "¿Confirmas que deseas cerrar tu sesión administrativa?")) {
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
    
    // Mostrar Banner de DB Vacía si no hay socios
    if (socios.length === 0) {
      document.getElementById('empty-db-banner').classList.remove('hidden');
    } else {
      document.getElementById('empty-db-banner').classList.add('hidden');
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
    actualizarOpcionesPeriodoAdmin();
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

  // 4. Escuchar objetivos mensuales globales (un documento por YYYY-MM)
  db.collection('objetivosMensuales').onSnapshot((snapshot) => {
    objetivosMensuales = {};
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const valor = Number(data.objetivoHoras);
      if (Number.isFinite(valor) && valor >= 0) objetivosMensuales[doc.id] = valor;
    });
    renderDashboard();
    renderPlanilla();
  }, (error) => {
    showToast("Error al sincronizar objetivos mensuales: " + error.message, "error");
  });

  // 5. Escuchar Saldos e Históricos del Cierre mensual
  db.collection('saldosHistoricos').onSnapshot((snapshot) => {
    saldosHistoricos = {};
    snapshot.docs.forEach(doc => {
      saldosHistoricos[doc.id] = doc.data();
    });
    actualizarOpcionesPeriodoAdmin();
    renderPlanilla();
    renderDashboard();
  });

  // 6. Escuchar Comisiones
  db.collection('comisiones').onSnapshot((snapshot) => {
    const firebaseComisiones = snapshot.docs.map(doc => doc.data().nombre);
    COMISIONES_VALIDAS = ["Ninguna", ...firebaseComisiones].sort(); // "Ninguna" siempre primero, luego alfabético
    // Re-renderizar elementos que usan la lista de comisiones
    renderSociosList(); // Para actualizar los badges de comisión
    populateCommissionSelect('socio-comision'); // Actualizar selector en el formulario de registro
    renderComisionesManagement(); // Para actualizar la lista en el modal de configuración
  }, (error) => {
    showToast("Error al sincronizar comisiones: " + error.message, "error");
  });
}

async function clearCloudDatabase() {
  if (!db) return;
  if (!navigator.onLine) {
    showToast("La limpieza de base de datos requiere conexión a internet.", "error");
    return;
  }
  if (await showConfirmModal("LIMPIEZA TOTAL", "¿Estás seguro? Esta acción borrará permanentemente todos los socios, jornadas y saldos de la base de datos.")) {
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
  const nombre = cleanText(document.getElementById('socio-nombre').value);
  const fechaAlta = document.getElementById('socio-alta').value;
  const fechaNacimiento = document.getElementById('socio-nacimiento').value;
  const comision = normalizarComision(document.getElementById('socio-comision').value);
  const certificadoMedico = document.getElementById('socio-certificado-medico').checked;
  const autorizacionMenor = document.getElementById('socio-autorizacion-menor').checked;
  const pin = document.getElementById('socio-pin').value.trim();

  if (socios.some(s => s.id === id)) {
    showToast("ID de socio ya se encuentra registrado.", "error");
    return;
  }

  // Si no se ingresa PIN, usar el PIN por defecto "1234"
  const pinFinal = /^\d{4}$/.test(pin) ? pin : '1234';

  // Hashear PIN con SHA-256
  const pinHash = await hashPIN(pinFinal);

  try {
    const socioData = {
      id,
      nombre,
      fechaAlta,
      fechaBaja: null,
      fechaNacimiento,
      comision,
      certificadoMedico,
      autorizacionMenor,
      pinHash,
      nucleo: [],
      historialTitulares: [{
        nombre,
        fechaNacimiento,
        comision,
        certificadoMedico,
        desde: fechaAlta,
        hasta: null
      }]
    };

    if (!navigator.onLine) {
      OfflineSync.enqueue('socios', id, 'set', socioData);
      socios.push(socioData);
      renderSociosList();
      renderDashboard();
      renderPlanilla();
      showToast("Socio guardado offline. Se sincronizará al tener conexión.", "info");
      registrarLog("Creación Socio (Offline)", `SOCIO TITULAR: ${nombre} (ID: ${id}). Pendiente de sincronización.`);
      document.getElementById('form-socio').reset();
      return;
    }

    await db.collection('socios').doc(id).set(socioData);
    const pinMsg = /^\d{4}$/.test(pin) ? `PIN: ${pin}` : 'PIN por defecto: 1234 (el socio puede cambiarlo desde su portal)';
    showToast(`Socio titular guardado. ${pinMsg}`, "success");
    registrarLog("Creación/Edición Socio", `SOCIO TITULAR: ${nombre} (ID: ${id}). Fecha de alta: ${fechaAlta}.`);
    document.getElementById('form-socio').reset();
  } catch (err) {
    showToast("Error al guardar socio: " + err.message, "error");
  }
}

/**
 * Obtiene el estado y datos del titular de un socio para una fecha específica.
 */
function getSocioSnapshot(socio, targetDateStr) {
  if (!socio) return null;
  const targetDate = new Date(targetDateStr);
  
  // Manejar socios sin fecha de alta (ej. importados por CSV)
  const fechaAlta = socio.fechaAlta ? new Date(socio.fechaAlta) : new Date('2000-01-01');
  const fechaBaja = socio.fechaBaja ? new Date(socio.fechaBaja) : null;

  // Verificar si el socio existe/está activo en esa fecha
  if (targetDate < fechaAlta) return null;
  if (fechaBaja && targetDate >= fechaBaja) return null;

  // Si no hay historial (legacy o recien importado), devolvemos el socio actual
  if (!socio.historialTitulares || socio.historialTitulares.length === 0) {
    return { ...socio, id: socio.id };
  }

  // Buscar quién era titular en esa fecha en el historial
  const snapshot = socio.historialTitulares.find(h => {
    const desde = new Date(h.desde);
    const hasta = h.hasta ? new Date(h.hasta) : null;
    return targetDate >= desde && (!hasta || targetDate < hasta);
  });

  return snapshot ? { ...snapshot, id: socio.id } : socio; // Aseguramos que el snapshot tenga el ID del socio
}

function openGestionEstadoModal(socioId, accion) {
  const socio = socios.find(s => s.id === socioId);
  if (!socio) return;

  document.getElementById('gestion-socio-id').value = socioId;
  document.getElementById('gestion-tipo-accion').value = accion;
  document.getElementById('gestion-fecha-efectiva').value = new Date().toISOString().split('T')[0];

  const title = document.getElementById('title-gestion-estado');
  const btn = document.getElementById('btn-confirmar-gestion');
  const containerTitular = document.getElementById('container-nuevo-titular');
  const containerBaja = document.getElementById('container-baja-aviso');

  if (accion === 'baja') {
    title.innerText = "Dar de Baja Socio y Núcleo";
    btn.innerText = "Confirmar Baja Definitiva";
    btn.className = "px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition";
    containerTitular.classList.add('hidden');
    containerBaja.classList.remove('hidden');
  } else {
    title.innerText = "Cambiar Socio Titular";
    btn.innerText = "Confirmar Cambio de Titular";
    btn.className = "px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-semibold transition";
    containerTitular.classList.remove('hidden');
    containerBaja.classList.add('hidden');

    const select = document.getElementById('gestion-nuevo-titular');
    select.innerHTML = socio.nucleo.map(f => `<option value="${f.nombre}">${f.nombre} (${f.parentesco})</option>`).join('');
  }

  document.getElementById('modal-gestion-estado').classList.remove('hidden');
}

function closeGestionEstadoModal() {
  document.getElementById('modal-gestion-estado').classList.add('hidden');
}

async function processGestionEstado() {
  const socioId = document.getElementById('gestion-socio-id').value;
  const accion = document.getElementById('gestion-tipo-accion').value;
  const fechaEfectiva = document.getElementById('gestion-fecha-efectiva').value;
  const socio = socios.find(s => s.id === socioId);

  try {
    if (accion === 'baja') {
      const bajaData = { fechaBaja: fechaEfectiva };
      
      if (!navigator.onLine) {
        OfflineSync.enqueue('socios', socioId, 'update', bajaData);
        const socioIdx = socios.findIndex(s => s.id === socioId);
        if (socioIdx >= 0) socios[socioIdx].fechaBaja = fechaEfectiva;
        renderSociosList();
        renderDashboard();
        renderPlanilla();
        showToast(`Baja guardada offline desde ${fechaEfectiva}. Se sincronizará al tener conexión.`, "info");
        registrarLog("Baja Socio (Offline)", `BAJA del Socio ID: ${socioId}. Pendiente de sincronización.`);
        closeGestionEstadoModal();
        return;
      }
      
      await db.collection('socios').doc(socioId).update(bajaData);
      showToast(`Socio ${socioId} dado de baja desde ${fechaEfectiva}`, "info");
      registrarLog("Baja de Socio", `BAJA DEFINITIVA del Socio ID: ${socioId} (${socio.nombre}) a partir del día ${fechaEfectiva}.`);
    } else {
      const nuevoNombreTitular = document.getElementById('gestion-nuevo-titular').value;
      const fechaEfectiva = document.getElementById('gestion-fecha-efectiva').value;
      
      const antiguoTitular = socio.nombre;
      // Buscar los datos del nuevo titular dentro del núcleo actual del socio
      const nuevoTitularData = socio.nucleo.find(f => f.nombre === nuevoNombreTitular);
      if (!nuevoTitularData) {
        showToast("Error: Nuevo titular no encontrado en el núcleo familiar.", "error");
        return;
      }

      // Guardar los datos del titular actual para moverlo al núcleo
      const antiguoTitularData = {
        nombre: socio.nombre,
        fechaNacimiento: socio.fechaNacimiento,
        comision: socio.comision,
        certificadoMedico: socio.certificadoMedico,
        parentesco: 'Ex-Titular' // Asignar un parentesco específico para el ex-titular
      };
      
      // 1. Cerrar titularidad actual
      const historial = [...(socio.historialTitulares || [])];
      // Encontrar la entrada de titularidad activa (la que tiene 'hasta: null')
      const activeTitularEntryIndex = historial.findIndex(entry => entry.hasta === null);
      if (activeTitularEntryIndex !== -1) {
        historial[activeTitularEntryIndex].hasta = fechaEfectiva;
      }

      // 2. Agregar nueva titularidad
      historial.push({
        nombre: nuevoTitularData.nombre,
        fechaNacimiento: nuevoTitularData.fechaNacimiento,
        comision: nuevoTitularData.comision,
        certificadoMedico: nuevoTitularData.certificadoMedico,
        desde: fechaEfectiva,
        hasta: null
      });

      // 3. Construir el nuevo array del núcleo: quitar al nuevo titular y añadir al antiguo titular
      let nuevoNucleo = socio.nucleo.filter(f => f.nombre !== nuevoNombreTitular);
      nuevoNucleo.push(antiguoTitularData);

      const updateData = {
        nombre: nuevoTitularData.nombre,
        fechaNacimiento: nuevoTitularData.fechaNacimiento,
        comision: nuevoTitularData.comision,
        certificadoMedico: nuevoTitularData.certificadoMedico,
        nucleo: nuevoNucleo,
        historialTitulares: historial
      };

      if (!navigator.onLine) {
        OfflineSync.enqueue('socios', socioId, 'update', updateData);
        const socioIdx = socios.findIndex(s => s.id === socioId);
        if (socioIdx >= 0) Object.assign(socios[socioIdx], updateData);
        renderSociosList();
        renderDashboard();
        renderPlanilla();
        showToast("Cambio de titular guardado offline. Se sincronizará al tener conexión.", "info");
        registrarLog("Cambio Titular (Offline)", `Socio ID: ${socioId}. Pendiente de sincronización.`);
        closeGestionEstadoModal();
        return;
      }

      await db.collection('socios').doc(socioId).update(updateData);
      showToast("Titular cambiado exitosamente.", "success");
      registrarLog("Cambio de Titular", `Socio ID: ${socioId}. CAMBIO DE TITULARIDAD el ${fechaEfectiva}. Titular saliente: ${antiguoTitular}. Titular entrante: ${nuevoNombreTitular}.`);
    }
    closeGestionEstadoModal();
  } catch (err) { showToast("Error: " + err.message, "error"); }
}

async function saveNucleoMember() {
  const socioId = document.getElementById('nucleo-socio-id').value;
  const editIndexValue = document.getElementById('nucleo-edit-index').value;
  const editIndex = editIndexValue === '' ? -1 : parseInt(editIndexValue);
  const nombre = cleanText(document.getElementById('nucleo-nombre').value);
  const fechaNacimiento = document.getElementById('nucleo-nacimiento').value;
  const parentesco = document.getElementById('nucleo-parentesco').value;
  const comision = normalizarComision(document.getElementById('nucleo-comision').value);
  const certificadoMedico = document.getElementById('nucleo-certificado-medico').checked;
  const autorizacionMenor = document.getElementById('nucleo-autorizacion-menor').checked;

  const idx = socios.findIndex(s => s.id === socioId);
  if (idx !== -1) {
    const socio = socios[idx];
    const nuevoNucleo = [...(socio.nucleo || [])];
    const familiar = { nombre, fechaNacimiento, parentesco, comision, certificadoMedico, autorizacionMenor };
    if (editIndex >= 0) {
      nuevoNucleo[editIndex] = familiar;
    } else {
      nuevoNucleo.push(familiar);
    }
    try {
      if (!navigator.onLine) {
        OfflineSync.enqueue('socios', socioId, 'update', { nucleo: nuevoNucleo });
        // Optimistic update
        socios[idx].nucleo = nuevoNucleo;
        renderSociosList();
        renderDashboard();
        renderPlanilla();
        showToast("Familiar guardado offline. Se sincronizará al tener conexión.", "info");
        registrarLog(editIndex >= 0 ? "Edición Familiar (Offline)" : "Adición Familiar (Offline)", `FAMILIAR: ${nombre} (${parentesco}) en Socio ID: ${socioId}. Pendiente de sincronización.`);
        closeNucleoModal();
        return;
      }
      await db.collection('socios').doc(socioId).update({ nucleo: nuevoNucleo });
      showToast(editIndex >= 0 ? "Familiar actualizado." : "Familiar agregado al núcleo.", "success");
      registrarLog(editIndex >= 0 ? "Edición Familiar" : "Adición Familiar", `FAMILIAR: ${nombre} (${parentesco}) en el núcleo del Socio ID: ${socioId}.`);
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
  if (await showConfirmModal("Eliminar Familiar", "¿Confirmas que deseas eliminar a este integrante del núcleo familiar?")) {
    const idx = socios.findIndex(s => s.id === socioId);
    if (idx !== -1) {
      const socio = socios[idx];
      const nuevoNucleo = [...socio.nucleo];
      nuevoNucleo.splice(index, 1);
      try {
        if (!navigator.onLine) {
          OfflineSync.enqueue('socios', socioId, 'update', { nucleo: nuevoNucleo });
          socios[idx].nucleo = nuevoNucleo;
          renderSociosList();
          renderDashboard();
          renderPlanilla();
          showToast("Familiar eliminado (offline). Se sincronizará al tener conexión.", "info");
          registrarLog("Eliminación Familiar (Offline)", `Familiar índice ${index} eliminado del Socio ID: ${socioId}. Pendiente de sincronización.`);
          return;
        }
        await db.collection('socios').doc(socioId).update({ nucleo: nuevoNucleo });
        showToast("Miembro removido.", "info");
        registrarLog("Eliminación Familiar", `Se eliminó al familiar con índice ${index} del núcleo del Socio ID: ${socioId}.`);
      } catch (err) {
        showToast("Error al remover familiar: " + err.message, "error");
      }
    }
  }
}

async function registerIngreso() {
  const socioId = document.getElementById('ingreso-socio-filtered').value;
  const fecha = document.getElementById('ingreso-fecha').value;
  const responsable = document.getElementById('ingreso-responsable').value.trim();
  const horaIngresoRaw = document.getElementById('ingreso-hora').value;
  const tarea = document.getElementById('ingreso-tarea').value.trim();

  // Leer todos los checkboxes marcados
  const checkboxes = document.querySelectorAll('.ingreso-trabajador-cb:checked');
  const trabajadores = Array.from(checkboxes).map(cb => cb.value);

  if (trabajadores.length === 0) {
    showToast("Seleccione al menos un integrante habilitado.", "error");
    return;
  }

  // Lógica de redondeo: ±15 minutos de la hora exacta (ej: 7:45 -> 8:00, 8:15 -> 8:00)
  let [h, m] = horaIngresoRaw.split(':').map(Number);
  let horaIngreso = horaIngresoRaw;
  if (m >= 45) {
    h = (h + 1) % 24;
    horaIngreso = `${String(h).padStart(2, '0')}:00`;
  } else if (m <= 15) {
    horaIngreso = `${String(h).padStart(2, '0')}:00`;
  }

  const currentResp = document.getElementById('ingreso-responsable').value;
  let successCount = 0;
  let errorCount = 0;

  try {
    for (const trabajadorNombre of trabajadores) {
      const id = 'reg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
      const nuevoIngreso = {
        id,
        socioId,
        trabajadorNombre,
        fecha,
        responsable,
        horaIngreso,
        horaSalida: '',
        horasTrabajadas: 0,
        tarea,
        firma: '',
        estado: 'activo'
      };

      if (!navigator.onLine) {
        OfflineSync.enqueue('registros', id, 'set', nuevoIngreso);
        registros.push(nuevoIngreso);
        successCount++;
      } else {
        await db.collection('registros').doc(id).set(nuevoIngreso);
        successCount++;
      }
    }

    if (!navigator.onLine) {
      renderJornadasActivas();
      renderDashboard();
      showToast(`${successCount} ingreso(s) guardado(s) offline.`, "info");
      registrarLog("Ingreso Múltiple (Offline)", `${successCount} INGRESOS OFFLINE (Socio: ${socioId}). Pendientes de sincronización.`);
    } else {
      showToast(`${successCount} ingreso(s) registrado(s) correctamente.`, "success");
      registrarLog("Ingreso Múltiple", `${successCount} ingresos para Socio ${socioId}: ${trabajadores.join(', ')}.`);
    }

    // Reiniciar formulario manteniendo al responsable
    document.getElementById('form-ingreso').reset();
    document.getElementById('ingreso-responsable').value = currentResp;
    setupAsistenciaForms();

  } catch (err) {
    showToast("Error al registrar ingreso(s): " + err.message, "error");
  }
}

async function submitEgresoWithSignature() {
  const id = document.getElementById('egreso-registro-id').value;
  const horaSalida = document.getElementById('egreso-hora').value;

  const reg = registros.find(r => r.id === id);
  if (reg) {
    const esUltimaSalidaDeLaFecha = !registros.some(r =>
      r.id !== id && r.fecha === reg.fecha && r.estado === 'activo'
    );
    const calculated = getRoundedHours(reg.horaIngreso, horaSalida);
    
    if (calculated === 0) {
      if (await showConfirmModal("Jornada de 0.00 hs", "Esta jornada no alcanzó el mínimo computable de 1:45h. ¿Deseas ELIMINAR el ingreso? Si cancelas, la jornada seguirá activa para completar más horas.")) {
        try {
          registrarLog("Eliminación Ingreso", `CANCELACIÓN - Jornada ID: ${id} de ${reg.trabajadorNombre} (Socio: ${reg.socioId}) eliminada por tiempo insuficiente (0.00 hs).`);
          
          if (!navigator.onLine) {
            OfflineSync.enqueue('registros', id, 'delete', null);
            registros = registros.filter(r => r.id !== id);
            renderJornadasActivas();
            renderDashboard();
            renderHistorialTable();
            showToast("Jornada eliminada (offline).", "info");
            closeEgresoModal();
            return;
          }
          
          await db.collection('registros').doc(id).delete();
          showToast("Jornada eliminada.", "info");
          closeEgresoModal();
        } catch (err) {
          showToast("Error al eliminar: " + err.message, "error");
        }
      } else {
        closeEgresoModal();
        showToast("Jornada mantenida en curso.", "info");
      }
      return;
    }

    if (isCanvasBlank(signatureCanvas)) {
      showToast("La firma del trabajador es obligatoria.", "error");
      return;
    }
    const firma = signatureCanvas.toDataURL();

    try {
      const egresoData = {
        horaSalida,
        horasTrabajadas: calculated,
        firma,
        estado: 'finalizado'
      };

      if (!navigator.onLine) {
        OfflineSync.enqueue('registros', id, 'merge', egresoData);
        // Optimistic update
        const regIdx = registros.findIndex(r => r.id === id);
        if (regIdx >= 0) {
          registros[regIdx] = { ...registros[regIdx], ...egresoData };
        }
        renderJornadasActivas();
        renderDashboard();
        renderPlanilla();
        renderHistorialTable();
        showToast(`Egreso guardado offline: ${calculated} hs. Se sincronizará al tener conexión.`, "info");
        registrarLog("Egreso (Offline)", `EGRESO OFFLINE: ${reg.trabajadorNombre}. ${calculated} hs. Pendiente de sincronización.`);
        closeEgresoModal();
        if (esUltimaSalidaDeLaFecha) openFirmaResponsableModal(id, { ...reg, ...egresoData });
        return;
      }

      await db.collection('registros').doc(id).set(egresoData, { merge: true });
      showToast(`Egreso registrado: ${calculated} hs guardadas.`, "success");
      registrarLog("Egreso Jornada", `FIN - Trabajador: ${reg.trabajadorNombre} (Socio: ${reg.socioId}). Salida: ${horaSalida}hs. Total computado: ${calculated} hs.`);
      closeEgresoModal();
      if (esUltimaSalidaDeLaFecha) openFirmaResponsableModal(id, { ...reg, ...egresoData });
    } catch (err) {
      showToast("Error al registrar egreso: " + err.message, "error");
    }
  }
}

async function deleteRecord(recordId) {
  if (await showConfirmModal("Eliminar Jornada", "¿Deseas borrar permanentemente este registro de trabajo?")) {
    try {
      registrarLog("Eliminación Registro", `Jornada ID: ${recordId} borrada manualmente.`);

      if (!navigator.onLine) {
        OfflineSync.enqueue('registros', recordId, 'delete', null);
        registros = registros.filter(r => r.id !== recordId);
        renderJornadasActivas();
        renderDashboard();
        renderPlanilla();
        renderHistorialTable();
        showToast("Jornada eliminada (offline). Se sincronizará al tener conexión.", "info");
        return;
      }

      await db.collection('registros').doc(recordId).delete();
      showToast("Jornada eliminada.", "info");
    } catch (err) {
      showToast("Error al eliminar registro: " + err.message, "error");
    }
  }
}

async function saveConfig() {
  const obj = Number(document.getElementById('config-objetivo').value);
  if (!Number.isFinite(obj) || obj < 0 || obj > 200) {
    showToast('Las horas objetivo deben ser un valor entre 0 y 200.', 'error');
    return;
  }

  try {
    const toggleEl = document.getElementById('config-modo-edicion');
    const nuevoModo = toggleEl ? toggleEl.checked : modoEdicion;

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

    const periodo = `${periodoAdminAnio}-${periodoAdminMes}`;
    const objetivoData = {
      objetivoHoras: obj,
      anio: periodoAdminAnio,
      mes: periodoAdminMes,
      actualizadoEn: new Date().toISOString()
    };

    if (!navigator.onLine) {
      OfflineSync.enqueue('objetivosMensuales', periodo, 'set', objetivoData);
      objetivosMensuales[periodo] = obj;
      renderDashboard();
      renderPlanilla();
      showToast(`Objetivo de ${MESES_ADMIN[Number(periodoAdminMes)]} ${periodoAdminAnio} guardado offline.`, 'info');
      registrarLog('Configuración (Offline)', `Objetivo ${periodo}: ${obj} hs. Modo Edición: ${modoEdicion}. Pendiente de sincronización.`);
      closeConfigModal();
      return;
    }

    await db.collection('objetivosMensuales').doc(periodo).set(objetivoData);
    objetivosMensuales[periodo] = obj;
    registrarLog('Objetivo Mensual', `Período ${periodo}: ${obj} hs. Modo Edición: ${modoEdicion}.`);
    showToast(`Objetivo guardado para ${MESES_ADMIN[Number(periodoAdminMes)]} ${periodoAdminAnio}: ${obj} hs.`, 'success');
    renderDashboard();
    renderPlanilla();
    closeConfigModal();
  } catch (err) {
    showToast('Error al guardar configuración: ' + err.message, 'error');
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
  const btnReabrirMes = document.getElementById('btn-reabrir-mes');
  if (btnReabrirMes) {
    btnReabrirMes.style.display = modoEdicion ? '' : 'none';
  }
  const btnDescargarPDF = document.getElementById('btn-descargar-pdf');
  if (btnDescargarPDF) {
    btnDescargarPDF.style.display = modoEdicion ? '' : 'none';
  }
  const btnTesoreria = document.getElementById('btn-reporte-tesoreria');
  if (btnTesoreria) {
    btnTesoreria.style.display = modoEdicion ? '' : 'none';
  }
  // Herramienta PDF de la pestaña Jornada
  const panelReporteJornada = document.getElementById('panel-reporte-jornada');
  if (panelReporteJornada) {
    panelReporteJornada.classList.toggle('hidden', !modoEdicion);
  }
  // Si se desactiva el modo edición con el modal abierto, cerrarlo
  if (!modoEdicion) {
    document.getElementById('modal-reporte-jornada')?.classList.add('hidden');
  }
  // Botón de bitácora en la navegación superior
  const btnNavBitacora = document.getElementById('btn-nav-bitacora');
  if (btnNavBitacora) {
    btnNavBitacora.classList.toggle('hidden', !modoEdicion);
  }
  // Sección restringida del modal de configuración
  const restrictedSection = document.getElementById('config-restricted-section');
  if (restrictedSection) {
    restrictedSection.classList.toggle('hidden', !modoEdicion);
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

  if (!await showConfirmModal("Sincronizar CSV", `¿Deseas sobreescribir TODOS los socios con el archivo "${file.name}" para el período ${mes}/${anio}? Esta acción es irreversible.`)) {
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
      const defaultPinHash = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'; // SHA-256 de "1234"
      let batchW = db.batch();
      c = 0;
      for (const { socio, pin } of datos) {
        // Hashear PIN del CSV o usar default
        const pinHash = (pin && /^\d{4}$/.test(pin)) 
          ? await hashPIN(pin) 
          : defaultPinHash;

        const socioData = {
          ...socio,
          pinHash,
          fechaAlta: socio.fechaAlta || `${anio}-${mes}-01`,
          historialTitulares: socio.historialTitulares || [{
            nombre: socio.nombre,
            fechaNacimiento: socio.fechaNacimiento,
            comision: socio.comision || 'Ninguna',
            desde: socio.fechaAlta || `${anio}-${mes}-01`,
            hasta: null
          }]
        };
        batchW.set(db.collection('socios').doc(socio.id), socioData);
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
            tesoreriaAcumulada: 0,
            tesoreriaPendiente: 0
          });
          if (++c === 499) { await batchS.commit(); batchS = db.batch(); c = 0; }
        }
      }
      if (c > 0) await batchS.commit();

      // Registrar el período de apertura para impedir que la Planilla muestre
      // meses posteriores antes del cierre correspondiente.
      const fechaCierreInicial = new Date(Number(anio), Number(mes) - 2, 1);
      const periodoCierreAnteriorSimulado = `${fechaCierreInicial.getFullYear()}-${String(fechaCierreInicial.getMonth() + 1).padStart(2, '0')}`;
      await db.collection('config').doc('metaGlobal').set({
        objetivoHoras: 4,
        periodoInicial: `${anio}-${String(mes).padStart(2, '0')}`,
        cierreAnteriorSimulado: true,
        periodoCierreAnteriorSimulado
      }, { merge: true });

      registrarLog("Sincronización CSV", `CARGA MASIVA - Archivo: ${file.name}. Período: ${mes}/${anio}. Se sincronizaron ${datos.length} socios.`);
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
    const nombre = cleanText(cols[1]);
    if (!id || !nombre) continue;

    const fechaNacimiento = parsearFechaCSV(cols[2]);

    // Familiares: columnas 3..32 (hasta 10 familiares x 3 campos)
    const nucleo = [];
    for (let i = 0; i < 10; i++) {
      const base = 3 + i * 3;
      const nomFam     = cleanText(cols[base]);
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

    // PIN: columna 34 (opcional, 4 dígitos, default "1234")
    const pin = /^\d{4}$/.test(cols[34] || '') ? cols[34].trim() : '1234';

    resultado.push({
      socio: {
        id,
        nombre,
        fechaNacimiento,
        comision: 'Ninguna',
        nucleo
      },
      saldoAnterior,
      pin
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

  if (!navigator.onLine) {
    showToast("El cierre mensual requiere conexión a internet.", "error");
    return;
  }

  if (!await showConfirmModal("Cierre Mensual", `¿Confirmas el cierre del período ${mes}/${anio}? Se calcularán y arrastrarán los saldos para el mes siguiente.`)) {
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
    const periodoEsLicencia = esPeriodoLicencia(anio, mes);
    const ultimoDiaMes = new Date(Number(anio), Number(mes), 0).getDate();
    const fechaCierreContable = `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDiaMes).padStart(2, '0')}`;
    const cerradoEn = new Date().toISOString();
    for (const s of socios) {
      const objetivo = obtenerObjetivoHorasSocio(s, anio, mes);

      const hist = obtenerSaldoHistoricoAlMes(s.id, anio, mes);
      const resHoras = obtenerResultadoHorasSocio(s, anio, mes);

      // Compatibilidad: cualquier pendiente heredado se imputa al período que se cierra.
      const tesoreriaAntes = hist.tesoreriaAcumulada || 0;
      const cobroPendienteHeredado = hist.tesoreriaPendiente || 0;
      const tesoreriaAntesDelCierre = tesoreriaAntes + cobroPendienteHeredado;
      const claveActual = `${s.id}_${anio}-${String(mes).padStart(2, '0')}`;
      const claveSiguiente = `${s.id}_${sigAnioStr}-${sigMesStr}`;

      if (periodoEsLicencia) {
        const tesoreriaAcumuladaAlCierre = tesoreriaAntesDelCierre;
        await db.collection('saldosHistoricos').doc(claveActual).set({
          cerrado: true,
          cerradoEn,
          fechaCierreContable,
          tesoreriaCobradaEnPeriodo: cobroPendienteHeredado,
          tesoreriaPasadaEnCierre: 0,
          tesoreriaAcumuladaAlCierre
        }, { merge: true });
        await db.collection('saldosHistoricos').doc(claveSiguiente).set({
          deudaAnterior: hist.deudaAnterior || 0,       // A Recuperar: se saltea la licencia
          remanenteAnterior: hist.remanenteAnterior || 0,
          tesoreriaAcumulada: tesoreriaAcumuladaAlCierre,
          tesoreriaPendiente: 0,
          recuperacionPausadaPorLicencia: true,
          periodoOrigen: `${anio}-${mes}`
        });
        continue;
      }
      
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

      // El pasaje ocurre contablemente en el último día del mes que se cierra.
      const tesoreriaCobradaEnPeriodo = cobroPendienteHeredado + pasajeATesoreria;
      const tesoreriaAcumuladaAlCierre = tesoreriaAntes + tesoreriaCobradaEnPeriodo;
      await db.collection('saldosHistoricos').doc(claveActual).set({
        cerrado: true,
        cerradoEn,
        fechaCierreContable,
        tesoreriaCobradaEnPeriodo,
        tesoreriaPasadaEnCierre: pasajeATesoreria,
        tesoreriaAcumuladaAlCierre
      }, { merge: true });
      await db.collection('saldosHistoricos').doc(claveSiguiente).set({
        deudaAnterior: deudaFinal,                     // Déficit propio del mes: A Recuperar siguiente
        remanenteAnterior: remanenteFinal,
        tesoreriaAcumulada: tesoreriaAcumuladaAlCierre, // Ya incluye el pasaje del cierre actual
        tesoreriaPendiente: 0,
        periodoOrigen: `${anio}-${mes}`
      });
    }
    registrarLog("Cierre Mensual", `CIERRE DE PERÍODO: ${mes}/${anio}. Se generaron los saldos y arrastres para ${sigMesStr}/${sigAnioStr}.`);
    showToast(`Cierre procesado. Período ${sigMesStr}/${sigAnioStr} habilitado.`, "success");
    establecerPeriodoAdmin(sigAnioStr, sigMesStr, true);
  } catch (err) {
    showToast("Error al realizar cierre: " + err.message, "error");
  }
}

async function reabrirMes() {
  const anio = document.getElementById('planilla-anio').value;
  const mes = document.getElementById('planilla-mes').value;

  if (!navigator.onLine) {
    showToast("Reabrir mes requiere conexión a internet.", "error");
    return;
  }

  if (!await showConfirmModal("Reabrir Mes", `¿Deseas reabrir el mes ${mes}/${anio}? Esto eliminará los arrastres generados para el período siguiente.`)) {
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
  const claveSiguientePeriodo = `${sigAnioStr}-${sigMesStr}`;

  try {
    showToast("Reabriendo mes en Firebase...", "info");
    // Eliminar los saldos históricos para el siguiente período para todos los socios
    for (const s of socios) {
      const clave = `${s.id}_${claveSiguientePeriodo}`;
      const docRef = db.collection('saldosHistoricos').doc(clave);
      const doc = await docRef.get();
      if (doc.exists) {
        await docRef.delete();
      }
      const claveActual = `${s.id}_${anio}-${String(mes).padStart(2, '0')}`;
      const actualRef = db.collection('saldosHistoricos').doc(claveActual);
      const actualDoc = await actualRef.get();
      if (actualDoc.exists) {
        await actualRef.set({
          cerrado: firebase.firestore.FieldValue.delete(),
          cerradoEn: firebase.firestore.FieldValue.delete(),
          fechaCierreContable: firebase.firestore.FieldValue.delete(),
          tesoreriaCobradaEnPeriodo: firebase.firestore.FieldValue.delete(),
          tesoreriaPasadaEnCierre: firebase.firestore.FieldValue.delete(),
          tesoreriaAcumuladaAlCierre: firebase.firestore.FieldValue.delete()
        }, { merge: true });
      }
    }
    registrarLog("Reapertura Mes", `REAPERTURA - Se reabrió el período ${mes}/${anio}. Se eliminaron los arrastres previos para el mes siguiente.`);
    showToast(`Mes ${mes}/${anio} reabierto. Saldos del período ${sigMesStr}/${sigAnioStr} eliminados.`, "success");
    renderPlanilla(); // Re-renderizar la planilla para reflejar los cambios
  } catch (err) {
    showToast("Error al reabrir el mes: " + err.message, "error");
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
  if (edad < 16 || edad > 70) return false;
  // Menores de 18 (16-17 años) requieren autorización del responsable
  if (edad < 18 && !persona.autorizacionMenor) return false;
  return true;
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
  const valor = Number(data.objetivoHoras);
  const objetivoHoras = Number.isFinite(valor) && valor >= 0 ? valor : 4;
  const periodoInicial = /^\d{4}-\d{2}$/.test(String(data.periodoInicial || ''))
    ? String(data.periodoInicial)
    : '';
  return { objetivoHoras, periodoInicial };
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

function obtenerObjetivoHorasPeriodo(anio, mes) {
  const clave = `${anio}-${mes}`;
  return Object.prototype.hasOwnProperty.call(objetivosMensuales, clave)
    ? objetivosMensuales[clave]
    : 4; // Valor predeterminado para períodos todavía no configurados.
}

function obtenerObjetivoHorasSocio(socio, anio = periodoAdminAnio, mes = periodoAdminMes) {
  if (esNucleoExonerado(socio)) return 0;
  return obtenerObjetivoHorasPeriodo(anio, mes);
}

function esPeriodoLicencia(anio, mes) {
  return obtenerObjetivoHorasPeriodo(anio, mes) === 0;
}

function obtenerHorasRealizadasNucleo(socioId, anio, mes) {
  const sIdSearch = String(socioId).trim();
  const horasFisicas = registros
    .filter(r => String(r.socioId).trim() === sIdSearch && r.estado === 'finalizado')
    .filter(r => {
      const [regAnio, regMes] = (r.fecha || "").split('-');
      return regAnio === anio && regMes === mes;
    })
    .reduce((sum, r) => sum + getRoundedHours(r.horaIngreso, r.horaSalida), 0);

  // Las horas computables deben ser múltiplos de 4. Si es menos de 4, se pierden.
  const horasComputables = (horasFisicas >= 4) ? Math.floor(horasFisicas / 4) * 4 : 0;
  const horasResto = Math.round((horasFisicas - horasComputables) * 100) / 100;

  return { 
    fisicas: horasFisicas, 
    computables: horasComputables, 
    perdidas: (horasFisicas > 0 && horasComputables === 0),
    horasResto: horasResto
  };
}

function obtenerResultadoHorasSocio(socio, anio, mes) {
  const horasCampo = obtenerHorasRealizadasNucleo(socio.id, anio, mes);
  const objetivo = obtenerObjetivoHorasSocio(socio, anio, mes);
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
  const data = saldosHistoricos[clave] || {};
  return {
    ...data,
    deudaAnterior: Number(data.deudaAnterior) || 0,
    remanenteAnterior: Number(data.remanenteAnterior) || 0,
    tesoreriaAcumulada: Number(data.tesoreriaAcumulada) || 0,
    tesoreriaPendiente: Number(data.tesoreriaPendiente) || 0, // compatibilidad histórica
    tesoreriaCobradaEnPeriodo: Number(data.tesoreriaCobradaEnPeriodo) || 0,
    tesoreriaPasadaEnCierre: Number(data.tesoreriaPasadaEnCierre) || 0,
    tesoreriaAcumuladaAlCierre: Number(data.tesoreriaAcumuladaAlCierre) || 0,
    cerrado: data.cerrado === true,
    fechaCierreContable: data.fechaCierreContable || ''
  };
}

function obtenerTesoreriaTotal(hist) {
  if (hist.cerrado) return hist.tesoreriaAcumuladaAlCierre || 0;
  return (hist.tesoreriaAcumulada || 0) + (hist.tesoreriaPendiente || 0);
}

// --- PERÍODO GLOBAL DEL ADMIN ---
function obtenerAniosDisponiblesAdmin() {
  const actual = new Date().getFullYear();
  const anios = new Set();
  for (let i = -2; i <= 5; i++) anios.add(String(actual - i));
  registros.forEach(r => {
    const anio = String(r.fecha || '').split('-')[0];
    if (/^\d{4}$/.test(anio)) anios.add(anio);
  });
  Object.keys(saldosHistoricos).forEach(clave => {
    const periodo = clave.substring(clave.lastIndexOf('_') + 1);
    const anio = periodo.split('-')[0];
    if (/^\d{4}$/.test(anio)) anios.add(anio);
  });
  anios.add(periodoAdminAnio);
  return [...anios].sort((a, b) => Number(b) - Number(a));
}

function poblarAniosAdmin(select, incluirTodos = false) {
  if (!select) return;
  const valorPrevio = select.value;
  select.innerHTML = incluirTodos ? '<option value="todos">Todos los Años</option>' : '';
  obtenerAniosDisponiblesAdmin().forEach(anio => {
    const option = document.createElement('option');
    option.value = anio;
    option.textContent = anio;
    select.appendChild(option);
  });
  const valorDeseado = valorPrevio && valorPrevio !== 'todos' ? valorPrevio : periodoAdminAnio;
  select.value = [...select.options].some(o => o.value === valorDeseado) ? valorDeseado : periodoAdminAnio;
}

function inicializarPeriodoAdminDesdeDispositivo() {
  const ahora = new Date();
  periodoAdminAnio = String(ahora.getFullYear());
  periodoAdminMes = String(ahora.getMonth() + 1).padStart(2, '0');
  actualizarOpcionesPeriodoAdmin();
  sincronizarSelectoresPeriodoAdmin();
}

function actualizarOpcionesPeriodoAdmin() {
  poblarAniosAdmin(document.getElementById('dashboard-anio'));
  poblarAniosAdmin(document.getElementById('planilla-anio'));
  const historialAnio = document.getElementById('filter-historial-anio');
  if (historialAnio && historialAnio.options.length > 0) poblarAniosAdmin(historialAnio, true);
  sincronizarSelectoresPeriodoAdmin();
}

function sincronizarSelectoresPeriodoAdmin() {
  const pares = [
    ['dashboard-mes', 'dashboard-anio'],
    ['planilla-mes', 'planilla-anio'],
    ['filter-historial-mes', 'filter-historial-anio']
  ];
  pares.forEach(([mesId, anioId]) => {
    const mesEl = document.getElementById(mesId);
    const anioEl = document.getElementById(anioId);
    if (mesEl && [...mesEl.options].some(o => o.value === periodoAdminMes)) mesEl.value = periodoAdminMes;
    if (anioEl && [...anioEl.options].some(o => o.value === periodoAdminAnio)) anioEl.value = periodoAdminAnio;
  });
}

function establecerPeriodoAdmin(anio, mes, renderizar = true) {
  if (!/^\d{4}$/.test(String(anio)) || !/^(0[1-9]|1[0-2])$/.test(String(mes))) return;
  periodoAdminAnio = String(anio);
  periodoAdminMes = String(mes);
  actualizarOpcionesPeriodoAdmin();
  sincronizarSelectoresPeriodoAdmin();
  if (renderizar) {
    renderDashboard();
    renderPlanilla();
    renderHistorialTable();
  }
}

function cambiarPeriodoAdminDesde(origen) {
  const ids = origen === 'dashboard'
    ? ['dashboard-mes', 'dashboard-anio']
    : origen === 'planilla'
      ? ['planilla-mes', 'planilla-anio']
      : ['filter-historial-mes', 'filter-historial-anio'];
  const mes = document.getElementById(ids[0])?.value;
  const anio = document.getElementById(ids[1])?.value;

  // "Todos" sigue disponible como filtro exclusivo del Historial y no altera el período global.
  if (mes === 'todos' || anio === 'todos') {
    renderHistorialTable();
    return;
  }
  establecerPeriodoAdmin(anio, mes, true);
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
  if (tabId === 'tab-socios') populateCommissionSelect('socio-comision'); // Populate socio form commission select
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
    } else if (edad >= 16 && edad < 18) {
      if (s.autorizacionMenor) {
        badgeHabilidad = `<span class="bg-orange-50 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold border border-orange-200">Menor Autorizado (16-17)</span>`;
      } else {
        badgeHabilidad = `<span class="bg-red-50 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold border border-red-200">⚠ Menor Sin Autorización</span>`;
      }
    } else {
      badgeHabilidad = `<span class="bg-brand-50 text-brand-700 px-2 py-0.5 rounded text-[10px] font-bold border border-brand-200">Habilitado</span>`;
    }

    const comisionBadge = s.comision !== 'Ninguna' ? `<span class="bg-purple-50 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold border border-purple-200">Comisión: ${s.comision}</span>` : '';

    let nucleoHTML = '';
    if (s.nucleo && s.nucleo.length > 0) {
      nucleoHTML = s.nucleo.map((f, i) => {
        const fEdad = calcularEdad(f.fechaNacimiento);
        const fHabilitado = esPersonaHabilitada(f);
        const fMenor1617 = fEdad >= 16 && fEdad < 18;
        const fBadge = fHabilitado 
          ? (fMenor1617 ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-emerald-50 text-emerald-700 border-emerald-100')
          : 'bg-slate-100 text-slate-500 border-slate-200';
        const fCom = f.comision !== 'Ninguna' ? `[C: ${f.comision}]` : '';
        const fCertificado = f.certificadoMedico ? ' 📋' : '';
        const fAutorizacion = fMenor1617 ? (f.autorizacionMenor ? ' ✅' : ' ⚠️') : '';

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
            <span>${f.nombre} (${f.parentesco}, ${fEdad} años)${fAutorizacion} ${fCom}${fCertificado}</span>
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
        <button onclick="openGestionEstadoModal('${s.id}', 'titular')" class="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-xs font-semibold transition flex items-center gap-1">
          <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Cambiar Titular
        </button>
        <button onclick="openCambiarPINModal('${s.id}')" class="px-3 py-1.5 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 rounded-lg text-xs font-semibold transition flex items-center gap-1" title="Cambiar PIN de acceso al portal">
          <i data-lucide="key-round" class="w-3.5 h-3.5"></i> PIN
        </button>
        <button onclick="openNucleoModal('${s.id}')" class="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1">
          <i data-lucide="plus" class="w-3.5 h-3.5"></i> Familiar
        </button>
        <div class="flex gap-1 ml-auto">
          <button onclick="openGestionEstadoModal('${s.id}', 'baja')" class="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-semibold transition flex items-center gap-1">
            <i data-lucide="user-minus" class="w-3.5 h-3.5"></i> Baja
          </button>
          <button onclick="deleteSocio('${s.id}')" class="px-2 py-1.5 text-slate-400 hover:text-red-600 transition" title="Eliminar definitivamente">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </div>` : '';

    const card = document.createElement('div');
    card.className = `p-5 border rounded-2xl transition ${exoneradoNucleo ? 'bg-blue-50/20 border-blue-100' : 'bg-slate-50/50 hover:bg-white border-slate-150 hover:shadow-md'}`;
    card.innerHTML = `
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-mono text-slate-400">ID: ${s.id}</span>
          </div>
          <div class="flex gap-1">
            ${s.fechaBaja ? `<span class="bg-red-100 text-red-800 px-2 py-0.5 rounded text-[10px] font-bold border border-red-200">BAJA: ${formatDateString(s.fechaBaja)}</span>` : ''}
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
  const filterInput = document.getElementById('filter-socio-id');
  const socioSelectFiltered = document.getElementById('ingreso-socio-filtered');
  if (!filterInput || !socioSelectFiltered) return;

  filterInput.value = ''; // Limpiar el filtro al configurar el formulario
  filterAndRenderSociosForIngreso(); // Renderizar la lista inicial

  // Event listener para el campo de filtro
  filterInput.addEventListener('input', filterAndRenderSociosForIngreso);

  // Event listener para el select de socios filtrados
  socioSelectFiltered.addEventListener('change', updateIngresoTrabajadores);

  document.getElementById('ingreso-trabajadores-checkboxes').innerHTML = '<p class="text-xs text-slate-400 text-center py-2">Seleccione un socio primero</p>';
  document.getElementById('ingreso-fecha').value = new Date().toISOString().split('T')[0];
  
  const ahora = new Date();
  const hh = String(ahora.getHours()).padStart(2, '0');
  const mm = String(ahora.getMinutes()).padStart(2, '0');
  document.getElementById('ingreso-hora').value = `${hh}:${mm}`; // Asegúrate de que este ID exista en tu HTML

  renderJornadasActivas();
}

function filterAndRenderSociosForIngreso() {
  const filterInput = document.getElementById('filter-socio-id');
  const socioSelectFiltered = document.getElementById('ingreso-socio-filtered');
  if (!filterInput || !socioSelectFiltered) return;

  const filterText = filterInput.value.toLowerCase();
  socioSelectFiltered.innerHTML = '<option value="" disabled selected>Seleccione un Socio</option>';

  const filteredSocios = socios.filter(s =>
    s.id.toLowerCase().includes(filterText) ||
    s.nombre.toLowerCase().includes(filterText)
  );

  filteredSocios.forEach(s => {
    const option = document.createElement('option');
    option.value = s.id;
    option.textContent = `${s.nombre} (${s.id})`;
    socioSelectFiltered.appendChild(option);
  });

  // Si solo hay un socio filtrado, seleccionarlo automáticamente
  if (filteredSocios.length === 1) {
    socioSelectFiltered.value = filteredSocios[0].id;
  }

  updateIngresoTrabajadores(); // Actualizar la lista de trabajadores después de filtrar socios
}

function updateIngresoTrabajadores() {
  const socioId = document.getElementById('ingreso-socio-filtered').value;
  const container = document.getElementById('ingreso-trabajadores-checkboxes');
  container.innerHTML = '';

  const socio = socios.find(s => s.id === socioId);
  if (!socio) {
    container.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">Seleccione un socio primero</p>';
    return;
  }

  let checkboxesAgregados = 0;

  // Titular
  if (esPersonaHabilitada(socio)) {
    const edad = calcularEdad(socio.fechaNacimiento);
    const esMenor = edad >= 16 && edad < 18;
    const label = document.createElement('label');
    label.className = 'flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200 cursor-pointer hover:bg-emerald-50 transition';
    label.innerHTML = `
      <input type="checkbox" class="ingreso-trabajador-cb w-4 h-4 accent-emerald-600" value="${socio.nombre}">
      <span class="text-sm font-medium text-slate-700">${socio.nombre}</span>
      <span class="text-[10px] text-slate-400 ml-auto">Titular${esMenor ? ' (16-17)' : ''}</span>
    `;
    container.appendChild(label);
    checkboxesAgregados++;
  }

  // Familiares del núcleo
  if (socio.nucleo) {
    socio.nucleo.forEach(f => {
      if (esPersonaHabilitada(f)) {
        const edad = calcularEdad(f.fechaNacimiento);
        const esMenor = edad >= 16 && edad < 18;
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200 cursor-pointer hover:bg-emerald-50 transition';
        label.innerHTML = `
          <input type="checkbox" class="ingreso-trabajador-cb w-4 h-4 accent-emerald-600" value="${f.nombre}">
          <span class="text-sm font-medium text-slate-700">${f.nombre}</span>
          <span class="text-[10px] text-slate-400 ml-auto">${f.parentesco}${esMenor ? ' (16-17)' : ''}</span>
        `;
        container.appendChild(label);
        checkboxesAgregados++;
      }
    });
  }

  if (checkboxesAgregados === 0) {
    container.innerHTML = '<p class="text-xs text-red-500 text-center py-2">Sin integrantes habilitados para trabajar</p>';
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
    const socio = socios.find(s => s.id === act.socioId) || { nombre: 'Desconocido' };
    
    const card = document.createElement('div');
    card.className = "p-4 border border-slate-100 rounded-xl bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3";
    card.innerHTML = `
      <div>
        <div class="flex items-center gap-2">
          <span class="bg-blue-100 text-blue-800 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider">En obra</span>
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

// --- CANVAS DE FIRMAS ---
let signatureCanvas, signatureCtx;
let responsableSignatureCanvas, responsableSignatureCtx;

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
  updateRoundedHoursDisplay();
}

function getRoundedHours(horaIngreso, horaSalida) {
  let calculated = calculateHours(horaIngreso, horaSalida);
  if (calculated <= 0) return 0;

  const minutosTrabajados = calculated * 60;
  if (minutosTrabajados < 105) return 0;

  if (minutosTrabajados >= 210 && minutosTrabajados <= 255) {
    return 4.0;
  } else if (minutosTrabajados >= 105 && minutosTrabajados < 210) {
    return 2.0;
  }
  return calculated;
}

function updateRoundedHoursDisplay() {
  const id = document.getElementById('egreso-registro-id').value;
  const horaSalida = document.getElementById('egreso-hora').value;
  const reg = registros.find(r => r.id === id);
  const lbl = document.getElementById('lbl-egreso-horas-calculadas');
  if (reg && horaSalida && lbl) {
    const rounded = getRoundedHours(reg.horaIngreso, horaSalida);
    lbl.textContent = `${rounded.toFixed(2)} hs`;
  }
}

function closeEgresoModal() {
  document.getElementById('modal-egreso-firma').classList.add('hidden');
}

function setupSignatureCanvas() {
  signatureCanvas = document.getElementById('signature-canvas');
  signatureCtx = prepararCanvasFirma(signatureCanvas);
}

function prepararCanvasFirma(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  limpiarCanvasFirma(canvas);

  if (canvas.dataset.firmaEventos === 'true') return ctx;
  canvas.dataset.firmaEventos = 'true';
  let dibujando = false;

  const posicionMouse = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const posicionTouch = (e) => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches[0];
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };
  const iniciar = (pos) => {
    dibujando = true;
    const contexto = canvas.getContext('2d');
    contexto.beginPath();
    contexto.moveTo(pos.x, pos.y);
  };
  const continuar = (pos) => {
    if (!dibujando) return;
    const contexto = canvas.getContext('2d');
    contexto.lineTo(pos.x, pos.y);
    contexto.stroke();
  };

  canvas.addEventListener('mousedown', (e) => iniciar(posicionMouse(e)));
  canvas.addEventListener('mousemove', (e) => continuar(posicionMouse(e)));
  canvas.addEventListener('mouseup', () => { dibujando = false; });
  canvas.addEventListener('mouseleave', () => { dibujando = false; });
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    iniciar(posicionTouch(e));
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    continuar(posicionTouch(e));
  }, { passive: false });
  canvas.addEventListener('touchend', () => { dibujando = false; });
  return ctx;
}

function limpiarCanvasFirma(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function clearCanvas() {
  limpiarCanvasFirma(signatureCanvas);
}

function openFirmaResponsableModal(registroId, registroData = null) {
  const reg = registroData || registros.find(r => r.id === registroId);
  if (!reg) return;
  document.getElementById('firma-responsable-registro-id').value = registroId;
  document.getElementById('lbl-firma-responsable-fecha').textContent = formatDateString(reg.fecha);
  document.getElementById('lbl-firma-responsable-nombre').textContent = reg.responsable || 'Sin nombre registrado';
  document.getElementById('modal-firma-responsable').classList.remove('hidden');
  responsableSignatureCanvas = document.getElementById('responsable-signature-canvas');
  responsableSignatureCtx = prepararCanvasFirma(responsableSignatureCanvas);
  lucide.createIcons();
}

async function submitFirmaResponsableJornada() {
  const id = document.getElementById('firma-responsable-registro-id').value;
  if (isCanvasBlank(responsableSignatureCanvas)) {
    showToast('La firma del responsable (capataz/delegado) es obligatoria.', 'error');
    return;
  }
  const firmaResponsable = responsableSignatureCanvas.toDataURL();
  const data = { firmaResponsable };
  try {
    if (!navigator.onLine) {
      OfflineSync.enqueue('registros', id, 'merge', data);
      const idx = registros.findIndex(r => r.id === id);
      if (idx >= 0) registros[idx] = { ...registros[idx], ...data };
      showToast('Firma del responsable guardada offline. Se sincronizará al tener conexión.', 'info');
    } else {
      await db.collection('registros').doc(id).set(data, { merge: true });
      const idx = registros.findIndex(r => r.id === id);
      if (idx >= 0) registros[idx] = { ...registros[idx], ...data };
      showToast('Jornada cerrada con la firma del responsable.', 'success');
    }
    registrarLog('Cierre de Jornada', `Firma del responsable registrada para la jornada ${id}.`);
    document.getElementById('modal-firma-responsable').classList.add('hidden');
    renderHistorialTable();
  } catch (err) {
    showToast('Error al guardar la firma del responsable: ' + err.message, 'error');
  }
}

function clearResponsableCanvas() {
  limpiarCanvasFirma(responsableSignatureCanvas);
}

function isCanvasBlank(canvas) {
  if (!canvas) return true;
  const blank = document.createElement('canvas');
  blank.width = canvas.width;
  blank.height = canvas.height;
  const bCtx = blank.getContext('2d');
  bCtx.fillStyle = '#ffffff';
  bCtx.fillRect(0, 0, blank.width, blank.height);
  return canvas.toDataURL() === blank.toDataURL();
}

// --- PLANILLA DE CÁLCULO ---
function periodoAnterior(anio, mes) {
  const fecha = new Date(Number(anio), Number(mes) - 2, 1);
  return {
    anio: String(fecha.getFullYear()),
    mes: String(fecha.getMonth() + 1).padStart(2, '0')
  };
}

function obtenerEstadoPeriodoPlanilla(anio, mes) {
  const periodo = `${anio}-${String(mes).padStart(2, '0')}`;
  if (config.periodoInicial && periodo < config.periodoInicial) {
    return { habilitado: false, motivo: 'anterior', periodo, inicial: config.periodoInicial };
  }
  // El período inicial simula el cierre anterior mediante sus saldos de apertura.
  if (config.periodoInicial && periodo === config.periodoInicial) {
    return { habilitado: true, motivo: 'inicial', periodo, inicial: config.periodoInicial };
  }

  // El cierre del mes anterior crea un saldo de apertura para cada socio.
  const tieneSaldoApertura = Object.keys(saldosHistoricos).some(clave => clave.endsWith(`_${periodo}`));
  if (tieneSaldoApertura) return { habilitado: true, motivo: 'cerrado', periodo, inicial: config.periodoInicial };

  // Compatibilidad con instalaciones anteriores que aún no tienen período inicial.
  if (!config.periodoInicial && Object.keys(saldosHistoricos).length === 0) {
    const ahora = new Date();
    const actual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    if (periodo === actual) return { habilitado: true, motivo: 'compatibilidad', periodo, inicial: '' };
  }
  return { habilitado: false, motivo: 'pendiente', periodo, inicial: config.periodoInicial };
}

function periodoPlanillaHabilitado(anio, mes) {
  return obtenerEstadoPeriodoPlanilla(anio, mes).habilitado;
}

function renderPlanilla() {
  const anio = periodoAdminAnio;
  const mes = periodoAdminMes;
  const tbody = document.getElementById('tbl-planilla-cuerpo');
  if (!tbody) return;
  tbody.innerHTML = '';

  const estadoPeriodo = obtenerEstadoPeriodoPlanilla(anio, mes);
  if (!estadoPeriodo.habilitado) {
    const anterior = periodoAnterior(anio, mes);
    const esAnterior = estadoPeriodo.motivo === 'anterior';
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 px-4 text-center">
      <div class="font-bold text-amber-700">${esAnterior ? 'No hay información para este período' : 'Período todavía no habilitado'}</div>
      <div class="mt-1 text-sm text-slate-500">${esAnterior
        ? `La operación comienza en ${estadoPeriodo.inicial}. Los meses anteriores no tienen datos cargados.`
        : `Para mostrar ${String(mes).padStart(2, '0')}/${anio}, primero debe cerrar ${anterior.mes}/${anterior.anio}.`}</div>
    </td></tr>`;
    return;
  }

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

  sociosOrdenados.forEach(socioOriginal => {
    // Obtener el estado del socio para el último día del mes consultado
    const ultimoDiaMes = new Date(anio, mes, 0).toISOString().split('T')[0];
    const s = getSocioSnapshot(socioOriginal, ultimoDiaMes);
    
    // Si el socio no existía o ya estaba de baja en ese mes, no lo mostramos
    if (!s) return;

    const exonerado = esNucleoExonerado(s);
    const objetivo = obtenerObjetivoHorasSocio(s, anio, mes);
    const comisionAsignada = obtenerComisionAsignadaNucleo(s);
    const hist = obtenerSaldoHistoricoAlMes(s.id, anio, mes);
    const resHoras = obtenerResultadoHorasSocio(s, anio, mes);

    const periodoEsLicencia = esPeriodoLicencia(anio, mes);
    const comprometidas = objetivo + hist.deudaAnterior;
    let saldoDelMes = resHoras.computables - objetivo;
    let totalCredito = resHoras.computables + hist.remanenteAnterior;

    let remanenteFinal = 0;
    let deudaFinal = 0;
    let pasajeProyectadoTesoreria = 0;

    if (periodoEsLicencia) {
      // Se cobra Tesorería pendiente y sólo se pausa la deuda A Recuperar.
      saldoDelMes = 0;
      totalCredito = hist.remanenteAnterior;
      remanenteFinal = hist.remanenteAnterior || 0;
      deudaFinal = hist.deudaAnterior || 0;
    } else if (totalCredito >= comprometidas) {
      remanenteFinal = totalCredito - comprometidas;
    } else {
      deudaFinal = comprometidas - totalCredito;
      const saldoTrasObjetivo = Math.max(0, totalCredito - objetivo);
      pasajeProyectadoTesoreria = Math.max(0, hist.deudaAnterior - saldoTrasObjetivo);
      // El saldo visible conserva toda la deuda pendiente; el pasaje proyectado se aplica al cerrar.
    }

    let obs = [];
    if (periodoEsLicencia) obs.push("Licencia: se cobra Tesorería y se pausa A Recuperar");
    if (hist.tesoreriaPendiente > 0) obs.push(`A Tesorería este mes: ${formatHours(hist.tesoreriaPendiente)}`);
    if (pasajeProyectadoTesoreria > 0) obs.push(`A Tesorería al cierre: ${formatHours(pasajeProyectadoTesoreria)}`);
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

    if (resHoras.horasResto > 0 && !resHoras.cubiertasPorComision) {
      if (resHoras.perdidas) {
        obs.push(`<span class="text-red-500 font-bold">Perdió ${resHoras.horasResto} hs (no llegó al mínimo de 4 hs)</span>`);
      } else {
        obs.push(`<span class="text-amber-500 font-semibold">Resto: ${resHoras.horasResto} hs perdidas (no completó múltiplo de 4)</span>`);
      }
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
      <td class="py-3 px-4 text-center font-semibold text-slate-700 whitespace-nowrap">
        ${formatHours(comprometidas)}
        <div class="text-[9px] text-slate-400 font-normal">(${formatHours(objetivo)} + ${formatHours(hist.deudaAnterior)} deudas)</div>
      </td>
      <td class="py-3 px-4 text-center">
        <span class="font-bold ${resHoras.perdidas ? 'text-red-500 line-through' : resHoras.cubiertasPorComision ? 'text-purple-700' : 'text-slate-800'}">
          ${formatHours(resHoras.computables)}
        </span>
        ${resHoras.cubiertasPorComision ? `<div class="text-[8px] text-purple-600 font-bold">Cubiertas por comisión</div>` : ''}
        ${resHoras.cubiertasPorComision && resHoras.fisicas > 0 ? `<div class="text-[8px] text-slate-400 line-through">${formatHours(resHoras.fisicas)} campo</div>` : ''}
        ${resHoras.horasResto > 0 && !resHoras.cubiertasPorComision ? `<div class="text-[8px] ${resHoras.perdidas ? 'text-red-500' : 'text-amber-500'} font-bold">-${resHoras.horasResto} hs resto</div>` : ''}
      </td>
      <td class="py-3 px-4 text-center font-bold ${saldoDelMes < 0 ? 'text-amber-600' : 'text-emerald-600'}">
        ${formatHours(saldoDelMes)}
      </td>
      <td class="py-3 px-4 text-center">
        ${remanenteFinal > 0 
          ? `<span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold border border-emerald-200">+${formatHours(remanenteFinal)}</span>`
          : deudaFinal > 0 
            ? `<span class="bg-red-50 text-red-700 px-2 py-0.5 rounded font-bold border border-red-200">Debe ${formatHours(deudaFinal)}</span>`
            : `<span class="text-slate-400 font-semibold">${formatHours(0)}</span>`
        }
      </td>
      <td class="py-3 px-4 text-center font-bold text-red-700">
        ${obtenerTesoreriaTotal(hist) > 0 ? formatHours(obtenerTesoreriaTotal(hist)) : '-'}
      </td>
      <td class="py-3 px-4 text-slate-500 max-w-xs truncate">${obs.join(" | ") || '-'}</td>
    `;
    tbody.appendChild(row);
  });
}

// --- HISTORIAL ---
function setupHistorial() {
  const filterInput = document.getElementById('filter-socio-id-history');
  const socioSelect = document.getElementById('filter-socio-history');
  const monthSelect = document.getElementById('filter-historial-mes');
  const yearSelect = document.getElementById('filter-historial-anio');
  
  if (!filterInput || !socioSelect || !monthSelect || !yearSelect) return;

  filterInput.value = '';
  filterInput.addEventListener('input', filterAndRenderSociosForHistory);

  populateMonthYearFilters(monthSelect, yearSelect);
  filterAndRenderSociosForHistory();
}

function filterAndRenderSociosForHistory() {
  const filterInput = document.getElementById('filter-socio-id-history');
  const socioSelect = document.getElementById('filter-socio-history');
  if (!filterInput || !socioSelect) return;

  const filterText = filterInput.value.toLowerCase();
  const currentVal = socioSelect.value;
  socioSelect.innerHTML = '<option value="todos">Todos los Socios</option>';

  const filteredSocios = socios.filter(s =>
    s.id.toLowerCase().includes(filterText) ||
    s.nombre.toLowerCase().includes(filterText)
  );

  filteredSocios.forEach(s => {
    const option = document.createElement('option');
    option.value = s.id;
    option.textContent = `${s.nombre} (${s.id})`;
    socioSelect.appendChild(option);
  });

  // Intentar mantener selección previa si aún existe en la lista filtrada
  if ([...socioSelect.options].some(o => o.value === currentVal)) {
    socioSelect.value = currentVal;
  }

  renderHistorialTable();
}

function renderHistorialTable() {
  const socioVal = document.getElementById('filter-socio-history') ? document.getElementById('filter-socio-history').value : 'todos';
  const trabVal = document.getElementById('filter-trabajador') ? document.getElementById('filter-trabajador').value.toLowerCase().trim() : '';
  const estVal = document.getElementById('filter-estado') ? document.getElementById('filter-estado').value : 'todos';
  const mesVal = document.getElementById('filter-historial-mes') ? document.getElementById('filter-historial-mes').value : 'todos';
  const anioVal = document.getElementById('filter-historial-anio') ? document.getElementById('filter-historial-anio').value : 'todos';

  const tbody = document.getElementById('tbl-reporte-cuerpo');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filtrados = registros.filter(r => {
    if (socioVal !== 'todos' && r.socioId !== socioVal) return false;
    if (trabVal && !r.trabajadorNombre.toLowerCase().includes(trabVal)) return false;
    if (estVal !== 'todos' && r.estado !== estVal) return false;
    const [regAnio, regMes] = r.fecha.split('-');
    if (mesVal !== 'todos' && regMes !== mesVal) return false;
    if (anioVal !== 'todos' && regAnio !== anioVal) return false;
    return true;
  }).sort((a, b) => b.fecha.localeCompare(a.fecha));

  const alertNo = document.getElementById('no-records-alert');
  if (filtrados.length === 0) {
    if (alertNo) alertNo.classList.remove('hidden');
    return;
  }
  if (alertNo) alertNo.classList.add('hidden');

  filtrados.forEach(r => {
    const socio = socios.find(s => s.id === r.socioId) || { nombre: 'Eliminado/Desconocido' };
    const esActivo = r.estado === 'activo';

    const row = document.createElement('tr');
    row.className = "hover:bg-slate-50 transition";
    row.innerHTML = `
      <td class="py-3 px-6 font-medium text-slate-700">${formatDateString(r.fecha)}</td>
      <td class="py-3 px-6">
        <div class="font-bold">${socio.nombre}</div>
        <div class="text-[10px] text-slate-400 font-mono">ID Titular: ${r.socioId}</div>
      </td>
      <td class="py-3 px-6 text-slate-700">
        <div class="font-bold">${r.trabajadorNombre}</div>
      </td>
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
          : `<div class="flex items-center justify-center gap-3">
              <button onclick="previewSignature('${r.id}')" class="text-brand-600 hover:text-brand-800 transition" title="Ver Firma">
                <i data-lucide="signature" class="w-5 h-5"></i>
              </button>
              <button onclick="descargarPDFJornada('${r.id}')" class="text-emerald-600 hover:text-emerald-800 transition" title="Descargar PDF">
                <i data-lucide="file-text" class="w-5 h-5"></i>
              </button>
            </div>`
        }
      </td>
      <td class="py-3 px-6 text-center">
        ${modoEdicion ? `
          <button onclick="deleteRecord('${r.id}')" class="text-red-500 hover:text-red-700 transition" title="Eliminar Registro">
            <i data-lucide="trash-2" class="w-4 h-4 mx-auto"></i>
          </button>` : `<i data-lucide="lock" class="w-4 h-4 mx-auto text-slate-300"></i>`
        }
      </td>
    `;
    tbody.appendChild(row);
  });
  lucide.createIcons();
}

function populateMonthYearFilters(monthSelect, yearSelect) {
  poblarAniosAdmin(yearSelect, true);

  const months = [
    { value: '01', text: 'Enero' }, { value: '02', text: 'Febrero' },
    { value: '03', text: 'Marzo' }, { value: '04', text: 'Abril' },
    { value: '05', text: 'Mayo' }, { value: '06', text: 'Junio' },
    { value: '07', text: 'Julio' }, { value: '08', text: 'Agosto' },
    { value: '09', text: 'Septiembre' }, { value: '10', text: 'Octubre' },
    { value: '11', text: 'Noviembre' }, { value: '12', text: 'Diciembre' }
  ];
  monthSelect.innerHTML = '<option value="todos">Todos los Meses</option>';
  months.forEach(m => {
    const option = document.createElement('option');
    option.value = m.value;
    option.textContent = m.text;
    monthSelect.appendChild(option);
  });
  monthSelect.value = periodoAdminMes;
  yearSelect.value = periodoAdminAnio;
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
  
  const anio = periodoAdminAnio;
  const mes = periodoAdminMes;
  lblGoal.textContent = obtenerObjetivoHorasPeriodo(anio, mes);
  sincronizarSelectoresPeriodoAdmin();

  const periodEl = document.getElementById('kpi-hours-period');
  if (periodEl) periodEl.textContent = `${MESES_ADMIN[parseInt(mes)]} ${anio}`;
  const textoRiesgo = document.getElementById('texto-alerta-riesgo');
  if (textoRiesgo) textoRiesgo.textContent = `Alerta de Horas Realizadas Menores a 4 hs (${MESES_ADMIN[parseInt(mes)]} ${anio})`;
  
  // Fecha de referencia para el snapshot (fin de mes)
  const fechaReferencia = `${anio}-${mes}-28`; 

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
  
  document.getElementById('kpi-total-hours').textContent = formatHours(totalComputables);
  document.getElementById('kpi-total-socios').textContent = socios.length;
  document.getElementById('kpi-exonerated-socios').textContent = `${totalExonerados} Exonerado(s)`;

  const activas = registros.filter(r => r.estado === 'activo').length;
  document.getElementById('kpi-active-jornadas').textContent = activas;

  const totalTesoreria = socios.reduce((total, socio) => {
    const hist = obtenerSaldoHistoricoAlMes(socio.id, anio, mes);
    return total + obtenerTesoreriaTotal(hist);
  }, 0);
  document.getElementById('kpi-total-tesoreria').textContent = formatHours(totalTesoreria);

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
        row.className = "bg-red-50/40 hover:bg-red-50 transition whitespace-nowrap";
        row.innerHTML = `
          <td class="py-2 px-4 font-bold text-slate-800">${s.nombre}</td>
          <td class="py-2 px-4 text-red-600 font-extrabold">${formatHours(res.fisicas)} trabajadas</td>
          <td class="py-2 px-4 text-red-700 font-semibold flex items-center gap-1 whitespace-nowrap">
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

async function deleteSocio(socioId) {
  if (await showConfirmModal("ELIMINAR SOCIO", "¿Confirmas la eliminación total de este socio y su historial? Para suspensiones temporales usa la opción 'Baja'.")) {
    try {
      if (!navigator.onLine) {
        OfflineSync.enqueue('socios', socioId, 'delete', null);
        socios = socios.filter(s => s.id !== socioId);
        renderSociosList();
        renderDashboard();
        renderPlanilla();
        showToast("Socio eliminado (offline). Se sincronizará al tener conexión.", "info");
        registrarLog("Eliminación Socio (Offline)", `Socio ID: ${socioId} eliminado localmente. Pendiente de sincronización.`);
        return;
      }
      await db.collection('socios').doc(socioId).delete();
      registrarLog("Eliminación Total Socio", `Socio ID: ${socioId} borrado permanentemente de la base de datos.`);
      showToast("Socio eliminado por completo.", "info");
    } catch (err) {
      showToast("Error al borrar socio: " + err.message, "error");
    }
  }
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
  populateCommissionSelect('nucleo-comision', familiar ? normalizarComision(familiar.comision) : 'Ninguna'); // Ensure nucleo-comision is populated
  document.getElementById('nucleo-certificado-medico').checked = familiar ? (familiar.certificadoMedico || false) : false;
  document.getElementById('nucleo-autorizacion-menor').checked = familiar ? (familiar.autorizacionMenor || false) : false;

  // Mostrar/ocultar checkbox de autorización según edad
  toggleAutorizacionMenor('nucleo');

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
  if (input) input.value = obtenerObjetivoHorasPeriodo(periodoAdminAnio, periodoAdminMes);
  const periodoLabel = document.getElementById('config-objetivo-periodo');
  if (periodoLabel) periodoLabel.textContent = `${MESES_ADMIN[Number(periodoAdminMes)]} ${periodoAdminAnio}`;
  const toggleEl = document.getElementById('config-modo-edicion');
  if (toggleEl) toggleEl.checked = modoEdicion;
  // Siempre ocultar el campo de clave al abrir el modal
  document.getElementById('campo-clave-edicion')?.classList.add('hidden');
  const inputClave = document.getElementById('clave-modo-edicion');
  if (inputClave) inputClave.value = '';
  renderComisionesManagement();
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
  populateCommissionSelect('comision-valor', normalizarComision(valorActual)); // Ensure comision-valor is populated
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
  document.getElementById('editar-socio-certificado-medico').checked = socio.certificadoMedico || false;
  
  document.getElementById('modal-editar-socio').classList.remove('hidden');
  lucide.createIcons();
}

function closeEditarSocioModal() {
  document.getElementById('modal-editar-socio').classList.add('hidden');
}

async function saveEditedSocio() {
  const socioId = document.getElementById('editar-socio-id').value;
  const nombre = cleanText(document.getElementById('editar-socio-nombre').value);
  const fechaNacimiento = document.getElementById('editar-socio-nacimiento').value;
  const certificadoMedico = document.getElementById('editar-socio-certificado-medico').checked;

  if (!nombre || !fechaNacimiento) {
    showToast("Por favor completa todos los campos.", "error");
    return;
  }

  try {
    const updateData = { nombre, fechaNacimiento, certificadoMedico };

    if (!navigator.onLine) {
      OfflineSync.enqueue('socios', socioId, 'update', updateData);
      const idx = socios.findIndex(s => s.id === socioId);
      if (idx >= 0) Object.assign(socios[idx], updateData);
      renderSociosList();
      renderDashboard();
      renderPlanilla();
      showToast("Socio actualizado offline. Se sincronizará al tener conexión.", "info");
      closeEditarSocioModal();
      return;
    }

    await db.collection('socios').doc(socioId).update(updateData);
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
    let personaNombre = '';
    let personaTipo = '';
    let updateData = {};

    if (targetType === 'socio') {
      personaNombre = socio.nombre;
      personaTipo = 'TITULAR';
      updateData = { comision };
    } else {
      const index = parseInt(nucleoIndex);
      const nuevoNucleo = [...(socio.nucleo || [])];
      if (!nuevoNucleo[index]) return;
      personaNombre = nuevoNucleo[index].nombre;
      personaTipo = 'FAMILIAR';
      nuevoNucleo[index] = { ...nuevoNucleo[index], comision };
      updateData = { nucleo: nuevoNucleo };
    }

    if (!navigator.onLine) {
      OfflineSync.enqueue('socios', socioId, 'update', updateData);
      const idx = socios.findIndex(s => s.id === socioId);
      if (idx >= 0) Object.assign(socios[idx], updateData);
      renderSociosList();
      renderDashboard();
      renderPlanilla();
      showToast("Comisión asignada offline. Se sincronizará al tener conexión.", "info");
      registrarLog("Comisión (Offline)", `Comisión: ${comision} a ${personaNombre} (${personaTipo}) Socio ID: ${socioId}. Pendiente.`);
      closeComisionModal();
      return;
    }

    await db.collection('socios').doc(socioId).update(updateData);
    showToast(comision === 'Ninguna' ? "Asignación a comisión dada de baja." : "Asignación a comisión guardada.", "success");
    registrarLog("Gestión Comisiones", `ASIGNACIÓN - Comisión: ${comision} asignada a ${personaNombre} (${personaTipo}) del Socio ID: ${socioId}.`);
    closeComisionModal();
  } catch (err) {
    showToast("Error al guardar comisión: " + err.message, "error");
  }
}

// --- GESTIÓN DE COMISIONES ---
function populateCommissionSelect(selectElementId, selectedValue = 'Ninguna') {
  const select = document.getElementById(selectElementId);
  if (!select) return;

  select.innerHTML = ''; // Limpiar opciones existentes

  COMISIONES_VALIDAS.forEach(comision => {
    const option = document.createElement('option');
    option.value = comision;
    option.textContent = comision;
    select.appendChild(option);
  });

  // Seleccionar el valor actual o volver a 'Ninguna'
  if (COMISIONES_VALIDAS.includes(selectedValue)) {
    select.value = selectedValue;
  } else {
    select.value = 'Ninguna';
  }
}

async function addCommission() {
  if (!db) {
    showToast("La base de datos no está lista. Reintenta en un momento.", "error");
    return;
  }

  const input = document.getElementById('new-commission-name');
  if (!input) return;
  const nombreOriginal = input.value.trim();
  const nombreNormalizado = cleanText(nombreOriginal);

  if (!nombreNormalizado || nombreNormalizado === 'NINGUNA') {
    showToast("El nombre no puede estar vacío o ser 'Ninguna'.", "error");
    return;
  }

  // Validación de duplicados (Ignora mayúsculas/minúsculas y acentos usando cleanText)
  const existe = COMISIONES_VALIDAS.some(c => cleanText(c) === nombreNormalizado);
  if (existe) {
    showToast("Esta comisión ya existe (nombre duplicado).", "info");
    return;
  }

  try {
    if (!navigator.onLine) {
      OfflineSync.enqueue('comisiones', nombreNormalizado, 'set', { nombre: nombreOriginal });
      COMISIONES_VALIDAS.push(nombreOriginal);
      COMISIONES_VALIDAS.sort();
      renderComisionesManagement();
      populateCommissionSelect('socio-comision');
      populateCommissionSelect('nucleo-comision');
      showToast(`Comisión "${nombreOriginal}" añadida offline. Se sincronizará al tener conexión.`, "info");
      input.value = '';
      return;
    }
    registrarLog("Gestión Comisiones", `Nueva comisión creada: ${nombreOriginal}`);
    await db.collection('comisiones').doc(nombreNormalizado).set({ nombre: nombreOriginal });
    showToast(`Comisión "${nombreOriginal}" añadida.`, "success");
    input.value = ''; 
  } catch (err) {
    showToast("Error al añadir comisión: " + err.message, "error");
  }
}

async function deleteCommission(commissionName) {
  if (commissionName === 'Ninguna') {
    showToast("No se puede eliminar la opción por defecto.", "error");
    return;
  }

  if (await showConfirmModal("Eliminar Comisión", `¿Estás seguro de eliminar la comisión "${commissionName}"?`)) {
    try {
      if (!navigator.onLine) {
        OfflineSync.enqueue('comisiones', cleanText(commissionName), 'delete', null);
        COMISIONES_VALIDAS = COMISIONES_VALIDAS.filter(c => c !== commissionName);
        renderComisionesManagement();
        populateCommissionSelect('socio-comision');
        populateCommissionSelect('nucleo-comision');
        showToast("Comisión eliminada offline. Se sincronizará al tener conexión.", "info");
        return;
      }
      await db.collection('comisiones').doc(cleanText(commissionName)).delete();
      registrarLog("Gestión Comisiones", `Comisión eliminada: ${commissionName}`);
      showToast("Comisión eliminada.", "info");
    } catch (err) {
      showToast("Error al eliminar: " + err.message, "error");
    }
  }
}

function renderComisionesManagement() {
  const container = document.getElementById('list-comisiones-management');
  if (!container) return;

  const comisionesFiltradas = COMISIONES_VALIDAS.filter(c => c !== 'Ninguna');

  if (comisionesFiltradas.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 italic">No hay comisiones creadas. Añade una arriba.</p>`;
  } else {
    container.innerHTML = comisionesFiltradas.map(c => `
      <div class="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100">
        <span class="text-sm text-slate-700">${c}</span>
        <button type="button" onclick="deleteCommission('${c}')" class="text-red-500 hover:text-red-700 transition" title="Eliminar comisión">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    `).join('');
  }
  lucide.createIcons();
}

// --- UTILIDADES ---
function setupOfflineDetector() {
  const updateStatus = () => {
    const icon = document.getElementById('offline-icon');
    if (!icon) return;
    if (!navigator.onLine) {
      icon.classList.remove('hidden');
    } else {
      icon.classList.add('hidden');
    }
  };
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
}

async function registrarLog(accion, detalle) {
  if (!db) return;
  const user = firebase.auth().currentUser;
  const logEntry = {
    fecha: new Date().toISOString(),
    usuario: user ? (user.email || "Admin") : "Sistema",
    accion: accion,
    detalle: detalle
  };
  try {
    if (!navigator.onLine) {
      OfflineSync.enqueue('bitacora', null, 'add', logEntry);
      return;
    }
    await db.collection('bitacora').add(logEntry);
  } catch (e) { console.error("Error bitácora:", e); }
}

function cleanText(text) {
  return (text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

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
  if (!ingreso || !salida) return 0;
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
  csvContent += "Socio,Nº Socio,Edad,Horas Objetivo,Horas Computables,Saldo del Mes,Deuda Anterior,Remanente Anterior,Comprometidas,Total Crédito,Remanente Final,Deuda Final,Tesorería Antes,A Tesorería al Cierre,Observaciones\n";

  sociosOrdenados.forEach(s => {
    const fechaNac = new Date(s.fechaNacimiento);
    const hoy = new Date();
    const edad = hoy.getFullYear() - fechaNac.getFullYear() - (hoy.getMonth() < fechaNac.getMonth() || (hoy.getMonth() === fechaNac.getMonth() && hoy.getDate() < fechaNac.getDate()) ? 1 : 0);
    
    const exonerado = esNucleoExonerado(s);
    const objetivo = obtenerObjetivoHorasSocio(s, anio, mes);
    const comisionAsignada = obtenerComisionAsignadaNucleo(s);
    const hist = obtenerSaldoHistoricoAlMes(s.id, anio, mes);
    const resHoras = obtenerResultadoHorasSocio(s, anio, mes);

    const periodoEsLicencia = esPeriodoLicencia(anio, mes);
    const comprometidas = objetivo + hist.deudaAnterior;
    let saldoDelMes = objetivo - resHoras.computables;
    let totalCredito = resHoras.computables + hist.remanenteAnterior;

    let remanenteFinal = 0;
    let deudaFinal = 0;
    let pasajeProyectadoTesoreria = 0;

    if (periodoEsLicencia) {
      saldoDelMes = 0;
      totalCredito = hist.remanenteAnterior;
      remanenteFinal = hist.remanenteAnterior || 0;
      deudaFinal = hist.deudaAnterior || 0;
    } else if (totalCredito >= comprometidas) {
      remanenteFinal = totalCredito - comprometidas;
    } else {
      deudaFinal = comprometidas - totalCredito;
      const saldoTrasObjetivo = Math.max(0, totalCredito - objetivo);
      pasajeProyectadoTesoreria = Math.max(0, hist.deudaAnterior - saldoTrasObjetivo);
      // El saldo visible conserva toda la deuda pendiente; el pasaje proyectado se aplica al cerrar.
    }

    let obs = [];
    if (periodoEsLicencia) obs.push("Licencia: se cobra Tesorería y se pausa A Recuperar");
    if (hist.tesoreriaPendiente > 0) obs.push(`A Tesorería este mes: ${formatHours(hist.tesoreriaPendiente)}`);
    if (pasajeProyectadoTesoreria > 0) obs.push(`A Tesorería al cierre: ${formatHours(pasajeProyectadoTesoreria)}`);
    if (exonerado) {
      if (s.certificadoMedico) {
        obs.push("Exonerado por certificado médico");
      } else {
        obs.push("Exonerado por edad");
      }
    }
    if (!exonerado && comisionAsignada) obs.push(`Objetivo cubierto por comisión: ${comisionAsignada} (${objetivo} hs)`);
    if (s.comision !== 'Ninguna') obs.push(`Titular en comisión: ${s.comision}`);

    if (resHoras.horasResto > 0 && !resHoras.cubiertasPorComision) {
      obs.push(resHoras.perdidas ? `Perdió ${resHoras.horasResto} hs (menor a 4 hs)` : `Resto ${resHoras.horasResto} hs no computables`);
    }

    const observacionesStr = obs.join("; ");
    const aTesoreriaCierreCSV = hist.cerrado
      ? hist.tesoreriaCobradaEnPeriodo
      : pasajeProyectadoTesoreria;

    csvContent += `"${s.nombre}","${s.id}","${edad}","${objetivo}","${resHoras.computables.toFixed(2)}","${saldoDelMes.toFixed(2)}","${hist.deudaAnterior.toFixed(2)}","${hist.remanenteAnterior.toFixed(2)}","${comprometidas.toFixed(2)}","${totalCredito.toFixed(2)}","${remanenteFinal.toFixed(2)}","${deudaFinal.toFixed(2)}","${hist.tesoreriaAcumulada.toFixed(2)}","${aTesoreriaCierreCSV.toFixed(2)}","${observacionesStr}"\n`;
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

/**
 * Genera un PDF optimizado para impresión A4 con los datos de la planilla mensual.
 */
function exportPlanillaPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');

  const anio = document.getElementById('planilla-anio').value;
  const mesNum = document.getElementById('planilla-mes').value;
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const mesNombre = meses[parseInt(mesNum) - 1];

  if (socios.length === 0) {
    showToast("No hay socios para exportar.", "info");
    return;
  }

  // Ordenar socios por ID numérico
  const sociosOrdenados = [...socios].sort((a, b) => {
    const numA = parseInt(a.id, 10);
    const numB = parseInt(b.id, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a.id).localeCompare(String(b.id));
  });

  const tableData = sociosOrdenados.map(s => {
    const objetivo = obtenerObjetivoHorasSocio(s, anio, mes);
    const hist = obtenerSaldoHistoricoAlMes(s.id, anio, mesNum);
    const resHoras = obtenerResultadoHorasSocio(s, anio, mesNum);
    const comisionAsignada = obtenerComisionAsignadaNucleo(s);
    const exonerado = esNucleoExonerado(s); // Check if the entire nucleus is exempt

    // Calculations for the current month's display
    const comprometidas = objetivo + hist.deudaAnterior; // Total hours to cover (objective + previous debt)
    const saldoDelMes = resHoras.computables - objetivo; // Balance for the current month's objective
    const totalCredito = resHoras.computables + hist.remanenteAnterior; // Total available credit (current work + previous surplus)

    let remanenteFinal = 0;
    let deudaFinal = 0;
    let pasajeATesoreriaCalculado = 0;
    const periodoEsLicencia = esPeriodoLicencia(anio, mesNum);

    if (periodoEsLicencia) {
      remanenteFinal = hist.remanenteAnterior || 0;
      deudaFinal = hist.deudaAnterior || 0;
      pasajeATesoreriaCalculado = 0;
    } else if (totalCredito >= comprometidas) {
      remanenteFinal = totalCredito - comprometidas;
    } else {
      deudaFinal = comprometidas - totalCredito;
      const saldoTrasMesCorriente = Math.max(0, totalCredito - objetivo);
      if (saldoTrasMesCorriente < hist.deudaAnterior) {
        pasajeATesoreriaCalculado = hist.deudaAnterior - saldoTrasMesCorriente;
        // El PDF muestra la deuda pendiente actual completa; el pasaje se concreta al cerrar.
      }
    }

    // Round all hour values to integers for display
    const saldoAnt = Math.round(hist.remanenteAnterior - hist.deudaAnterior);
    const comprometidasRounded = Math.round(comprometidas);
    const resHorasComputablesRounded = Math.round(resHoras.computables);
    const saldoDelMesRounded = Math.round(saldoDelMes);
    const saldoTot = Math.round(remanenteFinal - deudaFinal);
    const deudaAnteriorRounded = Math.round(hist.deudaAnterior);
    const pasajeATesoreriaRounded = Math.round(hist.cerrado
      ? hist.tesoreriaPasadaEnCierre
      : pasajeATesoreriaCalculado);
    const deudaGeneradaEsteMesRounded = (saldoDelMesRounded < 0) ? Math.abs(saldoDelMesRounded) : 0;

    // Observaciones abreviadas para ahorrar espacio
    let obs = [];
    if (periodoEsLicencia) obs.push("Licencia: A Recuperar pasa al mes siguiente");
    const cobradoEnPeriodo = hist.cerrado ? hist.tesoreriaCobradaEnPeriodo : hist.tesoreriaPendiente;
    if (cobradoEnPeriodo > 0) obs.push(`Tesorería imputada al cierre: ${formatHours(Math.round(cobradoEnPeriodo))}`);
    if (exonerado) obs.push(s.certificadoMedico ? "Exon.Méd." : "Exon.Edad");
    if (!exonerado && comisionAsignada) obs.push(`Com: ${comisionAsignada.split(' ').pop()}`);

    if (resHoras.horasResto > 0 && !comisionAsignada) {
      obs.push(resHoras.perdidas ? `Pérd. Total ${resHoras.horasResto}h` : `Resto -${resHoras.horasResto}h`);
    }

    // New observation logic based on user requirements
    if (deudaAnteriorRounded > 0 && pasajeATesoreriaRounded > 0) {
      if (deudaGeneradaEsteMesRounded > 0) {
        obs.push(`A Tesoreria ${formatHours(pasajeATesoreriaRounded)} A Recuperar ${formatHours(deudaGeneradaEsteMesRounded)}`);
      } else {
        obs.push(`A Tesoreria ${formatHours(pasajeATesoreriaRounded)}`);
      }
    } else if (deudaAnteriorRounded === 0 && deudaGeneradaEsteMesRounded > 0) {
      obs.push(`A Recuperar ${formatHours(deudaGeneradaEsteMesRounded)}`);
    }

    return [
      s.id,
      s.nombre.length > 22 ? s.nombre.substring(0, 20) + ".." : s.nombre,
      saldoAnt,
      formatHours(comprometidasRounded),
      formatHours(resHorasComputablesRounded),
      formatHours(saldoDelMesRounded),
      formatHours(saldoTot),
      obs.join(" | ").replace(/Hs/g, 'Hs') // Ensure 'Hs' is consistent
    ];
  });

  // Encabezados de columna abreviados
  const head = [['ID', 'Nombre', 'S. Ant.', 'H. Compr.', 'H. Real.', 'S. Mes', 'S. Tot.', 'Observaciones']];

  doc.autoTable({
    head: head,
    body: tableData,
    startY: 25,
    theme: 'grid',
    styles: {
      fontSize: 7.5, // Tamaño reducido para que entren más filas
      cellPadding: 1.2,
      valign: 'middle'
    },
    headStyles: {
      fillColor: [5, 150, 105], // Color brand-600
      halign: 'center'
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 42 },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 15, halign: 'center' },
      4: { cellWidth: 15, halign: 'center' },
      5: { cellWidth: 15, halign: 'center' },
      6: { cellWidth: 15, halign: 'center' },
      7: { cellWidth: 'auto' }
    },
    margin: { top: 25, bottom: 15 },
    didDrawPage: function (data) {
      // Encabezado en cada página
      const logo = document.getElementById('logo-coop');
      let headerX = data.settings.margin.left;
      // Verificamos que el logo esté cargado para evitar errores de jsPDF
      if (logo && logo.complete && logo.naturalWidth !== 0) {
        try { doc.addImage(logo, 'PNG', headerX, 8, 12, 12); headerX += 15; } catch(e) { console.error("Error al añadir logo al PDF:", e); }
      }
      doc.setFontSize(11);
      doc.setTextColor(40);
      doc.setFont(undefined, 'bold');
      doc.text(`COVIMT 9 - Estado de horas de ${mesNombre} de ${anio}`, headerX, 15);
      doc.setFontSize(9);
      doc.text(`Página ${data.pageNumber}`, 180, 15);
    }
  });

  doc.save(`COVIMT9_Estado_Horas_${mesNum}_${anio}.pdf`);
  showToast("Planilla PDF generada correctamente.", "success");
}

/**
 * Genera un PDF específico para Tesorería con los socios que tuvieron pasaje de horas a tesorería en el mes.
 * Muestra las horas de deuda anterior que no pudieron ser cubiertas/recuperadas.
 */
function exportReporteTesoreriaPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const anio = document.getElementById('planilla-anio').value;
  const mesNum = document.getElementById('planilla-mes').value;
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const mesNombre = meses[parseInt(mesNum) - 1];

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

  const tableData = [];
  let totalCobradoAntes = 0;
  let totalCobradoMes = 0;

  sociosOrdenados.forEach(socio => {
    const hist = obtenerSaldoHistoricoAlMes(socio.id, anio, mesNum);
    const aRecuperar = hist.deudaAnterior || 0;
    const cobradoAntes = hist.tesoreriaAcumulada || 0;
    const cobradoEsteMes = hist.cerrado
      ? (hist.tesoreriaCobradaEnPeriodo || 0)
      : (hist.tesoreriaPendiente || 0); // compatibilidad mientras el período sigue abierto
    const totalTesoreria = hist.cerrado
      ? (hist.tesoreriaAcumuladaAlCierre || 0)
      : cobradoAntes + cobradoEsteMes;

    // Mostrar tanto socios con Tesorería como quienes conservan horas A Recuperar.
    if (aRecuperar <= 0 && totalTesoreria <= 0) return;
    totalCobradoAntes += cobradoAntes;
    totalCobradoMes += cobradoEsteMes;
    tableData.push([
      socio.id,
      socio.nombre,
      formatHours(Math.round(aRecuperar)),
      formatHours(Math.round(cobradoAntes)),
      formatHours(Math.round(cobradoEsteMes)),
      formatHours(Math.round(totalTesoreria))
    ]);
  });

  if (tableData.length === 0) {
    showToast(`No hay movimientos de Tesorería ni horas A Recuperar en ${mesNombre} ${anio}.`, "info");
    return;
  }

  const logo = document.getElementById('logo-coop');
  if (logo && logo.complete && logo.naturalWidth !== 0) {
    try { doc.addImage(logo, 'PNG', 20, 12, 15, 15); } catch(e) { console.error(e); }
  }
  doc.setFontSize(16);
  doc.setTextColor(5, 150, 105);
  doc.text("COVIMT 9 - Estado de Tesorería", 105, 20, { align: 'center' });
  doc.setFontSize(12);
  doc.setTextColor(40);
  doc.text(`${mesNombre} ${anio}`, 105, 28, { align: 'center' });

  doc.autoTable({
    head: [['ID', 'Socio Titular', 'A Recuperar', 'Cobrado antes', 'Cobrado este mes', 'Tesorería acumulada']],
    body: tableData,
    startY: 35,
    theme: 'grid',
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [5, 150, 105] },
    columnStyles: {
      0: { cellWidth: 13, halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'center', fontStyle: 'bold' },
      5: { halign: 'center', fontStyle: 'bold' }
    },
    margin: { top: 30 }
  });

  const finalY = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(9.5);
  doc.setFont(undefined, 'bold');
  doc.text(`Total cobrado antes del período: ${formatHours(Math.round(totalCobradoAntes))}`, 20, finalY);
  doc.text(`Total cobrado durante el período: ${formatHours(Math.round(totalCobradoMes))}`, 20, finalY + 6);
  doc.text(`Tesorería acumulada total: ${formatHours(Math.round(totalCobradoAntes + totalCobradoMes))}`, 20, finalY + 12);

  doc.save(`COVIMT9_Tesoreria_${mesNum}_${anio}.pdf`);
  showToast("Estado de Tesorería generado correctamente.", "success");
}

/**
 * Genera un PDF resumen para la cooperativa con todas las jornadas finalizadas de una fecha específica.
 */
function openReporteJornadaModal() {
  if (!modoEdicion) return;
  const fechaInput = document.getElementById('reporte-jornada-modal-fecha');
  if (fechaInput) fechaInput.value = new Date().toISOString().split('T')[0];
  ocultarAlertaReporteJornada();
  document.getElementById('modal-reporte-jornada')?.classList.remove('hidden');
  lucide.createIcons();
  fechaInput?.focus();
}

function closeReporteJornadaModal() {
  document.getElementById('modal-reporte-jornada')?.classList.add('hidden');
  ocultarAlertaReporteJornada();
}

function ocultarAlertaReporteJornada() {
  document.getElementById('alerta-reporte-jornada')?.classList.add('hidden');
}

function mostrarAlertaReporteJornada(fechaReporte) {
  const alerta = document.getElementById('alerta-reporte-jornada');
  const texto = document.getElementById('texto-alerta-reporte-jornada');
  if (texto) texto.textContent = `No hay socios que hayan trabajado en la jornada del ${formatDateString(fechaReporte)}.`;
  alerta?.classList.remove('hidden');
  lucide.createIcons();
}

/**
 * Redondea una hora para la planilla con la misma regla usada al fichar:
 * hasta 15 minutos baja a la hora exacta y desde 45 sube a la siguiente.
 */
function redondearHoraParaPlanilla(hora) {
  if (!hora || !/^\d{1,2}:\d{2}$/.test(hora)) return hora || '-';
  let [h, m] = hora.split(':').map(Number);
  if (m <= 15) m = 0;
  else if (m >= 45) {
    h = (h + 1) % 24;
    m = 0;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function generarPDFJornadaSeleccionada() {
  const fechaReporte = document.getElementById('reporte-jornada-modal-fecha')?.value;
  if (!fechaReporte) {
    showToast("Por favor, selecciona una fecha para el reporte.", "error");
    return;
  }
  ocultarAlertaReporteJornada();
  const generado = generarReporteJornadaPDF(fechaReporte, true);
  if (generado) closeReporteJornadaModal();
}

/**
 * Genera la planilla con las jornadas finalizadas (las que poseen egreso y firma).
 * Devuelve true cuando el archivo fue generado.
 */
function generarReporteJornadaPDF(fechaReporte, mostrarAlertaEnModal = false) {
  const jornadasDelDia = registros
    .filter(r => r.fecha === fechaReporte && r.estado === 'finalizado')
    .slice();

  if (jornadasDelDia.length === 0) {
    if (mostrarAlertaEnModal) mostrarAlertaReporteJornada(fechaReporte);
    else showToast(`No hay socios que hayan trabajado en la jornada del ${formatDateString(fechaReporte)}.`, "info");
    return false;
  }

  jornadasDelDia.sort((a, b) => {
    const numA = parseInt(a.socioId, 10);
    const numB = parseInt(b.socioId, 10);
    if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
    return String(a.socioId).localeCompare(String(b.socioId)) ||
      String(a.trabajadorNombre).localeCompare(String(b.trabajadorNombre));
  });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const logo = document.getElementById('logo-coop');
  if (logo && logo.complete && logo.naturalWidth !== 0) {
    try { doc.addImage(logo, 'PNG', 20, 12, 15, 15); } catch (e) { console.error(e); }
  }

  doc.setFontSize(16);
  doc.setTextColor(5, 150, 105);
  doc.text("COOPERATIVA DE VIVIENDA COVIMT 9", 105, 20, { align: 'center' });
  doc.setFontSize(14);
  doc.setTextColor(40, 40, 40);
  doc.text(`Jornada de trabajo - ${formatDateString(fechaReporte)}`, 105, 30, { align: 'center' });
  doc.setDrawColor(200, 200, 200);
  doc.line(20, 35, 190, 35);

  const tableRows = jornadasDelDia.map(r => [
    String(r.socioId || ''),
    r.trabajadorNombre || '',
    redondearHoraParaPlanilla(r.horaIngreso),
    redondearHoraParaPlanilla(r.horaSalida),
    `${getRoundedHours(r.horaIngreso, r.horaSalida).toFixed(2)} hs`,
    { content: '', signature: r.firma || '' }
  ]);

  doc.autoTable({
    head: [["Nº socio", "Nombre del trabajador", "Hora de entrada", "Hora de salida", "Horas trabajadas", "Firma del trabajador"]],
    body: tableRows,
    startY: 42,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.5, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [5, 150, 105], textColor: 255, halign: 'center', fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 16, halign: 'center' },
      1: { cellWidth: 43 },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 22, halign: 'center' },
      4: { cellWidth: 24, halign: 'center' },
      5: { cellWidth: 43, halign: 'center', minCellHeight: 13 }
    },
    didDrawCell(data) {
      if (data.column.index === 5 && data.cell.section === 'body' && data.cell.raw.signature) {
        try {
          const imgWidth = 28;
          const imgHeight = 9;
          const x = data.cell.x + (data.cell.width - imgWidth) / 2;
          const y = data.cell.y + (data.cell.height - imgHeight) / 2;
          doc.addImage(data.cell.raw.signature, 'PNG', x, y, imgWidth, imgHeight);
        } catch (e) { console.error('No se pudo agregar una firma al PDF:', e); }
      }
    },
    didDrawPage(data) {
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`Fecha de trabajo: ${formatDateString(fechaReporte)}`, 20, doc.internal.pageSize.height - 10);
      doc.text(`Página ${data.pageNumber}`, doc.internal.pageSize.width - 35, doc.internal.pageSize.height - 10);
    },
    margin: { top: 20, bottom: 18 }
  });

  // Firmas de los responsables al final de la nómina de trabajadores.
  // Si hubo más de un responsable en la fecha, se incluye una firma por cada uno.
  const responsables = [];
  jornadasDelDia.filter(r => r.firmaResponsable).forEach(r => {
    const nombre = (r.responsable || 'Responsable sin nombre').trim();
    const existente = responsables.find(item => item.nombre.toLocaleLowerCase() === nombre.toLocaleLowerCase());
    if (!existente) responsables.push({ nombre, firma: r.firmaResponsable });
  });
  // Compatibilidad con jornadas antiguas que todavía no poseen firma del responsable.
  if (responsables.length === 0) {
    const ultimoRegistro = jornadasDelDia[jornadasDelDia.length - 1];
    responsables.push({
      nombre: (ultimoRegistro.responsable || 'Responsable sin nombre').trim(),
      firma: ''
    });
  }

  let firmaY = doc.lastAutoTable.finalY + 12;
  const altoBloqueResponsable = 34;
  const limitePagina = doc.internal.pageSize.height - 18;
  const centroFirmaX = doc.internal.pageSize.width / 2;
  const anchoFirma = 50;
  const altoFirma = 16;
  const anchoLinea = 62;

  responsables.forEach(responsable => {
    if (firmaY + altoBloqueResponsable > limitePagina) {
      doc.addPage();
      firmaY = 20;
    }

    // Firma centrada, línea debajo y nombre del encargado bajo la línea.
    if (responsable.firma) {
      try {
        doc.addImage(
          responsable.firma,
          'PNG',
          centroFirmaX - (anchoFirma / 2),
          firmaY,
          anchoFirma,
          altoFirma
        );
      } catch (e) {
        console.error('No se pudo agregar la firma del responsable al PDF:', e);
      }
    }

    const lineaY = firmaY + altoFirma + 2;
    doc.setDrawColor(60, 60, 60);
    doc.line(
      centroFirmaX - (anchoLinea / 2),
      lineaY,
      centroFirmaX + (anchoLinea / 2),
      lineaY
    );
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(responsable.nombre, centroFirmaX, lineaY + 6, { align: 'center' });

    firmaY += altoBloqueResponsable;
  });

  doc.save(`Jornada_COVIMT9_${fechaReporte}.pdf`);
  showToast("PDF de la jornada generado correctamente.", "success");
  return true;
}

/**
 * Genera un PDF individual para una jornada finalizada con todos los detalles y firma.
 */
function descargarPDFJornada(recordId) {
  const reg = registros.find(r => r.id === recordId);
  if (!reg || !reg.firma) {
    showToast("No se encontró el registro o la firma para generar el PDF.", "error");
    return;
  }
  const socio = socios.find(s => s.id === reg.socioId) || { nombre: 'Desconocido' };
  
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');

  const logo = document.getElementById('logo-coop');
  if (logo && logo.complete && logo.naturalWidth !== 0) {
    try { doc.addImage(logo, 'PNG', 20, 12, 15, 15); } catch(e) { console.error(e); }
  }

  // Encabezado descriptivo
  doc.setFontSize(18);
  doc.setTextColor(5, 150, 105); // Color brand-600
  doc.text("COOPERATIVA DE VIVIENDA COVIMT 9", 105, 20, { align: 'center' });
  
  doc.setFontSize(14);
  doc.setTextColor(40, 40, 40);
  doc.text("Comprobante de Asistencia a Obra", 105, 30, { align: 'center' });

  doc.setDrawColor(200, 200, 200);
  doc.line(20, 35, 190, 35);

  // Datos de la Jornada
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text("INFORMACIÓN DEL SOCIO", 20, 45);
  doc.setFont(undefined, 'normal');
  doc.text(`Número de Socio: ${reg.socioId}`, 25, 53);
  doc.text(`Socio Titular: ${socio.nombre}`, 25, 61);

  doc.setFont(undefined, 'bold');
  doc.text("DETALLES DEL TRABAJO", 20, 75);
  doc.setFont(undefined, 'normal');
  doc.text(`Persona que trabajó: ${reg.trabajadorNombre}`, 25, 83);
  doc.text(`Fecha: ${formatDateString(reg.fecha)}`, 25, 91);
  doc.text(`Hora Entrada: ${reg.horaIngreso} Hs`, 25, 99);
  doc.text(`Hora Salida: ${reg.horaSalida} Hs`, 25, 107);
  doc.text(`Total Horas Realizadas: ${getRoundedHours(reg.horaIngreso, reg.horaSalida).toFixed(2)} Hs`, 25, 115);
  doc.text(`Tarea Realizada: ${reg.tarea}`, 25, 123);

  // Firma
  doc.setFont(undefined, 'bold');
  doc.text("FIRMA DIGITAL DE CONFORMIDAD", 105, 140, { align: 'center' });
  doc.addImage(reg.firma, 'PNG', 75, 145, 60, 25);

  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text(`Documento oficial generado el ${new Date().toLocaleString()}`, 20, 285);

  doc.save(`Comprobante_Jornada_${reg.socioId}_${reg.fecha}.pdf`);
  showToast("PDF de jornada generado con éxito.", "success");
}

function showConfirmModal(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-confirmation');
    document.getElementById('conf-modal-title').textContent = title;
    document.getElementById('conf-modal-message').textContent = message;
    
    const btnConfirm = document.getElementById('btn-conf-modal-confirm');
    const btnCancel = document.getElementById('btn-conf-modal-cancel');
    
    const onConfirm = () => {
      modal.classList.add('hidden');
      cleanup();
      resolve(true);
    };
    const onCancel = () => {
      modal.classList.add('hidden');
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      btnConfirm.removeEventListener('click', onConfirm);
      btnCancel.removeEventListener('click', onCancel);
    };
    
    btnConfirm.addEventListener('click', onConfirm, { once: true });
    btnCancel.addEventListener('click', onCancel, { once: true });
    modal.classList.remove('hidden');
  });
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Centrar el contenedor tanto horizontal como verticalmente en la pantalla
  container.className = "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10000] flex flex-col items-center gap-3 pointer-events-none w-full max-w-sm";

  const toast = document.createElement('div');
  toast.className = `flex items-center justify-center gap-3 p-4 rounded-xl shadow-lg border text-sm transition-all duration-300 transform scale-90 opacity-0 select-none pointer-events-auto w-fit mx-auto ${
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

  setTimeout(() => toast.classList.remove('scale-90', 'opacity-0'), 10);
  setTimeout(() => {
    toast.classList.add('opacity-0', 'scale-95');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================================
//  FUNCIONES DE SINCRONIZACIÓN OFFLINE (UI)
// ============================================================

function openSyncModal() {
  const modal = document.getElementById('modal-sync-detail');
  const list = document.getElementById('sync-queue-list');
  if (!modal || !list) return;

  const queue = OfflineSync.getQueue();
  
  if (queue.length === 0) {
    list.innerHTML = '<p class="text-center text-slate-400 py-6">No hay operaciones pendientes.</p>';
  } else {
    const opLabels = {
      'set': { label: 'Crear/Reemplazar', color: 'bg-emerald-100 text-emerald-800' },
      'update': { label: 'Actualizar', color: 'bg-blue-100 text-blue-800' },
      'merge': { label: 'Actualizar (merge)', color: 'bg-blue-100 text-blue-800' },
      'delete': { label: 'Eliminar', color: 'bg-red-100 text-red-800' },
      'add': { label: 'Añadir', color: 'bg-purple-100 text-purple-800' }
    };

    list.innerHTML = queue.map((op, i) => {
      const opInfo = opLabels[op.operation] || { label: op.operation, color: 'bg-slate-100 text-slate-800' };
      const fecha = new Date(op.timestamp).toLocaleString();
      return `
        <div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-mono text-slate-400">#${i + 1}</span>
              <span class="px-2 py-0.5 rounded font-bold text-[10px] ${opInfo.color}">${opInfo.label}</span>
              <span class="font-semibold text-slate-700">${op.collection}${op.docId ? '/' + op.docId : ''}</span>
            </div>
            <div class="text-[10px] text-slate-400">${fecha}</div>
          </div>
          <button onclick="OfflineSync.removeOp('${op.id}'); openSyncModal();" class="text-red-400 hover:text-red-600 transition p-1" title="Descartar esta operación">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
      `;
    }).join('');
  }

  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeSyncModal() {
  document.getElementById('modal-sync-detail')?.classList.add('hidden');
}

async function handleSyncNow() {
  if (!navigator.onLine) {
    showToast('Sin conexión a internet.', 'error');
    return;
  }
  if (!db) {
    showToast('Base de datos no inicializada.', 'error');
    return;
  }

  const progressEl = document.getElementById('sync-progress-text');
  if (progressEl) {
    progressEl.classList.remove('hidden');
    progressEl.textContent = 'Sincronizando...';
  }

  await OfflineSync.syncAll(db);

  if (progressEl) {
    progressEl.classList.add('hidden');
  }
}

async function handleClearQueue() {
  if (await showConfirmModal('Descartar Operaciones', '¿Estás seguro de descartar TODAS las operaciones pendientes? Los cambios guardados localmente se perderán permanentemente.')) {
    OfflineSync.clearQueue();
    closeSyncModal();
    showToast('Cola de operaciones descartada.', 'info');
  }
}

// ============================================================
//  PIN DE ACCESO AL PORTAL DE SOCIOS
// ============================================================

async function hashPIN(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function generarPIN() {
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const input = document.getElementById('socio-pin');
  if (input) {
    input.value = pin;
    input.type = 'text'; // Mostrar temporalmente
    setTimeout(() => { input.type = 'password'; }, 3000);
  }
  showToast(`PIN generado: ${pin} (visible 3 segundos)`, 'info');
}

async function openCambiarPINModal(socioId) {
  const socio = socios.find(s => s.id === socioId);
  if (!socio) return;

  const nuevoPin = prompt(`Cambiar PIN de acceso para ${socio.nombre} (ID: ${socioId})\n\nIngresá un nuevo PIN de 4 dígitos:`);
  if (!nuevoPin) return;

  if (!/^\d{4}$/.test(nuevoPin)) {
    showToast('El PIN debe tener exactamente 4 dígitos numéricos.', 'error');
    return;
  }

  try {
    const pinHash = await hashPIN(nuevoPin);

    if (!navigator.onLine) {
      OfflineSync.enqueue('socios', socioId, 'update', { pinHash });
      showToast('PIN actualizado offline. Se sincronizará al tener conexión.', 'info');
      return;
    }

    await db.collection('socios').doc(socioId).update({ pinHash });
    showToast(`PIN actualizado para ${socio.nombre}. Nuevo PIN: ${nuevoPin}`, 'success');
    registrarLog("Cambio PIN Socio", `PIN actualizado para Socio ID: ${socioId} (${socio.nombre}).`);
  } catch (err) {
    showToast('Error al actualizar PIN: ' + err.message, 'error');
  }
}

// ============================================================
//  AUTORIZACIÓN DE MENORES (16-17 AÑOS)
// ============================================================

function esMenorRequiereAutorizacion(fechaNacStr) {
  if (!fechaNacStr) return false;
  const edad = calcularEdad(fechaNacStr);
  return edad >= 16 && edad < 18;
}

function toggleAutorizacionMenor(prefix) {
  const fechaInput = document.getElementById(`${prefix}-nacimiento`);
  const container = document.getElementById(`${prefix}-autorizacion-menor-container`);
  if (!fechaInput || !container) return;

  if (esMenorRequiereAutorizacion(fechaInput.value)) {
    container.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
    document.getElementById(`${prefix}-autorizacion-menor`).checked = false;
  }
}

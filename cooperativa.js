// --- CONFIGURACIÓN E INICIALIZACIÓN ---
let db = null;
let socios = [];
let registros = [];
let config = { objetivoHoras: 40 };
let saldosHistoricos = {};
let modoEdicion = false; // Variable para controlar el modo edición
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
  checkAuthAndInit();

  // Asignar manejadores de eventos a los botones para evitar ReferenceError por 'defer'
  document.getElementById('btn-descargar-pdf')?.addEventListener('click', exportPlanillaPDF);
  document.getElementById('btn-reporte-tesoreria')?.addEventListener('click', exportReporteTesoreriaPDF);
  document.getElementById('btn-generar-reporte-diario-pdf')?.addEventListener('click', generarReporteDiarioPDF);
  document.getElementById('btn-cerrar-mes')?.addEventListener('click', simularCierreMensual);
  document.getElementById('btn-reabrir-mes')?.addEventListener('click', reabrirMes);
  document.getElementById('btn-descargar-csv')?.addEventListener('click', exportPlanillaCSV);
  populateCommissionSelect('socio-comision'); // Populate initial socio commission select

  // Listener para actualizar horas redondeadas en tiempo real en el modal
  document.getElementById('egreso-hora')?.addEventListener('input', updateRoundedHoursDisplay);
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

  // Forzamos persistencia de SESIÓN. Al cerrar el navegador/pestaña, se pierde el login.
  // Esto evita entrar automáticamente sin credenciales tras haber cerrado la sesión anterior.
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(err => console.error(err));

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

  // 5. Escuchar Comisiones
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

  if (socios.some(s => s.id === id)) {
    showToast("ID de socio ya se encuentra registrado.", "error");
    return;
  }

  try {
    await db.collection('socios').doc(id).set({
      id,
      // ... (other fields)
      nombre,
      fechaAlta,
      fechaBaja: null,
      fechaNacimiento,
      comision,
      certificadoMedico,
      nucleo: [],
      historialTitulares: [{
        nombre,
        fechaNacimiento,
        comision,
        certificadoMedico,
        desde: fechaAlta,
        hasta: null
      }]
    });
    showToast("Socio titular guardado.", "success");
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
  const targetDate = new Date(targetDateStr);
  const fechaAlta = new Date(socio.fechaAlta);
  const fechaBaja = socio.fechaBaja ? new Date(socio.fechaBaja) : null;

  // Verificar si el socio existe/está activo en esa fecha
  if (targetDate < fechaAlta) return null;
  if (fechaBaja && targetDate >= fechaBaja) return null;

  // Buscar quién era titular en esa fecha en el historial
  const snapshot = socio.historialTitulares.find(h => {
    const desde = new Date(h.desde);
    const hasta = h.hasta ? new Date(h.hasta) : null;
    return targetDate >= desde && (!hasta || targetDate < hasta);
  });

  return snapshot || socio; // Fallback al socio actual si no hay historial (legacy)
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
      await db.collection('socios').doc(socioId).update({ fechaBaja: fechaEfectiva });
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

      await db.collection('socios').doc(socioId).update({
        nombre: nuevoTitularData.nombre,
        fechaNacimiento: nuevoTitularData.fechaNacimiento,
        comision: nuevoTitularData.comision, // Actualizar la comisión del socio principal
        certificadoMedico: nuevoTitularData.certificadoMedico, // Actualizar el certificado médico del socio principal
        nucleo: nuevoNucleo, // Actualizar el núcleo familiar
        historialTitulares: historial
      });
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
  const socioId = document.getElementById('ingreso-socio-filtered').value; // Ahora toma el ID del nuevo select
  const trabajadorNombre = document.getElementById('ingreso-trabajador').value;
  const fecha = document.getElementById('ingreso-fecha').value;
  const responsable = document.getElementById('ingreso-responsable').value.trim();
  const horaIngresoRaw = document.getElementById('ingreso-hora').value;
  const tarea = document.getElementById('ingreso-tarea').value.trim();

  if (!trabajadorNombre) {
    showToast("No se seleccionó un trabajador habilitado.", "error");
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

  const id = 'reg-' + Date.now();
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

  try {
    await db.collection('registros').doc(id).set(nuevoIngreso);
    showToast("Ingreso marcado.", "success");
    
    // Reiniciar formulario manteniendo al responsable
    const currentResp = document.getElementById('ingreso-responsable').value;
    document.getElementById('form-ingreso').reset();
    document.getElementById('ingreso-responsable').value = currentResp;
    setupAsistenciaForms();
  } catch (err) {
    showToast("Error al registrar ingreso: " + err.message, "error");
  }
}

async function submitEgresoWithSignature() {
  const id = document.getElementById('egreso-registro-id').value;
  const horaSalida = document.getElementById('egreso-hora').value;

  const reg = registros.find(r => r.id === id);
  if (reg) {
    const calculated = getRoundedHours(reg.horaIngreso, horaSalida);
    
    if (calculated === 0) {
      if (await showConfirmModal("Jornada de 0.00 hs", "Esta jornada no alcanzó el mínimo computable de 1:45h. ¿Deseas ELIMINAR el ingreso? Si cancelas, la jornada seguirá activa para completar más horas.")) {
        try {
          registrarLog("Eliminación Ingreso", `CANCELACIÓN - Jornada ID: ${id} de ${reg.trabajadorNombre} (Socio: ${reg.socioId}) eliminada por tiempo insuficiente (0.00 hs).`);
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

    if (isCanvasBlank()) {
      showToast("Es obligatorio firmar.", "error");
      return;
    }
    const firma = signatureCanvas.toDataURL();

    try {
      await db.collection('registros').doc(id).update({
        horaSalida,
        horasTrabajadas: calculated,
        firma,
        estado: 'finalizado'
      });
      showToast(`Egreso registrado: ${calculated} hs guardadas.`, "success");
      registrarLog("Egreso Jornada", `FIN - Trabajador: ${reg.trabajadorNombre} (Socio: ${reg.socioId}). Salida: ${horaSalida}hs. Total computado: ${calculated} hs.`);
      closeEgresoModal();
    } catch (err) {
      showToast("Error al registrar egreso: " + err.message, "error");
    }
  }
}

async function deleteRecord(recordId) {
  if (await showConfirmModal("Eliminar Jornada", "¿Deseas borrar permanentemente este registro de trabajo?")) {
    try {
      registrarLog("Eliminación Registro", `Jornada ID: ${recordId} borrada manualmente.`);
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
      registrarLog("Acceso Administrador", `Meta: ${obj} hs. Modo Edición: ${modoEdicion}.`);
      showToast(modoEdicion ? 'Configuración guardada. Modo Edición activado.' : 'Configuración guardada. Modo Edición desactivado.', 'success');
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

    resultado.push({
      socio: {
        id,
        nombre,
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
    registrarLog("Cierre Mensual", `CIERRE DE PERÍODO: ${mes}/${anio}. Se generaron los saldos y arrastres para ${sigMesStr}/${sigAnioStr}.`);
    showToast(`Cierre procesado. Período ${sigMesStr}/${sigAnioStr} habilitado.`, "success");
    document.getElementById('planilla-anio').value = sigAnioStr;
    document.getElementById('planilla-mes').value = sigMesStr;
    renderPlanilla();
  } catch (err) {
    showToast("Error al realizar cierre: " + err.message, "error");
  }
}

async function reabrirMes() {
  const anio = document.getElementById('planilla-anio').value;
  const mes = document.getElementById('planilla-mes').value;

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
        <button onclick="openGestionEstadoModal('${s.id}', 'titular')" class="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-xs font-semibold transition flex items-center gap-1">
          <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Cambiar Titular
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

  document.getElementById('ingreso-trabajador').innerHTML = '<option value="" disabled selected>Seleccione socio primero</option>';
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
  const socioId = document.getElementById('ingreso-socio-filtered').value; // Ahora toma el ID del nuevo select
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
  updateRoundedHoursDisplay();
}

function getRoundedHours(horaIngreso, horaSalida) {
  let calculated = calculateHours(horaIngreso, horaSalida);
  if (calculated <= 0) return 0;

  const minutosTrabajados = calculated * 60;

  // Si el tiempo trabajado es inferior a 1:45 (105 min), computa 0 hs
  if (minutosTrabajados < 105) return 0;

  if (minutosTrabajados >= 210 && minutosTrabajados <= 255) {
    // Caso ~4hs: Desde 3h 30m hasta 4h 15m -> Redondea a 4.0 hs
    return 4.0;
  } else if (minutosTrabajados >= 105 && minutosTrabajados < 210) {
    // Caso ~2hs: Desde 1h 45m hasta 3h 30m -> Redondea a 2.0 hs
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

  sociosOrdenados.forEach(socioOriginal => {
    // Obtener el estado del socio para el último día del mes consultado
    const ultimoDiaMes = new Date(anio, mes, 0).toISOString().split('T')[0];
    const s = getSocioSnapshot(socioOriginal, ultimoDiaMes);
    
    // Si el socio no existía o ya estaba de baja en ese mes, no lo mostramos
    if (!s) return;

    const exonerado = esNucleoExonerado(s);
    const objetivo = obtenerObjetivoHorasSocio(s);
    const comisionAsignada = obtenerComisionAsignadaNucleo(s);
    const hist = obtenerSaldoHistoricoAlMes(s.id, anio, mes);
    const resHoras = obtenerResultadoHorasSocio(s, anio, mes);

    const comprometidas = objetivo + hist.deudaAnterior;
    const saldoDelMes = resHoras.computables - objetivo;
    
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
        ${hist.tesoreriaAcumulada > 0 ? formatHours(hist.tesoreriaAcumulada) : '-'}
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
  const currentYear = new Date().getFullYear();
  const currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');

  // Populate years (e.g., current year and a few years back)
  yearSelect.innerHTML = '<option value="todos">Todos los Años</option>';
  for (let i = 0; i < 5; i++) { // Last 5 years
    const year = currentYear - i;
    const option = document.createElement('option');
    option.value = year.toString();
    option.textContent = year.toString();
    yearSelect.appendChild(option);
  }
  yearSelect.value = currentYear.toString(); // Default to current year

  // Populate months
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
  monthSelect.value = currentMonth; // Default to current month
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

  // Usamos el mes/año seleccionado en la planilla para el dashboard o el actual
  const anio = document.getElementById('planilla-anio')?.value || new Date().getFullYear().toString();
  const mes = document.getElementById('planilla-mes')?.value || (new Date().getMonth() + 1).toString().padStart(2, '0');
  
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

  let totalTesoreria = 0;
  for (const clave in saldosHistoricos) {
    totalTesoreria += (saldosHistoricos[clave].tesoreriaAcumulada || 0); // This is a sum, not a display.
  }
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
    await db.collection('socios').doc(socioId).update({
      nombre,
      fechaNacimiento,
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
    let personaNombre = '';
    let personaTipo = '';

    if (targetType === 'socio') {
      personaNombre = socio.nombre;
      personaTipo = 'TITULAR';
      await db.collection('socios').doc(socioId).update({ comision });
    } else {
      const index = parseInt(nucleoIndex);
      const nuevoNucleo = [...(socio.nucleo || [])];
      if (!nuevoNucleo[index]) return;
      personaNombre = nuevoNucleo[index].nombre;
      personaTipo = 'FAMILIAR';
      nuevoNucleo[index] = { ...nuevoNucleo[index], comision };
      await db.collection('socios').doc(socioId).update({ nucleo: nuevoNucleo });
    }

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
    // Guardamos en Firebase usando el nombre normalizado como ID para evitar duplicados reales
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
async function registrarLog(accion, detalle) {
  if (!db) return;
  const user = firebase.auth().currentUser;
  const logEntry = {
    fecha: new Date().toISOString(), // ISO para ordenamiento fácil
    usuario: user ? (user.email || "Admin") : "Sistema",
    accion: accion,
    detalle: detalle
  };
  try {
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
  csvContent += "Socio,Nº Socio,Edad,Horas Objetivo,Horas Computables,Saldo del Mes,Deuda Anterior,Remanente Anterior,Comprometidas,Total Crédito,Remanente Final,Deuda Final,Observaciones\n";

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

    if (resHoras.horasResto > 0 && !resHoras.cubiertasPorComision) {
      obs.push(resHoras.perdidas ? `Perdió ${resHoras.horasResto} hs (menor a 4 hs)` : `Resto ${resHoras.horasResto} hs no computables`);
    }

    const observacionesStr = obs.join("; ");

    csvContent += `"${s.nombre}","${s.id}","${edad}","${objetivo}","${resHoras.computables.toFixed(2)}","${saldoDelMes.toFixed(2)}","${hist.deudaAnterior.toFixed(2)}","${hist.remanenteAnterior.toFixed(2)}","${comprometidas.toFixed(2)}","${totalCredito.toFixed(2)}","${remanenteFinal.toFixed(2)}","${deudaFinal.toFixed(2)}","${observacionesStr}"\n`;
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
    const objetivo = obtenerObjetivoHorasSocio(s);
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
    let pasajeATesoreriaCalculado = 0; // Amount of previous debt converted to Tesoreria this month

    if (totalCredito >= comprometidas) { // If total credit covers all commitments
      remanenteFinal = totalCredito - comprometidas; // Remaining surplus
    } else { // If there's a deficit
      deudaFinal = comprometidas - totalCredito; // New debt for the next month

      // Calculate how much of the previous debt (hist.deudaAnterior) is converted to Tesoreria
      const saldoTrasMesCorriente = Math.max(0, totalCredito - objetivo);
      if (saldoTrasMesCorriente < hist.deudaAnterior) {
        pasajeATesoreriaCalculado = hist.deudaAnterior - saldoTrasMesCorriente;
        deudaFinal = Math.max(0, deudaFinal - pasajeATesoreriaCalculado); // Reduce next month's debt by what went to Tesoreria
      }
    }

    // Round all hour values to integers for display
    const saldoAnt = Math.round(hist.remanenteAnterior - hist.deudaAnterior);
    const comprometidasRounded = Math.round(comprometidas);
    const resHorasComputablesRounded = Math.round(resHoras.computables);
    const saldoDelMesRounded = Math.round(saldoDelMes);
    const saldoTot = Math.round(remanenteFinal - deudaFinal);
    const deudaAnteriorRounded = Math.round(hist.deudaAnterior);
    const pasajeATesoreriaRounded = Math.round(pasajeATesoreriaCalculado);
    const deudaGeneradaEsteMesRounded = (saldoDelMesRounded < 0) ? Math.abs(saldoDelMesRounded) : 0;

    // Observaciones abreviadas para ahorrar espacio
    let obs = [];
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

  const logo = document.getElementById('logo-coop');
  if (logo && logo.complete && logo.naturalWidth !== 0) {
    try { doc.addImage(logo, 'PNG', 20, 12, 15, 15); } catch(e) { console.error(e); }
  }

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
  let totalGeneralTesoreria = 0;

  sociosOrdenados.forEach(s => {
    const objetivo = obtenerObjetivoHorasSocio(s);
    const hist = obtenerSaldoHistoricoAlMes(s.id, anio, mesNum);
    const resHoras = obtenerResultadoHorasSocio(s, anio, mesNum);
    
    // totalCredito: lo trabajado este mes + remanente traído del mes anterior
    const totalCredito = resHoras.computables + hist.remanenteAnterior;
    
    let pasajeATesoreria = 0;
    let horasRecuperadas = 0;

    if (hist.deudaAnterior > 0) {
      // El socio debe cubrir primero el objetivo actual
      const saldoTrasObjetivo = Math.max(0, totalCredito - objetivo);
      // Lo que queda se usa para recuperar deuda
      horasRecuperadas = Math.min(hist.deudaAnterior, saldoTrasObjetivo);
      // Lo que no se recuperó de la deuda anterior se pierde y va a Tesorería
      pasajeATesoreria = hist.deudaAnterior - horasRecuperadas;
    }

    if (pasajeATesoreria > 0) {
      totalGeneralTesoreria += pasajeATesoreria;
      tableData.push([
        s.id,
        s.nombre,
        formatHours(Math.round(hist.deudaAnterior)),
        formatHours(Math.round(resHoras.computables)),
        formatHours(Math.round(horasRecuperadas)),
        formatHours(Math.round(pasajeATesoreria))
      ]);
    }
  });

  if (tableData.length === 0) {
    showToast(`No se encontraron deudas sin recuperar en ${mesNombre} ${anio}.`, "info");
    return;
  }

  doc.setFontSize(16);
  doc.setTextColor(5, 150, 105);
  doc.text("COVIMT 9 - Informe de Tesorería", 105, 20, { align: 'center' });
  doc.setFontSize(12);
  doc.setTextColor(40);
  doc.text(`Pasaje de Horas no Recuperadas - ${mesNombre} ${anio}`, 105, 28, { align: 'center' });

  doc.autoTable({
    head: [['ID', 'Socio Titular', 'Deuda Inicial', 'Trabajado', 'Recuperado', 'A Tesorería']],
    body: tableData,
    startY: 35,
    theme: 'grid',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [5, 150, 105] },
    columnStyles: {
      0: { cellWidth: 15, halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'center' },
      5: { halign: 'center', fontStyle: 'bold' }
    },
    margin: { top: 30 }
  });

  const finalY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text(`Total de horas pasadas a Tesorería en el período: ${formatHours(Math.round(totalGeneralTesoreria))}`, 20, finalY);

  doc.save(`COVIMT9_Tesoreria_${mesNum}_${anio}.pdf`);
  showToast("Reporte de Tesorería generado correctamente.", "success");
}

/**
 * Genera un PDF resumen para la cooperativa con todas las jornadas finalizadas de una fecha específica.
 */
async function generarReporteDiarioPDF() {
  const fechaReporte = document.getElementById('reporte-jornada-fecha').value;
  if (!fechaReporte) {
    showToast("Por favor, selecciona una fecha para el reporte.", "error");
    return;
  }

  const jornadasDelDia = registros.filter(r => r.fecha === fechaReporte && r.estado === 'finalizado');

  if (jornadasDelDia.length === 0) {
    showToast(`No se encontraron jornadas finalizadas para la fecha ${formatDateString(fechaReporte)}.`, "info");
    return;
  }

  // Obtener el responsable de la primera jornada del día para la firma
  const responsableDia = jornadasDelDia[0].responsable || "________________";

  // Ordenar jornadas por número de socio (numérico si es posible, sino alfabético)
  jornadasDelDia.sort((a, b) => {
    const numA = parseInt(a.socioId, 10);
    const numB = parseInt(b.socioId, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a.socioId).localeCompare(String(b.socioId));
  });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');

  const logo = document.getElementById('logo-coop');
  if (logo && logo.complete && logo.naturalWidth !== 0) {
    try { doc.addImage(logo, 'PNG', 20, 12, 15, 15); } catch(e) { console.error(e); }
  }

  doc.setFontSize(16);
  doc.setTextColor(5, 150, 105);
  doc.text("COOPERATIVA DE VIVIENDA COVIMT 9", 105, 20, { align: 'center' });

  doc.setFontSize(14);
  doc.setTextColor(40, 40, 40);
  doc.text(`Reporte Diario de Jornadas - ${formatDateString(fechaReporte)}`, 105, 30, { align: 'center' });

  doc.setDrawColor(200, 200, 200);
  doc.line(20, 35, 190, 35);

  const tableColumnTitles = ["Nº Socio", "Nombre Trabajador", "Entrada", "Salida", "Horas", "Firma"];
  const tableRows = jornadasDelDia.map(r => [
    r.socioId,
    r.trabajadorNombre,
    r.horaIngreso,
    r.horaSalida, // Display original exit time
    getRoundedHours(r.horaIngreso, r.horaSalida).toFixed(2), // Display rounded hours
    { content: '', signature: r.firma }
  ]);

  doc.autoTable({
    head: [tableColumnTitles],
    body: tableRows,
    startY: 45,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 1.5, valign: 'middle' },
    headStyles: { fillColor: [5, 150, 105], textColor: 255, halign: 'center' },
    columnStyles: {
      0: { cellWidth: 20, halign: 'center' },
      1: { cellWidth: 45 },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 20, halign: 'center' },
      4: { cellWidth: 15, halign: 'center' },
      5: { cellWidth: 45, halign: 'center', minCellHeight: 12 }
    },
    didDrawCell: function (data) {
      if (data.column.index === 5 && data.cell.section === 'body' && data.cell.raw.signature) {
        const signature = data.cell.raw.signature;
        const imgWidth = 25;
        const imgHeight = 8;
        const x = data.cell.x + (data.cell.width - imgWidth) / 2;
        const y = data.cell.y + (data.cell.height - imgHeight) / 2;
        doc.addImage(signature, 'PNG', x, y, imgWidth, imgHeight);
      }
    },
    margin: { top: 20 },
    didDrawPage: function (data) {
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Generado el: ${new Date().toLocaleString()}`, 20, doc.internal.pageSize.height - 10);
      doc.text(`Página ${data.pageNumber}`, doc.internal.pageSize.width - 40, doc.internal.pageSize.height - 10);
    }
  });

  // Añadir firma del responsable al final
  const finalY = doc.lastAutoTable.finalY + 20;
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text("__________________________", 150, finalY, { align: 'center' });
  doc.text(`Firma Responsable: ${responsableDia}`, 150, finalY + 5, { align: 'center' });

  doc.save(`Reporte_Diario_Jornadas_${fechaReporte}.pdf`);
  showToast("Reporte diario PDF generado con éxito.", "success");
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

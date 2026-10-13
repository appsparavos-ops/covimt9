// --- CONFIGURACIÓN E INICIALIZACIÓN ---
let db = null;
let memberSocios = []; // Will hold the current member's socio data (as an array for compatibility)
let memberRegistros = []; // Will hold the current member's jornada records
let memberConfig = { objetivoHoras: 4, periodoInicial: '' }; // Configuración global y período de apertura
let memberSaldosHistoricos = {}; // Saldos históricos del socio actual
let memberPeriodosHabilitados = new Set(); // Períodos con saldo de apertura generado por un cierre
let memberObjetivosMensuales = {}; // Objetivo global por período YYYY-MM
let currentMemberSocioId = null;
const memberHoy = new Date();
let memberPeriodoAnio = String(memberHoy.getFullYear());
let memberPeriodoMes = String(memberHoy.getMonth() + 1).padStart(2, '0');
const MEMBER_MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// Utility functions (duplicated from cooperativa.js for self-containment)
function formatHours(value) {
  const roundedValue = Math.round(value);
  return `${roundedValue}Hs`;
}

function calculateHours(ingreso, salida) {
  if (!ingreso || !salida) return 0;
  const [h1, m1] = ingreso.split(':').map(Number);
  const [h2, m2] = salida.split(':').map(Number);
  let diffMin = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (diffMin < 0) diffMin += 24 * 60;
  return Math.round((diffMin / 60) * 100) / 100;
}

function getRoundedHours(horaIngreso, horaSalida) {
  let calculated = calculateHours(horaIngreso, horaSalida);
  if (calculated <= 0) return 0;

  const minutosTrabajados = calculated * 60;
  // Si el tiempo trabajado es inferior a 1:45 (105 min), computa 0 hs
  if (minutosTrabajados < 105) return 0;

  if (minutosTrabajados >= 210 && minutosTrabajados <= 255) {
    return 4.0;
  } else if (minutosTrabajados >= 105 && minutosTrabajados < 210) {
    return 2.0;
  }
  return calculated;
}

// Función para normalizar texto (Mayúsculas y quitar acentos)
function cleanText(text) {
  return (text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

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
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

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
  if (socio.certificadoMedico && !esPersonaHabilitada(socio)) {
    if (socio.nucleo) {
      for (const familiar of socio.nucleo) {
        if (esPersonaHabilitada(familiar)) return false;
      }
    }
    return true;
  }
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

function obtenerObjetivoHorasPeriodoSocio(anio, mes) {
  const clave = `${anio}-${mes}`;
  return Object.prototype.hasOwnProperty.call(memberObjetivosMensuales, clave)
    ? memberObjetivosMensuales[clave]
    : 4; // Valor predeterminado para períodos todavía no configurados.
}

function obtenerObjetivoHorasSocio(socio, anio = memberPeriodoAnio, mes = memberPeriodoMes) {
  if (esNucleoExonerado(socio)) return 0;
  return obtenerObjetivoHorasPeriodoSocio(anio, mes);
}

function esPeriodoLicenciaSocio(anio, mes) {
  return obtenerObjetivoHorasPeriodoSocio(anio, mes) === 0;
}

function obtenerHorasRealizadasNucleo(socioId, anio, mes) {
  const horasFisicas = memberRegistros
    .filter(r => r.socioId === socioId && r.estado === 'finalizado')
    .filter(r => {
      const [regAnio, regMes] = r.fecha.split('-');
      return regAnio === anio && regMes === mes;
    })
    .reduce((sum, r) => sum + getRoundedHours(r.horaIngreso, r.horaSalida), 0);

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
  const data = memberSaldosHistoricos[clave] || {};
  return {
    ...data,
    deudaAnterior: Number(data.deudaAnterior) || 0,
    remanenteAnterior: Number(data.remanenteAnterior) || 0,
    tesoreriaAcumulada: Number(data.tesoreriaAcumulada) || 0,
    tesoreriaPendiente: Number(data.tesoreriaPendiente) || 0,
    tesoreriaCobradaEnPeriodo: Number(data.tesoreriaCobradaEnPeriodo) || 0,
    tesoreriaPasadaEnCierre: Number(data.tesoreriaPasadaEnCierre) || 0,
    tesoreriaAcumuladaAlCierre: Number(data.tesoreriaAcumuladaAlCierre) || 0,
    cerrado: data.cerrado === true,
    fechaCierreContable: data.fechaCierreContable || ''
  };
}

function formatDateString(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

// Nuevo: Modal de diagnóstico con botón de cierre
function showDiagnosticModal(title, message, isError = false) {
  // Eliminar si ya existe uno
  const oldModal = document.getElementById('diagnostic-modal');
  if (oldModal) oldModal.remove();

  const modalHtml = `
    <div id="diagnostic-modal" class="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden border ${isError ? 'border-red-200' : 'border-emerald-200'}">
        <div class="${isError ? 'bg-red-600' : 'bg-emerald-600'} p-4 text-white font-bold flex items-center gap-2">
          <i data-lucide="${isError ? 'alert-circle' : 'check-circle'}" class="w-5 h-5"></i>
          ${title}
        </div>
        <div class="p-6">
          <p class="text-slate-600 text-sm leading-relaxed">${message}</p>
          <button onclick="document.getElementById('diagnostic-modal').remove()" class="mt-6 w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl transition">
            Cerrar y reintentar
          </button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  lucide.createIcons();
}

// Inicializar iconos de Lucide al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initMemberApp();
});

async function initMemberApp() {
  if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') {
    showToast("Error: SDK de Firebase o firebaseConfig.js no cargados.", "error");
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  db = firebase.firestore();

  // Usar persistencia LOCAL para que la sesión anónima sobreviva entre aperturas de la PWA
  await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err => console.error("Error al configurar persistencia:", err));

  try {
    // Login anónimo automático para permitir consultas a Firestore
    if (!firebase.auth().currentUser) {
      await firebase.auth().signInAnonymously();
      console.log("Sesión anónima iniciada:", firebase.auth().currentUser.uid);
    }

    // Verificar si ya existe una sesión interna de socio
    currentMemberSocioId = localStorage.getItem('memberSocioId');
    if (currentMemberSocioId) {
      showMemberPortal();
      loadMemberData(currentMemberSocioId);
    } else {
      showMemberLogin();
    }
  } catch (error) {
    console.error("Error de inicialización:", error);
    showDiagnosticModal(
      "Error de Conexión", 
      "No se pudo establecer conexión con la base de datos. Verifica tu internet o la configuración de Firebase.\n\nDetalle: " + error.message,
      true
    );
    showMemberLogin();
  }
}

function showMemberLogin() {
  document.getElementById('view-member-login').classList.remove('hidden');
  document.getElementById('member-portal-container').classList.add('hidden');
  lucide.createIcons();
}

function showMemberPortal() {
  document.getElementById('view-member-login').classList.add('hidden');
  document.getElementById('member-portal-container').classList.remove('hidden');
  lucide.createIcons();
}

// --- Función de hash SHA-256 para PIN ---
async function hashPIN(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleMemberLogin() {
  const nombre = cleanText(document.getElementById('member-login-name').value);
  const socioId = document.getElementById('member-login-id').value.trim();
  const pin = document.getElementById('member-login-pin').value.trim();
  const submitBtn = document.getElementById('btn-member-login-submit');

  if (!nombre || !socioId || !pin) {
    showToast("Por favor, ingresa tu nombre, número de socio y PIN.", "error");
    return;
  }

  if (!/^\d{4}$/.test(pin)) {
    showToast("El PIN debe tener exactamente 4 dígitos.", "error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Verificando...`;
  lucide.createIcons();

  try {
    // Buscar socio por ID
    const doc = await db.collection('socios').doc(socioId).get();

    if (!doc.exists) {
      showDiagnosticModal(
        "Socio no encontrado", 
        `El número de socio "${socioId}" no existe en la base de datos.`,
        true
      );
      return;
    }

    const socioData = doc.data();

    // Verificar nombre
    if (cleanText(socioData.nombre) !== nombre) {
      showDiagnosticModal(
        "Nombre no coincide", 
        `El número de socio existe, pero el nombre ingresado no coincide.\n\nIngresaste: "${nombre}"\nEn sistema: "${socioData.nombre.toUpperCase()}"`,
        true
      );
      return;
    }

    // Verificar PIN (hash SHA-256)
    const pinHash = await hashPIN(pin);
    if (!socioData.pinHash || socioData.pinHash !== pinHash) {
      showDiagnosticModal(
        "PIN incorrecto",
        "El PIN de 4 dígitos ingresado no es válido. Contactá al administrador si olvidaste tu PIN.",
        true
      );
      return;
    }

    currentMemberSocioId = socioData.id;
    localStorage.setItem('memberSocioId', currentMemberSocioId);
    localStorage.setItem('memberSocioName', socioData.nombre);

    showToast(`Bienvenido, ${socioData.nombre}.`, "success");
    registrarLog("Acceso Portal Socio", `LOGIN - El socio ${socioData.nombre} (ID: ${currentMemberSocioId}) ingresó a su portal.`);
    showMemberPortal();
    loadMemberData(currentMemberSocioId);

    // Limpiar campos sensibles
    document.getElementById('member-login-pin').value = '';

  } catch (error) {
    showToast("Error al intentar acceder: " + error.message, "error");
    console.error("Member login error:", error);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i data-lucide="log-in" class="w-4 h-4"></i> Acceder al Portal`;
    lucide.createIcons();
  }
}

async function handleMemberLogout() {
  if (await showConfirmModal("Salir del Portal", "¿Confirmas que deseas cerrar tu sesión de socio?")) {
    closeMemberSettings();
    registrarLog("Salida Portal Socio", `LOGOUT - El socio ID: ${currentMemberSocioId} cerró su sesión.`);
    localStorage.removeItem('memberSocioId');
    localStorage.removeItem('memberSocioName');
    currentMemberSocioId = null;
    memberSocios = [];
    memberRegistros = [];
    memberSaldosHistoricos = {};
    memberPeriodosHabilitados = new Set();
    memberObjetivosMensuales = {};
    showToast("Sesión cerrada.", "info");
    showMemberLogin();
  }
}

function establecerPeriodoActualDispositivo() {
  const fechaDispositivo = new Date();
  memberPeriodoAnio = String(fechaDispositivo.getFullYear());
  memberPeriodoMes = String(fechaDispositivo.getMonth() + 1).padStart(2, '0');
}

async function refrescarSaldosPeriodosSocio(socioId) {
  const saldosSnapshot = await db.collection('saldosHistoricos').get();
  memberSaldosHistoricos = {};
  memberPeriodosHabilitados = new Set();
  saldosSnapshot.docs.forEach(doc => {
    const separador = doc.id.lastIndexOf('_');
    if (separador < 0) return;
    const sId = doc.id.substring(0, separador);
    const period = doc.id.substring(separador + 1);
    if (/^\d{4}-\d{2}$/.test(period)) memberPeriodosHabilitados.add(period);
    if (sId === socioId) memberSaldosHistoricos[doc.id] = doc.data();
  });
}

async function loadMemberData(socioId) {
  // Cada ingreso al portal comienza en el mes y año actuales del dispositivo.
  establecerPeriodoActualDispositivo();
  document.getElementById('member-name-display').textContent = localStorage.getItem('memberSocioName') || 'Socio';

  try {
    // Fetch member's socio data
    const socioDoc = await db.collection('socios').doc(socioId).get();
    if (socioDoc.exists) {
      memberSocios = [socioDoc.data()]; // Store as an array for compatibility with utility functions
    } else {
      showToast("No se encontraron datos de socio.", "error");
      return;
    }

    // Fetch global config for objective hours
    const configDoc = await db.collection('config').doc('metaGlobal').get();
    if (configDoc.exists) {
      memberConfig = normalizarConfig(configDoc.data());
    }

    // Fetch global objectives by period. Missing periods use the legacy default.
    const objetivosSnapshot = await db.collection('objetivosMensuales').get();
    memberObjetivosMensuales = {};
    objetivosSnapshot.docs.forEach(doc => {
      const valor = Number(doc.data().objetivoHoras);
      if (Number.isFinite(valor) && valor >= 0) memberObjetivosMensuales[doc.id] = valor;
    });

    // Fetch member's records
    const registrosSnapshot = await db.collection('registros').where('socioId', '==', socioId).get();
    memberRegistros = registrosSnapshot.docs.map(doc => doc.data());

    // Cargar saldos propios y períodos globalmente habilitados por cierres.
    await refrescarSaldosPeriodosSocio(socioId);

    inicializarSelectorPeriodoSocio();
    renderMemberDashboard();
    renderMemberJornadasTable();

    // Verificar si está usando PIN por defecto
    if (memberSocios.length > 0) {
      checkDefaultPIN(memberSocios[0]);
    }

  } catch (error) {
    showToast("Error al cargar tus datos: " + error.message, "error");
    console.error("Error loading member data:", error);
  }
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

async function registrarLog(accion, detalle) {
  if (!db) return;
  // En el portal de socio, el "user" de Firebase es socios@coope.com, 
  // por eso usamos el detalle para especificar qué socio es.
  const logEntry = {
    fecha: new Date().toISOString(),
    usuario: "Portal de Socios",
    accion: accion,
    detalle: detalle
  };
  try {
    await db.collection('bitacora').add(logEntry);
  } catch (e) { console.error("Error bitácora:", e); }
}

function inicializarSelectorPeriodoSocio() {
  const monthSelect = document.getElementById('member-period-month');
  const yearSelect = document.getElementById('member-period-year');
  if (!monthSelect || !yearSelect) return;

  const actual = new Date().getFullYear();
  const anios = new Set();
  for (let desplazamiento = -2; desplazamiento <= 5; desplazamiento++) {
    anios.add(String(actual + desplazamiento));
  }
  const inicial = obtenerPeriodoInicialSocio();
  if (inicial) anios.add(inicial.substring(0, 4));
  memberRegistros.forEach(r => {
    const anio = String(r.fecha || '').split('-')[0];
    if (/^\d{4}$/.test(anio)) anios.add(anio);
  });
  Object.keys(memberSaldosHistoricos).forEach(clave => {
    const periodo = clave.substring(clave.lastIndexOf('_') + 1);
    const anio = periodo.split('-')[0];
    if (/^\d{4}$/.test(anio)) anios.add(anio);
  });

  // Mantener el período elegido si los datos se vuelven a cargar.
  anios.add(memberPeriodoAnio);
  yearSelect.innerHTML = [...anios]
    .sort((a, b) => Number(b) - Number(a))
    .map(anio => `<option value="${anio}">${anio}</option>`)
    .join('');
  yearSelect.value = memberPeriodoAnio;
  monthSelect.value = memberPeriodoMes;
}

async function cambiarPeriodoSocio() {
  const monthSelect = document.getElementById('member-period-month');
  const yearSelect = document.getElementById('member-period-year');
  if (!monthSelect || !yearSelect) return;
  memberPeriodoMes = monthSelect.value;
  memberPeriodoAnio = yearSelect.value;
  try {
    // Volver a consultar permite detectar un cierre realizado mientras el portal estaba abierto.
    if (currentMemberSocioId) await refrescarSaldosPeriodosSocio(currentMemberSocioId);
  } catch (error) {
    console.error('No se pudieron actualizar los períodos:', error);
  }
  renderMemberDashboard();
  renderMemberJornadasTable();
}

function nombrePeriodoSocio() {
  return `${MEMBER_MESES[Number(memberPeriodoMes) - 1]} de ${memberPeriodoAnio}`;
}

function obtenerPeriodoInicialSocio() {
  if (memberConfig.periodoInicial) return memberConfig.periodoInicial;
  const periodos = [...memberPeriodosHabilitados].sort();
  if (periodos.length) return periodos[0];
  const fechaAlta = String(memberSocios[0]?.fechaAlta || '');
  if (/^\d{4}-\d{2}/.test(fechaAlta)) return fechaAlta.substring(0, 7);
  return '';
}

function obtenerEstadoPeriodoSocio(anio = memberPeriodoAnio, mes = memberPeriodoMes) {
  const periodo = `${anio}-${String(mes).padStart(2, '0')}`;
  const inicial = obtenerPeriodoInicialSocio();
  if (inicial && periodo < inicial) return { disponible: false, motivo: 'anterior', periodo, inicial };
  // El período inicial equivale a haber cerrado el mes anterior con los saldos cargados.
  if (inicial && periodo === inicial) return { disponible: true, motivo: 'inicial', periodo, inicial };
  // Cada cierre crea saldos de apertura para el mes siguiente.
  if (memberPeriodosHabilitados.has(periodo)) return { disponible: true, motivo: 'cerrado', periodo, inicial };
  return { disponible: false, motivo: 'pendiente', periodo, inicial };
}

function actualizarDisponibilidadPeriodoSocio() {
  const estado = obtenerEstadoPeriodoSocio();
  const aviso = document.getElementById('member-period-status');
  const datos = document.getElementById('member-period-data');
  if (!aviso || !datos) return estado;

  datos.classList.toggle('hidden', !estado.disponible);
  aviso.classList.toggle('hidden', estado.disponible);
  if (!estado.disponible) {
    const titulo = document.getElementById('member-period-status-title');
    const detalle = document.getElementById('member-period-status-detail');
    if (estado.motivo === 'anterior') {
      titulo.textContent = 'No hay información para este período';
      detalle.textContent = `La operación comienza en ${estado.inicial}. Los meses anteriores no tienen datos cargados.`;
    } else {
      titulo.textContent = 'Período todavía no disponible';
      detalle.textContent = `La información de ${estado.periodo} aparecerá después de que la Administración cierre el mes anterior.`;
    }
  }
  return estado;
}

function obtenerPeriodoSiguienteSocio(anio, mes) {
  const fecha = new Date(Number(anio), Number(mes), 1);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
}

function renderMemberDashboard() {
  if (!currentMemberSocioId || memberSocios.length === 0) return;
  const estadoPeriodo = actualizarDisponibilidadPeriodoSocio();
  if (!estadoPeriodo.disponible) return;

  const socio = memberSocios[0]; // The current member's socio data

  const anio = memberPeriodoAnio;
  const mes = memberPeriodoMes;

  const objetivo = obtenerObjetivoHorasSocio(socio, anio, mes);
  const hist = obtenerSaldoHistoricoAlMes(socio.id, anio, mes);
  const resHoras = obtenerResultadoHorasSocio(socio, anio, mes);

  const comprometidas = objetivo + hist.deudaAnterior;
  const totalCredito = resHoras.computables + hist.remanenteAnterior;

  let remanenteFinal = 0;
  let deudaFinal = 0;

  // En licencia se pausa únicamente "A Recuperar". Lo marcado "A Tesorería"
  // se cobra en este mes y forma parte del total mostrado.
  if (esPeriodoLicenciaSocio(anio, mes)) {
    remanenteFinal = hist.remanenteAnterior || 0;
    deudaFinal = hist.deudaAnterior || 0;
  } else if (totalCredito >= comprometidas) {
    remanenteFinal = totalCredito - comprometidas;
  } else {
    // El saldo del período muestra todas las horas comprometidas todavía no cubiertas.
    // El eventual pasaje de deuda anterior a Tesorería se aplica recién al cerrar el mes.
    deudaFinal = comprometidas - totalCredito;
  }

  // Mostrar el compromiso total, igual que Admin: objetivo del período + A Recuperar.
  document.getElementById('member-kpi-objetivo').textContent = formatHours(comprometidas);
  const detalleObjetivo = document.getElementById('member-kpi-objetivo-detalle');
  if (detalleObjetivo) {
    detalleObjetivo.textContent = `${formatHours(objetivo)} objetivo + ${formatHours(hist.deudaAnterior)} A Recuperar`;
  }
  document.getElementById('member-kpi-realizadas').textContent = formatHours(resHoras.fisicas);

  let saldoDisplay = '';
  if (remanenteFinal > 0) {
    saldoDisplay = `+${formatHours(remanenteFinal)}`;
    document.getElementById('member-kpi-saldo').classList.remove('text-red-600');
    document.getElementById('member-kpi-saldo').classList.add('text-emerald-600');
  } else if (deudaFinal > 0) {
    saldoDisplay = `Debe ${formatHours(deudaFinal)}`;
    document.getElementById('member-kpi-saldo').classList.remove('text-emerald-600');
    document.getElementById('member-kpi-saldo').classList.add('text-red-600');
  } else {
    saldoDisplay = formatHours(0);
    document.getElementById('member-kpi-saldo').classList.remove('text-red-600', 'text-emerald-600');
  }
  document.getElementById('member-kpi-saldo').textContent = saldoDisplay;

  const periodoLicencia = esPeriodoLicenciaSocio(anio, mes);
  const periodoSiguiente = obtenerPeriodoSiguienteSocio(anio, mes);
  const histSiguienteRaw = memberSaldosHistoricos[`${socio.id}_${periodoSiguiente}`];
  const mesCerrado = Boolean(histSiguienteRaw);

  // Mientras el mes está abierto se calcula qué ocurriría si cerrara ahora.
  const creditoParaDeudaAnterior = Math.max(0, totalCredito - objetivo);
  const pasajeProyectado = periodoLicencia
    ? 0
    : Math.max(0, hist.deudaAnterior - creditoParaDeudaAnterior);
  const recuperarProyectado = periodoLicencia
    ? (hist.deudaAnterior || 0)
    : Math.max(0, deudaFinal - pasajeProyectado);

  // Para meses cerrados se muestran los resultados efectivamente guardados.
  const pasajeMostrado = mesCerrado
    ? (hist.cerrado
      ? Number(hist.tesoreriaPasadaEnCierre || 0)
      : Number(histSiguienteRaw.tesoreriaPendiente || 0)) // compatibilidad con cierres anteriores
    : pasajeProyectado;
  const recuperarMostrado = mesCerrado
    ? Number(histSiguienteRaw.deudaAnterior || 0)
    : recuperarProyectado;

  const fechaCierreTexto = hist.fechaCierreContable
    ? `el ${formatDateString(hist.fechaCierreContable)}`
    : 'al cierre del período';
  const saldoDetalle = document.getElementById('member-kpi-saldo-detalle');
  if (saldoDetalle) {
    if (mesCerrado && pasajeMostrado > 0) {
      saldoDetalle.textContent = `${formatHours(pasajeMostrado)} pasaron a Tesorería ${fechaCierreTexto}`;
    } else if (!mesCerrado && pasajeMostrado > 0) {
      saldoDetalle.textContent = `${formatHours(pasajeMostrado)} vencerían al cierre si no se recuperan`;
    } else if (periodoLicencia && hist.deudaAnterior > 0) {
      saldoDetalle.textContent = `${formatHours(hist.deudaAnterior)} A Recuperar pausadas por licencia`;
    } else if (deudaFinal > 0) {
      saldoDetalle.textContent = `${formatHours(deudaFinal)} permanecen A Recuperar`;
    } else if (remanenteFinal > 0) {
      saldoDetalle.textContent = `${formatHours(remanenteFinal)} a favor`;
    } else {
      saldoDetalle.textContent = 'Sin saldo pendiente';
    }
  }

  // Separar el movimiento del período del acumulado histórico evita aparentar un cobro doble.
  const movimientoTesoreriaPeriodo = hist.cerrado
    ? (hist.tesoreriaCobradaEnPeriodo || 0)
    : mesCerrado
      ? (hist.tesoreriaPendiente || 0) + Number(histSiguienteRaw.tesoreriaPendiente || 0) // cierre legado
      : (hist.tesoreriaPendiente || 0);
  const tesoreriaAcumuladaMostrada = hist.cerrado
    ? (hist.tesoreriaAcumuladaAlCierre || 0)
    : mesCerrado
      ? (hist.tesoreriaAcumulada || 0) + (hist.tesoreriaPendiente || 0) + Number(histSiguienteRaw.tesoreriaPendiente || 0) // cierre legado
      : (hist.tesoreriaAcumulada || 0) + (hist.tesoreriaPendiente || 0);
  document.getElementById('member-kpi-tesoreria').textContent = formatHours(movimientoTesoreriaPeriodo);
  const acumuladaTesoreria = document.getElementById('member-kpi-tesoreria-acumulada');
  if (acumuladaTesoreria) acumuladaTesoreria.textContent = `Tesorería acumulada: ${formatHours(tesoreriaAcumuladaMostrada)}`;

  const estadoTesoreria = document.getElementById('member-kpi-tesoreria-estado');
  if (estadoTesoreria) {
    const cobroActual = hist.tesoreriaPendiente > 0
      ? `<span class="block text-red-700 mb-1">${formatHours(hist.tesoreriaPendiente)} se cobran en este período</span>`
      : '';
    if (!mesCerrado && pasajeMostrado > 0) {
      estadoTesoreria.innerHTML = `${cobroActual}<span class="safe-pulse animate-pulse inline-flex rounded-full bg-amber-200 text-amber-900 px-2 py-1">${formatHours(pasajeMostrado)} SI NO SE RECUPERAN</span><span class="block text-amber-800 mt-1 font-medium">Pasarían a Tesorería al cerrar este mes</span>`;
    } else if (mesCerrado && pasajeMostrado > 0) {
      estadoTesoreria.innerHTML = `${cobroActual}<span class="inline-flex rounded-full bg-red-100 text-red-800 px-2 py-1">${formatHours(pasajeMostrado)} pasaron a Tesorería ${fechaCierreTexto}</span>`;
    } else if (periodoLicencia && hist.deudaAnterior > 0) {
      estadoTesoreria.innerHTML = `${cobroActual}<span class="inline-flex rounded-full bg-blue-100 text-blue-800 px-2 py-1">A Recuperar pausadas por licencia</span>`;
    } else {
      estadoTesoreria.innerHTML = `${cobroActual}<span class="inline-flex rounded-full bg-emerald-100 text-emerald-800 px-2 py-1">Sin horas próximas a Tesorería</span>`;
    }
  }

  const proyeccion = document.getElementById('member-close-projection');
  const proyeccionTitulo = document.getElementById('member-close-projection-title');
  const proyeccionDetalle = document.getElementById('member-close-projection-detail');
  const proyeccionTesoreria = document.getElementById('member-close-projection-treasury');
  const proyeccionRecuperar = document.getElementById('member-close-projection-recover');
  if (proyeccion && proyeccionTitulo && proyeccionDetalle && proyeccionTesoreria && proyeccionRecuperar) {
    proyeccion.className = 'mt-4 rounded-2xl border p-4';
    if (mesCerrado) {
      proyeccion.classList.add('bg-slate-50', 'border-slate-200', 'text-slate-700');
      proyeccionTitulo.textContent = periodoLicencia ? 'Resultado del cierre de licencia' : 'Resultado del cierre';
      proyeccionDetalle.textContent = pasajeMostrado > 0
        ? `Estas horas se imputaron a Tesorería ${fechaCierreTexto}, no en el mes siguiente.`
        : 'El período fue cerrado sin nuevas horas imputadas a Tesorería.';
    } else if (periodoLicencia) {
      proyeccion.classList.add('bg-blue-50', 'border-blue-200', 'text-blue-800');
      proyeccionTitulo.textContent = 'Mes de licencia';
      proyeccionDetalle.textContent = 'Las horas A Recuperar quedan pausadas. Las horas que ya estaban en Tesorería se cobran normalmente.';
    } else if (pasajeMostrado > 0) {
      proyeccion.classList.add('bg-amber-50', 'border-amber-200', 'text-amber-900');
      proyeccionTitulo.textContent = 'Si el mes cerrara hoy';
      proyeccionDetalle.textContent = 'La deuda anterior no recuperada pasaría a Tesorería. El déficit propio de este mes quedaría A Recuperar.';
    } else {
      proyeccion.classList.add('bg-emerald-50', 'border-emerald-200', 'text-emerald-800');
      proyeccionTitulo.textContent = 'Proyección al cierre';
      proyeccionDetalle.textContent = 'No hay horas anteriores próximas a pasar a Tesorería.';
    }
    proyeccionTesoreria.textContent = formatHours(pasajeMostrado);
    proyeccionRecuperar.textContent = formatHours(recuperarMostrado);
  }
}

function renderMemberJornadasTable() {
  const tbody = document.getElementById('member-jornadas-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!obtenerEstadoPeriodoSocio().disponible) return;
  const periodLabel = document.getElementById('member-history-period-label');
  if (periodLabel) periodLabel.textContent = `Período: ${nombrePeriodoSocio()}`;

  const registrosDelPeriodo = memberRegistros.filter(r => {
    const [anio, mes] = String(r.fecha || '').split('-');
    return anio === memberPeriodoAnio && mes === memberPeriodoMes;
  });

  if (registrosDelPeriodo.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">No tienes jornadas registradas en ${nombrePeriodoSocio()}.</td></tr>`;
    return;
  }

  // Ordenar las jornadas del período por fecha descendente.
  const sortedRegistros = [...registrosDelPeriodo].sort((a, b) => b.fecha.localeCompare(a.fecha));

  sortedRegistros.forEach(r => {
    const roundedHs = r.estado === 'finalizado' ? getRoundedHours(r.horaIngreso, r.horaSalida) : 0;
    const row = document.createElement('tr');
    row.className = "hover:bg-slate-50 transition";
    row.innerHTML = `
      <td class="py-3 px-4 font-medium text-slate-700">${formatDateString(r.fecha)}</td>
      <td class="py-3 px-4 text-slate-700">${r.trabajadorNombre}</td>
      <td class="py-3 px-4 text-slate-500 font-mono text-[10px]">${r.horaIngreso} hs ${r.horaSalida ? `- ${r.horaSalida} hs` : ''}</td>
      <td class="py-3 px-4 text-slate-600 italic text-[11px]">${r.responsable || '-'}</td>
      <td class="py-3 px-4 text-slate-700 font-bold">${r.estado === 'finalizado' ? roundedHs.toFixed(2) + ' hs' : '-'}</td>
      <td class="py-3 px-4 text-slate-500 max-w-xs truncate">${r.tarea}</td>
      <td class="py-3 px-4">
        ${r.estado === 'finalizado'
          ? `<span class="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded font-bold">Finalizada</span>`
          : `<span class="bg-blue-100 text-blue-800 text-[10px] px-2 py-0.5 rounded font-bold">En Curso</span>`
        }
      </td>
    `;
    tbody.appendChild(row);
  });
}
// ============================================================
//  CONFIGURACIÓN Y CAMBIO DE PIN POR EL SOCIO
// ============================================================

function openMemberSettings() {
  const modal = document.getElementById('modal-member-settings');
  if (!modal) return;
  modal.classList.remove('hidden');
  if (typeof lucide !== 'undefined') lucide.createIcons();
  setTimeout(() => document.getElementById('member-current-pin')?.focus(), 50);
}

function closeMemberSettings() {
  const modal = document.getElementById('modal-member-settings');
  if (modal) modal.classList.add('hidden');
  ['member-current-pin', 'member-new-pin', 'member-confirm-pin'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
}

const DEFAULT_PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'; // SHA-256 de "1234"

async function hashPIN(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function checkDefaultPIN(socioData) {
  const alert = document.getElementById('member-default-pin-alert');
  const dot = document.getElementById('member-settings-pin-dot');
  const usaPinInicial = socioData.pinHash === DEFAULT_PIN_HASH;
  if (alert) alert.classList.toggle('hidden', !usaPinInicial);
  if (dot) dot.classList.toggle('hidden', !usaPinInicial);
}

async function handleChangeMemberPIN() {
  const currentPin = document.getElementById('member-current-pin').value.trim();
  const newPin = document.getElementById('member-new-pin').value.trim();
  const confirmPin = document.getElementById('member-confirm-pin').value.trim();

  // Validaciones
  if (!/^\d{4}$/.test(currentPin)) {
    showToast('El PIN actual debe tener 4 dígitos.', 'error');
    return;
  }

  if (!/^\d{4}$/.test(newPin)) {
    showToast('El nuevo PIN debe tener exactamente 4 dígitos numéricos.', 'error');
    return;
  }

  if (newPin !== confirmPin) {
    showToast('El nuevo PIN y la confirmación no coinciden.', 'error');
    return;
  }

  if (currentPin === newPin) {
    showToast('El nuevo PIN debe ser diferente al actual.', 'error');
    return;
  }

  try {
    // Verificar PIN actual
    const currentHash = await hashPIN(currentPin);
    const socioDoc = await db.collection('socios').doc(currentMemberSocioId).get();
    
    if (!socioDoc.exists) {
      showToast('Error: no se encontraron datos del socio.', 'error');
      return;
    }

    const socioData = socioDoc.data();
    if (socioData.pinHash !== currentHash) {
      showToast('El PIN actual es incorrecto.', 'error');
      return;
    }

    // Hashear nuevo PIN y actualizar
    const newPinHash = await hashPIN(newPin);
    await db.collection('socios').doc(currentMemberSocioId).update({ pinHash: newPinHash });

    showToast('✓ PIN cambiado exitosamente.', 'success');
    registrarLog("Cambio PIN Socio", `El socio ID: ${currentMemberSocioId} cambió su PIN desde el portal.`);

    // Limpiar campos
    document.getElementById('member-current-pin').value = '';
    document.getElementById('member-new-pin').value = '';
    document.getElementById('member-confirm-pin').value = '';

    // Ocultar aviso de PIN por defecto y cerrar Configuración.
    const alert = document.getElementById('member-default-pin-alert');
    const dot = document.getElementById('member-settings-pin-dot');
    if (alert) alert.classList.add('hidden');
    if (dot) dot.classList.add('hidden');
    closeMemberSettings();

  } catch (error) {
    showToast('Error al cambiar PIN: ' + error.message, 'error');
    console.error('Error changing PIN:', error);
  }
}

// --- CONFIGURACIÓN E INICIALIZACIÓN ---
let db = null;
let memberSocios = []; // Will hold the current member's socio data (as an array for compatibility)
let memberRegistros = []; // Will hold the current member's jornada records
let memberConfig = { objetivoHoras: 40 }; // Default config, will be fetched
let memberSaldosHistoricos = {}; // Will hold the current member's historical balances
let currentMemberSocioId = null;

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
  return memberConfig.objetivoHoras;
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
  if (memberSaldosHistoricos[clave]) {
    return memberSaldosHistoricos[clave];
  }
  return { deudaAnterior: 0, remanenteAnterior: 0, tesoreriaAcumulada: 0 };
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

  // Forzamos persistencia de sesión para evitar conflictos con la cuenta de administrador y loguear errores.
  await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(err => console.error("Error al configurar persistencia de sesión:", err));

  try {
    // Login automático con cuenta genérica para permitir lectura de datos bajo reglas de seguridad.
    // Esto garantiza que cualquier consulta posterior a Firestore esté autenticada.
    if (!firebase.auth().currentUser || firebase.auth().currentUser.email !== "socios@coope.com") {
      const userCredential = await firebase.auth().signInWithEmailAndPassword("socios@coope.com", "socios");
      console.log("Sesión de consulta iniciada:", userCredential.user.email);
    }

    // Test de lectura: intentamos traer la configuración
    const testDoc = await db.collection('config').doc('metaGlobal').get();
    console.log("Test de conexión a Firestore:", testDoc.exists ? "EXITOSO" : "FALLIDO (No existe metaGlobal)");

    // Una vez autenticados con Firebase, verificamos si ya existe una sesión "interna" de socio
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

async function handleMemberLogin() {
  const nombre = cleanText(document.getElementById('member-login-name').value);
  const socioId = document.getElementById('member-login-id').value.trim();
  const submitBtn = document.getElementById('btn-member-login-submit');

  if (!nombre || !socioId) {
    showToast("Por favor, ingresa tu nombre y número de socio.", "error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Verificando...`;
  lucide.createIcons();

  try {
    // Aseguramos que la sesión genérica de Firebase esté activa antes de consultar la base de datos
    if (!firebase.auth().currentUser) {
      await firebase.auth().signInWithEmailAndPassword("socios@coope.com", "socios");
    }

    // Optimizamos: Buscamos directamente por ID de documento (Primary Key)
    const doc = await db.collection('socios').doc(socioId).get();

    if (!doc.exists) {
      showDiagnosticModal(
        "Socio no encontrado", 
        `El número de socio "${socioId}" no existe en la base de datos. Verifica que incluya puntos y guiones si así fue registrado (ej: 1.234.567-8).`,
        true
      );
      return;
    }

    const socioData = doc.data();
    if (cleanText(socioData.nombre) !== nombre) {
      showDiagnosticModal(
        "Nombre no coincide", 
        `El número de socio existe, pero el nombre ingresado no coincide.\n\nIngresaste: "${nombre}"\nEn sistema: "${socioData.nombre.toUpperCase()}"`,
        true
      );
      return;
    }

    currentMemberSocioId = socioData.id;
    localStorage.setItem('memberSocioId', currentMemberSocioId);
    localStorage.setItem('memberSocioName', socioData.nombre); // Store name for display

    showToast(`Bienvenido, ${socioData.nombre}.`, "success");
    showMemberPortal();
    loadMemberData(currentMemberSocioId);

  } catch (error) {
    showToast("Error al intentar acceder: " + error.message, "error");
    console.error("Member login error:", error);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i data-lucide="log-in" class="w-4 h-4"></i> Acceder al Portal`;
    lucide.createIcons();
  }
}

function handleMemberLogout() {
  if (confirm("¿Deseas cerrar sesión en el portal de socios?")) {
    localStorage.removeItem('memberSocioId');
    localStorage.removeItem('memberSocioName');
    currentMemberSocioId = null;
    memberSocios = [];
    memberRegistros = [];
    memberSaldosHistoricos = {};
    showToast("Sesión cerrada.", "info");
    showMemberLogin();
  }
}

async function loadMemberData(socioId) {
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

    // Fetch member's records
    const registrosSnapshot = await db.collection('registros').where('socioId', '==', socioId).get();
    memberRegistros = registrosSnapshot.docs.map(doc => doc.data());

    // Fetch member's historical balances
    const saldosSnapshot = await db.collection('saldosHistoricos').get(); // Fetch all, then filter client-side
    memberSaldosHistoricos = {};
    saldosSnapshot.docs.forEach(doc => {
      const [sId, period] = doc.id.split('_');
      if (sId === socioId) {
        memberSaldosHistoricos[doc.id] = doc.data();
      }
    });

    renderMemberDashboard();
    renderMemberJornadasTable();

  } catch (error) {
    showToast("Error al cargar tus datos: " + error.message, "error");
    console.error("Error loading member data:", error);
  }
}

function renderMemberDashboard() {
  if (!currentMemberSocioId || memberSocios.length === 0) return;

  const socio = memberSocios[0]; // The current member's socio data

  const anio = new Date().getFullYear().toString();
  const mes = (new Date().getMonth() + 1).toString().padStart(2, '0');

  const objetivo = obtenerObjetivoHorasSocio(socio);
  const hist = obtenerSaldoHistoricoAlMes(socio.id, anio, mes);
  const resHoras = obtenerResultadoHorasSocio(socio, anio, mes);

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

  document.getElementById('member-kpi-objetivo').textContent = formatHours(objetivo);
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

  let totalTesoreriaAcumulada = 0;
  for (const clave in memberSaldosHistoricos) {
    if (clave.startsWith(socio.id + '_')) {
      totalTesoreriaAcumulada += (memberSaldosHistoricos[clave].tesoreriaAcumulada || 0);
    }
  }
  document.getElementById('member-kpi-tesoreria').textContent = formatHours(totalTesoreriaAcumulada);
}

function renderMemberJornadasTable() {
  const tbody = document.getElementById('member-jornadas-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (memberRegistros.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-400">No tienes jornadas registradas.</td></tr>`;
    return;
  }

  // Sort by date descending
  const sortedRegistros = [...memberRegistros].sort((a, b) => b.fecha.localeCompare(a.fecha));

  sortedRegistros.forEach(r => {
    const roundedHs = r.estado === 'finalizado' ? getRoundedHours(r.horaIngreso, r.horaSalida) : 0;
    const row = document.createElement('tr');
    row.className = "hover:bg-slate-50 transition";
    row.innerHTML = `
      <td class="py-3 px-4 font-medium text-slate-700">${formatDateString(r.fecha)}</td>
      <td class="py-3 px-4 text-slate-700">${r.trabajadorNombre}</td>
      <td class="py-3 px-4 text-slate-500 font-mono text-[10px]">${r.horaIngreso} hs ${r.horaSalida ? `- ${r.horaSalida} hs` : ''}</td>
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
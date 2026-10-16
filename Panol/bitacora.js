// ============================================================
//  BITÁCORA DE AUDITORÍA — COVIMT 9
// ============================================================
let dbBitacora = null;
let registrosBitacora = [];
let usuarioBitacora = null;
let cancelarEscuchaBitacora = null;

window.addEventListener('DOMContentLoaded', iniciarBitacora);

function iniciarBitacora() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') {
    mostrarEstadoBitacora('No se pudo cargar Firebase o firebaseConfig.js.', true);
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    dbBitacora = firebase.firestore();
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    firebase.auth().onAuthStateChanged(user => {
      usuarioBitacora = user || null;
      if (!user) {
        mostrarEstadoBitacora('La sesión administrativa no está activa. Volviendo al Panel...', true);
        setTimeout(() => { window.location.href = 'index.html'; }, 1200);
        return;
      }
      escucharBitacora();
    });
  } catch (error) {
    mostrarEstadoBitacora('Error al iniciar la Bitácora: ' + error.message, true);
  }
}

function escucharBitacora() {
  if (!dbBitacora) return;
  if (cancelarEscuchaBitacora) cancelarEscuchaBitacora();
  cancelarEscuchaBitacora = dbBitacora.collection('bitacora')
    .orderBy('fecha', 'desc')
    .limit(200)
    .onSnapshot(snapshot => {
      registrosBitacora = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderBitacora();
    }, error => {
      console.error(error);
      mostrarEstadoBitacora('No se pudo leer la Bitácora: ' + error.message, true);
    });
}

function fechaLogAFecha(valor) {
  if (!valor) return null;
  if (typeof valor.toDate === 'function') return valor.toDate();
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function formatearFechaHoraLog(valor) {
  const fecha = fechaLogAFecha(valor);
  if (!fecha) return '-';
  return fecha.toLocaleString('es-UY', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function obtenerBitacoraFiltrada() {
  const texto = (document.getElementById('filter-log')?.value || '').trim().toLocaleLowerCase('es-UY');
  const desdeValor = document.getElementById('filter-date-from')?.value || '';
  const hastaValor = document.getElementById('filter-date-to')?.value || '';
  const desde = desdeValor ? new Date(`${desdeValor}T00:00:00`) : null;
  const hasta = hastaValor ? new Date(`${hastaValor}T23:59:59.999`) : null;
  return registrosBitacora.filter(registro => {
    const fecha = fechaLogAFecha(registro.fecha);
    if (desde && (!fecha || fecha < desde)) return false;
    if (hasta && (!fecha || fecha > hasta)) return false;
    if (!texto) return true;
    return [registro.usuario, registro.accion, registro.detalle]
      .some(valor => String(valor || '').toLocaleLowerCase('es-UY').includes(texto));
  });
}

function renderBitacora() {
  const tbody = document.getElementById('tbl-bitacora');
  if (!tbody) return;
  const filtrados = obtenerBitacoraFiltrada();
  tbody.innerHTML = '';
  if (filtrados.length === 0) {
    mostrarEstadoBitacora(registrosBitacora.length === 0 ? 'La Bitácora está vacía.' : 'No hay eventos que coincidan con los filtros.');
    return;
  }
  filtrados.forEach(registro => {
    const fila = document.createElement('tr');
    fila.className = 'hover:bg-slate-50 transition';
    const valores = [
      formatearFechaHoraLog(registro.fecha),
      registro.usuario || 'Sistema',
      registro.accion || '-',
      registro.detalle || '-'
    ];
    valores.forEach((valor, indice) => {
      const celda = document.createElement('td');
      celda.className = indice === 0
        ? 'py-3 px-6 whitespace-nowrap text-xs text-slate-500'
        : indice === 2
          ? 'py-3 px-6 text-xs font-semibold text-slate-700'
          : 'py-3 px-6 text-xs text-slate-600';
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    tbody.appendChild(fila);
  });
}

function mostrarEstadoBitacora(mensaje, error = false) {
  const tbody = document.getElementById('tbl-bitacora');
  if (!tbody) return;
  tbody.innerHTML = '';
  const fila = document.createElement('tr');
  const celda = document.createElement('td');
  celda.colSpan = 4;
  celda.className = `p-8 text-center italic ${error ? 'text-red-600' : 'text-slate-400'}`;
  celda.textContent = mensaje;
  fila.appendChild(celda);
  tbody.appendChild(fila);
}

function showToast(mensaje, tipo = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const colores = {
    success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-slate-800'
  };
  const toast = document.createElement('div');
  toast.className = `${colores[tipo] || colores.info} text-white px-5 py-3 rounded-xl shadow-xl text-sm font-semibold max-w-sm text-center pointer-events-auto`;
  toast.textContent = mensaje;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function confirmarAccionBitacora(titulo, mensaje, solicitarClave = false) {
  return new Promise(resolve => {
    const modal = document.getElementById('modal-confirmation');
    const contenedorClave = document.getElementById('conf-modal-prompt-container');
    const input = document.getElementById('conf-modal-input');
    const confirmar = document.getElementById('btn-conf-modal-confirm');
    const cancelar = document.getElementById('btn-conf-modal-cancel');
    document.getElementById('conf-modal-title').textContent = titulo;
    document.getElementById('conf-modal-message').textContent = mensaje;
    contenedorClave.classList.toggle('hidden', !solicitarClave);
    input.value = '';
    modal.classList.remove('hidden');

    const cerrar = resultado => {
      modal.classList.add('hidden');
      confirmar.onclick = null;
      cancelar.onclick = null;
      resolve(resultado);
    };
    cancelar.onclick = () => cerrar(false);
    confirmar.onclick = () => {
      if (solicitarClave && input.value.trim() !== 'admin') {
        showToast('Clave administrativa incorrecta.', 'error');
        input.focus();
        return;
      }
      cerrar(true);
    };
    if (solicitarClave) input.focus();
  });
}

async function clearBitacora() {
  if (!dbBitacora || !usuarioBitacora) return;
  if (!navigator.onLine) {
    showToast('La limpieza de la Bitácora requiere conexión.', 'error');
    return;
  }
  const confirmado = await confirmarAccionBitacora(
    'Limpiar Bitácora',
    'Esta acción eliminará todos los eventos de auditoría. Exporte el PDF antes de continuar. Ingrese la clave administrativa para confirmar.',
    true
  );
  if (!confirmado) return;

  try {
    showToast('Limpiando Bitácora...', 'info');
    const snapshot = await dbBitacora.collection('bitacora').get();
    for (let inicio = 0; inicio < snapshot.docs.length; inicio += 400) {
      const batch = dbBitacora.batch();
      snapshot.docs.slice(inicio, inicio + 400).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    await dbBitacora.collection('bitacora').add({
      fecha: new Date().toISOString(),
      usuario: usuarioBitacora.email || 'Admin',
      accion: 'Limpieza Bitácora',
      detalle: `Se eliminaron ${snapshot.docs.length} eventos anteriores.`
    });
    showToast('Bitácora limpiada correctamente.', 'success');
  } catch (error) {
    showToast('Error al limpiar la Bitácora: ' + error.message, 'error');
  }
}

function exportBitacoraPDF() {
  const filtrados = obtenerBitacoraFiltrada();
  if (filtrados.length === 0) {
    showToast('No hay eventos para exportar con los filtros actuales.', 'info');
    return;
  }
  if (!window.jspdf?.jsPDF) {
    showToast('No se pudo cargar el generador PDF.', 'error');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('l', 'mm', 'a4');
  const logo = document.querySelector('header img');
  if (logo?.complete && logo.naturalWidth) {
    try { doc.addImage(logo, 'PNG', 14, 8, 12, 12); } catch (error) { console.error(error); }
  }
  doc.setFontSize(15);
  doc.setTextColor(5, 95, 70);
  doc.text('COVIMT 9 · Bitácora de Auditoría', 30, 15);
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(`Generado: ${new Date().toLocaleString('es-UY')} · ${filtrados.length} eventos`, 30, 20);
  doc.autoTable({
    head: [['Fecha y hora', 'Usuario', 'Acción', 'Detalle del movimiento']],
    body: filtrados.map(registro => [
      formatearFechaHoraLog(registro.fecha),
      registro.usuario || 'Sistema',
      registro.accion || '-',
      registro.detalle || '-'
    ]),
    startY: 25,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1.5, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [5, 150, 105], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 35 }, 1: { cellWidth: 48 }, 2: { cellWidth: 52 }, 3: { cellWidth: 132 }
    },
    margin: { top: 25, right: 10, bottom: 12, left: 10 },
    didDrawPage(data) {
      doc.setFontSize(7);
      doc.setTextColor(120);
      doc.text(`Página ${data.pageNumber}`, 280, 202, { align: 'right' });
    }
  });
  doc.save(`COVIMT9_Bitacora_${new Date().toISOString().slice(0, 10)}.pdf`);
  showToast('PDF de Bitácora generado.', 'success');
}

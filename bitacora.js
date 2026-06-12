let db = null;
let logs = [];

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();

  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      startSync();
    } else {
      showToast("Debes estar logueado como administrador.", "error");
      await new Promise(r => setTimeout(r, 2000));
      location.href = 'index.html';
    }
  });
});

function startSync() {
  // Traemos los últimos 200 logs ordenados por fecha descendente
  db.collection('bitacora')
    .orderBy('fecha', 'desc')
    .limit(200)
    .onSnapshot((snapshot) => {
      logs = snapshot.docs.map(doc => doc.data());
      renderBitacora();
    });
}

function renderBitacora() {
  const tbody = document.getElementById('tbl-bitacora');
  const filter = document.getElementById('filter-log').value.toLowerCase();
  const dateFrom = document.getElementById('filter-date-from').value;
  const dateTo = document.getElementById('filter-date-to').value;

  if (!tbody) return;

  const filtrados = logs.filter(l => {
    const matchesText = l.usuario.toLowerCase().includes(filter) || 
                        l.accion.toLowerCase().includes(filter) ||
                        l.detalle.toLowerCase().includes(filter);
    
    let matchesDate = true;
    const logDate = l.fecha.split('T')[0]; // Obtiene YYYY-MM-DD
    if (dateFrom && logDate < dateFrom) matchesDate = false;
    if (dateTo && logDate > dateTo) matchesDate = false;

    return matchesText && matchesDate;
  });

  tbody.innerHTML = filtrados.map(l => {
    const f = new Date(l.fecha);
    const fechaFormateada = f.toLocaleDateString() + ' ' + f.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="py-3 px-6 font-mono text-[11px] text-slate-500">${fechaFormateada}</td>
        <td class="py-3 px-6 font-bold text-slate-700">${l.usuario}</td>
        <td class="py-3 px-6">
          <span class="px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold uppercase border border-slate-200">${l.accion}</span>
        </td>
        <td class="py-3 px-6 text-slate-600 text-xs">${l.detalle}</td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
}

function exportBitacoraPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');

  const filter = document.getElementById('filter-log').value.toLowerCase();
  const dateFrom = document.getElementById('filter-date-from').value;
  const dateTo = document.getElementById('filter-date-to').value;

  const filtrados = logs.filter(l => {
    const matchesText = l.usuario.toLowerCase().includes(filter) || 
                        l.accion.toLowerCase().includes(filter) ||
                        l.detalle.toLowerCase().includes(filter);
    let matchesDate = true;
    const logDate = l.fecha.split('T')[0];
    if (dateFrom && logDate < dateFrom) matchesDate = false;
    if (dateTo && logDate > dateTo) matchesDate = false;
    return matchesText && matchesDate;
  });

  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text("Bitácora de Auditoría - COVIMT 9", 105, 15, { align: 'center' });
  doc.setFontSize(10);
  const rangeText = (dateFrom || dateTo) ? `Período: ${dateFrom || '...'} al ${dateTo || '...'}` : "Reporte Completo (Últimos 200)";
  doc.text(rangeText, 105, 22, { align: 'center' });

  const tableData = filtrados.map(l => {
    const f = new Date(l.fecha);
    return [
      f.toLocaleDateString() + ' ' + f.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
      l.usuario,
      l.accion,
      l.detalle
    ];
  });

  doc.autoTable({
    head: [['Fecha', 'Usuario', 'Acción', 'Detalle']],
    body: tableData,
    startY: 30,
    theme: 'grid',
    styles: { fontSize: 7.5 },
    headStyles: { fillColor: [30, 41, 59], halign: 'center' },
    columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 35 }, 2: { cellWidth: 30 } }
  });

  registrarLog("Exportación PDF", `Se generó un reporte PDF de la bitácora (${rangeText})`);
  doc.save(`Bitacora_COVIMT9_${new Date().toISOString().split('T')[0]}.pdf`);
}

async function clearBitacora() {
  // Pedimos confirmación y password en un mismo flujo visual
  if (await showConfirmModal("Limpiar Bitácora", "¿Estás seguro de borrar el historial? Esta acción no se puede deshacer. Por seguridad, ingrese la clave administrativa:", true)) {
    
    const password = document.getElementById('conf-modal-input').value;
    if (password !== "admin") {
      showToast("Clave incorrecta. La bitácora no ha sido borrada.", "error");
      return;
    }

    try {
      const snapshot = await db.collection('bitacora').get();
      let batch = db.batch();
      let count = 0;

      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
        count++;
        if (count === 400) { // Límite de batch en Firestore es 500
          await batch.commit();
          batch = db.batch();
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
      
      // Dejar constancia de la limpieza en la nueva bitácora vacía
      await registrarLog("Limpieza Bitácora", "Se ha vaciado el historial completo de auditoría.");
      showToast("Bitácora limpiada con éxito.", "success");
    } catch (error) {
      console.error("Error al limpiar bitácora:", error);
      showToast("Error al limpiar bitácora: " + error.message, "error");
    }
  }
}

function showConfirmModal(title, message, isPrompt = false) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-confirmation');
    document.getElementById('conf-modal-title').textContent = title;
    document.getElementById('conf-modal-message').textContent = message;
    
    const promptContainer = document.getElementById('conf-modal-prompt-container');
    const promptInput = document.getElementById('conf-modal-input');
    const btnConfirm = document.getElementById('btn-conf-modal-confirm');
    const btnCancel = document.getElementById('btn-conf-modal-cancel');

    if (isPrompt) {
      promptContainer.classList.remove('hidden');
      promptInput.value = '';
      setTimeout(() => promptInput.focus(), 100);
    } else {
      promptContainer.classList.add('hidden');
    }
    
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
    await db.collection('bitacora').add(logEntry);
  } catch (e) { console.error("Error bitácora:", e); }
}
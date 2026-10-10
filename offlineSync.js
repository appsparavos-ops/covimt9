// ============================================================
//  OFFLINE SYNC MODULE — COVIMT 9
//  Cola de operaciones offline con sincronización manual/automática
// ============================================================

const OfflineSync = (() => {
  const QUEUE_KEY = 'covimt9_offline_queue';
  let _syncing = false;
  let _onSyncComplete = null; // callback tras sync exitoso

  // --- Cola de operaciones ---

  function _loadQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
    } catch { return []; }
  }

  function _saveQueue(queue) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    _updateUI();
  }

  function getQueue() {
    return _loadQueue();
  }

  function getPendingCount() {
    return _loadQueue().length;
  }

  function hasPending() {
    return getPendingCount() > 0;
  }

  // --- Encolar operaciones ---

  function enqueue(collection, docId, operation, data) {
    const queue = _loadQueue();
    const entry = {
      id: 'op-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      timestamp: new Date().toISOString(),
      collection,
      docId: docId || null,
      operation, // 'set', 'update', 'merge', 'delete', 'add'
      data: data || null
    };
    queue.push(entry);
    _saveQueue(queue);
    console.log('[OfflineSync] Operación encolada:', entry.operation, collection + '/' + (docId || '(auto)'));
    return entry;
  }

  // --- Ejecutar una operación en Firestore ---

  async function _executeOp(op, dbRef) {
    const { collection, docId, operation, data } = op;

    switch (operation) {
      case 'set':
        await dbRef.collection(collection).doc(docId).set(data);
        break;
      case 'update':
        await dbRef.collection(collection).doc(docId).update(data);
        break;
      case 'merge':
        await dbRef.collection(collection).doc(docId).set(data, { merge: true });
        break;
      case 'delete':
        await dbRef.collection(collection).doc(docId).delete();
        break;
      case 'add':
        await dbRef.collection(collection).add(data);
        break;
      default:
        throw new Error('Operación desconocida: ' + operation);
    }
  }

  // --- Sincronizar toda la cola ---

  async function syncAll(dbRef) {
    if (_syncing) {
      console.warn('[OfflineSync] Ya hay una sincronización en curso.');
      return;
    }
    if (!navigator.onLine) {
      if (typeof showToast === 'function') showToast('Sin conexión. No se puede sincronizar.', 'error');
      return;
    }

    const queue = _loadQueue();
    if (queue.length === 0) {
      if (typeof showToast === 'function') showToast('No hay operaciones pendientes.', 'info');
      return;
    }

    _syncing = true;
    _updateUI();

    let successCount = 0;
    let errorCount = 0;
    const failedOps = [];

    for (let i = 0; i < queue.length; i++) {
      const op = queue[i];
      try {
        await _executeOp(op, dbRef);
        successCount++;
      } catch (err) {
        console.error('[OfflineSync] Error en operación:', op, err);
        errorCount++;
        failedOps.push(op);
      }
      // Actualizar progreso
      _updateSyncProgress(i + 1, queue.length);
    }

    // Conservar solo las fallidas
    _saveQueue(failedOps);

    _syncing = false;
    _updateUI();

    if (typeof showToast === 'function') {
      if (errorCount === 0) {
        showToast(`✓ ${successCount} operaciones sincronizadas con éxito.`, 'success');
      } else {
        showToast(`${successCount} OK, ${errorCount} fallaron. Revisa la consola.`, 'error');
      }
    }

    // Callback para re-renderizar todo tras sincronización
    if (_onSyncComplete && typeof _onSyncComplete === 'function') {
      _onSyncComplete();
    }

    return { successCount, errorCount, failedOps };
  }

  // --- Limpiar cola ---

  function clearQueue() {
    _saveQueue([]);
    if (typeof showToast === 'function') showToast('Cola de operaciones vaciada.', 'info');
  }

  // --- Eliminar una operación específica ---

  function removeOp(opId) {
    const queue = _loadQueue().filter(op => op.id !== opId);
    _saveQueue(queue);
  }

  // --- Callback post-sync ---

  function onSyncComplete(callback) {
    _onSyncComplete = callback;
  }

  // --- Precarga de datos para offline ---

  async function precargarDatos(dbRef) {
    if (!navigator.onLine || !dbRef) return;
    try {
      console.log('[OfflineSync] Precargando datos para modo offline...');
      await Promise.all([
        dbRef.collection('socios').get(),
        dbRef.collection('registros').get(),
        dbRef.collection('saldosHistoricos').get(),
        dbRef.collection('comisiones').get(),
        dbRef.collection('config').doc('metaGlobal').get(),
      ]);
      localStorage.setItem('covimt9_lastPrecarga', new Date().toISOString());
      console.log('[OfflineSync] Precarga completada.');
    } catch (e) {
      console.warn('[OfflineSync] Error en precarga (puede ser normal si falta alguna colección):', e.message);
    }
  }

  // --- UI: Indicadores ---

  function _updateUI() {
    const count = getPendingCount();

    // Badge de pendientes
    const badge = document.getElementById('offline-pending-badge');
    if (badge) {
      if (count > 0) {
        badge.classList.remove('hidden');
        badge.querySelector('.pending-count') && (badge.querySelector('.pending-count').textContent = count);
        // Alternativa: buscar span con clase
        const countEl = badge.querySelector('[data-pending-count]');
        if (countEl) countEl.textContent = count;
      } else {
        badge.classList.add('hidden');
      }
    }

    // Banner de sincronización
    const banner = document.getElementById('sync-banner');
    if (banner) {
      if (count > 0 && navigator.onLine) {
        banner.classList.remove('hidden');
        const countEl = banner.querySelector('[data-pending-count]');
        if (countEl) countEl.textContent = count;
      } else {
        banner.classList.add('hidden');
      }
    }

    // Indicador de sincronización en progreso
    const syncBtn = document.getElementById('btn-sync-offline');
    if (syncBtn) {
      if (_syncing) {
        syncBtn.disabled = true;
        syncBtn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Sincronizando...';
      } else {
        syncBtn.disabled = false;
        syncBtn.innerHTML = '<i data-lucide="cloud-upload" class="w-4 h-4"></i> Sincronizar Ahora';
      }
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }

  function _updateSyncProgress(current, total) {
    const progressEl = document.getElementById('sync-progress-text');
    if (progressEl) {
      progressEl.textContent = `Procesando ${current} de ${total}...`;
    }
  }

  // --- Detectores de conexión ---

  function setupConnectionListeners(dbRef) {
    // Al volver online
    window.addEventListener('online', () => {
      console.log('[OfflineSync] Conexión restaurada.');
      _updateUI();

      if (hasPending()) {
        // Mostrar banner de sincronización
        const banner = document.getElementById('sync-banner');
        if (banner) {
          banner.classList.remove('hidden');
          const countEl = banner.querySelector('[data-pending-count]');
          if (countEl) countEl.textContent = getPendingCount();
        }
        if (typeof showToast === 'function') {
          showToast('Conexión restaurada. Hay operaciones pendientes de sincronizar.', 'info');
        }
      }

      // Re-precargar datos
      precargarDatos(dbRef);
    });

    // Al perder conexión
    window.addEventListener('offline', () => {
      console.log('[OfflineSync] Conexión perdida. Modo offline activado.');
      _updateUI();
      if (typeof showToast === 'function') {
        showToast('Sin conexión. Los cambios se guardarán localmente.', 'error');
      }
    });

    // Verificar al iniciar
    if (navigator.onLine && hasPending()) {
      // Esperar un momento para que la UI esté lista
      setTimeout(() => {
        const banner = document.getElementById('sync-banner');
        if (banner) {
          banner.classList.remove('hidden');
          const countEl = banner.querySelector('[data-pending-count]');
          if (countEl) countEl.textContent = getPendingCount();
        }
      }, 1500);
    }
  }

  // --- Inicialización ---

  function init(dbRef) {
    _updateUI();
    setupConnectionListeners(dbRef);

    // Precargar datos si hay conexión
    if (navigator.onLine) {
      precargarDatos(dbRef);
    }
  }

  // API pública
  return {
    enqueue,
    syncAll,
    clearQueue,
    removeOp,
    getQueue,
    getPendingCount,
    hasPending,
    precargarDatos,
    init,
    onSyncComplete,
    _updateUI
  };
})();

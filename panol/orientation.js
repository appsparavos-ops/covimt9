// C9 - Soporte de orientación dinámica (sigue al dispositivo)
(function(){
  function onOrientationChange(){
    // Fuerza recálculo de layout y refresco de iconos
    document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
    if (window.lucide && typeof lucide.createIcons === 'function') {
      try { lucide.createIcons(); } catch(e){}
    }
    // Algunos WebView/PWA necesitan un reflow mínimo al girar
    window.dispatchEvent(new Event('resize'));
  }
  // Inicial
  onOrientationChange();
  window.addEventListener('orientationchange', onOrientationChange);
  window.addEventListener('resize', onOrientationChange);
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', onOrientationChange);
  }
  // Para PWA instalada: asegura que no quede lock previo
  if (screen.orientation && screen.orientation.unlock) {
    try { screen.orientation.unlock(); } catch(e){}
  }
})();

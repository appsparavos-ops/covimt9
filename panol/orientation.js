// C9 - Soporte orientación V2: fuerza unlock y recalcula layout
(function(){
  function log(msg){ try{ console.log('[orientación]', msg); }catch(e){} }
  function onOrientationChange(){
    var vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', vh + 'px');
    document.documentElement.style.setProperty('--vw', (window.innerWidth * 0.01) + 'px');
    if (window.lucide && typeof lucide.createIcons === 'function') {
      try { lucide.createIcons(); } catch(e){}
    }
    // Reflow para WebView/PWA
    document.body.style.display = 'none';
    document.body.offsetHeight;
    document.body.style.display = '';
    window.dispatchEvent(new Event('resize'));
    log('cambio a ' + (screen.orientation ? screen.orientation.type : window.orientation) + ' ' + window.innerWidth + 'x' + window.innerHeight);
  }
  onOrientationChange();
  window.addEventListener('orientationchange', onOrientationChange);
  window.addEventListener('resize', onOrientationChange);
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', onOrientationChange);
  }
  // Desbloquear orientación si quedó lock previo (portrait-primary)
  function tryUnlock(){
    if (screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); log('unlock() ok'); } catch(e){ log('unlock fail: '+e.message); }
    }
    if (screen.lockOrientation) { try{ screen.lockOrientation('any'); }catch(e){} }
  }
  tryUnlock();
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) tryUnlock(); });
  window.addEventListener('load', tryUnlock);
  setTimeout(tryUnlock, 1000);
})();

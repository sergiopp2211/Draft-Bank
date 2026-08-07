/* DRAFT BANK · utilidades compartidas del portal */
(function(){
  "use strict";

  var contenedor = null;
  function getToastContainer(){
    if(!contenedor){
      contenedor = document.getElementById('toast-container');
      if(!contenedor){
        contenedor = document.createElement('div');
        contenedor.id = 'toast-container';
        document.body.appendChild(contenedor);
      }
    }
    return contenedor;
  }

  window.mostrarNotificacion = function(mensaje){
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = mensaje;
    getToastContainer().appendChild(toast);
    setTimeout(function(){
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', function(){ toast.remove(); }, { once:true });
    }, 3000);
  };

  var THEME_KEY = 'tema-preferido';
  var toggleBtn = document.getElementById('themeToggleBtn');
  var icon = document.getElementById('themeToggleIcon');
  var label = document.getElementById('themeToggleLabel');

  function currentTheme(){
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyThemeUI(theme){
    if(theme === 'light'){
      if(icon) icon.textContent = '☀️';
      if(label) label.textContent = 'Modo Claro';
    } else {
      if(icon) icon.textContent = '🌙';
      if(label) label.textContent = 'Modo Oscuro';
    }
  }

  function setTheme(theme, notify){
    if(theme === 'light'){
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try{ localStorage.setItem(THEME_KEY, theme); }catch(e){}
    applyThemeUI(theme);
    if(notify){
      window.mostrarNotificacion(theme === 'light' ? '☀️ Modo claro activado' : '🌙 Modo oscuro activado');
    }
  }

  if(toggleBtn){
    applyThemeUI(currentTheme());
    toggleBtn.addEventListener('click', function(){
      setTheme(currentTheme() === 'light' ? 'dark' : 'light', true);
    });
  }

  window.draftBankSetTheme = setTheme;
})();

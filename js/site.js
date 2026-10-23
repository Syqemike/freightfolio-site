/* Shared navigation: progressively enhanced, no perpetual animation. */
(function(){
 'use strict';
 var toggle=document.querySelector('.nav-toggle'),menu=document.getElementById('navMenu');
 function close(){if(!menu||!toggle)return;menu.classList.remove('open');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open menu');}
 if(toggle&&menu){
  toggle.addEventListener('click',function(){var open=menu.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close menu':'Open menu');});
  menu.addEventListener('click',function(e){if(e.target.closest('a'))close();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&menu.classList.contains('open')){close();toggle.focus();}});
  document.addEventListener('click',function(e){if(!e.target.closest('.site-header'))close();});
  window.matchMedia('(min-width:761px)').addEventListener('change',close);
 }
 var path=location.pathname.replace(/\.html$/,'').replace(/\/$/,'')||'/';
 document.querySelectorAll('.nav-menu a').forEach(function(a){if(a.pathname.replace(/\.html$/,'').replace(/\/$/,'')===path){a.classList.add('active');a.setAttribute('aria-current','page');}});
 document.querySelectorAll('[data-year]').forEach(function(e){e.textContent=new Date().getFullYear();});
 document.querySelectorAll('.reveal').forEach(function(e){e.classList.add('visible');});
 document.querySelectorAll('#timeline .tl-dot').forEach(function(dot){dot.addEventListener('click',function(){var expanded=dot.closest('.tl-step').classList.toggle('expanded');dot.setAttribute('aria-expanded',String(expanded));});});
})();

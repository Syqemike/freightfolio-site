/* User-driven portfolio preview; no autoplay or animation loop. */
(function () {
  'use strict';
  var projects = {
    studio: {name:'Studio 601 Barbershop',type:'Barber shop',slug:'studio-601-barbershop-614626f4a004308a',address:'studio 601'},
    tail: {name:'TailWaggers Salon',type:'Pet grooming',slug:'tailwaggers-salon-8e035e0e1cb623eb',address:'tailwaggers'}
  };
  document.querySelectorAll('[data-showcase]').forEach(function(stage){
    var project='studio', device='desktop';
    function sizePreview(){var win=stage.querySelector('.preview-window'),frame=stage.querySelector('[data-preview]'),w=device==='desktop'?1440:390;frame.style.width=w+'px';frame.style.height=(win.clientHeight/(win.clientWidth/w))+'px';frame.style.transform='scale('+(win.clientWidth/w)+')';}
    if('ResizeObserver' in window){new ResizeObserver(sizePreview).observe(stage.querySelector('.preview-window'));}else{window.addEventListener('resize',sizePreview);}
    sizePreview();
    function update(){
      var p=projects[project],img=stage.querySelector('[data-preview]');
      img.src='/concepts/'+p.slug+'/';
      img.title=p.name+' website design concept, '+device+' preview';
      
      stage.dataset.active=project;stage.classList.toggle('mobile',device==='mobile');
      sizePreview();
      stage.querySelector('[data-project-name]').textContent=p.name;
      stage.querySelector('[data-project-type]').textContent=p.type+' · Design demonstration';
      stage.querySelector('[data-address]').textContent=p.address+' / design concept';
      stage.querySelector('[data-demo]').href='/concepts/'+p.slug+'/';
      stage.querySelectorAll('[data-project]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.project===project));});
      stage.querySelectorAll('[data-device]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.device===device));});
    }
    stage.querySelectorAll('[data-project]').forEach(function(b){b.addEventListener('click',function(){project=b.dataset.project;update();});});
    stage.querySelectorAll('[data-device]').forEach(function(b){b.addEventListener('click',function(){device=b.dataset.device;update();});});
  });
})();

const menuButton=document.querySelector('.menu-toggle');
const nav=document.querySelector('.site-nav');
if(menuButton&&nav){
  menuButton.addEventListener('click',()=>{
    const open=nav.classList.toggle('open');
    menuButton.setAttribute('aria-expanded',String(open));
  });
  nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{
    nav.classList.remove('open');
    menuButton.setAttribute('aria-expanded','false');
  }));
}
const year=document.getElementById('year');
if(year)year.textContent=new Date().getFullYear();

const prefersReduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealEls=[...document.querySelectorAll('.reveal')];
if(prefersReduced){
  revealEls.forEach(el=>el.classList.add('in'));
}else{
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    });
  },{threshold:.12});
  revealEls.forEach(el=>observer.observe(el));

  const glow=document.querySelector('.cursor-glow');
  if(glow){
    window.addEventListener('pointermove',e=>{
      glow.style.left=e.clientX+'px';
      glow.style.top=e.clientY+'px';
    },{passive:true});
  }
}
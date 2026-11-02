
/* Power Gym Studio motion system: navigation transitions + accessible loading states */
(() => {
 'use strict';
 const ready = () => {
   if (document.querySelector('.pg-page-loader')) return;
   const loader=document.createElement('div');
   loader.className='pg-page-loader';
   loader.setAttribute('aria-hidden','true');
   loader.innerHTML='<div><div class="pg-loader-core"></div><div class="pg-loader-caption">POWER GYM · جاري فتح القسم</div></div>';
   document.body.appendChild(loader);

   let timer=0;
   const isVisible = el => !!el && !el.classList.contains('hidden') && getComputedStyle(el).display!=='none';
   const animateVisible = () => {
     const candidates=[...document.querySelectorAll('main > section, main > div[id], #playersDirectory, #financeModal, #reportsSection')];
     candidates.forEach(el=>{
       if(isVisible(el) && !el.dataset.pgMotionSeen){
         el.dataset.pgMotionSeen='1';
         el.classList.add('pg-view-enter');
         el.addEventListener('animationend',()=>el.classList.remove('pg-view-enter'),{once:true});
       }
     });
   };
   const observer=new MutationObserver(records=>{
     let changed=false;
     for(const r of records){
       if(r.type==='attributes' && r.attributeName==='class') changed=true;
       if(r.type==='childList') changed=true;
     }
     if(changed) requestAnimationFrame(animateVisible);
   });
   observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
   animateVisible();

   // A short visual transition for section navigation only; never delays form submission.
   document.addEventListener('click',event=>{
     const link=event.target.closest('button, a');
     if(!link || link.disabled) return;
     const label=(link.innerText||link.getAttribute('aria-label')||'').trim();
     const navigates=link.classList.contains('sidebar-link') || link.classList.contains('mnav-btn') ||
       /لوحة التحكم|اللاعبين|الاشتراكات|الحسابات|التقارير|المخزن|المدربين|الحضور/.test(label);
     if(!navigates) return;
     loader.classList.add('is-on');
     clearTimeout(timer);
     timer=setTimeout(()=>loader.classList.remove('is-on'),260);
   },true);
   window.addEventListener('pageshow',()=>loader.classList.remove('is-on'));
 };
 if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',ready,{once:true});
 else ready();
})();

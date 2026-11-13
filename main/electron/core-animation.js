/* Nube volumetrica local: movimiento interno, sin anillos ni zoom del canvas. */
window.startBitCore = function (canvas, readState) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const count = canvas.id === 'coreParticles' ? 110 : 230;
  const particles = Array.from({length: count}, () => ({
    angle: Math.random()*Math.PI*2, latitude: Math.acos(2*Math.random()-1),
    radius: Math.pow(Math.random(), .65), phase: Math.random()*Math.PI*2,
    size: .6+Math.random()*1.1
  }));
  let width=0,height=0,last=0,time=0,frameId;
  let flow=.25, turbulence=.025, energy=.2, hover=0, rotation=0, wavePhase=0, shearPhase=0;
  function resize() {
    const box=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);
    width=box.width;height=box.height;canvas.width=width*ratio;canvas.height=height*ratio;
    ctx.setTransform(ratio,0,0,ratio,0,0);
  }
  function frame(now) {
    frameId=requestAnimationFrame(frame);
    if(document.hidden){last=now;return;}
    if(now-last<1000/30)return;
    const dt=Math.min((now-last)/1000,.05);last=now;
    if(!reduced.matches)time+=dt;
    const {state,level=0,hovered=false}=readState();
    hover+=((hovered?1:0)-hover)*.1;
    const thinking=state==='processing'||state==='thinking',speaking=state==='speaking',listening=state==='listening';
    const targetFlow=thinking?1.3:speaking?.65:listening?.45:.18;
    const targetTurbulence=thinking?.12:speaking?.19+level*.12:listening?.075:.025;
    flow+=(targetFlow+hover*.95-flow)*.12;turbulence+=(targetTurbulence+hover*.075-turbulence)*.12;
    if(!reduced.matches){rotation+=dt*flow;wavePhase+=dt*(speaking?7:2.4);shearPhase+=dt*(thinking?3:1.5);}
    energy+=((speaking?.75+level*.25:listening?.55:thinking?.65:.25)+hover*.65-energy)*.12;
    const t=time,cx=width/2,cy=height/2,extent=Math.min(width,height)*.39;
    ctx.clearRect(0,0,width,height);
    const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,extent);
    glow.addColorStop(0,'rgba(110,235,255,'+(.09+energy*.08)+')');
    glow.addColorStop(.65,'rgba(20,130,180,.035)');glow.addColorStop(1,'rgba(0,100,140,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
    // Luz suave descentrada: da volumen sin formar un borde circular.
    const lightX=cx-extent*.09,lightY=cy-extent*.12;
    const heart=ctx.createRadialGradient(lightX,lightY,0,cx,cy,extent*.62);
    heart.addColorStop(0,'rgba(221,255,255,'+(.38+energy*.16)+')');
    heart.addColorStop(.12,'rgba(131,241,255,.28)');
    heart.addColorStop(.38,thinking?'rgba(107,128,255,.17)':'rgba(36,180,218,.18)');
    heart.addColorStop(1,'rgba(9,70,120,0)');
    ctx.fillStyle=heart;ctx.fillRect(0,0,width,height);
    ctx.globalCompositeOperation='lighter';
    // Hebras abiertas de plasma atraviesan el interior y cambian su curvatura.
    for(let strand=0;strand<12;strand++){
      const phase=strand*2.39996,drift=t*.3+rotation*.25,span=extent*(.32+(strand%4)*.13);
      const dx=Math.cos(phase+drift),dy=Math.sin(phase+drift)*.72;
      const bend=Math.sin(t*.9+phase)*extent*.27;
      ctx.globalAlpha=.045+energy*.045+hover*.14;ctx.strokeStyle=thinking?'#9aabff':listening?'#63edce':'#51cde9';
      ctx.lineWidth=strand%3===0?1.3:.6;ctx.beginPath();
      ctx.moveTo(cx-dx*span,cy-dy*span);
      ctx.bezierCurveTo(cx-dy*bend,cy+dx*bend,cx+dy*bend+Math.sin(phase)*span*.25,cy-dx*bend,cx+dx*span,cy+dy*span);
      ctx.stroke();
    }
    for(const p of particles) {
      // Cada capa gira a una velocidad distinta y se deforma en tres dimensiones.
      const angle=p.angle+rotation*(1.5-p.radius)+Math.sin(t*.8+p.phase)*turbulence;
      const latitude=p.latitude+Math.sin(t*1.6+p.phase)*turbulence;
      const radial=p.radius+Math.sin(wavePhase+p.phase+p.radius*9)*turbulence*(1-p.radius*.5);
      const x=Math.cos(angle)*Math.sin(latitude)*radial;
      const z=Math.sin(angle)*Math.sin(latitude)*radial;
      const y=Math.cos(latitude)*radial;
      const shear=Math.sin(y*5+shearPhase+p.phase)*turbulence;
      const px=cx+(x+shear*.5)*extent,py=cy+(y*.87+Math.sin(x*5-t*2+p.phase)*turbulence*.45)*extent;
      const depth=(z+1)*.5;const alpha=(.18+depth*.65)*(1-p.radius*.45)*(.86+.14*Math.sin(t*2+p.phase));
      ctx.globalAlpha=Math.min(1,alpha*(1+hover*.22));ctx.fillStyle=depth>.72?'#d7ffff':thinking?'#8e9bea':listening?'#58dabb':'#43b9dc';
      const size=p.size*(.45+depth*.95);
      if(depth>.72&&p.size>1.3){ctx.globalAlpha=alpha*.13;ctx.beginPath();ctx.arc(px,py,size*3,0,Math.PI*2);ctx.fill();}
      ctx.globalAlpha=Math.min(1,alpha*(1+hover*.45));ctx.beginPath();ctx.arc(px,py,size,0,Math.PI*2);ctx.fill();
      // Filamentos cortos dentro de la nube: nunca dibujan una circunferencia.
      if(p.radius<.85&&p.size>1.3){
        ctx.globalAlpha=alpha*.28;ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.65;
        ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px-Math.sin(angle)*extent*.045,py+Math.cos(latitude+t)*extent*.035);ctx.stroke();
      }
    }
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  }
  resize();window.addEventListener('resize',resize);frameId=requestAnimationFrame(frame);
  window.addEventListener('beforeunload',()=>{cancelAnimationFrame(frameId);window.removeEventListener('resize',resize);},{once:true});
};

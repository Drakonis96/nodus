/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The Support Nodus hero planet: native WebGL 1 + SVG, no libraries, no image
texture. The surface is procedural — it is code, never a picture — and the
component is static by default, rendering on resize rather than every frame.

Usage, exactly as the standalone component: a host element with the attribute

  <div class="nodus-planet" data-nodus-planet data-blend="true"></div>

data-seed changes the surface, data-caption="false" drops the caption,
data-blend="true" feathers the edges into the page behind it.
*/
(function () {
  'use strict';
  const VERTEX = `
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main() {
      vUv = vec2(aPosition.x * .5 + .5, .5 - aPosition.y * .5);
      gl_Position = vec4(aPosition, 0., 1.);
    }
  `;
  const FRAGMENT = `
    precision highp float;
    varying vec2 vUv;
    uniform vec2 uResolution;
    uniform float uSeed;

    float hash(vec3 p) {
      p = fract(p * .3183099 + vec3(.11,.17,.13));
      p *= 17.;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float noise(vec3 p) {
      vec3 i = floor(p), f = fract(p);
      f = f*f*(3.-2.*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                     mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                     mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    float fbm(vec3 p) {
      float sum = 0.;
      float a = .5;
      for(int i=0;i<6;i++) {
        sum += a*noise(p);
        p = p*2.04 + vec3(17.1, 4.7, 9.2);
        a *= .49;
      }
      return sum;
    }
    float rockNoise(vec3 p) {
      return noise(p)*.60+noise(p*2.03+4.1)*.27+noise(p*4.11+8.5)*.13;
    }
    float gauss(vec2 p,vec2 center,vec2 spread) {
      vec2 q=(p-center)/spread;
      return exp(-dot(q,q));
    }
    void main() {
      vec2 p = vUv * vec2(720.,828.);
      vec2 c = vec2(617.7,536.4);
      float radius = 456.4;
      vec2 q = (p-c)/radius;
      float r=length(q);
      float dist=(r-1.)*radius;
      vec2 rad = q / max(r,.0001);
      float sector=pow(clamp(dot(rad,normalize(vec2(-.92,-.39)))*.5+.5,0.,1.),3.8);
      sector *= 1. - .97*smoothstep(460.,830.,p.y);
      float region = gauss(p,vec2(184.,339.),vec2(270.,420.));
      float spaceNoise=fbm(vec3(p*.007,4.6));
      vec3 bg=vec3(.033,.043,.087);
      bg+=vec3(.036,.037,.092)*region*(.55+spaceNoise*.75);
      bg+=vec3(.005,.006,.012)*gauss(p,vec2(220.,75.),vec2(600.,250.));
      bg*=1.-.18*smoothstep(540.,840.,p.y);
      vec3 col=bg;
      float aa=828./uResolution.y;
      if (dist <= aa) {
        float z=sqrt(max(0.,1.-dot(q,q)));
        vec3 n=vec3(q,z);
        vec3 light=normalize(vec3(-.89,-.46,.04));
        float diffuse=max(0.,dot(n,light));
        float lit=pow(diffuse,5.1);

        // Map noise onto the sphere, not onto a flat disc. Domain warping
        // and oblique stretching produce fine ridges rather than "TV snow".
        vec3 t=vec3(n.x*1.03-n.y*.45,n.y*.83+n.x*.48,n.z);
        vec3 warp=vec3(fbm(t*4.1+uSeed),fbm(t*4.1+8.9+uSeed),fbm(t*4.1+19.3+uSeed));
        float broad=fbm(t*9.+warp*2.8);
        vec3 terrainPoint = t*vec3(30.,105.,38.)+warp*4.5;
        float rock=rockNoise(terrainPoint);
        float neighbor=rockNoise(terrainPoint+vec3(.02,-.19,.025));
        float relief=clamp((rock-neighbor)*4.2+.32,0.,1.);
        float micro=noise(t*620.+warp*24.);
        float ridge=pow(clamp(1.-abs(rock-.51)*4.7,0.,1.),7.);
        float terrain=clamp(.08+ridge*.28+broad*.12+relief*.85,0.,1.);
        vec3 surface=vec3(.024,.033,.070);
        surface+=vec3(.018,.018,.048)*pow(diffuse,1.8)*broad;
        surface+=vec3(.167,.173,.402)*lit*(.46+terrain*.62);
        // Fine lit rock details, only on the narrow illuminated crescent.
        surface+=vec3(.089,.111,.245)*lit*max(0.,relief-.40)*.55;
        float rim=exp(min(dist,0.)/2.6)*sector;
        float inner=exp(min(dist,0.)/16.)*sector;
        surface+=vec3(.32,.26,.63)*rim;
        surface+=vec3(.090,.091,.24)*inner;
        float fade=smoothstep(-aa,aa,dist);
        col=mix(surface,bg,fade);
      }
      // Atmospheric scattering outside the sphere, with a hairline violet limb.
      if(dist > -aa) {
        float edge=exp(-max(dist,0.)/2.8)*.43;
        float glow=exp(-max(dist,0.)/21.)*.235;
        float haze=exp(-max(dist,0.)/61.)*.105;
        col+=vec3(.43,.32,.98)*sector*(edge+glow+haze)*smoothstep(-aa,aa,dist);
      }
      // Very subtle deterministic dithering keeps near-black gradients smooth.
      float grain=(hash(vec3(gl_FragCoord.xy, .17))-.5)/700.;
      col+=grain;
      gl_FragColor=vec4(col,1.);
    }
  `;

  let counter = 0;
  const instances = new WeakMap();
  function makeOverlay(id) {
    return `<svg class="np-orbit" viewBox="0 0 720 828" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="${id}-back" x1="224" y1="320" x2="154" y2="482" gradientUnits="userSpaceOnUse">
          <stop stop-color="#7651c6" stop-opacity=".07"/>
          <stop offset=".42" stop-color="#8850df" stop-opacity=".75"/>
          <stop offset="1" stop-color="#b28afe" stop-opacity=".88"/>
        </linearGradient>
        <linearGradient id="${id}-front" x1="166" y1="482" x2="716" y2="720" gradientUnits="userSpaceOnUse">
          <stop stop-color="#dfc3ff" stop-opacity=".95"/>
          <stop offset=".22" stop-color="#a275f3" stop-opacity=".83"/>
          <stop offset=".58" stop-color="#6344b9" stop-opacity=".46"/>
          <stop offset="1" stop-color="#473065" stop-opacity="0"/>
        </linearGradient>
        <radialGradient id="${id}-flare">
          <stop stop-color="#ede1ff" stop-opacity=".82"/>
          <stop offset=".07" stop-color="#c79aff" stop-opacity=".73"/>
          <stop offset=".23" stop-color="#9e60ff" stop-opacity=".40"/>
          <stop offset=".5" stop-color="#7940ef" stop-opacity=".17"/>
          <stop offset="1" stop-color="#7940ef" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${id}-star">
          <stop stop-color="#e6d5ff"/>
          <stop offset=".14" stop-color="#bc93ff" stop-opacity=".8"/>
          <stop offset=".4" stop-color="#965bfc" stop-opacity=".23"/>
          <stop offset="1" stop-color="#965bfc" stop-opacity="0"/>
        </radialGradient>
        <filter id="${id}-blur" x="-50%" y="-100%" width="200%" height="300%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="3"/></filter>
      </defs>
      <g class="np-stars">
        <circle cx="45" cy="274" r="12" fill="url(#${id}-star)"/>
        <circle cx="45" cy="274" r="1.55" fill="#c8a3ff" opacity=".74"/>
        <circle cx="127" cy="135" r="1.25" fill="#9370d7" opacity=".67"/>
        <circle cx="89" cy="202" r="1.15" fill="#a784f0" opacity=".7"/>
        <circle cx="13" cy="117" r=".95" fill="#8466c1" opacity=".47"/>
        <circle cx="60" cy="477" r="1.35" fill="#8b63db" opacity=".58"/>
        <circle cx="119" cy="589" r="1.1" fill="#9878d6" opacity=".56"/>
        <circle cx="25" cy="519" r=".7" fill="#71619b" opacity=".40"/>
        <circle cx="102" cy="446" r=".8" fill="#8676b3" opacity=".38"/>
        <circle cx="43" cy="436" r=".95" fill="#8160bb" opacity=".5"/>
        <circle cx="156" cy="221" r=".85" fill="#8c6db6" opacity=".37"/>
      </g>
      <g fill="none" stroke-linecap="round">
        <path d="M 225 320 C 75 319 49 378 166 482" stroke="url(#${id}-back)" stroke-width="4" opacity=".5" filter="url(#${id}-blur)"/>
        <path d="M 225 320 C 75 319 49 378 166 482" stroke="url(#${id}-back)" stroke-width="1.5"/>
        <path d="M 166 482 C 330 608 531 686 720 726" stroke="url(#${id}-front)" stroke-width="5" opacity=".56" filter="url(#${id}-blur)"/>
        <path d="M 166 482 C 330 608 531 686 720 726" stroke="url(#${id}-front)" stroke-width="1.7"/>
      </g>
      <g class="np-flare">
        <circle cx="166" cy="482" r="60" fill="url(#${id}-flare)"/>
        <ellipse cx="166" cy="482" rx="10" ry="26" fill="url(#${id}-flare)" opacity=".7"/>
        <path d="M 166 465 Q 167 480 173 482 Q 167 484 166 500 Q 165 484 159 482 Q 165 480 166 465" fill="#dec3ff" opacity=".79"/>
        <circle cx="166" cy="482" r="3.7" fill="#f7edff"/>
        <circle cx="166" cy="482" r="1.6" fill="#fff"/>
      </g>
    </svg>`;
  }
  function compile(gl,type,source) {
    const s=gl.createShader(type);
    if(!s) throw new Error('Shader allocation failed');
    gl.shaderSource(s,source); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) {
      const log=gl.getShaderInfoLog(s); gl.deleteShader(s);
      throw new Error(log || 'Shader compilation failed');
    }
    return s;
  }
  function mount(element) {
    if(instances.has(element)) return instances.get(element);
    const id=`nodus-planet-${++counter}`;
    const fallback=document.createElement('div'); fallback.className='np-fallback';
    const canvas=document.createElement('canvas'); canvas.setAttribute('aria-hidden','true');
    element.append(fallback,canvas);
    element.insertAdjacentHTML('beforeend',makeOverlay(id));
    const caption=document.createElement('p'); caption.className='np-caption';
    caption.innerHTML='<span>Ideas</span><span>connect</span><span>further</span>';
    element.append(caption);
    const generated=[fallback,canvas,element.querySelector('.np-orbit'),caption];
    let gl=null, program=null, buffer=null, observer=null, raf=0, destroyed=false, lost=false;
    let position=0, resolution=null, seed=null;
    function release() {
      if(!gl || lost) return;
      if(buffer) gl.deleteBuffer(buffer);
      if(program) gl.deleteProgram(program);
      buffer=program=null;
    }
    function setup() {
      if(!gl) return;
      let vs=null,fs=null;
      try {
        vs=compile(gl,gl.VERTEX_SHADER,VERTEX);
        const precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
        fs=compile(gl,gl.FRAGMENT_SHADER,precision && precision.precision>0?FRAGMENT:FRAGMENT.replace('precision highp float','precision mediump float'));
        program=gl.createProgram(); if(!program) throw new Error('Program allocation failed');
        gl.attachShader(program,vs); gl.attachShader(program,fs);
        gl.bindAttribLocation(program,0,'aPosition'); gl.linkProgram(program);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        position=gl.getAttribLocation(program,'aPosition');
        resolution=gl.getUniformLocation(program,'uResolution');
        seed=gl.getUniformLocation(program,'uSeed');
        buffer=gl.createBuffer(); if(!buffer) throw new Error('Buffer allocation failed');
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
        draw();
      } catch(error) {
        console.warn('[Nodus planet] Using static fallback.',error);
        release(); element.dataset.ready='false';
      } finally {
        if(vs) gl.deleteShader(vs); if(fs) gl.deleteShader(fs);
      }
    }
    function draw() {
      raf=0;
      if(destroyed || lost || !gl || !program) return;
      const bounds=element.getBoundingClientRect();
      if(bounds.width<1 || bounds.height<1) return;
      const dpr=Math.min(window.devicePixelRatio || 1,2);
      const factor=Math.min(dpr,1440/bounds.width,1656/bounds.height);
      const w=Math.max(1,Math.round(bounds.width*factor)),h=Math.max(1,Math.round(bounds.height*factor));
      if(canvas.width!==w || canvas.height!==h) { canvas.width=w;canvas.height=h; }
      gl.viewport(0,0,w,h); gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      gl.uniform2f(resolution,w,h);
      const number=Number(element.dataset.seed || 3.7);
      gl.uniform1f(seed,Number.isFinite(number)?number:3.7);
      gl.drawArrays(gl.TRIANGLES,0,6); gl.flush();
      element.dataset.ready='true';
    }
    function schedule() { if(!raf && !destroyed) raf=requestAnimationFrame(draw); }
    function contextLost(e) { e.preventDefault();lost=true; element.dataset.ready='false'; }
    function contextRestored() { lost=false;program=buffer=null;setup(); }
    canvas.addEventListener('webglcontextlost',contextLost);
    canvas.addEventListener('webglcontextrestored',contextRestored);
    try {
      gl=canvas.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:true,preserveDrawingBuffer:false,powerPreference:'low-power'});
      setup();
    } catch(error) { console.warn('[Nodus planet] WebGL unavailable.',error); }
    if('ResizeObserver' in window) { observer=new ResizeObserver(schedule);observer.observe(element); }
    window.addEventListener('resize',schedule,{passive:true});
    function destroy() {
      if(destroyed) return;
      destroyed=true; cancelAnimationFrame(raf); observer?.disconnect();
      window.removeEventListener('resize',schedule);
      canvas.removeEventListener('webglcontextlost',contextLost);
      canvas.removeEventListener('webglcontextrestored',contextRestored);
      release();
      if(gl && !lost) gl.getExtension('WEBGL_lose_context')?.loseContext();
      generated.forEach(node=>node?.remove()); delete element.dataset.ready;
      instances.delete(element);
    }
    const controller={redraw:schedule,destroy,canvas}; instances.set(element,controller);return controller;
  }
  function init(root=document) { root.querySelectorAll('[data-nodus-planet]').forEach(mount); }
  window.NodusPlanet={mount,init};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init(),{once:true});
  else init();
})();

/* The hero scene: a planet's silhouette, its lit edge and the rising sun or moon, drawn by one WebGL
   fragment shader (a simpler 2D-canvas drawing where WebGL is missing). It is computed from the canvas
   size, so it stays sharp on any screen and the page downloads no images for it. */
(function () {
  'use strict';

  var Site = (window.Site = window.Site || {});

  var VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  var FRAG = [
    'precision highp float;',
    'uniform vec2 uRes;uniform float uDpr;uniform vec3 uPlanet;uniform vec3 uLight;',
    'uniform float uDay;uniform float uLeak;uniform vec3 uPtr;uniform vec4 uMeteor;uniform float uMeteorLen;',
    'float hash(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}',
    /* one layer of stars: at most one per cell, with its own brightness and a faint white, warm or blue tint */
    'vec3 stars(vec2 p,float cs,float prob,float seed,float r,float b0,float b1,float halo){',
    '  vec2 cell=floor(p/cs);',
    '  if(hash(cell+seed)>prob)return vec3(0.);',
    '  vec2 sp=(cell+.15+.7*vec2(hash(cell+seed+1.7),hash(cell+seed+5.3)))*cs;',
    '  vec2 v=p-sp;float d2=dot(v,v);',
    '  float b=mix(b0,b1,pow(hash(cell+seed+9.1),3.));',
    '  float t=hash(cell+seed+13.7);',
    '  vec3 tint=t<.22?vec3(1.,.86,.74):(t>.8?vec3(.78,.86,1.):vec3(.94,.96,1.));',
    '  return tint*b*(exp(-d2/(r*r))+halo*exp(-d2/(r*r*14.)));',
    '}',
    'void main(){',
    '  vec2 p=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uDpr;',
    '  float aa=1./uDpr;',
    '  vec2 rel=p-uPlanet.xy;float dist=length(rel);',
    '  float d=dist-uPlanet.z;',                                    /* signed distance to the horizon, < 0 on the planet */
    '  float body=1.-smoothstep(-aa,aa,d);',
    '  vec2 dir=rel/max(dist,1e-3);',
    '  float along=acos(clamp(dot(dir,normalize(uLight.xy-uPlanet.xy)),-1.,1.))*uPlanet.z;', /* css px along the horizon from under the light */
    '  float above=max(d,0.);',
    '  float up=clamp(d/(uPlanet.z*.45),0.,1.);',
    '  float near=exp(-along/(uPlanet.z*.16));',
    '  float wide=exp(-along/(uPlanet.z*.8));',
    '  float line=exp(-d*d/(.36+aa*aa*.3));',
    '  float spill=exp(-along/(uPlanet.z*.04+26.))*exp(-above/20.)*exp(min(d,0.)/8.)*uLeak;',
    '  float lr=length(p-uLight.xy),rad=uLight.z,out_=max(lr-rad,0.),q=lr/rad;',
    '  float disc=(1.-smoothstep(rad-aa,rad+aa,lr))*(1.-body);',
    '  float pa=acos(clamp(dot(dir,normalize(uPtr.xy-uPlanet.xy)),-1.,1.))*uPlanet.z;',
    '  vec3 col;',
    '  if(uDay<.5){',
    /* night: near-black; light is added on top and saturates gently toward white */
    '    col=mix(mix(vec3(.012,.016,.03),vec3(0.),pow(up,.55)),mix(vec3(.006,.007,.011),vec3(0.),clamp(-d/(uPlanet.z*.3),0.,1.)),body);',
    '    vec3 edge=vec3(.80,.88,1.),air=vec3(.16,.36,1.),glow=vec3(.55,.70,1.);',
    '    vec3 e=edge*line*(.12+.5*wide+1.1*near);',                                   /* the razor-thin edge */
    '    e+=air*(exp(-above/6.)*(.05+.42*near)+exp(-above/40.)*.18*near)*(1.-body);', /* the air above it */
    '    e+=air*exp(min(d,0.)/4.)*body*(.03+.22*near);',
    '    float t=(d-12.)/1.1;e+=air*exp(-t*t)*(.025+.11*wide);',                      /* where the upper air ends: a second, fainter line */
    '    float t2=(d-30.)/1.6;e+=air*exp(-t2*t2)*(.01+.05*wide)*(1.-body);',           /* and a third, further out: the edge reads in layers */
    '    e+=glow*spill*1.7*(1.-.55*body);',                                            /* light spilling over as the moon clears the edge */
    '    e+=glow*(1.-body)*(1.-disc)*(.5*exp(-out_/(rad*.32))+.2*pow(rad/max(lr,rad),2.2)+.06*exp(-out_/(rad*8.)));',
    /* stars in three sizes, thinning out toward the horizon and around the moon */
    '    vec3 st=stars(p,19.,.28,0.,.55,.07,.3,0.)+stars(p,53.,.5,31.,.8,.28,.8,.05)+stars(p,157.,.45,67.,1.25,.75,1.25,.16);',
    '    e+=st*(1.-body)*smoothstep(0.,90.,d)*smoothstep(rad*2.5,rad*8.,lr);',
    /* a shooting star now and then: a thin streak that brightens toward its head */
    '    if(uMeteor.w>0.){',
    '      vec2 u=vec2(cos(uMeteor.z),sin(uMeteor.z)),tail=uMeteor.xy-u*uMeteorLen;',
    '      float k=clamp(dot(p-tail,u)/uMeteorLen,0.,1.);vec2 c=tail+u*uMeteorLen*k;float md=dot(p-c,p-c);',
    '      float m=uMeteor.w*pow(k,1.8)*(exp(-md/.32)+.12*exp(-md/5.));',
    '      vec2 hv=p-uMeteor.xy;m+=uMeteor.w*.55*exp(-dot(hv,hv)/3.);',
    '      e+=vec3(.9,.94,1.)*m*(1.-body);',
    '    }',
    '    e+=edge*line*exp(-pa/70.)*uPtr.z*.9;',                                       /* the pointer catches a glint on the edge */
    '    col=col+(1.-col)*(1.-exp(-e));',
    '    col=mix(col,vec3(.93,.95,.99)*(.9+.08*(1.-q*q)),disc);',
    '  }else{',
    /* day: a pale blue sky over a blue-grey planet, a bright haze along the horizon and the white sun;
       light cannot be added to a light sky, so it is mixed in instead */
    '    col=mix(mix(vec3(.958,.968,.984),vec3(.79,.857,.94),pow(up,.38)),mix(vec3(.74,.79,.858),vec3(.62,.68,.765),pow(clamp(-d/(uPlanet.z*.3),0.,1.),.8)),body);',
    '    float soft=.26*pow(rad/max(lr,rad),1.6)+.1*exp(-out_/(rad*12.)),corona=.6*exp(-out_/(rad*.22));',
    '    col=mix(col,vec3(1.,.965,.91),clamp(soft,0.,1.)*(1.-body));',                 /* a soft warm glow around the sun */
    '    col=mix(col,vec3(1.),clamp(corona,0.,1.)*(1.-body));',                        /* and a crisp bright rim, so the disc reads on the light sky */
    '    col=mix(col,vec3(1.),(1.-body)*exp(-above/26.)*(.3+.5*near));',              /* haze along the horizon */
    '    col=mix(col,vec3(.86,.9,.95),body*exp(min(d,0.)/18.)*(.25+.55*near));',       /* the planet lit near its edge */
    '    col=mix(col,vec3(1.,.97,.92),clamp(spill*1.3,0.,1.));',
    '    col=mix(col,vec3(1.),clamp(line*(.6+.4*near+exp(-pa/70.)*uPtr.z*.5),0.,1.));', /* a crisp white edge */
    '    float t3=(d-11.)/1.3;col=mix(col,vec3(1.),clamp(exp(-t3*t3)*(.12+.3*near),0.,1.)*(1.-body));', /* a fainter line just above it */
    '    col=mix(col,vec3(1.),disc);',
    '  }',
    '  col+=(hash(gl_FragCoord.xy)-.5)/255.;',                                         /* dither: no banding in the gradients */
    '  gl_FragColor=vec4(col,1.);',
    '}',
  ].join('\n');

  function webgl(canvas) {
    var gl = null;
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    } catch (e) { /* no WebGL */ }
    if (!gl) return null;
    function shader(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    }
    var vs = shader(gl.VERTEX_SHADER, VERT), fs = shader(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var u = {};
    ['uRes', 'uDpr', 'uPlanet', 'uLight', 'uDay', 'uLeak', 'uPtr', 'uMeteor', 'uMeteorLen'].forEach(function (n) { u[n] = gl.getUniformLocation(prog, n); });
    return function draw(s) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uDpr, s.dpr);
      gl.uniform3f(u.uPlanet, s.cx, s.cy, s.R);
      gl.uniform3f(u.uLight, s.lx, s.ly, s.lr);
      gl.uniform1f(u.uDay, s.day ? 1 : 0);
      gl.uniform1f(u.uLeak, s.leak);
      gl.uniform3f(u.uPtr, s.px, s.py, s.pon);
      gl.uniform4f(u.uMeteor, s.mx, s.my, s.ma, s.mi);
      gl.uniform1f(u.uMeteorLen, s.ml || 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
  }

  /* without WebGL: the same composition with canvas gradients, minus the finer touches */
  function plain(canvas) {
    var c = canvas.getContext('2d');
    if (!c) return null;
    return function draw(s) {
      var k = s.dpr;
      c.setTransform(k, 0, 0, k, 0, 0);
      c.fillStyle = s.day ? '#f4f5f7' : '#000';
      c.fillRect(0, 0, s.w, s.h);
      var g = c.createRadialGradient(s.lx, s.ly, s.lr, s.lx, s.ly, s.lr * 9);
      g.addColorStop(0, s.day ? 'rgba(255,214,160,.55)' : 'rgba(140,175,255,.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, s.w, s.h);
      c.beginPath();
      c.arc(s.lx, s.ly, s.lr, 0, Math.PI * 2);
      c.fillStyle = s.day ? '#fff' : '#eef1f8';
      c.fill();
      c.beginPath();
      c.arc(s.cx, s.cy, s.R, 0, Math.PI * 2);
      c.fillStyle = s.day ? '#d8dbe1' : '#000';
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = s.day ? 'rgba(255,255,255,.95)' : 'rgba(200,220,255,.7)';
      c.stroke();
    };
  }

  Site.scene = {
    create: function (canvas) {
      var draw = webgl(canvas) || plain(canvas);
      return draw ? { draw: draw } : null;
    },
  };
})();

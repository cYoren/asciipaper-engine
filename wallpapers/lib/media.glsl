// defaults: {"fit": 0, "zoom": 1, "offset": [0, 0], "contrast": 1.15, "brightness": 0, "gamma": 1, "threshold": 0.06, "invert": 0, "colorMode": 0, "vivid": 0.5, "tint": "#e8b900", "tint2": "#ff3355", "lens": 0, "ripple": 1, "speed": 1, "backdrop": 0.3, "warp": 0, "warpAmount": 0.5, "motion": 0, "motionAmount": 0.6}
// The media shader: turns a picture, GIF or video into characters. Every uniform below is a setting a
// wallpaper can change in its "uniforms" (colours as "#rrggbb"); the line above holds the defaults.
// asciipaper sets `media` (the current frame) and `mediaSize` (its size in pixels).
uniform sampler2D media;
uniform vec2 mediaSize;
uniform float fit;          // 0 = show the whole picture, 1 = fill the screen (crops)
uniform float zoom;         // scale on top of the fit
uniform vec2 offset;        // move the picture, in screen fractions
uniform float contrast, brightness, gamma;
uniform float threshold;    // brightness under which a cell stays empty
uniform float invert;       // 1 = dark parts get the dense characters
uniform float colorMode;    // 0 = the picture's own colours, 1 = tint, 2 = gradient from tint to tint2
uniform float vivid;        // 0..1: lift colours towards full brightness
uniform vec3 tint, tint2;
uniform float lens;         // magnify around the pointer
uniform float ripple;       // clicks send a wave through the picture
uniform float backdrop;     // 0..1: fill the rest of the screen with a dim, enlarged copy of the picture
uniform float warp;         // 0 none, 1 twirl, 2 spherize (pinch below 0), 3 ripple, 4 zigzag, 5 polar, 6 kaleidoscope, 7 shear, 8 droste, 9 tiles, 10 flag
uniform float warpAmount;   // how strong; every warp moves slowly with time
uniform float motion;       // 0 none, 1 shimmer, 2 pulse, 3 wave, 4 drift, 5 scan, 6 sparkle, 7 ripple
uniform float motionAmount; // 0..1, how strongly the characters move

vec2 warped(vec2 uv){
  if(warp<0.5) return uv;
  vec2 k=vec2(u_aspect,1.0), c=(uv-0.5)*k;
  float r=length(c), a=atan(c.y,c.x), t=u_time, w=warpAmount;
  if(warp<1.5) a+=w*4.0*max(0.0,1.0-r*1.8)*sin(t*0.3);
  else if(warp<2.5) r*=pow(clamp(r*1.8,0.001,1.0),w*(0.7+0.3*sin(t*0.5)));
  else if(warp<3.5) r+=sin(r*40.0-t*3.0)*0.012*w;
  else if(warp<4.5){c.x+=sin(c.y*30.0+t*2.0)*0.02*w; return c/k+0.5;}
  else if(warp<5.5) return vec2(fract(a/6.283+0.5+t*0.01),clamp(r*1.6/(0.4+w),0.0,1.0));
  else if(warp<6.5){float n=floor(3.0+w*6.0), s=6.283/n; a=abs(mod(a+t*0.1,s)-s*0.5);}
  else if(warp<7.5){c.x+=c.y*w*sin(t*0.4); return c/k+0.5;}
  else if(warp<8.5){float L=log(2.0+w*3.0); a+=log(max(r,1e-4))*w*0.5; r=0.5*exp(mod(log(max(r,1e-4))-t*0.04,L)-L);}
  else if(warp<9.5){float n=floor(2.0+w*3.0); return fract(uv*n+t*0.005);}
  else {c.y+=sin(c.x*8.0+t*1.5)*0.035*w; c.x+=sin(c.y*6.0+t)*0.01*w; return c/k+0.5;}
  return vec2(cos(a),sin(a))*r/k+0.5;
}

// Motion changes the characters, never the picture: no UV bending, no warped faces.
float motionLevel(vec2 uv, float l){
  float a=clamp(motionAmount,0.0,1.0), t=u_time;
  if(motion<0.5||a<=0.0) return l;
  if(motion<1.5){                                         // shimmer: each character twinkles on its own
    float id=dot(floor(uv*u_grid),vec2(12.9898,78.233));
    float tw=0.5+0.5*sin(t*2.2+id);
    return l*(1.0-a*0.35+a*0.7*tw);
  }
  if(motion<2.5) return l*(1.0+a*0.18*sin(t*1.3));        // pulse: the whole picture breathes
  if(motion<3.5) return l*(1.0+a*0.22*sin((uv.x+uv.y*0.7)*6.0-t*1.6)); // wave
  if(motion<4.5){                                         // drift: a soft band travels across the characters
    float p=fract(uv.x*2.5-t*0.12);
    return l*(0.85+a*0.35*smoothstep(0.0,0.15,p)*smoothstep(0.5,0.15,p));
  }
  if(motion<5.5){                                         // scan: a bright line sweeps down
    float band=exp(-pow((fract(uv.y-t*0.07)-0.5)*7.0,2.0));
    return min(1.0,l+band*a*0.45);
  }
  if(motion<6.5){                                         // sparkle: a few cells flash
    float bucket=floor(t*3.0);
    float h=fract(sin(dot(floor(uv*u_grid)+bucket,vec2(127.1,311.7)))*43758.5453);
    return min(1.0,l+step(0.965,h)*a*0.9);
  }
  float r=length((uv-0.5)*vec2(u_aspect,1.0));            // ripple: brightness only, no bending
  return l*(1.0+a*0.18*sin(r*16.0-t*2.2));
}

vec4 cell(vec2 uv){
  uv=warped(uv);
  vec2 q=uv-u_pointer, k=vec2(u_aspect,1.0);
  float d=length(q*k), glow=0.0;
  // Hover: a magnifying lens that follows the pointer while it moves.
  float near=lens*u_strength*smoothstep(0.2,0.0,d)*step(u_idle,2.0);
  uv=u_pointer+q*(1.0-0.45*near);
  // Clicks: a ring travels outward, bending and lighting what it passes.
  for(int i=0;i<8;i++){vec3 c=u_clicks[i];
    vec2 r=uv-c.xy; float rd=length(r*k);
    float ring=ripple*u_strength*smoothstep(0.05,0.0,abs(rd-c.z*0.55))*max(0.0,1.0-c.z/1.6);
    uv-=r/max(rd,0.001)*ring*0.025; glow=max(glow,ring);}
  // Place the picture: contain or cover, then zoom and offset.
  float ratio=u_aspect/(mediaSize.x/max(mediaSize.y,1.0));
  vec2 sc=vec2(1.0), bc=vec2(1.0);                 // screen → picture scale
  if((ratio>1.0)==(fit<0.5)) sc.x=ratio; else sc.y=1.0/ratio;
  if(ratio>1.0) bc.y=1.0/ratio; else bc.x=ratio;   // the backdrop always covers the screen
  sc/=zoom;
  vec2 m=(uv-0.5)*sc+0.5-offset;
  float dim=1.0;
  if(m.x<0.0||m.x>1.0||m.y<0.0||m.y>1.0){
    if(backdrop<=0.0) return vec4(0.0);
    sc=bc*0.85; m=(uv-0.5)*sc+0.5; dim=backdrop;   // a little enlarged: a backdrop, not a copy
  }
  // Average the whole character's footprint, so fine detail (halftones, dithering, noise)
  // becomes shading instead of flicker.
  vec2 f=sc/u_grid*0.25;
  vec3 c=(texture2D(media,m+vec2(-f.x,-f.y)).rgb+texture2D(media,m+vec2(f.x,-f.y)).rgb
         +texture2D(media,m+vec2(-f.x,f.y)).rgb+texture2D(media,m+vec2(f.x,f.y)).rgb)*0.25;
  float l=dot(c,vec3(0.299,0.587,0.114));
  l=pow(clamp((l-0.5)*contrast+0.5+brightness+near*0.12+glow*0.5,0.0,1.0),gamma);
  if(invert>0.5) l=1.0-l;
  l*=dim;
  l=clamp(motionLevel(uv,l),0.0,1.0);
  if(l<threshold) return vec4(0.0);
  // Own colours: saturated pixels keep their hue, dark or grey ones take the tint (so an inverted
  // picture's dark subject still glows); vivid lifts them all towards full brightness.
  float hi=max(max(c.r,c.g),c.b), lo=min(min(c.r,c.g),c.b);
  float chroma=(hi-lo)/max(hi,0.001)*smoothstep(0.03,0.2,hi);
  vec3 own=mix(tint,c/max(hi,0.001),chroma)*mix(hi,1.0,vivid);
  vec3 color=colorMode<0.5?own:colorMode<1.5?tint*(0.3+0.7*l):mix(tint,tint2,l);
  return vec4((color+glow*0.35)*mix(0.5,1.0,dim),l);
}

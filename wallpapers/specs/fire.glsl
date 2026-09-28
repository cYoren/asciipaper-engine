// defaults: {"speed": 1, "height": 1}
// An ASCII fire: turbulent flames rising from the bottom edge, white-hot at the base.
uniform float speed, height;

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.02+vec2(1.7,9.2); a*=0.5; } return v; }

vec4 cell(vec2 uv){
  float t=u_time*speed;
  vec2 p=vec2(uv.x*u_aspect*3.0,(1.0-uv.y)*3.0);
  float n=fbm(p*vec2(1.0,0.8)-vec2(0.0,t*1.6));
  n=fbm(p+vec2(n*1.2,-t*1.9));
  float h=(1.0-uv.y)/max(height,0.1);                             // 0 at the bottom edge
  float heat=clamp(n*1.35-h*1.7+0.25,0.0,1.0);
  heat=pow(heat,1.4);
  vec3 color=heat<0.35?mix(vec3(0.25,0.02,0.0),vec3(0.9,0.15,0.02),heat/0.35)
            :heat<0.7?mix(vec3(0.9,0.15,0.02),vec3(1.0,0.6,0.08),(heat-0.35)/0.35)
                     :mix(vec3(1.0,0.6,0.08),vec3(1.0,0.97,0.8),(heat-0.7)/0.3);
  return vec4(color,heat);
}

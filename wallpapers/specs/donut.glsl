// defaults: {"speed": 1}
// The spinning ASCII donut (after Andy Sloane's donut.c), raymarched per character and lit from
// above and behind you.
uniform float speed;

mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float donut(vec3 p, float t){
  p.yz*=rot(t*0.7); p.xy*=rot(t*0.45);
  vec2 q=vec2(length(p.xz)-1.0,p.y);
  return length(q)-0.45;
}

vec4 cell(vec2 uv){
  vec2 p=(uv-0.5)*vec2(u_aspect,1.0)*2.3; p.y=-p.y;
  float t=u_time*speed;
  vec3 ro=vec3(0.0,0.0,-3.4), rd=normalize(vec3(p,1.7));
  float d=0.0;
  for(int i=0;i<56;i++){ float h=donut(ro+rd*d,t); if(h<0.002||d>8.0) break; d+=h; }
  if(d>8.0) return vec4(0.0);
  vec3 x=ro+rd*d; vec2 e=vec2(0.003,0.0);
  vec3 n=normalize(vec3(donut(x+e.xyy,t)-donut(x-e.xyy,t),donut(x+e.yxy,t)-donut(x-e.yxy,t),donut(x+e.yyx,t)-donut(x-e.yyx,t)));
  float light=clamp(dot(n,normalize(vec3(0.0,1.0,-1.0))),0.0,1.0);
  float rim=pow(1.0-abs(dot(n,-rd)),3.0)*0.35;
  float level=clamp(0.1+0.9*light+rim,0.0,1.0);
  return vec4(mix(vec3(0.95,0.45,0.12),vec3(1.0,0.93,0.72),light)*(0.35+0.65*level),level);
}

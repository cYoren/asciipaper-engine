// defaults: {"speed": 1, "streak": 1}
// Warp speed: stars stream out from the centre, stretching into streaks as they pass.
uniform float speed, streak;

float hash(float n){ return fract(sin(n*127.1)*43758.5453); }

vec4 cell(vec2 uv){
  vec2 p=(uv-0.5)*vec2(u_aspect,1.0);
  float r=length(p), a=atan(p.y,p.x)/6.2832+0.5;
  float t=u_time*speed*0.22, light=0.0; vec3 tint=vec3(0.0);
  const float LANES=420.0;                                        // directions a star can travel
  float lane=floor(a*LANES), off=fract(a*LANES)-0.5;
  for(int k=0;k<4;k++){
    float id=lane*4.0+float(k);
    float z=fract(hash(id+0.5)+t*(0.5+hash(id+1.3)));            // 0 far .. 1 passing you
    float rs=0.015/(1.0-z*0.985);                                  // how far out it is now
    float len=0.01+0.14*z*z*streak;                               // how far it has smeared
    float along=smoothstep(len,0.0,rs-r)*step(r,rs+0.004);
    float across=smoothstep(0.5,0.0,abs(off));
    float s=along*across*(0.25+z*1.2);
    light+=s; tint+=s*mix(vec3(0.55,0.72,1.0),vec3(1.0,0.92,0.82),hash(id+2.7));
  }
  float level=clamp(light,0.0,1.0);
  return vec4(tint/max(light,0.001)*(0.45+0.7*level),level);
}

// defaults: {"speed": 1}
// A calm sea at night: long swells rolling in under a low moon, its light breaking on the water.
uniform float speed;

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

vec4 cell(vec2 uv){
  float t=u_time*speed, horizon=0.46;
  vec2 moon=vec2(0.68*u_aspect,0.24);
  vec2 p=vec2(uv.x*u_aspect,uv.y);
  if(uv.y<horizon){                                                // sky
    float m=length(p-moon);
    float disc=smoothstep(0.075,0.068,m), halo=exp(-m*6.0)*0.35;
    float star=step(0.994,hash(floor(uv*u_grid)))*0.5;
    float level=clamp(disc+halo+star,0.0,1.0);
    return vec4(mix(vec3(0.35,0.45,0.75),vec3(1.0,0.97,0.88),disc)*(0.35+0.8*level),level);
  }
  float z=0.06/(uv.y-horizon+0.004);                               // distance into the sea
  float x=(uv.x-0.5)*u_aspect*z;
  float waves=sin(z*9.0-t*1.4+sin(x*1.3+t*0.3)*1.5)*0.5+sin(z*23.0+x*2.0-t*2.3)*0.25+sin(x*7.0+z*5.0+t)*0.12;
  float crest=smoothstep(0.1,0.7,waves);
  float path=exp(-pow((uv.x*u_aspect-moon.x)*(3.0+z*0.6),2.0));    // the moon's path on the water
  float glint=path*smoothstep(0.1,0.9,waves+0.3)*1.1;
  float level=clamp(0.2+crest*0.55+glint,0.0,1.0)*smoothstep(0.0,0.02,uv.y-horizon);
  vec3 color=mix(vec3(0.1,0.4,0.75),vec3(0.95,0.95,0.85),clamp(glint,0.0,1.0));
  return vec4(color*(0.35+0.8*level),level);
}

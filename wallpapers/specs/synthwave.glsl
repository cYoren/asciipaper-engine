// defaults: {"speed": 1}
// Retro sunset: a striped sun sinking behind a neon grid that scrolls toward you.
uniform float speed;

vec4 cell(vec2 uv){
  float t=u_time*speed, horizon=0.58;
  vec2 p=vec2((uv.x-0.5)*u_aspect,uv.y);
  if(uv.y<horizon){
    vec2 c=vec2(0.0,horizon-0.17);
    float d=length((p-c)*vec2(1.0,1.05));
    float bands=step(0.0,sin((uv.y-horizon)*110.0+t*1.5))+step(horizon-0.12,horizon-uv.y);   // gaps near the bottom
    float sun=smoothstep(0.26,0.25,d)*(uv.y<horizon-0.12?1.0:bands*0.5+0.0);
    float glow=exp(-d*4.0)*0.35;
    float level=clamp(sun*0.95+glow,0.0,1.0);
    vec3 color=mix(vec3(1.0,0.2,0.55),vec3(1.0,0.85,0.2),clamp((horizon-uv.y)*2.4,0.0,1.0));
    return vec4(mix(vec3(0.35,0.1,0.55),color,sun)*(0.35+0.8*level),level);
  }
  float z=0.1/(uv.y-horizon+0.002);
  float x=p.x*z;
  float lines=max(pow(1.0-abs(fract(x*2.0)-0.5)*2.0,24.0),pow(1.0-abs(fract(z*1.5-t*1.2)-0.5)*2.0,10.0));
  float level=clamp(lines*smoothstep(0.0,0.05,uv.y-horizon)+0.05,0.0,1.0);
  return vec4(mix(vec3(0.9,0.1,0.9),vec3(0.1,0.95,1.0),clamp(uv.y-horizon,0.0,0.4)*2.5)*(0.35+0.8*level),level);
}

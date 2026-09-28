// defaults: {"speed": 1, "scale": 1}
// Demoscene plasma: overlapping waves cycling through a soft rainbow.
uniform float speed, scale;

vec4 cell(vec2 uv){
  vec2 p=(uv-0.5)*vec2(u_aspect,1.0)*6.0*scale;
  float t=u_time*speed*0.6;
  float v=sin(p.x+t)+sin((p.y+t)*0.7)+sin((p.x+p.y+t)*0.5)+sin(length(p+vec2(sin(t*0.3),cos(t*0.4))*3.0)+t);
  v*=0.25;
  float level=0.5+0.5*sin(v*3.1416*2.0);
  vec3 color=0.5+0.5*cos(6.2832*(v*0.5+t*0.05+vec3(0.0,0.33,0.67)));
  return vec4(color*(0.3+0.8*level),level);
}

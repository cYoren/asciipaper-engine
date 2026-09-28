// defaults: {"speed": 1, "twist": 1}
// An endless ASCII tunnel: a checkered neon tube rushing toward you, turning slowly.
uniform float speed, twist;

vec4 cell(vec2 uv){
  vec2 p=(uv-0.5)*vec2(u_aspect,1.0);
  float t=u_time*speed;
  p+=0.05*vec2(sin(t*0.5),cos(t*0.37));                          // the camera sways
  float r=length(p), a=atan(p.y,p.x)/6.2832;
  float z=0.25/max(r,0.001)+t*0.8;                                // depth along the tunnel
  a+=twist*0.06*z;
  vec2 tile=vec2(a*10.0,z*1.5);
  float check=mod(floor(tile.x)+floor(tile.y),2.0);
  vec2 edge=abs(fract(tile)-0.5);
  float line=smoothstep(0.42,0.5,max(edge.x,edge.y));             // bright seams between tiles
  float fog=smoothstep(0.02,0.45,r);                              // the far end fades to black
  float level=clamp((0.25+0.4*check+0.6*line)*fog,0.0,1.0);
  vec3 color=mix(vec3(0.15,0.85,1.0),vec3(1.0,0.25,0.8),0.5+0.5*sin(z*0.7));
  return vec4(mix(color,vec3(1.0),line*0.4)*(0.35+0.8*level),level);
}

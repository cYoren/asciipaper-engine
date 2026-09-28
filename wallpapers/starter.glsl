// defaults: {"speed": 1, "hue": 0.5}
// A shader wallpaper: asciipaper runs cell() once per character, natively and in the browser.
// Save this file and your desktop updates. Change the look (characters, size, colours) in the
// Studio or in the .json beside this file; its "uniforms" set the values declared below.
//
// cell(uv): uv is the character's centre, 0..1 from the top left. Return vec4(r, g, b, level):
// level 0..1 picks a character from the charset (0 = the first, usually a space; 1 = the last).
// Built in: u_time (s), u_grid (columns, rows), u_size (px), u_aspect, u_pointer (0..1),
// u_velocity, u_down, u_idle (s since the pointer moved), u_strength (pointer setting),
// u_clicks[8] (x, y, age in s).
uniform float speed, hue;

vec3 palette(float t){ return 0.5+0.5*cos(6.2832*(t+vec3(0.0,0.33,0.67)+hue)); }

vec4 cell(vec2 uv){
  vec2 p=(uv-0.5)*vec2(u_aspect,1.0);
  float t=u_time*speed*0.4;
  // Two drifting interference fields, bent by the pointer.
  vec2 m=(u_pointer-0.5)*vec2(u_aspect,1.0);
  float pull=u_strength*0.25*exp(-8.0*dot(p-m,p-m))*step(u_idle,2.0);
  float v=sin(length(p-vec2(sin(t),cos(t*0.7))*0.35)*14.0-t*3.0)
         +sin(dot(p,vec2(cos(t*0.3),sin(t*0.4)))*11.0+t*2.0)
         +pull*8.0;
  // Clicks send out a ring.
  for(int i=0;i<8;i++){vec3 c=u_clicks[i];
    v+=2.0*max(0.0,1.0-c.z)*smoothstep(0.03,0.0,abs(length((uv-c.xy)*vec2(u_aspect,1.0))-c.z*0.6));}
  float level=clamp(v*0.25+0.5,0.0,1.0);
  return vec4(palette(level*0.6+t*0.05)*(0.35+0.75*level),level);
}

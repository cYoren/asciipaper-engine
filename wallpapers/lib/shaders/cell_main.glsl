
uniform sampler2D u_lut;uniform float u_glyphs,u_useLut,u_dither,u_paletteSize;uniform vec3 u_palette[16];
float ap_b2(vec2 a){a=floor(a);return fract(a.x*0.5+a.y*a.y*0.75);}
float ap_b4(vec2 a){return ap_b2(0.5*a)*0.25+ap_b2(a);}
float ap_b8(vec2 a){return ap_b4(0.5*a)*0.25+ap_b2(a);}
float ap_dither(vec2 a){float m=u_dither;
if(m<1.5)return ap_b2(a);if(m<2.5)return ap_b4(a);if(m<3.5)return ap_b8(a);if(m<4.5)return ap_b8(0.5*a)*0.25+ap_b2(a);
if(m<5.5)return clamp(length(fract(a/4.0)-0.5)*1.41,0.0,1.0);if(m<6.5)return fract(length(a-u_grid*0.5)/4.0);
if(m<7.5)return fract(a.y/4.0);if(m<8.5)return fract(a.x/4.0);if(m<9.5)return fract((a.x+a.y)/4.0);
if(m<10.5)return fract(sin(dot(floor(a),vec2(12.9898,78.233)))*43758.5453);
return fract(52.9829189*fract(dot(floor(a),vec2(0.06711056,0.00583715))));}
void main(){vec4 c=cell(vec2(v_uv.x,1.0-v_uv.y));float l=clamp(c.a,0.0,1.0);vec3 rgb=clamp(c.rgb,0.0,1.0);
if(u_dither>0.5){float t=ap_dither(gl_FragCoord.xy)-0.5;if(l>0.0)l=clamp(l+t/max(u_glyphs-1.0,1.0),0.0,1.0);
if(u_paletteSize>0.5)rgb=clamp(rgb+t*pow(max(u_paletteSize-1.0,1.0),-0.333),0.0,1.0);}
if(u_paletteSize>0.5){vec3 best=u_palette[0];float bd=1e9;for(int i=0;i<16;i++){if(float(i)>=u_paletteSize)break;
vec3 e=rgb-u_palette[i];float d=dot(e*e,vec3(0.3,0.59,0.11));if(d<bd){bd=d;best=u_palette[i];}}rgb=best;}
float g=u_useLut>0.5?texture2D(u_lut,vec2((floor(l*255.0+0.5)+0.5)/256.0,0.5)).a*255.0:floor(l*(u_glyphs-1.0)+0.5);
gl_FragColor=vec4(g/255.0,rgb);}

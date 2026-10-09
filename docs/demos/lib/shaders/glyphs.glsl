precision highp float;varying vec2 v_uv;uniform sampler2D cells,atlas;uniform vec2 grid,cell,atlasSize;uniform float tile,pad,fill,glyphs,shape,time;uniform vec3 bg;uniform vec4 fxA,fxB,fxC;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec4 at(vec2 p){return texture2D(cells,(floor(p*grid)+0.5)/grid);}
float inside(float d){return clamp(0.5-d,0.0,1.0);}
float box(vec2 q,vec2 h){vec2 d=abs(q)-h;return length(max(d,0.0))+min(max(d.x,d.y),0.0);}
vec3 cmyk(vec2 px){vec3 col=bg;vec4 ang=vec4(0.26,1.31,0.0,0.79);float s=min(cell.x,cell.y)*0.9;
for(int k=0;k<4;k++){float a=ang[k];mat2 r=mat2(cos(a),-sin(a),sin(a),cos(a));vec2 q=r*px,c=(floor(q/s)+0.5)*s;
vec3 rgb=at((c*r)/(grid*cell)).gba;float K=1.0-max(max(rgb.r,rgb.g),rgb.b);vec4 ink=vec4((1.0-rgb-K)/max(1.0-K,0.001),K);
float dot_=inside(length(q-c)-s*0.55*sqrt(ink[k]));
vec3 tone=k==0?vec3(0.0,0.68,0.94):k==1?vec3(0.93,0.0,0.55):k==2?vec3(1.0,0.95,0.0):vec3(0.1);col*=mix(vec3(1.0),tone,dot_);}
return col;}
vec3 draw(vec2 p){vec4 d=at(p);vec2 l=fract(vec2(p.x,1.0-p.y)*grid);float g=floor(d.r*255.0+0.5),v=g/max(glyphs-1.0,1.0),s=floor(shape+0.5);
vec3 under=bg+d.gba*fill*v,c=d.gba;
if(s<0.5){float cols=floor(atlasSize.x/tile);vec2 uv=(vec2(mod(g,cols)*tile,floor(g/cols)*(ceil(cell.y)+pad*2.0))+pad+l*cell)/atlasSize;return mix(under,c,texture2D(atlas,uv).a);}
if(s>11.5)return cmyk(p*grid*cell);
vec2 q=(l-0.5)*cell;float r=min(cell.x,cell.y)*0.5,gap=max(1.0,r*0.12),k=0.0;
if(g<0.5&&s!=4.0)return under;
if(s<1.5)return c;
if(s<2.5||s>10.5){k=inside(box(q,cell*0.5-gap));
if(s>10.5){vec2 id=floor(p*grid);c+=pow(max(0.0,sin(time*2.0+hash(id)*6.283)),24.0)*inside(length(q+r*0.35)-r*0.25)*0.9;}}
else if(s<3.5)k=inside(length(q)-r*1.15*sqrt(v));
else if(s<4.5){k=inside(length(q)-r*0.78);c=max(c*(0.12+0.88*v),vec3(0.05));}
else if(s<5.5){k=inside(box(q,cell*0.5-gap*0.6));float st=length(q)-r*0.5;
c*=(1.0-0.35*inside(abs(st)-gap*0.5))*(1.0+0.3*inside(st)*clamp(-(q.x+q.y)/r,0.0,1.0));}
else if(s<6.5){float a=r*v*1.1,t=max(1.0,r*0.28);k=inside(min(box(q,vec2(a,t)),box(q,vec2(t,a))));}
else if(s<7.5)k=inside((abs(q.x)+abs(q.y)-r*1.3*v)*0.707);
else if(s<8.5)k=inside(abs(q.x)-cell.x*0.5*v);
else if(s<9.5)k=inside(abs(q.x+q.y)*0.707-r*0.75*v);
else{float h=r*(0.35+0.6*v);k=inside(box(q,vec2(h)));c*=q.y<-h*0.35?1.25:q.x>h*0.35?0.62:1.0;}
return mix(under,c,k);}
void main(){vec2 p=v_uv;
if(fxA.z>0.0){vec2 o=p-0.5;p=0.5+o*(1.0+fxA.z*0.35*dot(o,o)*4.0);if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0){gl_FragColor=vec4(0.0,0.0,0.0,1.0);return;}}
if(fxB.y>0.0){float t=floor(time*9.0),band=floor(p.y*18.0+hash(vec2(t,3.0))*6.0);if(hash(vec2(band,t))<fxB.y*0.35)p.x=fract(p.x+(hash(vec2(t,band))-0.5)*0.12*fxB.y);}
vec3 col=draw(p);
if(fxA.w>0.0){float o=fxA.w*6.0/(grid.x*cell.x);col.r=draw(p+vec2(o,0.0)).r;col.b=draw(p-vec2(o,0.0)).b;}
if(fxB.z>0.0){vec3 b=vec3(0.0);for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++){vec4 e=texture2D(cells,(floor(p*grid)+vec2(float(i),float(j))+0.5)/grid);
b+=e.gba*min(e.r*255.0,1.0)/(1.0+float(i*i+j*j));}col+=b*fxB.z*0.22;}
if(fxC.x!=0.0){float y=dot(col,vec3(0.299,0.587,0.114));col=mix(vec3(y),col,1.0+fxC.x);}
if(fxC.y!=0.0){float a=fxC.y*6.283;vec3 k=vec3(0.57735);col=col*cos(a)+cross(k,col)*sin(a)+k*dot(k,col)*(1.0-cos(a));}
if(fxA.y>0.0)col*=1.0-fxA.y*0.55*(0.5+0.5*cos(gl_FragCoord.y*2.094));
if(fxA.x>0.0)col*=1.0-fxA.x*smoothstep(0.35,1.0,length(v_uv-0.5)*1.41);
if(fxB.x>0.0)col+=(hash(gl_FragCoord.xy+fract(time*7.0)*91.0)-0.5)*fxB.x*0.35;
if(fxB.w>0.0)col=mix(col,vec3(0.82),step(1.0-fxB.w*0.004,hash(floor(gl_FragCoord.xy/2.0)+floor(time*12.0)*7.31)));
if(fxC.z>0.0)col*=1.0-fxC.z*0.12*hash(vec2(floor(time*20.0),5.0));
gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);}

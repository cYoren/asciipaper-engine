attribute vec2 p;varying vec2 v_uv;void main(){v_uv=p;gl_Position=vec4(p*2.0-1.0,0,1);}

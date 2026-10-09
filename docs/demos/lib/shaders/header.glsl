precision highp float;
varying vec2 v_uv;
uniform float u_time, u_aspect, u_down, u_strength, u_idle;
uniform vec2 u_grid, u_size, u_pointer, u_velocity;
uniform vec3 u_clicks[8];
uniform sampler2D u_data;

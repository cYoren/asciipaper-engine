#include "engine.h"
#include <stdlib.h>
#include <stdio.h>
void scene_uniform(struct scene *s,const char *name,int n,const float *v) {}
void scene_texture(struct scene *s,const char *name,int w,int h,int channels,const uint8_t *pixels) {}
int main(void) {
    for(int i=0;presets[i];i++)for(int pass=0;pass<3;pass++){
        const struct preset *p=presets[i];
        struct pointer pointer={.x=.25,.y=.6};
        struct scene s={.width=320,.height=180,.cols=32,.rows=18,.strength=1,.pointer=&pointer};
        s.data=calloc(32*18*4,1);
        if(p->resize)p->resize(&s);
        for(int frame=0;frame<9;frame++){pointer.x+=.01;if(p->pointer_move)p->pointer_move(&s);if(p->update)p->update(&s,.04);}
        // An odd number of fluid steps swaps front to the interior allocation.
        if(p->resize)p->resize(&s);
        if(p->pointer_down)p->pointer_down(&s);
        if(p->update)p->update(&s,.04);
        preset_destroy(p,&s);free(s.data);
    }
    puts("PASS all native preset resize/destroy lifecycles");
}

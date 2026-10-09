// The Android adapter runs the actual Linux preset simulations, not a second port.
#include <jni.h>
#include <GLES2/gl2.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "engine.h"

struct mobile { struct scene scene; struct pointer pointer; const struct preset *preset; GLuint program, flow, data, lut; };
static const struct preset *find(JNIEnv *env, jstring name) {
    const char *text = (*env)->GetStringUTFChars(env,name,NULL);
    const struct preset *found = NULL;
    for (int i=0; presets[i]; i++) if (!strcmp(text,presets[i]->name)) found=presets[i];
    (*env)->ReleaseStringUTFChars(env,name,text); return found;
}
void scene_uniform(struct scene *s, const char *name, int n, const float *v) {
    struct mobile *m=(void *)s; GLint at=glGetUniformLocation(m->program,name);
    if(n==1)glUniform1fv(at,1,v);else if(n==2)glUniform2fv(at,1,v);else if(n==3)glUniform3fv(at,1,v);else if(n==4)glUniform4fv(at,1,v);
}
void scene_texture(struct scene *s,const char *name,int w,int h,int channels,const uint8_t *pixels) {
    struct mobile *m=(void *)s;
    glActiveTexture(GL_TEXTURE4); glBindTexture(GL_TEXTURE_2D,m->flow);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D,0,channels==4?GL_RGBA:GL_RGB,w,h,0,channels==4?GL_RGBA:GL_RGB,GL_UNSIGNED_BYTE,pixels);
    glUniform1i(glGetUniformLocation(m->program,name),4);
}
JNIEXPORT jobjectArray JNICALL Java_io_github_cyoren_asciipaper_NativeScene_describe(JNIEnv *env,jclass cls,jstring name) {
    const struct preset *p=find(env,name); if(!p)return NULL;
    jobjectArray a=(*env)->NewObjectArray(env,10,(*env)->FindClass(env,"java/lang/String"),NULL);
    const char *text[]={p->glsl?p->glsl:"vec4 cell(vec2 uv){return texture2D(u_data,uv);}",p->charset,p->background,p->name};
    for(int i=0;i<4;i++)(*env)->SetObjectArrayElement(env,a,i,(*env)->NewStringUTF(env,text[i]));
    float v[]={p->cell,p->aspect,p->max_cells?p->max_cells:40000,p->time,p->period?p->period:6283.1853,p->weight?p->weight:400};
    for(int i=0;i<6;i++){char b[48];snprintf(b,sizeof b,"%.9g",v[i]);(*env)->SetObjectArrayElement(env,a,4+i,(*env)->NewStringUTF(env,b));}return a;
}
JNIEXPORT jlong JNICALL Java_io_github_cyoren_asciipaper_NativeScene_create(JNIEnv *env,jclass cls,jstring name,jint program,jint width,jint height,jint cols,jint rows) {
    const struct preset *p=find(env,name);if(!p||cols<2||rows<2)return 0;
    struct mobile *m=calloc(1,sizeof *m);if(!m)return 0;
    m->preset=p;m->program=program;m->scene=(struct scene){.width=width,.height=height,.cols=cols,.rows=rows,.strength=1,.pointer=&m->pointer};
    m->scene.data=calloc((size_t)cols*rows*4,1);
    if(!m->scene.data){free(m);return 0;}
    glGenTextures(1,&m->flow);glGenTextures(1,&m->data);glGenTextures(1,&m->lut);
    glUseProgram(program);
    if(p->lut){glActiveTexture(GL_TEXTURE3);glBindTexture(GL_TEXTURE_2D,m->lut);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);glTexImage2D(GL_TEXTURE_2D,0,GL_ALPHA,256,1,0,GL_ALPHA,GL_UNSIGNED_BYTE,p->lut);glUniform1f(glGetUniformLocation(program,"u_useLut"),1);}
    if(p->resize)p->resize(&m->scene);return (jlong)(intptr_t)m;
}
JNIEXPORT void JNICALL Java_io_github_cyoren_asciipaper_NativeScene_step(JNIEnv *env,jclass cls,jlong handle,jfloat dt,jfloat x,jfloat y,jboolean down,jfloat strength) {
    struct mobile *m=(void *)(intptr_t)handle;if(!m)return;
    glUseProgram(m->program);m->scene.strength=strength;
    if(m->pointer.x!=x||m->pointer.y!=y){m->pointer.x=x;m->pointer.y=y;if(m->preset->pointer_move)m->preset->pointer_move(&m->scene);}
    if(down&&!m->pointer.down&&m->preset->pointer_down)m->preset->pointer_down(&m->scene);m->pointer.down=down;
    if(m->preset->update)m->preset->update(&m->scene,dt);
    if(!m->preset->glsl){glActiveTexture(GL_TEXTURE2);glBindTexture(GL_TEXTURE_2D,m->data);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,m->scene.cols,m->scene.rows,0,GL_RGBA,GL_UNSIGNED_BYTE,m->scene.data);}
}
JNIEXPORT void JNICALL Java_io_github_cyoren_asciipaper_NativeScene_destroy(JNIEnv *env,jclass cls,jlong handle) {
    struct mobile *m=(void *)(intptr_t)handle;if(!m)return;
    preset_destroy(m->preset,&m->scene);free(m->scene.data);glDeleteTextures(1,&m->flow);glDeleteTextures(1,&m->data);glDeleteTextures(1,&m->lut);free(m);
}

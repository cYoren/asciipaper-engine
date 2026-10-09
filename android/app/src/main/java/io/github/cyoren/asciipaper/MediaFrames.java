package io.github.cyoren.asciipaper;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Movie;
import android.graphics.SurfaceTexture;
import android.media.MediaPlayer;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.GLUtils;
import android.os.SystemClock;
import android.view.Surface;
import java.io.FileInputStream;
import java.nio.FloatBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

// Videos stay in the hardware decoder and on the GPU. Only a <=256px texture
// reaches the cell shader. Still images upload once; GIFs reuse one bitmap.
final class MediaFrames {
    private int texture, external, fbo, program, width=1, height=1;
    private Bitmap bitmap;
    private Movie movie;
    private SurfaceTexture surfaceTexture;
    private MediaPlayer player;
    private final AtomicBoolean available=new AtomicBoolean();
    private final float[] transform=new float[16];
    private long start=SystemClock.uptimeMillis(), pausedAt;
    private boolean prepared, active;
    private float speed=1;
    volatile long decodedFrames;

    MediaFrames(String file, String vertex, boolean active) throws Exception {
        try {
        this.active=active;
        GLES20.glActiveTexture(GLES20.GL_TEXTURE5);
        int[] id=new int[1]; GLES20.glGenTextures(1,id,0);texture=id[0];
        bind(texture,GLES20.GL_TEXTURE_2D);
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D,0,GLES20.GL_RGBA,1,1,0,GLES20.GL_RGBA,GLES20.GL_UNSIGNED_BYTE,java.nio.ByteBuffer.wrap(new byte[]{0,0,0,(byte)255}));
        if (file.toLowerCase(java.util.Locale.ROOT).endsWith(".gif")) {
            try(FileInputStream in=new FileInputStream(file)){movie=Movie.decodeStream(in);}
            if(movie!=null){int[] size=fit(movie.width(),movie.height());width=size[0];height=size[1];bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);return;}
        }
        BitmapFactory.Options opts=new BitmapFactory.Options();opts.inJustDecodeBounds=true;BitmapFactory.decodeFile(file,opts);
        if(opts.outWidth>0){opts.inJustDecodeBounds=false;opts.inSampleSize=1;while(Math.max(opts.outWidth,opts.outHeight)/opts.inSampleSize>512)opts.inSampleSize*=2;bitmap=BitmapFactory.decodeFile(file,opts);if(bitmap!=null){width=bitmap.getWidth();height=bitmap.getHeight();GLUtils.texImage2D(GLES20.GL_TEXTURE_2D,0,bitmap,0);decodedFrames=1;bitmap.recycle();bitmap=null;return;}}
        if(opts.outWidth>0||file.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(png|jpe?g|gif|webp|bmp|avif|apng)$"))throw new IllegalArgumentException("Cannot decode image");
        GLES20.glGenTextures(1,id,0);external=id[0];bind(external,GLES11Ext.GL_TEXTURE_EXTERNAL_OES);
        surfaceTexture=new SurfaceTexture(external);surfaceTexture.setOnFrameAvailableListener(t->available.set(true));
        player=new MediaPlayer();player.setDataSource(file);player.setLooping(true);player.setVolume(0,0);
        Surface surface=new Surface(surfaceTexture);player.setSurface(surface);surface.release();
        String fragment="#extension GL_OES_EGL_image_external : require\nprecision mediump float;varying vec2 v_uv;uniform samplerExternalOES source;uniform mat4 transform;void main(){gl_FragColor=texture2D(source,(transform*vec4(v_uv,0,1)).xy);}";
        program=Renderer.link(vertex,fragment);
        if(program==0)throw new IllegalStateException("Video texture shader failed");
        GLES20.glGenFramebuffers(1,id,0);fbo=id[0];
        player.setOnPreparedListener(p->{synchronized(this){prepared=true;try{p.setPlaybackParams(p.getPlaybackParams().setSpeed(speed));if(this.active)p.start();else p.pause();}catch(IllegalStateException ignored){}}});
        player.setOnErrorListener((p,what,extra)->{android.util.Log.e("asciipaper","Video decode error "+what+":"+extra+" "+new java.io.File(file).getName());return true;});
        player.prepareAsync();
        } catch(Exception error) { close();throw error; }
    }
    synchronized void active(boolean on) {
        if(active==on)return;active=on;
        long now=SystemClock.uptimeMillis();if(on&&pausedAt!=0){start+=now-pausedAt;pausedAt=0;}else if(!on)pausedAt=now;
        if(player!=null&&prepared)try{if(on)player.start();else player.pause();}catch(IllegalStateException ignored){}
    }
    synchronized void speed(float value) {
        value=Math.max(.1f,Math.min(3,value));if(speed==value)return;speed=value;
        if(player!=null&&prepared)try{player.setPlaybackParams(player.getPlaybackParams().setSpeed(speed));if(!active)player.pause();}catch(IllegalStateException ignored){}
    }
    void update(FloatBuffer quad) {
        if(movie!=null){movie.setTime((int)((SystemClock.uptimeMillis()-start)*speed)%Math.max(1,movie.duration()));Canvas c=new Canvas(bitmap);bitmap.eraseColor(0);c.scale((float)width/movie.width(),(float)height/movie.height());movie.draw(c,0,0);GLES20.glActiveTexture(GLES20.GL_TEXTURE5);bind(texture,GLES20.GL_TEXTURE_2D);GLUtils.texImage2D(GLES20.GL_TEXTURE_2D,0,bitmap,0);decodedFrames++;}
        if(surfaceTexture!=null&&available.getAndSet(false)){
            surfaceTexture.updateTexImage();surfaceTexture.getTransformMatrix(transform);
            int w=player.getVideoWidth(),h=player.getVideoHeight();if(w<=0||h<=0)return;
            int[] size=fit(w,h);int nextW=size[0],nextH=size[1];
            GLES20.glActiveTexture(GLES20.GL_TEXTURE5);bind(texture,GLES20.GL_TEXTURE_2D);
            if(width!=nextW||height!=nextH){width=nextW;height=nextH;GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D,0,GLES20.GL_RGBA,width,height,0,GLES20.GL_RGBA,GLES20.GL_UNSIGNED_BYTE,null);}
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER,fbo);GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER,GLES20.GL_COLOR_ATTACHMENT0,GLES20.GL_TEXTURE_2D,texture,0);
            GLES20.glViewport(0,0,width,height);GLES20.glUseProgram(program);
            GLES20.glActiveTexture(GLES20.GL_TEXTURE6);GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,external);
            GLES20.glUniform1i(GLES20.glGetUniformLocation(program,"source"),6);GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(program,"transform"),1,false,transform,0);
            quad.position(0);GLES20.glVertexAttribPointer(0,2,GLES20.GL_FLOAT,false,0,quad);GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP,0,4);
            decodedFrames++;
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER,0);
        }
    }
    void bindTo(int cellProgram) {GLES20.glActiveTexture(GLES20.GL_TEXTURE5);GLES20.glBindTexture(GLES20.GL_TEXTURE_2D,texture);GLES20.glUniform1i(GLES20.glGetUniformLocation(cellProgram,"media"),5);GLES20.glUniform2f(GLES20.glGetUniformLocation(cellProgram,"mediaSize"),width,height);}
    synchronized void close() {
        if(player!=null){player.setOnPreparedListener(null);player.release();player=null;}
        if(surfaceTexture!=null){surfaceTexture.release();surfaceTexture=null;}
        if(bitmap!=null){bitmap.recycle();bitmap=null;}
        if(program!=0)GLES20.glDeleteProgram(program);
        if(fbo!=0)GLES20.glDeleteFramebuffers(1,new int[]{fbo},0);
        GLES20.glDeleteTextures(2,new int[]{texture,external},0);
    }
    private static void bind(int id,int type){GLES20.glBindTexture(type,id);GLES20.glTexParameteri(type,GLES20.GL_TEXTURE_MIN_FILTER,GLES20.GL_LINEAR);GLES20.glTexParameteri(type,GLES20.GL_TEXTURE_MAG_FILTER,GLES20.GL_LINEAR);GLES20.glTexParameteri(type,GLES20.GL_TEXTURE_WRAP_S,GLES20.GL_CLAMP_TO_EDGE);GLES20.glTexParameteri(type,GLES20.GL_TEXTURE_WRAP_T,GLES20.GL_CLAMP_TO_EDGE);}
    // At most 256 pixels on the longer side, keeping the aspect: tall media stays inside GL_MAX_TEXTURE_SIZE.
    static int[] fit(int w,int h){float scale=Math.min(1f,256f/Math.max(1,Math.max(w,h)));return new int[]{Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale))};}
}

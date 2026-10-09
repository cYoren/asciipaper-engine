package io.github.cyoren.asciipaper;

import android.app.Activity;
import android.app.WallpaperManager;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONObject;

// A fixed HTTPS asset origin; untrusted documents never receive the native bridge.
public final class StudioActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> chooser;
    private File export;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);web=new WebView(this);web.setBackgroundColor(android.graphics.Color.BLACK);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0);
        web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);web.addJavascriptInterface(new Bridge(),"AndroidPaper");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){return !trusted(r.getUrl());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest r){
                Uri u=r.getUrl();if(!trusted(u))return response(403,"External resources are unavailable in the app");
                String path=u.getPath();if(path==null||!path.startsWith("/app/")||path.contains(".."))return response(404,"Not found");
                try {String ext=MimeTypeMap.getFileExtensionFromUrl(path),mime=MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
                    if(ext.equals("js"))mime="text/javascript";if(ext.equals("glsl"))mime="text/plain";
                    return new WebResourceResponse(mime==null?"application/octet-stream":mime,"UTF-8",getAssets().open(path.substring(1)));
                }catch(Exception e){return response(404,"Not found");}
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> callback,FileChooserParams p){
                if(chooser!=null)chooser.onReceiveValue(null);chooser=callback;
                startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE),1);return true;
            }
        });
        if(android.os.Build.VERSION.SDK_INT>=30)web.setOnApplyWindowInsetsListener((view,insets)->{
            android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());
            view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;
        });
        setContentView(web);web.loadUrl("https://asciipaper.local/app/studio/index.html");
    }
    private static boolean trusted(Uri u){return "https".equals(u.getScheme())&&"asciipaper.local".equals(u.getHost());}
    private static WebResourceResponse response(int status,String text){return new WebResourceResponse("text/plain","UTF-8",status,status==403?"Forbidden":"Not Found",java.util.Map.of(),new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));}
    final class Bridge {
        @JavascriptInterface public String call(String method,String json) {
            try {
                JSONObject p=new JSONObject(json);
                switch(method){
                    case "downloadURL": {
                        java.net.URL url=new java.net.URL(p.getString("url"));
                        for(int redirects=0;redirects<6;redirects++){
                            if(!"https".equals(url.getProtocol())||url.getUserInfo()!=null)throw new IllegalArgumentException("Use a direct HTTPS image or video URL");
                            java.net.HttpURLConnection connection=(java.net.HttpURLConnection)url.openConnection();
                            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(30000);
                            try{
                                int status=connection.getResponseCode();
                                if(status>=300&&status<400){url=new java.net.URL(url,connection.getHeaderField("Location"));continue;}
                                if(status!=200)throw new IOException("Download failed: HTTP "+status);
                                String mime=connection.getContentType();if(mime!=null)mime=mime.split(";")[0];
                                if(mime==null||!mime.matches("(image|video)/[A-Za-z0-9.+-]+"))throw new IOException("Use a direct image or video URL");
                                if(connection.getContentLengthLong()>64*1024*1024)throw new IOException("Maximum media size is 64 MiB");
                                ByteArrayOutputStream out=new ByteArrayOutputStream();
                                try(InputStream input=connection.getInputStream()){byte[] buffer=new byte[32768];int count;while((count=input.read(buffer))!=-1){if(out.size()+count>64*1024*1024)throw new IOException("Maximum media size is 64 MiB");out.write(buffer,0,count);}}
                                return new JSONObject().put("mime",mime).put("data",android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP)).toString();
                            }finally{connection.disconnect();}
                        }throw new IOException("Too many redirects");
                    }
                    case "apply": {
                        JSONObject project=p.optJSONObject("project");
                        android.content.SharedPreferences prefs=getSharedPreferences(WallpaperService.PREFS,MODE_PRIVATE);
                        if(project==null){String name=p.getString("name");NativeScene.spec(name);prefs.edit().remove("project").putString(WallpaperService.WALLPAPER,name).apply();}
                        else {
                            JSONObject s=new JSONObject(project.getJSONObject("spec").toString());String shader=s.getString("shader");
                            if(!shader.matches("(?s).*\\bcell\\s*\\(.*")||shader.length()>262144)throw new IllegalArgumentException("Invalid embedded shader");
                            JSONObject media=project.optJSONObject("media");
                            if(media!=null){String data=media.getString("data"),name=media.getString("name");
                                if(data.length()>89478488||!name.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")||name.contains(".."))throw new IllegalArgumentException("Invalid media");
                                byte[] bytes=android.util.Base64.decode(data,android.util.Base64.DEFAULT);
                                byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder hash=new StringBuilder();for(byte b:digest)hash.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
                                File folder=new File(getFilesDir(),"media");folder.mkdirs();File target=new File(folder,hash+"-"+name);
                                if(!target.exists())Files.write(target.toPath(),bytes);s.put("mediaPath",target.getAbsolutePath());
                            }
                            Look.fromSpec(getAssets(),s);prefs.edit().putString("project",s.toString()).apply();
                        }return "{}";
                    }
                    case "wallpaper":runOnUiThread(()->startActivity(new Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT,new ComponentName(StudioActivity.this,WallpaperService.class))));return "{}";
                    case "quickEditor":runOnUiThread(()->startActivity(new Intent(StudioActivity.this,MainActivity.class)));return "{}";
                    case "pause":getSharedPreferences(WallpaperService.PREFS,MODE_PRIVATE).edit().putBoolean("paused",p.optBoolean("paused",false)).apply();return "{}";
                    case "options":getSharedPreferences(WallpaperService.PREFS,MODE_PRIVATE).edit().putInt("fps",p.optInt("fps",24)).putInt("idleFps",p.optInt("idleFps",12)).putFloat("pointer",(float)p.optDouble("pointer",1)).putBoolean("clicks",p.optBoolean("clicks",false)).apply();return "{}";
                    case "saveFile":{
                        String data=p.getString("data");if(data.length()>128*1024*1024)throw new IllegalArgumentException("File is too large");
                        if(export!=null)throw new IllegalStateException("Finish the current export first");
                        export=File.createTempFile("paper-export",".tmp",getCacheDir());Files.write(export.toPath(),android.util.Base64.decode(data,android.util.Base64.DEFAULT));
                        String name=p.getString("name"),mime=p.getString("mime");
                        runOnUiThread(()->startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(mime).addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,name),2));return "{}";
                    }
                    default:throw new IllegalArgumentException("Unknown platform action");
                }
            }catch(Exception e){try{return new JSONObject().put("error",String.valueOf(e.getMessage())).toString();}catch(Exception ignored){return "{\"error\":\"Platform action failed\"}";}}
        }
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==1&&chooser!=null){chooser.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);chooser=null;}
        if(request==2&&export!=null){File file=export;export=null;if(result==RESULT_OK&&data!=null){Uri uri=data.getData();new Thread(()->{try(OutputStream out=getContentResolver().openOutputStream(uri)){Files.copy(file.toPath(),out);}catch(Exception e){android.util.Log.e("asciipaper","Export failed",e);}finally{file.delete();}},"paper-export").start();}else file.delete();}
    }
    @Override protected void onPause(){web.evaluateJavascript("window.paperVisibility?.(true)",null);web.onPause();super.onPause();}
    @Override protected void onResume(){super.onResume();if(web!=null){web.onResume();web.evaluateJavascript("window.paperVisibility?.(false)",null);}}
    @Override protected void onDestroy(){if(chooser!=null)chooser.onReceiveValue(null);web.removeJavascriptInterface("AndroidPaper");web.destroy();if(export!=null)export.delete();super.onDestroy();}
}

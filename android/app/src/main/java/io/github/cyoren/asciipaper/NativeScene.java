package io.github.cyoren.asciipaper;

import org.json.JSONObject;

final class NativeScene {
    static { System.loadLibrary("asciipaper"); }
    static native String[] describe(String name);
    static native long create(String name, int program, int width, int height, int cols, int rows);
    static native void step(long handle, float dt, float x, float y, boolean down, float strength);
    static native void destroy(long handle);
    static JSONObject spec(String name) throws Exception {
        String[] a=describe(name); if(a==null)throw new IllegalArgumentException("Unknown scene");
        return new JSONObject().put("shader",a[0]).put("charset",a[1]).put("background",a[2]).put("scene",a[3])
                .put("cell",Double.parseDouble(a[4])).put("aspect",Double.parseDouble(a[5])).put("maxCells",Double.parseDouble(a[6]))
                .put("time",Double.parseDouble(a[7])).put("period",Double.parseDouble(a[8])).put("weight",Integer.parseInt(a[9]));
    }
}

package io.github.cyoren.asciipaper;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.zip.Deflater;
import java.util.zip.DeflaterOutputStream;
import java.util.zip.InflaterInputStream;

// Existing desktop/web v1 format: UTF-8 JSON, zlib, unpadded URL-safe Base64.
// No Android dependencies: interoperability is tested against the desktop codec.
final class Recipe {
    static final String PREFIX = "asciipaper:v1:";
    static final int MAX_BYTES = 256 * 1024;

    static String encode(String json) throws IOException {
        byte[] utf8 = json.getBytes(StandardCharsets.UTF_8);
        if (utf8.length > MAX_BYTES) throw new IOException("Look code is too large");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Deflater deflater = new Deflater(9);
        try (DeflaterOutputStream zip = new DeflaterOutputStream(bytes, deflater)) { zip.write(utf8); }
        finally { deflater.end(); }
        return PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes.toByteArray());
    }

    static String decode(String code) throws IOException {
        code = code.trim();
        if (!code.startsWith(PREFIX)) throw new IOException("A look code starts with " + PREFIX);
        if (code.length() > MAX_BYTES * 2) throw new IOException("Look code is too large");
        byte[] compressed;
        try { compressed = Base64.getUrlDecoder().decode(code.substring(PREFIX.length())); }
        catch (IllegalArgumentException e) { throw new IOException("Not a readable look code", e); }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InflaterInputStream zip = new InflaterInputStream(new ByteArrayInputStream(compressed))) {
            byte[] buffer = new byte[4096];
            for (int count; (count = zip.read(buffer)) != -1; ) {
                if (bytes.size() + count > MAX_BYTES) throw new IOException("Look code is too large");
                bytes.write(buffer, 0, count);
            }
        }
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }
}
